/** Resolve one retryable interrupted-assistant turn from a Session log. */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { foldSurface } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionInterruptedRetryTarget } from './types.ts'

/** Durable facts for one retryable interrupted-assistant turn. */
export interface InterruptedRetryTarget {
  /** Inclusive surface seq of the replayable prompt. */
  readonly promptSeq: SessionSeq
  /**
   * Inclusive surface seq the replacement ends at: the interrupted
   * `assistant/message`, or the log-only attempt turn's last surface node.
   */
  readonly endSeq: SessionSeq
  /**
   * Every source event the replacement cites, in log order: the shadowed
   * surface nodes plus a log-only interrupted attempt.
   */
  readonly sourceSeqs: readonly SessionSeq[]
  /** Durable prompt content the retry replays. */
  readonly promptContent: readonly ContentBlock[]
}

/** The latest turn whose surface and durable settlements can be retried. */
interface RetryableTurn {
  readonly turn: number
  readonly turnStart: SessionEvent<'turn/start'>
  /** Durable seq of the interrupted settlement the retry replaces. */
  readonly settlementSeq: SessionSeq
  readonly logOnlyAttempt: boolean
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
 * Prove the settlement closes the latest closed Turn and that the Turn carries
 * no tool side effect. `turn` is the settlement's durable turn.
 */
function latestClosedTurn(
  events: readonly SessionEvent[],
  turn: number,
  settlementSeq: number,
): { readonly turnStart: SessionEvent<'turn/start'>; readonly turnEnd: SessionEvent<'turn/end'> } | undefined {
  const turnStart = events.findLast(event => event.type === 'turn/start')
  if (turnStart === undefined || turnStart.data.turn !== turn) return undefined
  const turnEnd = events.findLast(event => event.type === 'turn/end')
  if (turnEnd === undefined || turnEnd.data.turn !== turn || turnEnd.seq <= settlementSeq) return undefined
  if (events.some(event =>
    (event.type === 'tool/call' || event.type === 'tool/result') && event.data.turn === turn)) {
    return undefined
  }
  return { turnStart, turnEnd }
}

/** Locate the addressed `assistant/message` and prove it closes the latest Turn. */
function messageTurn(
  events: readonly SessionEvent[],
  messageId: string,
): RetryableTurn | undefined {
  const settlement = events.find((event): event is SessionEvent<'assistant/message'> =>
    event.type === 'assistant/message'
    && event.data.message.id === messageId
    && event.data.interrupted === true)
  if (settlement === undefined) return undefined
  const turn = latestClosedTurn(events, settlement.data.turn, settlement.seq)
  if (turn === undefined) return undefined
  return { turn: settlement.data.turn, turnStart: turn.turnStart, settlementSeq: settlement.seq, logOnlyAttempt: false }
}

/** Locate the addressed `assistant/attempt` and prove it is its Turn's sole settlement. */
function attemptTurn(
  events: readonly SessionEvent[],
  seq: SessionSeq,
): RetryableTurn | undefined {
  const settlement = events[seq]
  if (settlement?.type !== 'assistant/attempt') return undefined
  const turn = settlement.data.turn
  const closed = latestClosedTurn(events, turn, settlement.seq)
  if (closed === undefined) return undefined
  const reason = closed.turnEnd.data.reason.kind
  if (reason !== 'aborted' && reason !== 'interrupted') return undefined
  // A log-only attempt turn is retryable only as its Turn's single, un-retried
  // settlement: any other message or attempt makes the addressed tail ambiguous.
  const settlements = events.filter(event =>
    (event.type === 'assistant/attempt'
      || (event.type === 'assistant/message' && event.surfaceOp === 'append'))
    && event.data.turn === turn)
  if (settlements.length !== 1 || settlements[0]?.seq !== settlement.seq) return undefined
  return { turn, turnStart: closed.turnStart, settlementSeq: settlement.seq, logOnlyAttempt: true }
}

/**
 * Resolve the latest retryable interrupted-assistant turn in one Session log.
 *
 * The current surface must end with the addressed settlement's turn. An
 * `assistant-message` address requires the last surface node to be the
 * interrupted message; an `assistant-attempt` address requires the latest
 * closed Turn to end `aborted`/`interrupted` with that attempt as its only
 * settlement and no `assistant/message` on its surface. Within that turn's
 * current surface range, the resolver locates the replayable prompt — an
 * ordinary `user/message` or a previous retry's `assistant-retry` — and accepts
 * only injected context and system nodes between it and the surface end. The
 * returned range and provenance cover every shadowed node and, for a log-only
 * attempt, the attempt event itself. A running turn, a tool call or result, a
 * second assistant answer or attempt, a second replayable prompt, or no
 * replayable prompt all reject.
 * @param events - complete ordered Session log.
 * @param target - durability-addressed interrupted settlement to regenerate.
 * @returns the resolved target, or undefined when the tail is not retryable.
 */
export function resolveInterruptedRetryTarget(
  events: readonly SessionEvent[],
  target: SessionInterruptedRetryTarget,
): InterruptedRetryTarget | undefined {
  const turn = target.kind === 'assistant-message'
    ? messageTurn(events, target.messageId)
    : attemptTurn(events, target.seq)
  if (turn === undefined) return undefined
  const { nodes } = foldSurface(events)
  const latest = nodes.at(-1)
  // A message settlement must itself be the current surface tail; a log-only
  // attempt is absent from the surface, so its Turn's last surface node ends the
  // replaced range.
  if (!turn.logOnlyAttempt && latest !== turn.settlementSeq) return undefined
  // Every current surface node after the turn's own start belongs to this turn.
  // For a message settlement the last node is the interrupted answer; for a
  // log-only attempt the last node is the final shadowed surface node. The
  // message settlement itself must not be re-examined as a candidate prompt.
  const turnNodes = nodes.filter(seq => seq > turn.turnStart.seq)
  const candidateNodes = turn.logOnlyAttempt ? turnNodes : turnNodes.slice(0, -1)
  let promptSeq: SessionSeq | undefined
  for (const seq of candidateNodes) {
    const event = events[seq] as SessionEvent
    if (isReplayablePrompt(event)) {
      // A second replayable prompt makes the turn ambiguous.
      if (promptSeq !== undefined) return undefined
      promptSeq = seq
      continue
    }
    if (!isAllowedContext(event)) return undefined
  }
  // A resolved prompt is itself a surface node of this turn, so a log-only
  // attempt always has a defined end; a message settlement ends at itself.
  if (promptSeq === undefined) return undefined
  const prompt = events[promptSeq] as SessionEvent<'user/message'>
  let endSeq = turn.settlementSeq
  if (turn.logOnlyAttempt) {
    for (const seq of turnNodes) endSeq = seq
  }
  const shadowed = turnNodes.slice(turnNodes.indexOf(promptSeq))
  const sourceSeqs = turn.logOnlyAttempt
    ? [...shadowed, turn.settlementSeq].sort((left, right) => left - right)
    : shadowed
  return {
    promptSeq,
    endSeq,
    sourceSeqs,
    promptContent: prompt.data.content,
  }
}
