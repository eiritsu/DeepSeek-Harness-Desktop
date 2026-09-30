/** The Session row menu entry for copying the Session's opaque id. */
import { IconCopyOutlineRegular, MenuItemButton, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionMenuItemProps } from '../contract/slots.ts'

/** Copy result notification owned by the Workspace browser's overlay. */
export interface CopySessionIdInjected {
  /** Report whether the clipboard accepted the Session id. */
  reportCopyResult: (copied: boolean) => void
}

/**
 * Copy one row's Session id and close its menu; a failed clipboard write is
 * reported through the browser overlay instead of claiming success.
 * @param props - row identity, menu state, and the copy-result notice.
 * @returns the menu row.
 */
export function CopySessionIdMenuItem({ sessionId, useMenuOpenState, reportCopyResult, t }: SessionMenuItemProps<CopySessionIdInjected>) {
  const [, setMenuOpen] = useMenuOpenState()
  const copy = (id: SessionId): void => {
    void writeClipboard(String(id)).then(reportCopyResult, () => { reportCopyResult(false) })
  }
  return (
    <MenuItemButton
      icon={<IconCopyOutlineRegular />}
      onSelect={() => {
        setMenuOpen(false)
        copy(sessionId)
      }}
    >
      {t('menu.copySessionId')}
    </MenuItemButton>
  )
}
