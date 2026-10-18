/**
 * The Archived settings page: every archived Session, grouped by the Workspace
 * that holds it, with search, a Workspace filter, an order selector, per-row
 * restore and confirmed deletion, and a scoped bulk deletion.
 *
 * The page owns no data of its own. Which Sessions are archived and what their
 * Workspaces are come from the Workspace Controller's snapshot; their titles and
 * timestamps come from the Session Controller's list; both commands are that
 * service's own, so an archive, a restore, and a deletion here are the same
 * operations the sidebar performs.
 */

import { useMemo, useState } from 'react'
import {
  Button,
  IconChevronDownOutlineRegular,
  IconChevronsUpDownOutlineRegular,
  IconClockOutlineRegular,
  IconFolderCloseRegular,
  IconPlusOutlineRegular,
  IconSearchOutlineRegular,
  IconTrashOutlineRegular,
  IconWarningOutlineRegular,
  Input,
  Menu,
  RiskConfirmation,
  Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId, WorkspaceSource, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { workspaceDisplayTitle } from '@deepseek-ai/dsh-api-workspace-controller/default-workspace'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import {
  ALL_WORKSPACES,
  archivedReadStatus,
  archivedWorkspaceOptions,
  deriveArchivedRows,
  filterArchivedRows,
  groupArchivedRows,
  sortArchivedRows,
} from './archived-view.ts'
import type { ArchivedSessionRow, ArchivedSort, ArchivedWorkspaceFilter } from './archived-view.ts'
import { ArchivedWorkspaceGroup } from './ArchivedWorkspaceGroup.tsx'
import { DeleteArchivedDialog } from './DeleteArchivedDialog.tsx'
import type { DeleteArchivedScope, DeleteProgress } from './DeleteArchivedDialog.tsx'
import type { ArchivedSessionsLocaleKey } from './locales.ts'
import css from './ArchivedSessionsSection.module.css'

/** Registration-side business face for the section. */
export interface ArchivedSessionsInjected {
  hooks: {
    /** Host-authoritative Workspace rows, archive set, and follow state. */
    workspaces: WorkspaceSource
    /** Host-authoritative Session list, keyed by Session id. */
    sessions: HostObservable<SessionListState>
  }
  /** @param sessionId - archived Session to restore. @returns completion of the Host command. */
  unarchiveSession: (sessionId: SessionId) => Promise<void>
  /** @param sessionId - archived Session to delete from disk. @returns completion of the Host command. */
  deleteSession: (sessionId: SessionId) => Promise<void>
}

/** Props the renderer binds for the section. */
export type ArchivedSessionsSectionProps = PropsRuntime<'settings.section'>
  & PropsLocale<'settings.archivedSessions'>
  & InjectFace<ArchivedSessionsInjected>

/** One transient outcome banner: its text plus a key that restarts its hold. */
interface Notice {
  readonly seq: number
  readonly text: string
  readonly success: boolean
}

/**
 * Render the Archived settings page.
 * @param props - the bound Workspace and Session sources, the two commands, and the locale seat.
 * @returns the page: its toolbar, its workspace groups, and its confirmations.
 */
export function ArchivedSessionsSection({
  t, useWorkspaces, useSessions, unarchiveSession, deleteSession,
}: ArchivedSessionsSectionProps) {
  const storedWorkspaces = useWorkspaces(state => state.items)
  const workspaceState = useWorkspaces(state => state.state)
  const workspaceError = useWorkspaces(state => state.error)
  const archivedSessionIds = useWorkspaces(state => state.archivedSessionIds)
  const listById = useSessions(state => state.byId)
  const sessionPhase = useSessions(state => state.phase)

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ArchivedWorkspaceFilter>(ALL_WORKSPACES)
  const [sort, setSort] = useState<ArchivedSort>('updated')
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const [busy, setBusy] = useState<ReadonlySet<SessionId>>(() => new Set())
  const [deleteTarget, setDeleteTarget] = useState<ArchivedSessionRow>()
  const [deleteAcknowledged, setDeleteAcknowledged] = useState(false)
  const [deleteRunning, setDeleteRunning] = useState(false)
  const [bulkScope, setBulkScope] = useState<DeleteArchivedScope>()
  const [bulkProgress, setBulkProgress] = useState<DeleteProgress>()
  const [notice, setNotice] = useState<Notice>()

  // The resolved default name, not `t`, is the memo dependency: the bound seat
  // keeps its identity across a language switch.
  const defaultWorkspaceName = t('workspace.defaultName')
  const ungroupedName = t('workspace.ungrouped')
  const workspaces = useMemo<readonly WorkspaceView[]>(
    () => storedWorkspaces.map(workspace => ({
      ...workspace,
      title: workspaceDisplayTitle(workspace.title, defaultWorkspaceName),
    })),
    [storedWorkspaces, defaultWorkspaceName],
  )

  const rows = useMemo(
    () => deriveArchivedRows(listById, workspaces, archivedSessionIds),
    [listById, workspaces, archivedSessionIds],
  )
  const options = useMemo(() => archivedWorkspaceOptions(workspaces, rows), [workspaces, rows])
  // A Workspace that was removed while chosen narrows to the unfiltered view on
  // the very render the option list loses it, so no control can read a filter
  // the list no longer offers.
  const selected = filter === ALL_WORKSPACES
    ? undefined
    : options.find(option => option.workspaceId === filter)
  const effectiveFilter = selected?.workspaceId ?? ALL_WORKSPACES
  const visible = useMemo(
    () => sortArchivedRows(filterArchivedRows(rows, effectiveFilter, query), sort),
    [rows, effectiveFilter, query, sort],
  )
  const groups = useMemo(
    () => groupArchivedRows(visible, workspaces, () => ungroupedName),
    [visible, workspaces, ungroupedName],
  )
  const status = archivedReadStatus(sessionPhase, workspaceState)
  const now = Date.now()
  const trimmedQuery = query.trim()
  const filtering = trimmedQuery !== '' || effectiveFilter !== ALL_WORKSPACES

  const scopeLabel = trimmedQuery !== ''
    ? t('deleteAll.scope.search', { query: trimmedQuery })
    : selected === undefined
      ? t('deleteAll.scope.all')
      : t('deleteAll.scope.workspace', { name: selected.title })

  const toggleGroup = (key: string): void => {
    setCollapsed((previous) => {
      const next = new Set(previous)
      if (!next.delete(key)) next.add(key)
      return next
    })
  }

  const report = (text: string, success: boolean): void => {
    setNotice(previous => ({ seq: (previous?.seq ?? 0) + 1, text, success }))
  }

  const runRestore = async (row: ArchivedSessionRow): Promise<void> => {
    setBusy(previous => new Set(previous).add(row.sessionId))
    try {
      await unarchiveSession(row.sessionId)
      report(t('notice.restored'), true)
    } catch {
      report(t('restore.failed'), false)
    } finally {
      setBusy((previous) => {
        const next = new Set(previous)
        next.delete(row.sessionId)
        return next
      })
    }
  }

  const runDelete = async (row: ArchivedSessionRow): Promise<void> => {
    setBusy(previous => new Set(previous).add(row.sessionId))
    setDeleteRunning(true)
    try {
      await deleteSession(row.sessionId)
      report(t('notice.deleted'), true)
      // The Host has the Session; keeping its confirmation open would offer a
      // second deletion of a row that is already gone.
      setDeleteTarget(undefined)
    } catch {
      report(t('delete.failed'), false)
    } finally {
      setBusy((previous) => {
        const next = new Set(previous)
        next.delete(row.sessionId)
        return next
      })
      setDeleteRunning(false)
      // A refusal leaves the dialog up, so the retry is a fresh acknowledgement
      // rather than a carried-over tick.
      setDeleteAcknowledged(false)
    }
  }

  const runBulkDelete = async (scope: DeleteArchivedScope): Promise<void> => {
    setBulkProgress({ done: 0, failed: 0 })
    let done = 0
    let failed = 0
    for (const sessionId of scope.sessionIds) {
      try {
        await deleteSession(sessionId)
        done++
      } catch {
        failed++
      }
      setBulkProgress({ done, failed })
    }
    setBulkProgress(undefined)
    setBulkScope(undefined)
    report(
      failed === 0
        ? t(done === 1 ? 'notice.deletedMany.one' : 'notice.deletedMany', { n: done })
        : t('deleteAll.partial', { done, failed }),
      failed === 0,
    )
  }

  return (
    <div className={css.section}>
      <h2 className={css.heading}>{t('title')}</h2>
      <p className={css.intro}>{t('description')}</p>

      <div className={css.toolbar}>
        <Input
          className={css.search as string}
          icon={<IconSearchOutlineRegular size={15} />}
          type="search"
          value={query}
          aria-label={t('search.label')}
          placeholder={t('search.placeholder')}
          onChange={(event) => { setQuery(event.currentTarget.value) }}
        />
        <WorkspaceFilterMenu
          options={options}
          selected={selected?.workspaceId}
          onPick={setFilter}
          t={t}
        />
        <SortMenu sort={sort} onPick={setSort} t={t} />
      </div>

      {status === 'ready' && groups.length > 0 && (
        <div className={css.meta}>
          <span className={css.metaCount}>{t(visible.length === 1 ? 'summary.count.one' : 'summary.count', { n: visible.length })}</span>
          {visible.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              icon={<IconTrashOutlineRegular size={14} />}
              className={css.bulkDelete}
              disabled={bulkProgress !== undefined}
              onClick={() => {
                setBulkScope({ sessionIds: visible.map(row => row.sessionId), count: visible.length, label: scopeLabel })
              }}
            >
              {t(visible.length === 1 ? 'deleteAll.action.one' : 'deleteAll.action', { n: visible.length })}
            </Button>
          )}
        </div>
      )}

      {status === 'failed' ? (
        <div className={css.failure} role="alert">
          <IconWarningOutlineRegular className={css.failureIcon} size={16} />
          <div className={css.failureText}>
            <p className={css.failureTitle}>{t('error.title')}</p>
            <p className={css.failureDetail}>{t('error.detail')}</p>
            {workspaceError !== null && <p className={css.failureDetail}>{workspaceError.message}</p>}
          </div>
        </div>
      ) : status === 'pending' ? (
        <p className={css.status}>{t('empty.pending')}</p>
      ) : groups.length === 0 ? (
        <p className={css.status}>{filtering ? t('empty.filtered') : t('empty.none')}</p>
      ) : (
        <div className={css.groups}>
          {groups.map(group => (
            <ArchivedWorkspaceGroup
              key={group.key}
              group={group}
              t={t}
              now={now}
              collapsed={collapsed.has(group.key)}
              busy={busy}
              onToggle={toggleGroup}
              onRestore={(row) => { void runRestore(row) }}
              onDelete={(row) => {
                setDeleteAcknowledged(false)
                setDeleteTarget(row)
              }}
            />
          ))}
        </div>
      )}

      <RiskConfirmation
        open={deleteTarget !== undefined}
        title={t('delete.title')}
        description={t('delete.description', { title: deleteTarget?.title ?? '' })}
        acknowledgeLabel={t('delete.acknowledge')}
        cancelLabel={t('cancel')}
        closeLabel={t('close')}
        confirmLabel={t('delete.confirm')}
        acknowledged={deleteAcknowledged}
        disabled={deleteRunning}
        cancelDisabled={deleteRunning}
        onAcknowledgedChange={setDeleteAcknowledged}
        onCancel={() => {
          setDeleteTarget(undefined)
          setDeleteAcknowledged(false)
        }}
        onConfirm={() => {
          const target = deleteTarget
          /* v8 ignore next -- the dialog only reaches its confirm while a row is selected. */
          if (target === undefined) return
          void runDelete(target)
        }}
      />

      {bulkScope !== undefined && (
        <DeleteArchivedDialog
          scope={bulkScope}
          t={t}
          pending={bulkProgress !== undefined}
          progress={bulkProgress}
          onCancel={() => { setBulkScope(undefined) }}
          onConfirm={(scope) => { void runBulkDelete(scope) }}
        />
      )}

      {notice !== undefined && (
        <Toast
          key={notice.seq}
          text={notice.text}
          {...(notice.success
            ? { tone: 'success' as const }
            : { icon: <IconWarningOutlineRegular /> })}
          onDone={() => { setNotice(undefined) }}
        />
      )}
    </div>
  )
}

