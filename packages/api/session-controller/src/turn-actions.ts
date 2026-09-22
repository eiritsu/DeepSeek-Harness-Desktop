/** Resolve the edit-and-resend and resume targets owned by a Session's latest Turn. */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import { foldSurface } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionSeq } from '@deepseek-ai/dsh-session'

/** Durable facts for one edit-and-resend of the latest Turn's prompt. */
export interface ResolvedResendTarget {
  /** Inclusive surface seq of the replayable prompt. */
  readonly promptSeq: SessionSeq
  /**
   * Inclusive surface seq the replacement ends at: the latest Turn's last
   * surface node, which is the prompt itself when the Turn produced none.
   */
  readonly endSeq: SessionSeq
  /**
   * Every source event the replacement cites, in log order: the shadowed
   * surface nodes from the prompt on, plus the Turn's log-only `tool/call` and
   * `assistant/attempt` events after the prompt.
   */
  readonly sourceSeqs: readonly SessionSeq[]
  /** Durable prompt content the resend replays verbatim or edits. */
  readonly promptContent: readonly ContentBlock[]
}

/** The latest Turn of one Session log once its `turn/end` has landed. */
interface ClosedTurn {
  readonly turn: number
  readonly start: SessionEvent<'turn/start'>
  readonly end: SessionEvent<'turn/end'>
}

/**
 * Locate the latest Turn and prove it is closed: its own `turn/end` is the
 * log's last one, so no later Turn is open.
 * @param events - complete ordered Session log.
 * @returns the latest closed Turn, or undefined when the log has none.
 */
function latestClosedTurn(events: readonly SessionEvent[]): ClosedTurn | undefined {
  const start = events.findLast((event): event is SessionEvent<'turn/start'> => event.type === 'turn/start')
  const end = events.findLast((event): event is SessionEvent<'turn/end'> => event.type === 'turn/end')
  if (start === undefined || end === undefined || end.data.turn !== start.data.turn) return undefined
  return { turn: start.data.turn, start, end }
}

/**
 * Whether one surface event is a replayable prompt: an ordinary user message or
 * a previous resend's replay. Steering carries the ordinary user source too, so
 * exactly one of these per Turn is what names that Turn's prompt.
 */
function isReplayablePrompt(event: SessionEvent): event is SessionEvent<'user/message'> {
  if (event.type !== 'user/message') return false
  const kind = event.data.source.kind
  return kind === 'user' || kind === 'assistant-retry'
}

/** Current surface seqs of one Turn, in surface order. */
function turnNodes(nodes: readonly SessionSeq[], turn: ClosedTurn): readonly SessionSeq[] {
  return nodes.filter(seq => seq > turn.start.seq)
}

/** Replayable prompt seqs among one Turn's current surface nodes. */
function promptNodes(nodes: readonly SessionSeq[], events: readonly SessionEvent[]): readonly SessionSeq[] {
  return nodes.filter(seq => isReplayablePrompt(events[seq] as SessionEvent))
}

/**
 * Resolve the edit-and-resend target of one addressed prompt.
 *
 * The addressed durable `user/message` must be a current surface node and the
 * sole replayable prompt of the latest closed Turn, so an injected-context Turn,
 * a shadowed prompt, a steering message, a historical Turn, and an open Turn all
 * reject. Assistant answers, tool calls, tool results, log-only attempts, and
 * injected context may fill the rest of the Turn: the replacement spans the
 * prompt through the Turn's last surface node and cites those log-only events,
 * so no shadowed material of the Turn re-enters the derived history of the
 * re-sent request.
 * @param events - complete ordered Session log.
 * @param messageId - durable id of the latest Turn's opening user message.
 * @returns the resolved target, or undefined when the message is not resendable.
 */
export function resolveResendTarget(
  events: readonly SessionEvent[],
  messageId: MessageId,
): ResolvedResendTarget | undefined {
  const prompt = events.find((event): event is SessionEvent<'user/message'> =>
    event.type === 'user/message' && event.data.id === messageId)
  if (prompt === undefined || !isReplayablePrompt(prompt)) return undefined
  const turn = latestClosedTurn(events)
  if (turn === undefined || prompt.seq <= turn.start.seq || prompt.seq >= turn.end.seq) return undefined
  const nodes = turnNodes(foldSurface(events).nodes, turn)
  const startIdx = nodes.indexOf(prompt.seq)
  if (startIdx === -1) return undefined
  if (promptNodes(nodes, events).length !== 1) return undefined
  const shadowed = nodes.slice(startIdx)
  // oxlint-disable-next-line typescript/no-non-null-assertion -- the addressed prompt is one of these nodes
  const endSeq = nodes.at(-1)!
  const logOnly = events
    .filter((event): event is SessionEvent<'tool/call' | 'assistant/attempt'> =>
      (event.type === 'tool/call' || event.type === 'assistant/attempt')
      && event.data.turn === turn.turn
      && event.seq > prompt.seq)
    .map(event => event.seq)
  return {
    promptSeq: prompt.seq,
    endSeq,
    sourceSeqs: [...shadowed, ...logOnly].sort((left, right) => left - right),
    promptContent: prompt.data.content,
  }
}

/**
 * Resolve whether the latest closed Turn is resumable: it was stopped rather
 * than finished, and exactly one replayable prompt opened it, so the resume
 * spends its model request over that Turn's own surface.
 * @param events - complete ordered Session log.
 * @returns the latest Turn number when it can resume, or undefined otherwise.
 */
export function resolveResumeTurn(events: readonly SessionEvent[]): number | undefined {
  const turn = latestClosedTurn(events)
  if (turn === undefined) return undefined
  const reason = turn.end.data.reason.kind
  if (reason !== 'aborted' && reason !== 'interrupted') return undefined
  const prompts = promptNodes(turnNodes(foldSurface(events).nodes, turn), events)
  return prompts.length === 1 ? turn.turn : undefined
}
