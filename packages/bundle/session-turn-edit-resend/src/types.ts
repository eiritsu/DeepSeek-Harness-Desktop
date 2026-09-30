/**
 * Durable edit-and-resend vocabulary: the operation log events, the record the
 * client reads, and the types crossing the Remote boundary.
 *
 * This module is the browser-facing contract outlet: it imports leaf modules
 * only and merges no cordis `Context`, so a client program can name this
 * vocabulary without loading the Host plugin's service declarations — the
 * `@deepseek-ai/dsh-compaction/types` pattern. Importing the bare
 * `@deepseek-ai/dsh-session` entry here would load `SessionStore`'s `Context`
 * merge into the client program and collide with the API `ISessions` face.
 *
 * @module @deepseek-ai/dsh-session-turn-edit-resend/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionSeq } from '@deepseek-ai/dsh-session/types'

/**
 * Identity of one edit-and-resend attempt, minted by the caller.
 *
 * The caller owns the value so a repeated submission carries the same identity
 * and is answered from the journal instead of reaching the model again.
 */
export type ResendOperationId = Branded<'ResendOperationId'>

/** Why the most recent completed user turn cannot be edited and resent. */
export type ResendRefusal =
  /** The session has no turn that ended in completion. */
  | 'no-completed-turn'
  /** A turn opened after the last completed one, so the target is not the latest turn. */
  | 'not-latest-turn'
  /** The target turn recorded no direct human prompt to replace. */
  | 'no-human-prompt'
  /** The target prompt carries no text, so there is nothing in the composer to edit. */
  | 'no-editable-text'

/** Why the agent's latest turn cannot be edited right now. */
export type ResendBlocker =
  | ResendRefusal
  /** The agent is inside a turn, including one waiting on the user. */
  | 'agent-busy'
  /** Pending input is already queued, so a replacement would not be the next turn. */
  | 'inbox-pending'
  /** The caller aborted before the durable commit. */
  | 'aborted'

/** What every recorded operation names, whatever its outcome. */
interface ResendOperationIdentity {
  readonly operationId: ResendOperationId
  /** Turn whose surface range the operation targeted. */
  readonly turn: number
  /** Seq of the first shadowed surface node. */
  readonly startSeq: SessionSeq
  /** Seq of the last shadowed surface node. */
  readonly endSeq: SessionSeq
}

/** How a recorded attempt ended, or that its ending is not provable. */
export type ResendOperationRecord = ResendOperationIdentity & (
  /** The resent message entered the surface, so the model saw the edited turn. */
  | { readonly outcome: 'admitted'; readonly messageId: MessageId }
  /** The host declined the request; no model call was made. */
  | { readonly outcome: 'refused'; readonly refusal: ResendBlocker }
  /** Admission threw after the operation was recorded. */
  | { readonly outcome: 'failed'; readonly reason: string }
  /** The intent was recorded but no attempt started, so nothing left the host. */
  | { readonly outcome: 'pending' }
  /**
   * The request started and the log does not record whether the model was
   * called, so the outcome is unknown. The harness never resolves this by
   * repeating the call.
   */
  | { readonly outcome: 'uncertain'; readonly messageId: MessageId }
)

/** What the composer needs to offer, and seed, an edit. */
export type ResendEligibility =
  | {
    readonly eligible: true
    /** The prompt text the composer is seeded with. */
    readonly text: string
    /** Turn whose surface range an edit would replace. */
    readonly turn: number
    /** Seq of the first shadowed surface node. */
    readonly startSeq: SessionSeq
    /**
       * Tool names the target turn called, deduplicated. Non-empty when a resend
       * would ask the model to repeat tool calls whose external side effects
       * already happened; the consumer must confirm the repeat before submitting.
       */
    readonly toolCalls: readonly string[]
  }
  | { readonly eligible: false; readonly refusal: ResendBlocker }

/** Result of one edit-and-resend submission. */
export type ResendSubmission =
  /**
   * The attempt is in the journal. `operation.outcome` is what it reached:
   * `admitted` when the model saw the edit, and one of the others otherwise.
   */
  | { readonly recorded: true; readonly operation: ResendOperationRecord }
  /**
   * The host declined a session with no completed turn to record against. No
   * model call was made and nothing durable was written, so a repeated
   * submission is a fresh attempt rather than a duplicate.
   */
  | { readonly recorded: false; readonly refusal: ResendBlocker }

/** Caller's request to edit the latest turn and send it again. */
export interface ResendRequest {
  readonly operationId: ResendOperationId
  /** The edited text. */
  readonly text: string
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * A caller asked to edit the latest completed user turn. Recorded before the
     * host claims the agent, so a request that loses the idle-phase race is
     * still visible as a refusal rather than vanishing from the journal.
     */
    'turn-resend/requested': {
      operationId: string
      turn: number
      startSeq: SessionSeq
      endSeq: SessionSeq
    }
    /**
     * The operation's message identity, recorded before the message is queued.
     *
     * The record precedes `agent.followup`, so a crash between the two commits
     * leaves either no runnable message or a message whose operation is already
     * recorded; it can never leave a runnable message with no operation record.
     * The model request becomes reachable only after the flush that carries this
     * event, so an operation found here without the admission it would produce
     * may already have been sent and is never repeated.
     */
    'turn-resend/request-started': {
      operationId: string
      messageId: MessageId
      turn: number
      startSeq: SessionSeq
      endSeq: SessionSeq
    }
    /**
     * The request reached a terminal state that did not reach the model.
     *
     * A successful resend is not settled by an event: the resent message
     * admitting to the surface is itself the proof, and reading that proof from
     * the log keeps an operation correct across a crash before any later
     * notification could be written.
     */
    'turn-resend/settled':
      | { operationId: string; outcome: 'refused'; refusal: ResendBlocker }
      | { operationId: string; outcome: 'failed'; reason: string }
  }
}