/** Props of the Workspace filter control. */
interface WorkspaceFilterMenuProps {
  options: ReturnType<typeof archivedWorkspaceOptions>
  selected: WorkspaceId | undefined
  onPick: (filter: ArchivedWorkspaceFilter) => void
  t: ArchivedSessionsSectionProps['t']
}

/**
 * The Workspace filter: every Workspace the registry holds, each with the count
 * of what it has archived, plus the unfiltered choice.
 * @param props - the option list, the chosen Workspace, the pick callback, and the locale seat.
 * @returns the filter control and its dropdown.
 */
function WorkspaceFilterMenu({ options, selected, onPick, t }: WorkspaceFilterMenuProps) {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      items={[
        { type: 'label' as const, id: 'workspace-filter', text: t('workspace.filter') },
        { id: ALL_WORKSPACES, label: t('workspace.all'), icon: <IconFolderCloseRegular /> },
        ...options.map(option => ({
          id: option.workspaceId,
          label: `${option.title} (${String(option.count)})`,
          icon: <IconFolderCloseRegular />,
        })),
      ]}
      selectedId={selected}
      onSelect={(id) => {
        /* v8 ignore next -- a menu row is either the unfiltered choice or an id this control just listed. */
        onPick(id === ALL_WORKSPACES ? ALL_WORKSPACES : id as WorkspaceId)
        setOpen(false)
      }}
      align="start"
      dense
      // Portal: the settings panel scrolls, so an in-place list would be clipped
      // to the section's box.
      portal
      anchor={(
        <button
          type="button"
          className={css.select}
          aria-label={t('workspace.filter')}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => { setOpen(current => !current) }}
        >
          <IconFolderCloseRegular size={15} />
          <span className={css.selectText}>{selected === undefined ? t('workspace.all') : options.find(option => option.workspaceId === selected)?.title}</span>
          <IconChevronDownOutlineRegular size={14} />
        </button>
      )}
    />
  )
}

