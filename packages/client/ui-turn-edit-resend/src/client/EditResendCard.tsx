/** Inline edit-and-resend card rendered above the composer for one Session. */
import { memo } from 'react'
import type {
  InjectFace, PropsLocale, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { createTurnResendStore, TurnResendEdit, TurnResendOutcome } from './store.ts'
import css from './EditResendCard.module.css'

/** Business face of the card. */
export interface EditResendCardInjected {
  /** Session the open edit belongs to. */
  readonly sessionId: string
  /**
   * Submit one edited attempt through the Host Remote.
   * @param edit - the open attempt with its current text.
   * @returns the outcome to settle, or undefined when the edit was admitted.
   */
  readonly submit: (edit: TurnResendEdit) => Promise<TurnResendOutcome | undefined>
}

/** Full props of the edit-and-resend card. */
export type EditResendCardProps =
  PropsRuntime<'conversation.input.dock'>
  & PropsLocale<'turnResend'>
  & PropsStore<ReturnType<typeof createTurnResendStore>>
  & InjectFace<EditResendCardInjected>

/** The one line that states exactly what the Host's durable record proves. */
function outcomeNotice(outcome: TurnResendOutcome, t: EditResendCardProps['t']): string {
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

/** Composer-style card seeded with the edited turn's text and its tool disclosure. */
export const EditResendCard = memo(function EditResendCard({
  sessionId, submit, t, useStore, actions,
}: EditResendCardProps) {
  const edit = useStore(state => state.editing[sessionId])
  const saving = useStore(state => state.saving[sessionId] === true)
  const outcome = useStore(state => state.outcome[sessionId])
  if (edit === undefined) return null
  const save = async (): Promise<void> => {
    actions.saving(sessionId, true)
    actions.settle(sessionId, undefined)
    try {
      const settled = await submit(edit)
      if (settled === undefined) actions.clear(sessionId)
      else actions.settle(sessionId, settled)
    } finally {
      actions.saving(sessionId, false)
    }
  }
  return (
    <div className={css.card} data-turn-resend-card>
      <div className={css.title}>{t('card.title')}</div>
      {edit.toolCalls.length === 0 ? null : (
        <div className={css.warning} data-turn-resend-warning>
          <div className={css.warningTitle}>{t('card.warning.title')}</div>
          <div>{t('card.warning.tools', { tools: edit.toolCalls.join(', ') })}</div>
        </div>
      )}
      <textarea
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
        <button
          type="button"
          className={css.button}
          disabled={saving}
          onClick={() => { actions.clear(sessionId) }}
        >
          {t('card.cancel')}
        </button>
        {/* An uncertain attempt is never repeated under the same operation. */}
        {outcome?.kind === 'uncertain' ? null : (
          <button
            type="button"
            className={css.primary}
            disabled={saving}
            onClick={() => { void save() }}
          >
            {saving ? t('card.saving') : t('card.save')}
          </button>
        )}
      </div>
    </div>
  )
})
