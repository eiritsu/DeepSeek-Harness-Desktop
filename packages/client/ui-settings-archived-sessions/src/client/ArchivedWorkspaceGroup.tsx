/** One collapsible Workspace group and the archived Sessions it holds. */

import { useId } from 'react'
import {
  IconChevronDownOutlineRegular,
  IconFolderCloseRegular,
  IconFolderOpenOutlineRegular,
  IconTrashOutlineRegular,
  IconUnarchiveOutlineRegular,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ArchivedSessionRow, ArchivedWorkspaceGroup as Group } from './archived-view.ts'
import type { ArchivedTranslate } from './locales.ts'
import { relativeLabel } from './relative-label.ts'
import css from './ArchivedSessionsSection.module.css'

/** Props for one Workspace group. */
export interface ArchivedWorkspaceGroupProps {
  /** The group to draw, already filtered and ordered. */
  group: Group
  /** This page's translate function. */
  t: ArchivedTranslate
  /** Current epoch ms, so every row in one render names its moment identically. */
  now: number
  /** Whether the group's rows are hidden. */
  collapsed: boolean
  /** Session ids with a command in flight; their row actions stay disabled. */
  busy: ReadonlySet<SessionId>
  /** Group open/close request. */
  onToggle: (key: string) => void
  /** Unarchive request for one row. */
  onRestore: (row: ArchivedSessionRow) => void
  /** Permanent-deletion request for one row. */
  onDelete: (row: ArchivedSessionRow) => void
}

/**
 * Render one Workspace's archived Sessions behind a disclosure header. The
 * header is the only control that changes the group's height; each row's
 * commands are always present so a collapsed group still reports what it holds.
 * @param props - the group and the page state it draws from.
 * @returns the group heading and, unless collapsed, its rows.
 */
export function ArchivedWorkspaceGroup({
  group, t, now, collapsed, busy, onToggle, onRestore, onDelete,
}: ArchivedWorkspaceGroupProps) {
  const panelId = useId()
  const PanelIcon = collapsed ? IconFolderCloseRegular : IconFolderOpenOutlineRegular
  return (
    <section className={css.group}>
      <button
        type="button"
        className={css.groupHead}
        aria-expanded={!collapsed}
        aria-controls={panelId}
        onClick={() => { onToggle(group.key) }}
      >
        <span className={css.groupChevron} data-collapsed={collapsed ? 'true' : undefined} aria-hidden="true">
          <IconChevronDownOutlineRegular size={14} />
        </span>
        <PanelIcon className={css.groupIcon} size={16} />
        <span className={css.groupName}>{group.title}</span>
        <span className={css.groupCount}>{group.rows.length}</span>
      </button>
      <div id={panelId} className={css.groupPanel} hidden={collapsed}>
        <ul className={css.rows}>
          {group.rows.map((row) => {
            const pending = busy.has(row.sessionId)
            return (
              <li key={row.sessionId} className={css.row}>
                <span className={css.rowName}>{row.title}</span>
                <span className={css.rowTime}>{relativeLabel(row.updatedAt, now, t)}</span>
                <span className={css.rowActions}>
                  <Tooltip label={t('row.restore')} side="bottom" delayMs={500}>
                    <button
                      type="button"
                      className={css.rowAction}
                      disabled={pending}
                      aria-label={t('row.restore')}
                      onClick={() => { onRestore(row) }}
                    >
                      <IconUnarchiveOutlineRegular size={15} />
                    </button>
                  </Tooltip>
                  <Tooltip label={t('row.delete')} side="bottom" delayMs={500}>
                    <button
                      type="button"
                      className={css.rowDanger}
                      disabled={pending}
                      aria-label={t('row.delete')}
                      onClick={() => { onDelete(row) }}
                    >
                      <IconTrashOutlineRegular size={15} />
                    </button>
                  </Tooltip>
                </span>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
