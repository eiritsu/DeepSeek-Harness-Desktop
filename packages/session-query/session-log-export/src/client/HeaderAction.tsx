import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  IconCopyOutline16,
  IconDownloadOutline16,
  IconEllipsisOutline16,
  Menu,
  writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { SessionLogDownloadDialog, type SessionLogDownloadDialogProps } from './Dialog.tsx'
import css from './HeaderAction.module.css'

/**
 * Render the Session Header more-actions icon button, its Session-id/export menu, and the shared result dialog.
 * @param props - Session runtime, download controller, and localized copy.
 * @returns the persistent Header action and Session-scoped dialog.
 */
export function SessionLogDownloadHeaderAction(props: SessionLogDownloadDialogProps): ReactNode {
  const { sessionId, useSessionLogDownload, request, t } = props
  const entry = useSessionLogDownload(state => state.bySession[String(sessionId)])
  const busy = entry?.status === 'downloading'
  const [open, setOpen] = useState(false)

  return (
    <>
      <Menu
        open={open}
        align="end"
        dense
        onClose={() => { setOpen(false) }}
        items={[
          { id: 'copy-id', label: t('menu.copyId'), icon: <IconCopyOutline16 /> },
          { id: 'download', label: t('menu.download'), icon: <IconDownloadOutline16 />, disabled: busy },
        ]}
        onSelect={(id) => {
          setOpen(false)
          if (id === 'copy-id') {
            void writeClipboard(String(sessionId))
          } else {
            void request(sessionId)
          }
        }}
        anchor={(
          <button
            type="button"
            className={css.moreButton}
            aria-label={t('header.more')}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-busy={busy}
            onClick={() => { setOpen(value => !value) }}
          >
            <IconEllipsisOutline16 />
          </button>
        )}
      />
      <SessionLogDownloadDialog {...props} />
    </>
  )
}
