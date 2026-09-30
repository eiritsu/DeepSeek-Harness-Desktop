/**
 * Driver-owned durable agent inbox projection and command facade.
 *
 * @module @deepseek-ai/dsh-agent-loop/inbox
 */

import type { MessageId } from '@deepseek-ai/dsh-llm'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { Session, SessionEventMap, UserMessage } from '@deepseek-ai/dsh-session'
import type {
  AgentEventDispatch,
  Inbox as InboxContract,
  InboxState,
  InboxTarget,
  InboxWireState,
  SurfaceReplacement,
  SurfaceReplacements,
} from '@deepseek-ai/dsh-agent'
import { z } from 'zod'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** Wire validation for pending agent input reconstructed from durable inbox splices. */
export const inboxProjectionSchema = z.object({
  'next-turn': z.array(z.custom<UserMessage>()).readonly(),
  'next-step': z.array(z.custom<UserMessage>()).readonly(),
  replacements: z.record(z.string(), z.custom<SurfaceReplacement>()).readonly(),
}).readonly()

/**
 * Wire validation for the delivered pending value. A queued resend's surface
 * range is admitted by the host driver and has no client consumer, so the wire
 * carries only the two pending lists as lossless JSON.
 */
export const inboxWireSchema: z.ZodType<InboxWireState> = z.object({
  'next-turn': z.array(z.custom<JsonValue>()).readonly(),
  'next-step': z.array(z.custom<JsonValue>()).readonly(),
}).readonly()

/**
 * Fold one normalized splice, keeping each pending resend's surface range under
 * the identity of the message that carries it. A range leaves the pending value
 * with the message it belongs to, whether that message was removed, replaced in
 * place, or claimed.
 * @param state - pending input before the splice.
 * @param target - pending list the splice mutates.
 * @param start - validated splice position.
 * @param removedCount - validated number of removed messages.
 * @param inserted - messages inserted at the resolved position.
 * @param replacements - surface ranges this event records for inserted messages.
 * @returns the next pending value.
 */
function applySplice(
  state: InboxState,
  target: InboxTarget,
  start: number,
  removedCount: number,
  inserted: readonly UserMessage[],
  replacements: SurfaceReplacements | undefined,
): InboxState {
  const pending = state[target]
  const removedIds = new Set<string>(pending.slice(start, start + removedCount).map(message => message.id))
  const next: Record<string, SurfaceReplacement> = {}
  for (const [id, replacement] of Object.entries(state.replacements)) {
    if (!removedIds.has(id)) next[id] = replacement
  }
  for (const [id, replacement] of Object.entries(replacements ?? {})) next[id] = replacement
  return {
    'next-turn': target === 'next-turn' ? pending.toSpliced(start, removedCount, ...inserted) : state['next-turn'],
    'next-step': target === 'next-step' ? pending.toSpliced(start, removedCount, ...inserted) : state['next-step'],
    replacements: next,
  }
}

/** Standard fold that reconstructs pending input and rejects invalid durable splice history. */
export const inboxProjectionDefinition = {
  key: 'inbox',
  stateSchema: inboxProjectionSchema,
  init: (): InboxState => ({ 'next-turn': [], 'next-step': [], replacements: {} }),
  apply(state: InboxState, event) {
    if (event.type !== 'agent/inbox/spliced') return state
    const splice = event.data
    try {
      const inbox = state[splice.target]
      const removedCount = splice.removedCount ?? 0
      if (!Number.isSafeInteger(splice.start) || splice.start < 0 || splice.start > inbox.length
        || !Number.isSafeInteger(removedCount) || removedCount < 0
        || splice.start + removedCount > inbox.length) {
        throw new Error('invalid inbox splice')
      }
      const next = inbox.toSpliced(splice.start, removedCount, ...splice.inserted)
      const ids = new Set<string>()
      for (const message of splice.target === 'next-turn'
        ? [...next, ...state['next-step']]
        : [...state['next-turn'], ...next]) {
        if (ids.has(message.id)) throw new Error(`message "${message.id}" is already pending`)
        ids.add(message.id)
      }
      const insertions = new Set<string>(splice.inserted.map(message => message.id))
      for (const id of Object.keys(splice.replacements ?? {})) {
        if (!insertions.has(id)) throw new Error(`resend "${id}" is not an inserted message`)
      }
      return applySplice(state, splice.target, splice.start, removedCount, splice.inserted, splice.replacements)
    } catch (error: unknown) {
      throw new Error(`invalid persisted inbox splice at session seq ${event.seq}`, { cause: error })
    }
  },
  wire: {
    // Pending messages round-trip the session log as lossless JSON, so the wire
    // value is the fold state's two pending lists. The schema owns the JSON-safe
    // projection type, so validating here yields it without an unknown cast. The
    // resend ranges stay on the host fold state and never reach a client consumer.
    viewSchema: inboxWireSchema,
    view: (state: InboxState): InboxWireState => inboxWireSchema.parse({
      'next-turn': state['next-turn'],
      'next-step': state['next-step'],
    }),
  },
  // Version 2 adds `replacements` to the fold state. A version-1 cached row
  // predates the field and would replay as a state without it, so it is
  // discarded and refolded from the log rather than migrated.
  stateVersion: 2,
} satisfies ProjectionDefinition<'inbox', InboxState>

