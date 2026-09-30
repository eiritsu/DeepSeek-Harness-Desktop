/**
 * Edit the most recent replaceable user turn and send it again.
 *
 * The service reads turn and journal projections, claims the agent's idle phase
 * to select again against the current surface, records the attempt durably, and
 * holds the flush before the model request.
 *
 * A turn that ran tools stays editable. Its tool calls and results are shadowed
 * in the model-visible surface by the replacement while the append-only log
 * keeps them, and {@link check} discloses the tool names so the consumer can
 * confirm that the resend may repeat external side effects before submitting.
 *
 * @module @deepseek-ai/dsh-session-turn-edit-resend
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createMessage } from '@deepseek-ai/dsh-llm'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { findResendOperation, readResendJournal } from './journal.ts'
import { editPromptContent, promptText, selectResendTarget } from './policy.ts'
import type { ResendTarget } from './policy.ts'
import type {
  ResendBlocker,
  ResendEligibility,
  ResendOperationRecord,
  ResendRequest,
  ResendSubmission,
} from './types.ts'
import { resendJournalProjectionDefinition, resendTurnProjectionDefinition } from './projection.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `turnResend` Remote namespace. */
    turnResend: SessionTurnEditResend
  }
}

/** The fields one attempt names whatever it reaches. */
function identityOf(request: ResendRequest, target: ResendTarget): ResendOperationRecord {
  const { turn, replacement } = target
  return {
    operationId: request.operationId,
    turn,
    startSeq: replacement.startSeq,
    endSeq: replacement.endSeq,
    // Narrowed to the outcome the attempt reaches at each return site.
    outcome: 'pending',
  }
}

/** Host edit-and-resend admission over the `turnResend` Remote namespace. */
export class SessionTurnEditResend extends TypertRemoteService {
  static inject = ['sessions', 'sessionProjections']

  /**
   * Register the `turnResend` Remote namespace on the Host context.
   * @param ctx - Host context carrying the Session store this service flushes.
   */
  constructor(ctx: Context) {
    super(ctx, 'turnResend')
    ctx.sessionProjections.register(resendTurnProjectionDefinition)
    ctx.sessionProjections.register(resendJournalProjectionDefinition)
  }

  /**
   * Report whether the agent's latest turn may be edited, and seed an edit.
   *
   * The answer uses incrementally folded turn facts and the current surface;
   * {@link submit} selects the target again under the agent's idle claim.
   * @param agent - agent whose latest turn is offered.
   * @returns the editable prompt text and its turn, or why it is not editable.
   */
  @Remote
  check(agent: Agent): ResendEligibility {
    const blocker = this.blocker(agent)
    if (blocker !== undefined) return { eligible: false, refusal: blocker }
    const selection = selectResendTarget(agent.session, this.turnState(agent.session))
    if (!selection.eligible) return { eligible: false, refusal: selection.refusal }
    return {
      eligible: true,
      // The selection refuses a prompt that carries no text, so this read is total.
      text: promptText(selection.target.prompt) ?? '',
      turn: selection.target.turn,
      startSeq: selection.target.replacement.startSeq,
      toolCalls: selection.target.toolCalls,
    }
  }

