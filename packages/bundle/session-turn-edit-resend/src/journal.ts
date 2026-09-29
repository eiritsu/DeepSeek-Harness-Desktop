/**
 * The operation journal: every recorded edit-and-resend attempt in one session
 * log, folded into the state a caller may act on.
 *
 * Admission is proved from the log rather than announced by a further event, so
 * an operation that reached the surface reads as `admitted` even when the
 * process stopped before anything else could be written. An operation whose
 * request started without that proof reads as `uncertain`, which is the state
 * that keeps a resumed session from repeating a call it cannot verify.
 *
 * @module @deepseek-ai/dsh-session-turn-edit-resend/journal
 */

import type { MessageId } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, SessionSeq } from '@deepseek-ai/dsh-session'
import type { ResendBlocker, ResendOperationId, ResendOperationRecord } from './types.ts'

/** Recorded operations in the order they were requested. */
export type ResendJournal = readonly ResendOperationRecord[]

interface Draft {
  readonly operationId: ResendOperationId
  turn: number
  startSeq: SessionSeq
  endSeq: SessionSeq
  messageId?: MessageId
  outcome: 'pending' | 'uncertain' | 'admitted' | 'refused' | 'failed'
  refusal?: ResendBlocker
  reason?: string
}

/**
 * Whether one event admitted a message in place of a recorded range.
 *
 * The replaced range is the operation's identity, so a later resend of a
 * different turn cannot be mistaken for this one, and two operations over the
 * same range cannot both be proved from one append.
 * @param event - candidate `user/message` append.
 * @param draft - the operation that append would prove.
 * @returns whether the append is this operation's proof of admission.
 */
function admitsOperation(event: SessionEvent, draft: Draft): boolean {
  if (event.type !== 'user/message') return false
  const { surfaceOp } = event
  if (surfaceOp === undefined || typeof surfaceOp === 'string') return false
  return surfaceOp.op === 'replace'
    && surfaceOp.startSeq === draft.startSeq
    && surfaceOp.endSeq === draft.endSeq
}

/**
 * Read the operation journal of one session.
 *
 * Only the three operation events are read, so the fold stays valid for a log
 * written before they existed.
 * @param session - session whose log holds the operations.
 * @returns the recorded operations, oldest request first.
 */
export function readResendJournal(session: Session): ResendJournal {
  const events = session.snapshotEvents()
  const drafts = new Map<ResendOperationId, Draft>()
  for (const event of events) {
    switch (event.type) {
      case 'turn-resend/requested':
        drafts.set(event.data.operationId as ResendOperationId, {
          operationId: event.data.operationId as ResendOperationId,
          turn: event.data.turn,
          startSeq: event.data.startSeq,
          endSeq: event.data.endSeq,
          outcome: 'pending',
        })
        break
      case 'turn-resend/request-started': {
        const draft = drafts.get(event.data.operationId as ResendOperationId)
        // The request event is written in the same commit and precedes the
        // start; a start whose request is absent still describes itself, so the
        // uncertain operation remains readable.
        if (draft === undefined) {
          drafts.set(event.data.operationId as ResendOperationId, {
            operationId: event.data.operationId as ResendOperationId,
            turn: event.data.turn,
            startSeq: event.data.startSeq,
            endSeq: event.data.endSeq,
            messageId: event.data.messageId,
            outcome: 'uncertain',
          })
          break
        }
        draft.messageId = event.data.messageId
        draft.outcome = 'uncertain'
        break
      }
      case 'turn-resend/settled': {
        const draft = drafts.get(event.data.operationId as ResendOperationId)
        if (draft === undefined) break
        draft.outcome = event.data.outcome
        if (event.data.outcome === 'refused') draft.refusal = event.data.refusal
        else draft.reason = event.data.reason
        break
      }
      default:
        break
    }
  }
  for (const draft of drafts.values()) {
    if (draft.outcome === 'uncertain' && events.some(event => admitsOperation(event, draft))) {
      draft.outcome = 'admitted'
    }
  }
  return [...drafts.values()].map(settle)
}

/**
 * Turn a folded draft into the record its outcome admits.
 * @param draft - the folded operation.
 * @returns the record, carrying only the fields its outcome defines.
 */
function settle(draft: Draft): ResendOperationRecord {
  const identity = {
    operationId: draft.operationId,
    turn: draft.turn,
    startSeq: draft.startSeq,
    endSeq: draft.endSeq,
  }
  switch (draft.outcome) {
    case 'admitted':
    case 'uncertain':
      // Both name the queued message; only `admitted` also proves the model was
      // reached, which the fold already established from the log.
      if (draft.messageId === undefined) {
        throw new Error(`resend "${draft.operationId}" reached "${draft.outcome}" without a message identity`)
      }
      return { ...identity, outcome: draft.outcome, messageId: draft.messageId }
    case 'refused':
      if (draft.refusal === undefined) {
        throw new Error(`resend "${draft.operationId}" is refused without a reason`)
      }
      return { ...identity, outcome: 'refused', refusal: draft.refusal }
    case 'failed':
      return { ...identity, outcome: 'failed', reason: draft.reason ?? 'the resend failed' }
    case 'pending':
      return { ...identity, outcome: 'pending' }
  }
}

/**
 * Look up one recorded operation.
 * @param journal - the folded operations.
 * @param operationId - identity the caller submitted.
 * @returns the recorded operation, or undefined when the identity is new.
 */
export function findResendOperation(
  journal: ResendJournal,
  operationId: ResendOperationId,
): ResendOperationRecord | undefined {
  return journal.find(record => record.operationId === operationId)
}