/**
 * The batch one proposed step claims, with the surface ranges its resends carry.
 */
export interface ClaimedInput {
  /** Next-step input followed by the queued turn, when the boundary requests one. */
  readonly messages: UserMessage[]
  /** Surface ranges of the claimed resends, keyed by message identity. */
  readonly replacements: SurfaceReplacements
}

/** What one committed mutation took out of the pending value. */
interface InboxMutation {
  /** Messages removed by the splice. */
  readonly removed: UserMessage[]
  /** Surface ranges that left the pending value with those messages. */
  readonly removedReplacements: SurfaceReplacements
}

/**
 * Driver-owned durable Inbox implementation used by ReactLoopAgent and focused
 * provider tests.
 * @param projections - registry with the standard Inbox projection registered by AgentLoop.
 * @param session - session whose durable events store pending input.
 * @param dispatch - agent-scoped notifications for Inbox lifecycle events.
 */
export class ReactLoopInbox implements InboxContract {
  constructor(
    private readonly projections: SessionProjectionRegistry,
    private readonly session: Session,
    private readonly dispatch: AgentEventDispatch,
  ) {}

  /** Prompts awaiting individual turns. */
  get nextTurn(): readonly UserMessage[] {
    return this.current()['next-turn']
  }

  /** Input awaiting the next step boundary. */
  get nextStep(): readonly UserMessage[] {
    return this.current()['next-step']
  }

  /** Whether either pending-message list contains work. */
  get hasPending(): boolean {
    const state = this.current()
    return state['next-turn'].length > 0 || state['next-step'].length > 0
  }

  /** Durably cancel all pending input, clearing next-step before next-turn. */
  clear(): void {
    this.splice('next-step', 0, this.nextStep.length, [])
    this.splice('next-turn', 0, this.nextTurn.length, [])
  }

  /**
   * Remove and return the complete batch proposed for one step.
   * @param target - whether this boundary also consumes one queued turn.
   * @param turn - turn that will own the claimed batch.
   * @returns next-step input followed by the queued turn, when requested, with
   * the surface ranges the claimed resends carry.
   */
  claim(target: InboxTarget, turn: number): ClaimedInput {
    const step = this.mutate('next-step', 0, this.nextStep.length, [], false)
    const claimed: UserMessage[] = [...step.removed]
    let replacements: SurfaceReplacements = {}
    if (target === 'next-turn') {
      const next = this.mutate('next-turn', 0, 1, [], false)
      claimed.push(...next.removed)
      replacements = next.removedReplacements
    }
    for (const message of claimed) this.dispatch.emit('agent/inbox/claimed', { message, turn })
    return { messages: claimed, replacements }
  }

  /**
   * Append one message to a pending list.
   * @param target - pending list to extend.
   * @param message - message to append.
   */
  append(target: InboxTarget, message: UserMessage): void {
    this.splice(target, this.current()[target].length, 0, [message])
  }

  /**
   * Prepend one message to a pending list.
   * @param target - pending list to extend.
   * @param message - message to prepend.
   */
  prepend(target: InboxTarget, message: UserMessage): void {
    this.splice(target, 0, 0, [message])
  }

  /**
   * Replace one pending message in place.
   * @param messageId - identity of the pending message to replace.
   * @param newMessage - replacement message.
   * @returns whether the message was still pending.
   */
  replace(messageId: MessageId, newMessage: UserMessage): boolean {
    const location = this.locate(messageId)
    if (location === undefined) return false
    this.splice(location.target, location.index, 1, [newMessage])
    return true
  }

