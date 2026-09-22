import type { Context } from '@deepseek-ai/cordis'
import type {
  AssistantBlock, ConversationMatch, ConversationNodeContext, ConversationNodeDefinition, TurnLocation,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-llm-retry/types'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { deriveTurnTokenUsage } from '@deepseek-ai/dsh-token-meter/client'
import type {
  AssistantChatData, FinalAssistantChatData, TurnTailChatData,
} from '../contract/chat-nodes.ts'
import { deriveTurnMetrics } from '../contract/turn-metrics.ts'
import { CHAT_SYNTHETIC_SEQ_OFFSETS, chatNode } from './common.ts'
import { toAssistantBlocks } from './event-projection.ts'

declare module '../contract/chat-nodes.ts' {
  interface ChatNodeDataMap {
    /** Completed-turn actions and extension tail. */
    'turn-tail': TurnTailChatData
  }
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationTurnDataMap {
    /** Closing Assistant and footer facts derived for this completed Turn. */
    'turn-tail': TurnTailChatData
  }
}

interface TurnTailState {
  readonly turn: number
  readonly end?: ConversationMatch
}

interface StepEvidence {
  readonly streamedText: boolean
  readonly finalized: boolean
}

function isSessionEvent(event: ConversationMatch['event']): event is SessionEvent {
  return event.type !== 'assistant/live-chunk'
}

function hasTextAssistant(event: Parameters<ConversationNodeDefinition['match']>[0]): boolean {
  return event.type === 'assistant/message'
    && event.surfaceOp === 'append'
    && toAssistantBlocks(event.data.message.content)
      .some(block => block.kind === 'text' && block.text.trim() !== '')
}

function chunkHasText(chunk: StreamChunk): boolean {
  if (chunk.type === 'text-delta') return chunk.text.trim() !== ''
  return chunk.type === 'block-end'
    && chunk.block.type === 'text'
    && chunk.block.text.trim() !== ''
}

function turnCoordinates(event: Parameters<ConversationNodeDefinition['match']>[0]): {
  readonly turn: number
  readonly step?: number
} | undefined {
  if (event.type === 'assistant/message'
    || event.type === 'assistant/attempt'
    || event.type === 'assistant/live-chunk'
    || event.type === 'step/start'
    || event.type === 'step/end') {
    return { turn: event.data.turn, step: event.data.step }
  }
  if (event.type === 'llm/retry' || event.type === 'llm/retry-started') {
    return { turn: event.data.turn, step: event.data.step }
  }
  return undefined
}

function closingAnchor(context: ConversationNodeContext<TurnTailState>): number {
  let anchor = context.matches.find(match => match.event.type === 'turn/end')?.event.seq
    ?? context.start?.event.seq
    ?? context.matches[0]?.event.seq
    ?? 0
  const steps = new Map<number, StepEvidence>()
  for (const match of context.matches) {
    const event = match.event
    if (event.type === 'turn/end') continue
    const coordinates = turnCoordinates(event)
    if (coordinates?.step === undefined) continue
    const previous = steps.get(coordinates.step) ?? { streamedText: false, finalized: false }
    if (event.type === 'assistant/live-chunk') {
      steps.set(coordinates.step, {
        ...previous,
        streamedText: previous.streamedText || chunkHasText(event.data.chunk),
      })
      continue
    }
    if (event.type === 'assistant/message') {
      steps.set(coordinates.step, { streamedText: false, finalized: true })
      if (hasTextAssistant(event)) {
        anchor = event.seq + CHAT_SYNTHETIC_SEQ_OFFSETS.finalizedFollowup
      }
      continue
    }
    if (event.type === 'llm/retry') {
      steps.set(coordinates.step, { streamedText: false, finalized: false })
      continue
    }
    if (event.type === 'step/end' && previous.streamedText && !previous.finalized) {
      anchor = event.seq + CHAT_SYNTHETIC_SEQ_OFFSETS.interruptedFollowup
    }
  }
  return anchor
}

function turnLocation(context: ConversationNodeContext<TurnTailState>): TurnLocation | undefined {
  const location = context.start?.location ?? context.matches[0]?.location
  return location?.kind === 'turn' || location?.kind === 'step' ? location.turn : undefined
}

function hasClosingContent(data: AssistantChatData): data is FinalAssistantChatData {
  if (data.finalNode === undefined) return false
  // An interrupted prefix may hold only reasoning or an undispatched tool call;
  // any delivered block keeps the answer closable, while a settled answer needs
  // durable text to own the Turn footer.
  if (data.status === 'interrupted') return hasInterruptionEvidence(data.blocks)
  return data.blocks.some(block => block.kind === 'text' && block.text.trim() !== '')
}

/** Whether one block carries content an interrupted answer delivered. */
function hasInterruptionEvidence(blocks: readonly AssistantBlock[]): boolean {
  return blocks.some((block) => {
    if (block.kind === 'text' || block.kind === 'reasoning') return block.text.trim() !== ''
    return true
  })
}

/** Whether one Assistant is a log-only attempt that settled without any block. */
function isEmptyLogOnlyAttempt(data: FinalAssistantChatData): boolean {
  return data.status === 'interrupted'
    && data.finalNode.attemptSeq !== undefined
    && data.blocks.length === 0
}

/** Count one Turn's durable assistant settlements, surface messages and log-only attempts. */
function settlementCount(matches: readonly ConversationMatch[]): number {
  let count = 0
  for (const match of matches) {
    const settlement = match.event.type === 'assistant/attempt'
      || (match.event.type === 'assistant/message' && match.event.surfaceOp === 'append')
    if (settlement) count += 1
  }
  return count
}

function tailData(context: ConversationNodeContext<TurnTailState>): TurnTailChatData | null {
  const end = context.state === undefined
    ? context.matches.find(match => match.event.type === 'turn/end')
    : context.state.end
  if (end?.event.type !== 'turn/end') return null
  const turn = turnLocation(context)
  if (turn === undefined) return null
  const assistants = turn.steps
    .map(step => step.data.get('assistant-step'))
    .filter((candidate): candidate is Readonly<AssistantChatData> => candidate !== undefined)
  const finalized = assistants
    .filter((candidate): candidate is Readonly<FinalAssistantChatData> => candidate.finalNode !== undefined)
    .sort((left, right) => left.finalNode.seq - right.finalNode.seq)
  // A Turn whose sole durable settlement is an empty log-only attempt still has
  // a stopped answer to own its footer: no block arrived, but the attempt is the
  // interruption. A content-bearing answer keeps the footer when both exist.
  const soleSettlement = finalized.length === 1 ? finalized[0] : undefined
  const closing = finalized.findLast(hasClosingContent)
    ?? (soleSettlement !== undefined && isEmptyLogOnlyAttempt(soleSettlement) ? soleSettlement : null)
  let latestTranscriptSeq = finalized.at(-1)?.finalNode.seq
  for (const match of context.matches) {
    const event = match.event
    const candidate = event.type === 'tool/call'
      || (event.type === 'tool/result' && event.surfaceOp === 'append')
      || (event.type === 'turn/end' && event.data.reason.kind === 'error')
      || event.type === 'llm/retry'
      ? event.seq
      : undefined
    if (candidate !== undefined && (latestTranscriptSeq === undefined || candidate > latestTranscriptSeq)) {
      latestTranscriptSeq = candidate
    }
  }
  const metrics = deriveTurnMetrics(finalized.map(candidate => candidate.finalNode)).get(end.event.data.turn)
  const tokenUsage = context.start?.event.type === 'turn/start'
    ? deriveTurnTokenUsage(context.matches.map(match => match.event).filter(isSessionEvent))
    : undefined
  const branchUnavailable = closing === null || latestTranscriptSeq !== closing.finalNode.seq
  // Edit-and-resend replays the Turn's opening prompt over its closing answer,
  // so it is safe only when that answer is the Turn's sole settlement and no
  // tool call or result intervened. A surface message is resendable when it was
  // interrupted or when its Turn completed normally; a log-only attempt carries
  // no interruption marker, so its Turn must have ended aborted or
  // crash-repaired and must hold exactly one settlement for the address to be
  // unambiguous.
  const logOnlyAttempt = closing !== null && closing.finalNode.messageId === undefined
  const endReason = end.event.data.reason.kind
  const interruptionReason = endReason === 'aborted' || endReason === 'interrupted'
  const resendable = closing !== null
    && finalized.length === 1
    && !branchUnavailable
    && (logOnlyAttempt
      ? closing.status === 'interrupted' && interruptionReason && settlementCount(context.matches) === 1
      : closing.status === 'interrupted' || (closing.status === 'settled' && endReason === 'completed'))
    && !context.matches.some(match =>
      match.event.type === 'tool/call' || match.event.type === 'tool/result')
  return {
    turn: end.event.data.turn,
    seq: end.event.seq,
    time: end.event.time,
    closing,
    branchUnavailable,
    resendable,
    // Resume re-spends one model request over the stopped Turn's own surface,
    // so it is offered for exactly the Turns a stop closed.
    resumable: interruptionReason,
    ...metrics?.ttftMs === undefined ? {} : { ttftMs: metrics.ttftMs },
    ...metrics?.tokensPerSecond === undefined ? {} : { tokensPerSecond: metrics.tokensPerSecond },
    ...tokenUsage === undefined ? {} : { tokenUsage },
  }
}

/** Completed-turn footer Definition independent of any Assistant row. */
export const turnTailDefinition: ConversationNodeDefinition<TurnTailState> = {
  kind: 'turn-tail',
  target: 'chat',
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'turn/end') return { id: String(event.data.turn), role: 'update' }
    if (event.type === 'tool/call' || event.type === 'tool/result') {
      return { id: String(event.data.turn), role: 'update' }
    }
    const coordinates = turnCoordinates(event)
    if (coordinates !== undefined) return { id: String(coordinates.turn), role: 'update' }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('turn-tail start requires turn/start')
    return { turn: match.event.data.turn }
  },
  update: (context, match) => match.event.type === 'turn/end'
    ? { ...context.state, end: match }
    : context.state,
  publication: match => match.event.type === 'turn/end' ? 'immediate' : 'none',
  buildLocationData: (context, scope) => {
    if (scope !== 'turn') return null
    const value = tailData(context)
    return value === null ? null : {
      kind: 'turn',
      turn: value.turn,
      key: 'turn-tail',
      value,
    }
  },
  buildViewNode: (context) => {
    const turn = turnLocation(context)
    const data = turn?.data.get('turn-tail')
    return data === undefined ? null : chatNode(context, 'turn-tail', closingAnchor(context), data)
  },
}

/**
 * Register completed-Turn footer data and its Chat node contribution.
 * @param ctx - owning UI Conversation context.
 */
export function registerTurnTailConversationNode(ctx: Context): void {
  ctx.uiConversation.events.register(turnTailDefinition)
}
