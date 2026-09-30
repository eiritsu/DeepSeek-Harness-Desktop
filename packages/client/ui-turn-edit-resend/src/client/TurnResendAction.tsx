/** User-message action that opens the edit-and-resend card for the latest turn. */
import { memo } from 'react'
import { IconEditOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { createTurnResendStore, TurnResendEdit } from './store.ts'
import css from './TurnResendAction.module.css'

/** Business face of the entry: read a fresh eligibility result for one prompt. */
export interface TurnResendActionInjected {
  /**
   * Read the Host's current eligibility; return the attempt to open when the
   * eligible prompt is exactly the clicked message.
   * @param seq - surface seq of the clicked user message.
   * @returns the edit to begin, or undefined when it must not open.
   */
  beginEdit: (seq: number) => Promise<TurnResendEdit | undefined>
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
    <button
      type="button"
      className={css.action}
      aria-label={t('action.label')}
      title={t('action.tip')}
      onClick={() => {
        void beginEdit(seq).then((edit) => { if (edit !== undefined) actions.begin(edit) })
      }}
    >
      <IconEditOutlineRegular size={14} />
    </button>
  )
})