  /**
   * Remove one pending message.
   * @param messageId - identity of the pending message to remove.
   * @returns whether the message was still pending.
   */
  remove(messageId: MessageId): boolean {
    const location = this.locate(messageId)
    if (location === undefined) return false
    this.splice(location.target, location.index, 1, [])
    return true
  }

  /**
   * Apply standard splice semantics and durably record the normalized result.
   * @param target - pending list to mutate.
   * @param start - splice position.
   * @param deleteCount - maximum number of messages to remove.
   * @param inserted - messages to insert at the resolved position.
   * @param replacements - surface ranges of inserted resends, keyed by inserted message identity.
   * @returns messages removed by the splice.
   */
  splice(
    target: InboxTarget,
    start: number,
    deleteCount: number,
    inserted: UserMessage[],
    replacements?: SurfaceReplacements,
  ): UserMessage[] {
    return this.mutate(target, start, deleteCount, inserted, true, replacements).removed
  }

  /** Locate one pending identity across both owned lists. */
  private locate(messageId: MessageId): { target: InboxTarget; index: number } | undefined {
    const state = this.current()
    for (const target of ['next-turn', 'next-step'] as const) {
      const index = state[target].findIndex(message => message.id === messageId)
      if (index >= 0) return { target, index }
    }
    return undefined
  }

  /** Read the current durable projection state. */
  private current(): InboxState {
    const state = this.projections.stateOf(this.session, 'inbox')
    if (state === undefined) {
      throw new Error(
        `agent "${this.session.id}" cannot read inbox state: its projection registration is not active`,
      )
    }
    return state
  }

  /** Commit one normalized mutation and publish its live events. */
  private mutate(
    target: InboxTarget,
    start: number,
    deleteCount: number,
    inserted: UserMessage[],
    discardRemoved: boolean,
    replacements?: SurfaceReplacements,
  ): InboxMutation {
    const state = this.current()
    const inbox = state[target]
    const truncatedStart = Math.trunc(start)
    const offset = Number.isNaN(truncatedStart) ? 0 : truncatedStart
    const actualStart = offset < 0
      ? Math.max(inbox.length + offset, 0)
      : Math.min(offset, inbox.length)
    const truncatedDeleteCount = Math.trunc(deleteCount)
    const actualDeleteCount = Math.min(
      Math.max(Number.isNaN(truncatedDeleteCount) ? 0 : truncatedDeleteCount, 0),
      inbox.length - actualStart,
    )
    if (actualDeleteCount === 0 && inserted.length === 0) return { removed: [], removedReplacements: {} }
    const candidate = inbox.toSpliced(actualStart, actualDeleteCount, ...inserted)
    const ids = new Set<string>()
    for (const message of target === 'next-turn'
      ? [...candidate, ...state['next-step']]
      : [...state['next-turn'], ...candidate]) {
      if (ids.has(message.id)) throw new Error(`message "${message.id}" is already pending`)
      ids.add(message.id)
    }
    const insertions = new Set<string>(inserted.map(message => message.id))
    for (const id of Object.keys(replacements ?? {})) {
      if (!insertions.has(id)) throw new Error(`resend "${id}" is not an inserted message`)
    }
    const outcome = discardRemoved && actualDeleteCount > 0 ? 'canceled' as const : undefined
    const splice: SessionEventMap['agent/inbox/spliced'] = {
      target,
      start: actualStart,
      ...(actualDeleteCount === 0 ? {} : { removedCount: actualDeleteCount }),
      inserted,
      ...(outcome === undefined ? {} : { outcome }),
      ...(replacements === undefined ? {} : { replacements }),
    }
    const removed = inbox.slice(actualStart, actualStart + actualDeleteCount)
    const removedIds = new Set<string>(removed.map(message => message.id))
    const removedReplacements: Record<string, SurfaceReplacement> = {}
    for (const [id, replacement] of Object.entries(state.replacements)) {
      if (removedIds.has(id)) removedReplacements[id] = replacement
    }
    const event = this.session.append('agent/inbox/spliced', splice)
    if (discardRemoved) {
      for (const message of removed) this.dispatch.emit('agent/inbox/discarded', { message })
    }
    for (const message of event.data.inserted) {
      this.dispatch.emit('agent/inbox/inserted', { message })
    }
    return { removed, removedReplacements }
  }
}
