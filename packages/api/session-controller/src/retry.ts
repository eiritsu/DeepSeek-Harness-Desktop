/** Resolve one retryable interrupted-assistant turn from a Session log. */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import { foldSurface } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionSeq } from '@deepseek-ai/dsh-session'

/** Durable facts for one retryable interrupted-assistant turn. */
export interface InterruptedRetryTarget {
  /** Inclusive surface seq of the replayable prompt. */
  readonly promptSeq: SessionSeq
  /** Inclusive surface seq of the interrupted assistant answer. */
  readonly interruptedSeq: SessionSeq
  /** Every shadowed surface node, in surface order. */
  readonly shadowedSeqs: readonly SessionSeq[]
  /** Durable prompt content the retry replays. */
  readonly promptContent: readonly ContentBlock[]
}

/** Whether one surface event is the turn's replayable prompt. */
function isReplayablePrompt(event: SessionEvent): event is SessionEvent<'user/message'> {
  if (event.type !== 'user/message') return false
  const kind = event.data.source.kind
  return kind === 'user' || kind === 'assistant-retry'
}

/**
 * Whether one surface event may sit before the prompt or between the prompt and
 * the interrupted answer: injected user-role context and system-prompt nodes.
 * A tool result, another assistant message, or a second replayable prompt is
 * ambiguous and rejects.
 */
function isAllowedContext(event: SessionEvent): boolean {
  if (event.type === 'system/message') return true
  if (event.type !== 'user/message') return false
  const kind = event.data.source.kind
  return kind !== 'user' && kind !== 'assistant-retry'
}

/**
 * Resolve the latest retryable interrupted-assistant turn in one Session log.
 *
 * The current surface must end with the latest closed turn's interrupted
 * `assistant/message` whose id is `messageId`. Within that turn's current
 * surface range, the resolver locates the replayable prompt — an ordinary
 * `user/message` or a previous retry's `assistant-retry` — and accepts only
 * injected context and system nodes between it and the interrupted answer.
 * The returned range and provenance cover every shadowed node from the prompt
 * through the interrupted answer. A running turn, a tool call or result, a
 * second assistant answer, a second replayable prompt, or no replayable prompt
 * all reject.
 * @param events - complete ordered Session log.
 * @param messageId - interrupted assistant message the caller addressed.
 * @returns the resolved target, or undefined when the tail is not retryable.
 */
export function resolveInterruptedRetryTarget(
  events: readonly SessionEvent[],
  messageId: MessageId,
): InterruptedRetryTarget | undefined {
  const { nodes } = foldSurface(events)
  const interruptedSeq = nodes.at(-1)
  if (interruptedSeq === undefined) return undefined
  const interrupted = events[interruptedSeq]
  if (interrupted?.type !== 'assistant/message' || interrupted.data.interrupted !== true) return undefined
  if (interrupted.data.message.id !== messageId) return undefined
  const turn = interrupted.data.turn
  const turnStart = events.findLast(event => event.type === 'turn/start')
  if (turnStart?.data.turn !== turn) return undefined
  if (!events.some(event => event.type === 'turn/end' && event.data.turn === turn && event.seq > interruptedSeq)) {
    return undefined
  }
  if (events.some(event =>
    (event.type === 'tool/call' || event.type === 'tool/result') && event.data.turn === turn)) {
    return undefined
  }
  // Every current surface node after the turn's own start belongs to this turn,
  // and its last node is the interrupted answer verified above.
  const turnNodes = nodes.filter(seq => seq > turnStart.seq)
  let promptSeq: SessionSeq | undefined
  for (const seq of turnNodes.slice(0, -1)) {
    const event = events[seq] as SessionEvent
    if (isReplayablePrompt(event)) {
      // A second replayable prompt makes the turn ambiguous.
      if (promptSeq !== undefined) return undefined
      promptSeq = seq
      continue
    }
    if (!isAllowedContext(event)) return undefined
  }
  if (promptSeq === undefined) return undefined
  const prompt = events[promptSeq] as SessionEvent<'user/message'>
  return {
    promptSeq,
    interruptedSeq,
    shadowedSeqs: turnNodes.slice(turnNodes.indexOf(promptSeq)),
    promptContent: prompt.data.content,
  }
}
