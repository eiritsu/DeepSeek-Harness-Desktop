/**
 * The operation journal read from its incremental host-only projection.
 *
 * @module @deepseek-ai/dsh-session-turn-edit-resend/journal
 */

import type { ResendJournalDraft, ResendJournalState } from './types.ts'
import type { ResendOperationId, ResendOperationRecord } from './types.ts'

/** Recorded operations in the order they were requested. */
export type ResendJournal = readonly ResendOperationRecord[]

/**
 * Read the operation journal from already-folded host state.
 * @param state - the current resend-journal projection state.
 * @returns recorded operations, oldest request first.
 */
export function readResendJournal(state: ResendJournalState): ResendJournal {
  return state.drafts.map(settle)
}

/**
 * Turn a folded draft into the record its outcome admits.
 * @param draft - the folded operation.
 * @returns the record, carrying only the fields its outcome defines.
 */
function settle(draft: ResendJournalDraft): ResendOperationRecord {
  const identity = {
    operationId: draft.operationId as ResendOperationId,
    turn: draft.turn,
    startSeq: draft.startSeq,
    endSeq: draft.endSeq,
  }
  switch (draft.outcome) {
    case 'admitted':
    case 'uncertain':
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
