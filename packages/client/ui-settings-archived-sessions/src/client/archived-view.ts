/**
 * The Archived sessions page's view projection: turning the two Host
 * snapshots the page reads into the workspace-grouped, filtered, ordered rows
 * it draws. Every function here is pure, so the page's list behavior is
 * exercised without a Host.
 *
 * The archive set and the session metadata are two independent observations:
 * the Workspace Controller owns which Sessions are archived, the Session
 * Controller owns their titles and timestamps. An archived id the Session list
 * has not described yet is skipped rather than rendered as a blank row, and
 * the page reports the list phase so an empty archive during the first read is
 * distinguishable from an archive that is genuinely empty. The list builds a
 * few rows itself — subagents the Host list does not carry — and those carry
 * no durable creation time, so the creation order leaves them last rather than
 * dating them from their update time.
 */

import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** The workspace filter's "every workspace" choice. */
export const ALL_WORKSPACES = '*' as const

/** Group key for archived Sessions accounted to no Workspace. */
export const NO_WORKSPACE_KEY = '::no-workspace'

/** Workspace filter value: every Workspace, or one Workspace's archived Sessions. */
export type ArchivedWorkspaceFilter = typeof ALL_WORKSPACES | WorkspaceId

/** Row order: most recently updated, most recently created, or alphabetical by display title. */
export type ArchivedSort = 'updated' | 'created' | 'title'

/** One archived Session as the page draws it. */
export interface ArchivedSessionRow {
  readonly sessionId: SessionId
  /** Human-facing Session label from the Session Controller list. */
  readonly title: string
  /** Epoch ms of the Session's last durable mutation. */
  readonly updatedAt: number
  /**
   * Epoch ms of the Session's creation, read from its durable header. Absent
   * for the rows the Session list builds locally — a subagent the Host list
   * does not carry — which the list has no durable creation moment for.
   */
  readonly createdAt: number | undefined
  /** Owning Workspace, or undefined when no Workspace accounts for the Session. */
  readonly workspaceId: WorkspaceId | undefined
}

/** One Workspace's archived Sessions, or the ungrouped remainder. */
export interface ArchivedWorkspaceGroup {
  /** Stable group identity: a Workspace id, or {@link NO_WORKSPACE_KEY}. */
  readonly key: string
  /** Workspace identity, absent for the ungrouped remainder. */
  readonly workspaceId: WorkspaceId | undefined
  /** Localized Workspace display title, already resolved by the caller. */
  readonly title: string
  /** Group members in the page's active order. */
  readonly rows: readonly ArchivedSessionRow[]
}

/**
 * Case- and accent-insensitive title ordering for the alphabetical mode.
 * One collator for the page: `Intl.Collator` construction dominates the sort
 * when every row re-collates on each keystroke.
 */
const TITLE_COLLATOR = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

/**
 * Join the archive set with the Session list and the Workspace registry.
 * @param byId - Session Controller list rows, keyed by Session id.
 * @param workspaces - Workspace rows in Host order (names and membership).
 * @param archivedSessionIds - registry-global archive set in Host order.
 * @returns one row per archived Session the Session list describes, in archive-set order.
 */
export function deriveArchivedRows(
  byId: Readonly<Record<SessionId, SessionSummary>>,
  workspaces: readonly WorkspaceView[],
  archivedSessionIds: readonly SessionId[],
): readonly ArchivedSessionRow[] {
  const owner = owningWorkspaces(workspaces)
  const rows: ArchivedSessionRow[] = []
  for (const sessionId of archivedSessionIds) {
    const summary = byId[sessionId]
    /* v8 ignore next -- an archive id the Session list has not described carries no title or time; the page waits for the list phase. */
    if (summary === undefined) continue
    rows.push({
      sessionId,
      title: summary.displayTitle,
      updatedAt: summary.updatedAt,
      createdAt: summary.createdAt,
      workspaceId: owner.get(sessionId),
    })
  }
  return rows
}

/**
 * Invert Workspace membership into one owner per Session. A Session accounted
 * to several Workspaces keeps the first in Host order, which is the same
 * account the sidebar's grouping derivation resolves.
 * @param workspaces - Workspace rows in Host order.
 * @returns Session id to its owning Workspace id.
 */
function owningWorkspaces(workspaces: readonly WorkspaceView[]): ReadonlyMap<SessionId, WorkspaceId> {
  const owner = new Map<SessionId, WorkspaceId>()
  for (const workspace of workspaces) {
    for (const sessionId of workspace.sessionIds) {
      if (!owner.has(sessionId)) owner.set(sessionId, workspace.workspaceId)
    }
  }
  return owner
}

/**
 * Order rows for display.
 * @param rows - rows to order.
 * @param sort - the page's active order.
 * @returns a new ordered array; recency breaks title and creation ties so the order is total.
 */
export function sortArchivedRows(
  rows: readonly ArchivedSessionRow[],
  sort: ArchivedSort,
): readonly ArchivedSessionRow[] {
  const ordered = [...rows]
  if (sort === 'title') {
    ordered.sort((left, right) =>
      TITLE_COLLATOR.compare(left.title, right.title)
      || right.updatedAt - left.updatedAt
      || left.sessionId.localeCompare(right.sessionId))
    return ordered
  }
  if (sort === 'created') {
    ordered.sort((left, right) =>
      newerFirst(left.createdAt, right.createdAt)
      || right.updatedAt - left.updatedAt
      || left.sessionId.localeCompare(right.sessionId))
    return ordered
  }
  ordered.sort((left, right) =>
    right.updatedAt - left.updatedAt || left.sessionId.localeCompare(right.sessionId))
  return ordered
}