  /**
   * Replace the latest replaceable turn's prompt with the edited text and let the
   * driver send it as a new turn.
   *
   * Submission is idempotent in the caller's `operationId`: an identity the
   * journal already holds returns that record, so a repeated submission never
   * produces a second model request. A caller that wants a fresh attempt after
   * a recorded refusal submits a new identity.
   * @param agent - agent whose latest turn is replaced.
   * @param request - the caller's operation identity and edited text.
   * @param signal - aborts the request before the durable commit.
   * @returns the recorded attempt, or the refusal that left no trace.
   * @throws when the durable commit fails. The log then records the attempt as
   *   failed, so the caller is never retried under the same identity.
   */
  @Remote
  async submit(agent: Agent, request: ResendRequest, signal: AbortSignal): Promise<ResendSubmission> {
    const { session } = agent
    const existing = findResendOperation(readResendJournal(this.journalState(session)), request.operationId)
    if (existing !== undefined) return { recorded: true, operation: existing }

    // This gate makes the common refusal a direct answer rather than an
    // exception. It trusts nothing: the claim below re-reads the log.
    const busy = this.blocker(agent)
    if (busy !== undefined) return this.refuse(agent, request, busy)

    try {
      return await agent.runMaintenance(async () => {
        // From the selection to the commits there is no await. `runMaintenance`
        // holds the agent's idle phase across them, so no turn can open and no
        // other submission can enter between deciding and committing.
        const selection = selectResendTarget(session, this.turnState(session))
        if (!selection.eligible) return { recorded: false, refusal: selection.refusal }
        const { turn, replacement, prompt } = selection.target

        if (signal.aborted) return this.refuse(agent, request, 'aborted')
        const message = createMessage({
          role: 'user',
          content: editPromptContent(prompt, request.text),
          source: prompt.source,
        })
        session.append('turn-resend/requested', {
          operationId: request.operationId,
          turn,
          startSeq: replacement.startSeq,
          endSeq: replacement.endSeq,
        })
        // Record the operation's message identity before the queue can execute
        // it: a crash between the two commits must never leave a runnable
        // message with no operation record. `agent.followup` only latches the
        // driver's wake, which `runMaintenance` releases after the flush below.
        session.append('turn-resend/request-started', {
          operationId: request.operationId,
          messageId: message.id,
          turn,
          startSeq: replacement.startSeq,
          endSeq: replacement.endSeq,
        })
        agent.followup(message, replacement)
        // The flush is the barrier. `runMaintenance` wakes the driver from its
        // own `finally`, so the request cannot reach the model until the record
        // above is durable.
        await this.ctx.sessions.flush(session)
        const admitted: ResendOperationRecord = {
          ...identityOf(request, selection.target),
          outcome: 'admitted',
          messageId: message.id,
        }
        return { recorded: true, operation: admitted } satisfies ResendSubmission
      })
    } catch (error) {
      // The claim is lost when the agent took work between the gate above and
      // the call. That is a refusal by another submitter, not a failure here.
      if (this.blocker(agent) !== undefined) return this.refuse(agent, request, 'agent-busy')
      session.append('turn-resend/settled', {
        operationId: request.operationId,
        outcome: 'failed',
        reason: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  /**
   * Decline a request, recording it against the turn the request reached.
   *
   * A session with no replaceable turn leaves no trace, because there is no range
   * to name and nothing a repeated call could duplicate. Both events are
   * log-only and written together, so the journal holds a refusal as a complete
   * pair rather than an attempt that is neither started nor settled.
   * @param agent - agent the request was addressed to.
   * @param request - the caller's operation identity and edited text.
   * @param refusal - why the request cannot proceed.
   * @returns the recorded refusal, or the unrecorded one.
   */
  private refuse(
    agent: Agent,
    request: ResendRequest,
    refusal: ResendBlocker,
  ): ResendSubmission {
    const selection = selectResendTarget(agent.session, this.turnState(agent.session))
    if (!selection.eligible) return { recorded: false, refusal }
    const { session } = agent
    const { turn, replacement } = selection.target
    session.append('turn-resend/requested', {
      operationId: request.operationId,
      turn,
      startSeq: replacement.startSeq,
      endSeq: replacement.endSeq,
    })
    session.append('turn-resend/settled', { operationId: request.operationId, outcome: 'refused', refusal })
    return {
      recorded: true,
      operation: { ...identityOf(request, selection.target), outcome: 'refused', refusal },
    }
  }

  /**
   * Why the agent cannot be edited now, independent of turn contents.
   * @param agent - agent whose activity is read.
   * @returns the activity blocker, or undefined when the agent is idle with an empty inbox.
   */
  private blocker(agent: Agent): ResendBlocker | undefined {
    if (agent.status === 'running') return 'agent-busy'
    if (agent.inbox.nextTurn.length > 0 || agent.inbox.nextStep.length > 0) return 'inbox-pending'
    return undefined
  }

  /**
   * Read the current turn fold registered by this service.
   * @param session - session whose current state is read.
   * @returns the current turn facts.
   */
  private turnState(session: Agent['session']): import('./types.ts').ResendTurnState {
    const state = this.ctx.sessionProjections.stateOf(session, 'resendTurn')
    if (state === undefined) throw new Error('resendTurn projection is not registered')
    return state
  }

  /**
   * Read the current operation fold registered by this service.
   * @param session - session whose current journal is read.
   * @returns the current operation facts.
   */
  private journalState(session: Agent['session']): import('./types.ts').ResendJournalState {
    const state = this.ctx.sessionProjections.stateOf(session, 'resendJournal')
    if (state === undefined) throw new Error('resendJournal projection is not registered')
    return state
  }
}

export default SessionTurnEditResend
