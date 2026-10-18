/**
 * Web edit-and-resend plugin: the user-message edit entry and the in-place
 * editor that takes the edited message's place, over the Host `turnResend`
 * Remote. Copy rides the standard locale seat; the entry and the editor share
 * one Session-keyed store and one body claim.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { UserMessageBodyOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-session-turn-edit-resend/remote'
import type { ResendOperationId, ResendSubmission } from '@deepseek-ai/dsh-session-turn-edit-resend/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { TurnResendAction, type TurnResendActionInjected, type TurnResendBegin } from './TurnResendAction.tsx'
import { TurnResendBody, type TurnResendBodyInjected, type TurnResendBodyMatch } from './TurnResendBody.tsx'
import { en, zh, type TurnResendKey } from './locales.ts'
import { createTurnResendStore, type TurnResendEdit, type TurnResendOutcome } from './store.ts'

export type { TurnResendKey } from './locales.ts'
export type { TurnResendEdit, TurnResendNotice, TurnResendOutcome } from './store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The edit-and-resend entry, editor, and notice copy. */
    turnResend: TurnResendKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'turnResend'

/** Required services: slot registry, the turnResend Remote, copy, and body claims. */
export const inject = ['slots', 'remote', 'remote.turnResend', 'locale', 'uiChat']

/**
 * Map one Remote result to the editor's next state. `undefined` means admitted,
 * which closes the presentation; every other outcome is reported as the log
 * proves it, including the uncertain case that must never invite a repeat.
 * @param result - the Host's answer for one submission.
 * @returns the outcome to settle, or undefined when the edit was admitted.
 */
function submissionOutcome(result: RemoteResult<ResendSubmission>): TurnResendOutcome | undefined {
  if (!result.ok) return { kind: 'remote-failed', code: result.error.code }
  if (!result.value.recorded) return { kind: 'not-admitted' }
  switch (result.value.operation.outcome) {
    case 'admitted':
      return undefined
    case 'refused':
      return { kind: 'refused', refusal: result.value.operation.refusal }
    case 'failed':
      return { kind: 'failed', reason: result.value.operation.reason }
    case 'pending':
      return { kind: 'pending' }
    case 'uncertain':
      return { kind: 'uncertain' }
  }
}

/**
 * Register the `turnResend` dictionaries, the user-message edit entry, and the
 * in-place body editor.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-turn-edit-resend: dictionaries')
  const store = createTurnResendStore()
  // One body claim per Session: a newer presentation replaces the older claim,
  // and the registry makes the replaced claim's release a no-op.
  const claims = new Map<string, () => void>()
  const release = (sessionId: string): void => {
    claims.get(sessionId)?.()
    claims.delete(sessionId)
  }
  ctx.effect(() => () => {
    for (const claim of claims.values()) claim()
    claims.clear()
  }, 'ui-turn-edit-resend: message body claims')
  const claimBody = (sessionId: SessionId, seq: number): void => {
    release(String(sessionId))
    claims.set(String(sessionId), ctx.uiChat.claimUserMessageBody(sessionId, seq, 'turn-edit-resend'))
  }

  ctx.slots.inject('conversation.chat.user-actions', () => ctx.slots.register({
    name: 'conversation.chat.user-actions',
    id: 'turn-edit-resend',
    locale: NS,
    store,
    inject: (sessionId: SessionId): TurnResendActionInjected => ({
      beginEdit: async (seq: number): Promise<TurnResendBegin> => {
        const result = await ctx.remote.turnResend.check(sessionId)
        if (!result.ok) {
          claimBody(sessionId, seq)
          return {
            kind: 'notice',
            sessionId: String(sessionId),
            seq,
            outcome: { kind: 'remote-failed', code: result.error.code },
          }
        }
        if (!result.value.eligible) {
          claimBody(sessionId, seq)
          return {
            kind: 'notice',
            sessionId: String(sessionId),
            seq,
            outcome: { kind: 'refused', refusal: result.value.refusal },
          }
        }
        // The Host re-selects the latest turn; a click on any other prompt must
        // not open an editor for a turn that prompt does not own.
        if (result.value.startSeq !== seq) return { kind: 'none' }
        claimBody(sessionId, seq)
        return {
          kind: 'edit',
          edit: {
            sessionId: String(sessionId),
            operationId: randomUUID(),
            turn: result.value.turn,
            startSeq: result.value.startSeq,
            text: result.value.text,
            toolCalls: result.value.toolCalls,
          },
        }
      },
    }),
  }, TurnResendAction))

  ctx.slots.inject('conversation.chat.user-body', () => ctx.slots.register({
    name: 'conversation.chat.user-body',
    // The chain elects on owner props alone; `claimed` is the Chat service's
    // per-message claim, so this entry renders exactly while it owns the body.
    select: ({ seq, claimed }: UserMessageBodyOwnerProps): TurnResendBodyMatch | null =>
      claimed ? { seq } : null,
    locale: NS,
    store,
    inject: (sessionId: SessionId): TurnResendBodyInjected => ({
      sessionId: String(sessionId),
      release: () => { release(String(sessionId)) },
      submit: async (edit: TurnResendEdit): Promise<TurnResendOutcome | undefined> => submissionOutcome(
        await ctx.remote.turnResend.submit(
          sessionId,
          { operationId: edit.operationId as ResendOperationId, text: edit.text },
          new AbortController().signal,
        ),
      ),
    }),
  }, TurnResendBody))
}
