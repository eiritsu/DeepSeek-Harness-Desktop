/** The permanent-delete menu entry and its frame-wide confirmation dialog. */
import { useState } from 'react'
import type { WorkspaceSessionDeleteError } from '@deepseek-ai/dsh-api-workspace-controller/client'
import {
  Button, IconTrashOutlineRegular, MenuItemButton, Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  DeleteSessionInjected, SessionDeleteDialogInjected, SessionDeleteDialogProps, SessionDeleteRequest,
  SessionMenuItemProps,
} from '../contract/slots.ts'
import css from '../rows/WorkspaceBrowser.module.css'

/** Menu row (order 500): close the menu and request permanent deletion. */
export function DeleteSessionMenuItem({
  sessionId, displayTitle, useMenuOpenState, requestSessionDelete, t,
}: SessionMenuItemProps<DeleteSessionInjected>) {
  const [, setMenuOpen] = useMenuOpenState()
  return (
    <MenuItemButton
      icon={<IconTrashOutlineRegular />}
      danger
      separatorBefore
      onSelect={() => {
        setMenuOpen(false)
        requestSessionDelete(sessionId, displayTitle)
      }}
    >
      {t('menu.deleteSession')}
    </MenuItemButton>
  )
}

/** Render the pending delete request outside the row menu. */
export function SessionDeleteConfirmDialog({
  useDeleteRequest, settleSessionDelete, deleteSession, t,
}: SessionDeleteDialogProps) {
  const request = useDeleteRequest(pending => pending)
  if (request === null) return null
  return (
    <DeleteConfirmForm
      key={request.sessionId}
      request={request}
      deleteSession={deleteSession}
      onSettle={settleSessionDelete}
      t={t}
    />
  )
}

function DeleteConfirmForm({ request, deleteSession, onSettle, t }: {
  request: SessionDeleteRequest
  deleteSession: SessionDeleteDialogInjected['deleteSession']
  onSettle: () => void
  t: SessionDeleteDialogProps['t']
}) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const close = () => {
    if (!deleting) onSettle()
  }
  const confirm = () => {
    setDeleting(true)
    setError(null)
    deleteSession(request.sessionId).then(() => {
      setDeleting(false)
      onSettle()
    }).catch((reason: unknown) => {
      setDeleting(false)
      setError(deleteFailureMessage(reason, t))
    })
  }
  return (
    <Modal
      open
      onClose={close}
      closeLabel={t('close')}
      title={t('delete.session.title')}
      description={t('delete.session.desc', { title: request.displayTitle })}
      footer={(
        <>
          <Button variant="outline" disabled={deleting} onClick={close}>{t('cancel')}</Button>
          <Button variant="outline" className={css.deleteAction} disabled={deleting} onClick={confirm}>
            {t('delete.session.action')}
          </Button>
        </>
      )}
    >
      {deleting && <div className={css.deleteStatus} role="status">{t('delete.session.pending')}</div>}
      {error !== null && <div className={css.renameError} role="alert">{error}</div>}
    </Modal>
  )
}

function deleteFailureMessage(reason: unknown, t: SessionDeleteDialogProps['t']): string {
  if (!(reason instanceof Error) || reason.name !== 'WorkspaceSessionDeleteError') {
    return t('delete.session.error.generic', { message: reason instanceof Error ? reason.message : String(reason) })
  }
  const { rpcError } = reason as WorkspaceSessionDeleteError
  if (rpcError.code === 'workspace/session-active') return t('delete.session.error.active')
  if (rpcError.code === 'workspace/session-delete-blocked') return t('delete.session.error.writer')
  return t('delete.session.error.generic', { message: rpcError.message })
}