/**
 * Order two creation moments newest first. A row the Session list built locally
 * has no durable creation moment, and an unknown moment cannot be placed on the
 * timeline, so it follows every row that has one rather than claiming the epoch
 * or standing in for it with the row's update time.
 * @param left - one row's creation time, absent for a locally built row.
 * @param right - the other row's creation time.
 * @returns negative when `left` is the newer moment, positive when it is the older, zero when neither outranks the other.
 */
function newerFirst(left: number | undefined, right: number | undefined): number {
  if (left === undefined) return right === undefined ? 0 : 1
  if (right === undefined) return -1
  return right - left
}

/**
 * Fold one string to the form a search compares in: accents removed by
 * decomposing to NFD and dropping the combining marks, then lowercased. Both
 * sides of a comparison go through this, so a query typed without accents
 * matches a title that carries them.
 * @param text - the raw title or query.
 * @returns the folded form.
 */
function foldSearch(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase()
}

/**
 * Narrow rows to the workspace filter and the search query. An empty query
 * keeps every row; a query matches a case- and accent-insensitive substring of
 * the title.
 * @param rows - candidate rows.
 * @param filter - chosen Workspace, or {@link ALL_WORKSPACES}.
 * @param query - trimmed search text.
 * @returns the matching rows in their incoming order.
 */
export function filterArchivedRows(
  rows: readonly ArchivedSessionRow[],
  filter: ArchivedWorkspaceFilter,
  query: string,
): readonly ArchivedSessionRow[] {
  const needle = foldSearch(query.trim())
  return rows.filter((row) => {
    if (filter !== ALL_WORKSPACES && row.workspaceId !== filter) return false
    return needle === '' || foldSearch(row.title).includes(needle)
  })
}

/**
 * Group ordered rows by owning Workspace, keeping Workspace order from the
 * Host registry and appending the ungrouped remainder last.
 * @param rows - already filtered and ordered rows.
 * @param workspaces - Workspace rows in Host order, carrying resolved titles.
 * @param labelOf - renders the ungrouped group's title from the page dictionary.
 * @returns one group per Workspace holding at least one row, plus the remainder.
 */
export function groupArchivedRows(
  rows: readonly ArchivedSessionRow[],
  workspaces: readonly WorkspaceView[],
  labelOf: () => string,
): readonly ArchivedWorkspaceGroup[] {
  const groups = new Map<string, ArchivedSessionRow[]>()
  for (const row of rows) {
    const key = row.workspaceId ?? NO_WORKSPACE_KEY
    const group = groups.get(key)
    if (group === undefined) groups.set(key, [row])
    else group.push(row)
  }
  const ordered: ArchivedWorkspaceGroup[] = []
  for (const workspace of workspaces) {
    const group = groups.get(workspace.workspaceId)
    if (group === undefined) continue
    ordered.push({
      key: workspace.workspaceId,
      workspaceId: workspace.workspaceId,
      title: workspace.title,
      rows: group,
    })
  }
  const ungrouped = groups.get(NO_WORKSPACE_KEY)
  if (ungrouped !== undefined) {
    ordered.push({ key: NO_WORKSPACE_KEY, workspaceId: undefined, title: labelOf(), rows: ungrouped })
  }
  return ordered
}

/**
 * Workspaces the page's filter offers, in Host order, paired with their
 * archived-Session counts. A Workspace with nothing archived is still offered
 * so the filter never hides a group the user cannot currently reach.
 * @param workspaces - Workspace rows in Host order, carrying resolved titles.
 * @param rows - every archived row before filtering.
 * @returns one option per Workspace, each with its archived count.
 */
export function archivedWorkspaceOptions(
  workspaces: readonly WorkspaceView[],
  rows: readonly ArchivedSessionRow[],
): readonly { readonly workspaceId: WorkspaceId; readonly title: string; readonly count: number }[] {
  const counts = new Map<WorkspaceId, number>()
  for (const row of rows) {
    if (row.workspaceId === undefined) continue
    counts.set(row.workspaceId, (counts.get(row.workspaceId) ?? 0) + 1)
  }
  return workspaces.map(workspace => ({
    workspaceId: workspace.workspaceId,
    title: workspace.title,
    count: counts.get(workspace.workspaceId) ?? 0,
  }))
}

/**
 * How settled the page's two read authorities are. The Workspace Controller
 * owns the archive set and the Workspace names; the Session Controller owns the
 * titles and timestamps. An empty archive is only a fact once both settled —
 * otherwise the page says so instead of claiming nothing is archived.
 */
export type ArchivedReadStatus = 'pending' | 'failed' | 'ready'

/**
 * Classify the page's read authorities. The Session list has no failure phase
 * of its own: an unreachable Host leaves it `pending`, which the page's retry
 * re-reads through `sessions.refresh()`.
 * @param sessionPhase - Session list arrival phase.
 * @param workspaceState - Workspace follow-stream state.
 * @returns the status the page renders its body from.
 */
export function archivedReadStatus(
  sessionPhase: SessionListState['phase'],
  workspaceState: 'idle' | 'loading' | 'error',
): ArchivedReadStatus {
  if (workspaceState === 'error') return 'failed'
  if (sessionPhase !== 'ready' || workspaceState !== 'idle') return 'pending'
  return 'ready'
}
