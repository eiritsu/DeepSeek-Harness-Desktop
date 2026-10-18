/**
 * The bulk permanent-deletion confirmation. A bulk delete touches many
 * archived Sessions at once, so it takes two explicit steps: one that names
 * the scope and the count, and a second that deletes only after the
 * acknowledgement checkbox is checked. Nothing here deletes on its own — the
 * Host command runs from the page's `onConfirm`.
 *
 * The page mounts this component once per deletion, so each opening starts at
 * the scope step with an unchecked acknowledgement. The scope is a value the
 * page froze when the user opened the dialog, not a projection of the current
 * filters: a Workspace or a search that changes while the dialog is up cannot
 * widen what the confirmed run will delete.
 */

import { useState } from 'react'
import { Button, Modal, RiskConfirmation } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ArchivedTranslate } from './locales.ts'
import css from './ArchivedSessionsSection.module.css'

/** Progress of a deletion that is still running. */
export interface DeleteProgress {
  /** Sessions already deleted. */
  readonly done: number
  /** Sessions whose deletion the Host refused. */
  readonly failed: number
}

/** The exact deletion one opening of the dialog committed to. */
export interface DeleteArchivedScope {
  /** Archived Session ids chosen when the dialog opened, in the visible order. */
  readonly sessionIds: readonly SessionId[]
  /** How many Sessions `sessionIds` holds; the number every step displays. */
  readonly count: number
  /** Localized name of the scope: a Workspace, a search, or all of them. */
  readonly label: string
}

/** Props for the two-step bulk-deletion dialog. */
export interface DeleteArchivedDialogProps {
  /** The frozen scope this dialog opened on. */
  scope: DeleteArchivedScope
  /** This page's translate function. */
  t: ArchivedTranslate
  /** Whether a deletion is in flight; both steps hold their commands. */
  pending: boolean
  /** How far the in-flight deletion has come. */
  progress: DeleteProgress | undefined
  /** Dismiss the dialog without deleting. */
  onCancel: () => void
  /** Start the deletion of the scope this dialog displayed. */
  onConfirm: (scope: DeleteArchivedScope) => void
}

/**
 * Render the two-step confirmation for deleting a frozen set of archived
 * Sessions.
 * @param props - the scope the dialog committed to, and the run state.
 * @returns the scope step or the acknowledged confirmation step.
 */
export function DeleteArchivedDialog({
  scope, t, pending, progress, onCancel, onConfirm,
}: DeleteArchivedDialogProps) {
  const [step, setStep] = useState<'scope' | 'confirm'>('scope')
  const [acknowledged, setAcknowledged] = useState(false)
  const { count, label } = scope
  if (step === 'confirm') {
    return (
      <RiskConfirmation
        open
        title={t('deleteAll.title')}
        description={t(count === 1 ? 'deleteAll.scope.one' : 'deleteAll.scope', { n: count, scope: label })}
        acknowledgeLabel={t(count === 1 ? 'deleteAll.acknowledge.one' : 'deleteAll.acknowledge', { n: count })}
        cancelLabel={t('cancel')}
        closeLabel={t('close')}
        confirmLabel={progress === undefined
          ? t(count === 1 ? 'deleteAll.confirm.one' : 'deleteAll.confirm', { n: count })
          : t('deleteAll.pending', { done: progress.done, total: count })}
        acknowledged={acknowledged}
        disabled={pending}
        cancelDisabled={pending}
        onAcknowledgedChange={setAcknowledged}
        onCancel={onCancel}
        onConfirm={() => { onConfirm(scope) }}
      />
    )
  }
  return (
    <Modal
      open
      onClose={onCancel}
      title={t('deleteAll.title')}
      closeLabel={t('close')}
      className={css.confirmDialog as string}
      footer={(
        <>
          <Button variant="outline" className={css.confirmAction} onClick={onCancel}>
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            className={css.confirmAction}
            disabled={pending || count === 0}
            onClick={() => {
              setAcknowledged(false)
              setStep('confirm')
            }}
          >
            {t('next')}
          </Button>
        </>
      )}
    >
      <p className={css.confirmText}>{t(count === 1 ? 'deleteAll.scope.one' : 'deleteAll.scope', { n: count, scope: label })}</p>
    </Modal>
  )
}
