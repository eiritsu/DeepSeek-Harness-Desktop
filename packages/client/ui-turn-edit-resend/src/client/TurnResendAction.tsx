/** User-message action that opens the edit-and-resend card for the latest turn. */
import { memo } from 'react'
import { IconEditOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { createTurnResendStore, TurnResendEdit, TurnResendOutcome } from './store.ts'
import css from './TurnResendAction.module.css'

/** What one click on the entry reached. */
export type TurnResendBegin =
  /** The Host offered an edit for the clicked prompt. */
  | { readonly kind: 'edit'; readonly edit: TurnResendEdit }
  /** The Host answered without an edit; the body slot states the outcome in place of the message. */
  | { readonly kind: 'notice'; readonly sessionId: string; readonly seq: number; readonly outcome: TurnResendOutcome }
  /** The click does not own the Host's target; see {@link TurnResendActionInjected.beginEdit}. */
  | { readonly kind: 'none' }

/** Business face of the entry: read a fresh eligibility result for one prompt. */
export interface TurnResendActionInjected {
  /**
   * Read the Host's current eligibility for the clicked prompt.
   * @param seq - surface seq of the clicked user message.
   * @returns the edit to open, the outcome the card must state, or nothing when
   *   the Host's target is not the clicked message.
   */
  beginEdit: (seq: number) => Promise<TurnResendBegin>
}

/** Full props of the user-message edit entry. */
export type TurnResendActionProps =
  PropsRuntime<'conversation.chat.user-actions'>
  & PropsLocale<'turnResend'>
  & PropsStore<ReturnType<typeof createTurnResendStore>>
  & InjectFace<TurnResendActionInjected>

/** One icon button on the latest turn's user prompt; it opens the shared edit card. */
export const TurnResendAction = memo(function TurnResendAction({
  seq, turn, beginEdit, useChat, actions, t,
}: TurnResendActionProps) {
  // The entry belongs only to the latest turn, so an older prompt never shows
  // an affordance whose click would edit the newest one.
  const lastTurn = useChat(snapshot => snapshot.timeline.turnOrder.at(-1))
  if (turn === undefined || turn !== lastTurn) return null
  return (
    <Tooltip label={t('action.tip')} side="bottom">
      <button
        type="button"
        className={css.action}
        aria-label={t('action.label')}
        onClick={() => {
          void beginEdit(seq).then((result) => {
            if (result.kind === 'edit') actions.begin(result.edit)
            else if (result.kind === 'notice') actions.notice(result.sessionId, { seq: result.seq, outcome: result.outcome })
          })
        }}
      >
        <IconEditOutlineRegular size={14} />
      </button>
    </Tooltip>
  )
})
