/**
 * Web edit-and-resend plugin: the user-message edit entry and its inline card,
 * over the Host `turnResend` Remote. Copy rides the standard locale seat; the
 * card and entry share one Session-keyed store.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-session-turn-edit-resend/remote'
import type { ResendOperationId, ResendSubmission } from '@deepseek-ai/dsh-session-turn-edit-resend/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { EditResendCard, type EditResendCardInjected } from './EditResendCard.tsx'
import { TurnResendAction, type TurnResendActionInjected } from './TurnResendAction.tsx'
import { en, zh, type TurnResendKey } from './locales.ts'
import { createTurnResendStore, type TurnResendEdit, type TurnResendOutcome } from './store.ts'

export type { TurnResendKey } from './locales.ts'
export type { TurnResendEdit, TurnResendOutcome } from './store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The edit-and-resend entry and card copy. */
    turnResend: TurnResendKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'turnResend'

/** Required services: slot registry, the turnResend Remote, and copy. */
export const inject = ['slots', 'remote', 'remote.turnResend', 'locale']

/**
 * Map one Remote result to the card's next state. `undefined` means admitted,
 * which clears the card; every other outcome is reported as the log proves it,
 * including the uncertain case that must never invite a repeat.
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
 * inline edit card.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-turn-edit-resend: dictionaries')
  const store = createTurnResendStore()

  ctx.slots.inject('conversation.chat.user-actions', () => ctx.slots.register({
    name: 'conversation.chat.user-actions',
    id: 'turn-edit-resend',
    locale: NS,
    store,
    inject: (sessionId: SessionId): TurnResendActionInjected => ({
      beginEdit: async (seq: number): Promise<TurnResendEdit | undefined> => {
        const result = await ctx.remote.turnResend.check(sessionId)
        if (!result.ok || !result.value.eligible) return undefined
        // The Host re-selects the latest turn; a click on any other prompt must
        // not open a card for a turn that prompt does not own.
        if (result.value.startSeq !== seq) return undefined
        return {
          sessionId: String(sessionId),
          operationId: randomUUID(),
          turn: result.value.turn,
          startSeq: result.value.startSeq,
          text: result.value.text,
          toolCalls: result.value.toolCalls,
        }
      },
    }),
  }, TurnResendAction))

  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'turn-edit-resend-card',
    locale: NS,
    store,
    inject: (sessionId: SessionId): EditResendCardInjected => ({
      sessionId: String(sessionId),
      submit: async (edit: TurnResendEdit): Promise<TurnResendOutcome | undefined> => submissionOutcome(
        await ctx.remote.turnResend.submit(
          sessionId,
          { operationId: edit.operationId as ResendOperationId, text: edit.text },
          new AbortController().signal,
        ),
      ),
    }),
  }, EditResendCard))
}