/** Props of the order control. */
interface SortMenuProps {
  sort: ArchivedSort
  onPick: (sort: ArchivedSort) => void
  t: ArchivedSessionsSectionProps['t']
}

/**
 * The order selector. Recency leads because an archive is mostly revisited by
 * how lately it happened; creation time answers which of two long-dead
 * conversations came first; alphabetical serves the lookup case.
 * @param props - the active order, the pick callback, and the locale seat.
 * @returns the order control and its dropdown.
 */
function SortMenu({ sort, onPick, t }: SortMenuProps) {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      items={[
        { type: 'label' as const, id: 'archived-sort', text: t('sort.label') },
        { id: 'updated', label: t('sort.updated'), icon: <IconClockOutlineRegular /> },
        { id: 'created', label: t('sort.created'), icon: <IconPlusOutlineRegular /> },
        { id: 'title', label: t('sort.title'), icon: <IconChevronsUpDownOutlineRegular /> },
      ]}
      selectedId={sort}
      onSelect={(id) => {
        onPick(id === 'created' ? 'created' : id === 'title' ? 'title' : 'updated')
        setOpen(false)
      }}
      align="end"
      dense
      portal
      anchor={(
        <button
          type="button"
          className={css.select}
          aria-label={t('sort.label')}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => { setOpen(current => !current) }}
        >
          <IconChevronsUpDownOutlineRegular size={15} />
          {/* The control names what it sorts by, then which order is active:
              an icon alone leaves the trigger reading as an unlabelled menu. */}
          <span className={css.selectLabel}>{t('sort.label')}</span>
          <span className={css.selectText}>{t(sortKey(sort))}</span>
          <IconChevronDownOutlineRegular size={14} />
        </button>
      )}
    />
  )
}

/**
 * The dictionary key naming one order, so the dropdown's row and the trigger's
 * current value can never name different things.
 * @param sort - the order to name.
 * @returns that order's key in this page's dictionary.
 */
function sortKey(sort: ArchivedSort): ArchivedSessionsLocaleKey {
  switch (sort) {
    case 'created': return 'sort.created'
    case 'title': return 'sort.title'
    case 'updated': return 'sort.updated'
    /* v8 ignore next -- the closed union above is exhausted; only a forged order reaches this. */
    default: return assertNever(sort, 'ArchivedSort')
  }
}
