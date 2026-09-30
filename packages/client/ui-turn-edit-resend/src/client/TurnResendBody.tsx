/** In-place edit-and-resend editor rendered in place of one user message. */
import { memo, useLayoutEffect, useRef } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  InjectFace, PropsLocale, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { createTurnResendStore, TurnResendEdit, TurnResendOutcome } from './store.ts'
import css from './TurnResendBody.module.css'

/** The elected message of the body chain. */
export interface TurnResendBodyMatch {
  /** Surface seq of the message this entry replaces. */
  readonly seq: number
}

/** Business face of the in-place editor. */
export interface TurnResendBodyInjected {
  /** Session the open presentation belongs to. */
  readonly sessionId: string
  /**
   * Release this Session's body claim, so the shipped bubble returns.
   * @returns nothing; releasing a replaced claim is the registry's no-op.
   */
  readonly release: () => void
  /**
   * Submit one edited attempt through the Host Remote.
   * @param edit - the open attempt with its current text.
   * @returns the outcome to settle, or undefined when the edit was admitted.
   */
  readonly submit: (edit: TurnResendEdit) => Promise<TurnResendOutcome | undefined>
}

/** Full props of the in-place body editor. */
export type TurnResendBodyProps =
  PropsRuntime<'conversation.chat.user-body'>
  & { matched: TurnResendBodyMatch }
  & PropsLocale<'turnResend'>
  & PropsStore<ReturnType<typeof createTurnResendStore>>
  & InjectFace<TurnResendBodyInjected>

/** The one line that states exactly what the Host's durable record proves. */
function outcomeNotice(outcome: TurnResendOutcome, t: TurnResendBodyProps['t']): string {
  switch (outcome.kind) {
    case 'not-admitted':
      return t('card.notAdmitted')
    case 'refused':
      return t('card.refused', { refusal: outcome.refusal })
    case 'failed':
      return t('card.failed', { reason: outcome.reason })
    case 'pending':
      return t('card.pending')
    case 'uncertain':
      return t('card.uncertain')
    case 'remote-failed':
      return t('card.remoteFailed', { code: outcome.code })
  }
}

/** Composer-style editor seeded with the edited turn's text and its tool disclosure. */
export const TurnResendBody = memo(function TurnResendBody({
  matched, sessionId, release, submit, t, useStore, actions,
}: TurnResendBodyProps) {
  const edit = useStore(state => state.editing[sessionId])
  const saving = useStore(state => state.saving[sessionId] === true)
  const outcome = useStore(state => state.outcome[sessionId])
  const notice = useStore(state => state.notice[sessionId])
  const editorRef = useRef<HTMLTextAreaElement | null>(null)
  // Grow the draft with its own content up to the card cap, like the composer;
  // a notice render has no editor and the effect then finds no element.
  useLayoutEffect(() => {
    const editor = editorRef.current
    if (editor === null) return
    editor.style.height = 'auto'
    editor.style.height = `${String(editor.scrollHeight)}px`
  }, [edit?.text])
  const close = (): void => {
    actions.clear(sessionId)
    release()
  }
  // A click the Host answered without an edit shows the same surface form as a
  // notice: the reason, in place of the message, with only dismissal.
  if (edit === undefined) {
    if (notice === undefined || notice.seq !== matched.seq) return null
    return (
      <div className={css.root} data-turn-resend-body data-turn-resend-notice>
        <div className={css.failure} role="alert" data-turn-resend-outcome={notice.outcome.kind}>
          {outcomeNotice(notice.outcome, t)}
        </div>
        <div className={css.controls}>
          <Button variant="ghost" size="sm" onClick={close}>
            {t('card.dismiss')}
          </Button>
        </div>
      </div>
    )
  }
  const save = async (): Promise<void> => {
    actions.saving(sessionId, true)
    actions.settle(sessionId, undefined)
    try {
      const settled = await submit(edit)
      if (settled === undefined) close()
      else actions.settle(sessionId, settled)
    } finally {
      actions.saving(sessionId, false)
    }
  }
  return (
    <div className={css.root} data-turn-resend-body>
      {edit.toolCalls.length === 0 ? null : (
        <div className={css.warning} data-turn-resend-warning>
          {t('card.warning.tools', { tools: edit.toolCalls.join(', ') })}
        </div>
      )}
      <textarea
        ref={editorRef}
        className={css.editor}
        aria-label={t('card.title')}
        value={edit.text}
        disabled={saving}
        onChange={(event) => { actions.setText(sessionId, event.target.value) }}
      />
      {outcome === undefined ? null : (
        <div className={css.failure} role="alert" data-turn-resend-outcome={outcome.kind}>
          {outcomeNotice(outcome, t)}
        </div>
      )}
      <div className={css.controls}>
        <Button variant="ghost" size="sm" disabled={saving} onClick={close}>
          {t('card.cancel')}
        </Button>
        {/* An uncertain attempt is never repeated under the same operation. */}
        {outcome?.kind === 'uncertain' ? null : (
          <Button variant="primary" size="sm" disabled={saving} onClick={() => { void save() }}>
            {saving ? t('card.saving') : t('card.save')}
          </Button>
        )}
      </div>
    </div>
  )
})
