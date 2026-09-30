// @vitest-environment jsdom
/** The Archived settings page: what it groups, filters, orders, and confirms. */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import type { SessionSummary, SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId, WorkspaceSnapshot, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { ArchivedSessionsSection } from '../src/client/ArchivedSessionsSection.tsx'
import type { ArchivedSessionsSectionProps } from '../src/client/ArchivedSessionsSection.tsx'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)

const DAY = 86_400_000
const NOW = Date.now()

const sid = (id: string): SessionId => id as SessionId
const wid = (id: string): WorkspaceId => id as WorkspaceId

/** The page's translate seat, resolving this page's dictionary then the shared words. */
const t: ArchivedSessionsSectionProps['t'] = makeTranslate(en, commonEn)

const workspace = (id: string, title: string, sessionIds: readonly string[]): WorkspaceView => ({
  workspaceId: wid(id),
  path: `/projects/${id}`,
  title,
  sessionIds: sessionIds.map(sid),
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
})

const summary = (id: string, displayTitle: string, ageDays: number, createdAgeDays = ageDays): SessionSummary => ({
  id: sid(id),
  displayTitle,
  running: false,
  retainedBy: {},
  blank: false,
  createdAt: NOW - createdAgeDays * DAY,
  updatedAt: NOW - ageDays * DAY,
})

/**
 * A summary the Session list built itself, the way it does for a subagent the
 * Host list does not carry: there is no durable header, so the row carries an
 * update time and no creation time at all.
 * @param id - the Session's id.
 * @param displayTitle - the Session's display title.
 * @param ageDays - how many days ago the Session was last touched.
 * @returns the summary, absent its optional creation time.
 */
const localSummary = (id: string, displayTitle: string, ageDays: number): SessionSummary => ({
  id: sid(id),
  displayTitle,
  running: false,
  retainedBy: {},
  blank: false,
  updatedAt: NOW - ageDays * DAY,
})

interface Fixture {
  items?: readonly WorkspaceView[]
  archived?: readonly string[]
  rows?: readonly SessionSummary[]
  workspaceState?: WorkspaceSnapshot['state']
  workspaceError?: WorkspaceSnapshot['error']
  sessionPhase?: SessionListState['phase']
  unarchive?: (sessionId: SessionId) => Promise<void>
  remove?: (sessionId: SessionId) => Promise<void>
}

/** One of the two commands the page issues. */
type PageCommand = (sessionId: SessionId) => Promise<void>

/** That command as a spy whose calls the tests read. */
type CommandSpy = Mock<PageCommand>

/** Commands the page issues, overridable so a rerender keeps the same spies. */
interface PageCommands {
  unarchiveSession?: CommandSpy
  deleteSession?: CommandSpy
}

/**
 * The selector hook a component would receive for one fixed snapshot.
 * @param snapshot - the value every selector projects.
 * @returns the hook, generic over the selected value as the slot declares it.
 */
function workspaceHook(snapshot: WorkspaceSnapshot): ArchivedSessionsSectionProps['useWorkspaces'] {
  return <S,>(selector: (state: WorkspaceSnapshot) => S): S => selector(snapshot)
}

/** The session-list counterpart of {@link workspaceHook}. */
function sessionHook(snapshot: SessionListState): ArchivedSessionsSectionProps['useSessions'] {
  return <S,>(selector: (state: SessionListState) => S): S => selector(snapshot)
}

/**
 * A global slot source this page never reads, standing in for the seats every
 * settings section carries. Reaching one means the page read a source it does
 * not bind, so the throw names the page's own two read authorities.
 * @returns never; the page binds its reads to the Workspace and Session sources.
 */
function unusedHook(): never {
  throw new Error('This page reads the Workspace snapshot and the Session list only')
}

/**
 * The page's props over one snapshot pair, plus the spies behind its commands.
 * @param fixture - the snapshots, read state, and command bodies the page runs on.
 * @param commands - spies the caller already holds, so a rerender keeps their identity.
 * @returns the props and the two command spies the props bound.
 */
function sectionProps(fixture: Fixture = {}, commands: PageCommands = {}): {
  props: ArchivedSessionsSectionProps
  unarchiveSession: CommandSpy
  deleteSession: CommandSpy
} {
  const unarchiveSession: CommandSpy = commands.unarchiveSession ?? vi.fn<PageCommand>(fixture.unarchive ?? (async () => {}))
  const deleteSession: CommandSpy = commands.deleteSession ?? vi.fn<PageCommand>(fixture.remove ?? (async () => {}))
  const byId = Object.fromEntries((fixture.rows ?? []).map(row => [row.id, row])) as SessionListState['byId']
  return {
    props: {
      t,
      close: () => {},
      usePanelInfo: unusedHook,
      useSessionStatus: unusedHook,
      useSessionRetainInfo: unusedHook,
      useResource: unusedHook,
      useWorkspaces: workspaceHook({
        items: fixture.items ?? [],
        archivedSessionIds: (fixture.archived ?? []).map(sid),
        pinnedSessionIds: [],
        state: fixture.workspaceState ?? 'idle',
        phase: 'ready',
        error: fixture.workspaceError ?? null,
      }),
      useSessions: sessionHook({
        ids: (fixture.rows ?? []).map(row => row.id),
        byId,
        phase: fixture.sessionPhase ?? 'ready',
        projectionsBySession: {},
      }),
      unarchiveSession,
      deleteSession,
    },
    unarchiveSession,
    deleteSession,
  }
}

/** Render the page over one snapshot pair, returning the commands it issued. */
function renderPage(fixture: Fixture = {}) {
  const { props, unarchiveSession, deleteSession } = sectionProps(fixture)

  render(<ArchivedSessionsSection {...props} />)
  return { unarchiveSession, deleteSession }
}

/** Open one of the two dropdowns and pick the row carrying `name`. */
function pickMenu(name: string, option: string): void {
  fireEvent.click(screen.getByRole('button', { name }))
  fireEvent.click(screen.getByRole('menuitem', { name: option }))
}

/**
 * A command the test settles by hand, so a deletion can be observed while it
 * is still running.
 * @returns the pending promise and the function that settles it.
 */
function pendingCommand(): { pending: Promise<void>; resolve: () => void } {
  let settle: () => void = () => {}
  const pending = new Promise<void>((resolve) => { settle = () => { resolve() } })
  return { pending, resolve: settle }
}

const ARCHIVED = {
  items: [workspace('w1', 'Project', ['s1', 's2']), workspace('w2', 'Notes', ['s3'])],
  archived: ['s1', 's2', 's3'],
  rows: [
    summary('s1', 'Alpha report', 1),
    summary('s2', 'Beta plan', 3),
    summary('s3', 'Gamma log', 5),
  ],
}

/** English bulk-action label with count-sensitive grammar. */
const bulkActionLabel = (count: number): string =>
  en[count === 1 ? 'deleteAll.action.one' : 'deleteAll.action'].replace('{n}', String(count))

describe('ArchivedSessionsSection', () => {
  it('leads with its own heading and intro', () => {
    renderPage(ARCHIVED)

    expect(screen.getByRole('heading', { name: en.title })).toBeTruthy()
    expect(screen.getByText(en.description)).toBeTruthy()
  })

  it('says so when nothing has been archived yet', () => {
    renderPage()

    expect(screen.getByText(en['empty.none'])).toBeTruthy()
    expect(screen.queryByRole('button', { name: bulkActionLabel(1) })).toBeNull()
  })

  it('distinguishes an empty view from an empty archive', () => {
    renderPage({ ...ARCHIVED, archived: [] })
    expect(screen.getByText(en['empty.none'])).toBeTruthy()
  })

  it('waits rather than claiming an empty archive before the list has settled', () => {
    renderPage({ ...ARCHIVED, sessionPhase: 'pending' })

    expect(screen.getByText(en['empty.pending'])).toBeTruthy()
    expect(screen.queryByText('Alpha report')).toBeNull()
  })

  it('reports a terminal read failure without offering a retry it cannot perform', () => {
    renderPage({
      ...ARCHIVED,
      workspaceState: 'error',
      workspaceError: new RemoteError('gateway/internal', 'stream closed', {}),
    })

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain(en['error.title'])
    expect(alert.textContent).toContain(en['error.detail'])
    expect(screen.getByText('stream closed')).toBeTruthy()
    // The Workspace follow stream owns reconnection and publishes nothing to
    // resume it, so a retry here would only re-read the other half.
    expect(screen.queryByRole('button', { name: commonEn.retry })).toBeNull()
  })

  it('groups archived Sessions under the Workspace that holds them', () => {
    renderPage(ARCHIVED)

    expect(screen.getByRole('button', { name: /Project/ }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('button', { name: /Notes/ }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Alpha report')).toBeTruthy()
    expect(screen.getByText('Gamma log')).toBeTruthy()
  })

  it('gives every row both commands, with no pointer having touched it', () => {
    renderPage(ARCHIVED)

    // Nothing about a row's commands is conditional on hover, so a device that
    // cannot hover renders the same buttons; the stylesheet is what keeps them
    // visible there. The title and the date stay beside them, so a narrow sheet
    // can move a cell to a second line rather than drop one.
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect(within(row).getByRole('button', { name: en['row.restore'] })).toBeTruthy()
      expect(within(row).getByRole('button', { name: en['row.delete'] })).toBeTruthy()
      expect(row.querySelector('[class*="rowActions"]')?.children).toHaveLength(2)
      expect(within(row).getAllByText(/\S/).length).toBeGreaterThanOrEqual(2)
    }
    expect(screen.getAllByRole('button', { name: en['row.restore'] })).toHaveLength(3)
    expect(screen.getAllByRole('button', { name: en['row.delete'] })).toHaveLength(3)
  })

  it('collapses and reopens one group without touching the other', () => {
    renderPage(ARCHIVED)
    const project = screen.getByRole('button', { name: /Project/ })
    const notes = screen.getByRole('button', { name: /Notes/ })

    fireEvent.click(project)
    expect(project.getAttribute('aria-expanded')).toBe('false')
    expect(notes.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Alpha report').closest('[hidden]')).toBeTruthy()
    expect(screen.getByText('Gamma log').closest('[hidden]')).toBeNull()

    fireEvent.click(project)
    expect(screen.getByText('Alpha report').closest('[hidden]')).toBeNull()
  })

  it('holds archived Sessions no Workspace accounts for in their own group', () => {
    renderPage({ ...ARCHIVED, archived: ['s1', 's2', 's3', 's4'], rows: [...ARCHIVED.rows, summary('s4', 'Loose thought', 9)] })

    expect(screen.getByRole('button', { name: new RegExp(en['workspace.ungrouped']) })).toBeTruthy()
  })

  it('searches titles without regard to case', () => {
    renderPage(ARCHIVED)

    fireEvent.change(screen.getByRole('searchbox', { name: en['search.label'] }), { target: { value: 'BETA' } })

    expect(screen.getByText('Beta plan')).toBeTruthy()
    expect(screen.queryByText('Alpha report')).toBeNull()
  })

  it('matches a query typed without the accents a title carries', () => {
    renderPage({ ...ARCHIVED, rows: [summary('s1', 'Résumé polish', 1), summary('s2', 'Beta plan', 3)] })

    fireEvent.change(screen.getByRole('searchbox', { name: en['search.label'] }), { target: { value: 'resume' } })

    expect(screen.getByText('Résumé polish')).toBeTruthy()
    expect(screen.queryByText('Beta plan')).toBeNull()
  })

  it('says the current view matches nothing rather than that nothing is archived', () => {
    renderPage(ARCHIVED)

    fireEvent.change(screen.getByRole('searchbox', { name: en['search.label'] }), { target: { value: 'nothing here' } })

    expect(screen.getByText(en['empty.filtered'])).toBeTruthy()
  })

  it('uses singular English count and deletion copy for one archived conversation', async () => {
    const { deleteSession } = renderPage({ ...ARCHIVED, archived: ['s1'] })

    expect(screen.getByText('1 archived conversation')).toBeTruthy()
    const action = screen.getByRole('button', { name: 'Permanently delete 1 conversation' })
    fireEvent.click(action)
    expect(screen.getByText('1 archived conversation in the current view (All workspaces) will be permanently deleted:')).toBeTruthy()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: commonEn.next }))
    const confirmStep = within(screen.getByRole('dialog'))
    expect(confirmStep.getByLabelText('I understand this conversation will be permanently deleted and cannot be recovered')).toBeTruthy()
    fireEvent.click(confirmStep.getByRole('checkbox'))
    fireEvent.click(confirmStep.getByRole('button', { name: 'Permanently delete 1 conversation' }))
    await waitFor(() => { expect(deleteSession).toHaveBeenCalledExactlyOnceWith(sid('s1')) })
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('Permanently deleted 1 conversation') })
  })

  it('keeps the existing Chinese wording for one-item counts', () => {
    expect(zh['summary.count.one']).toBe(zh['summary.count'])
    expect(zh['deleteAll.action.one']).toBe(zh['deleteAll.action'])
    expect(zh['deleteAll.scope.one']).toBe(zh['deleteAll.scope'])
    expect(zh['deleteAll.acknowledge.one']).toBe(zh['deleteAll.acknowledge'])
    expect(zh['deleteAll.confirm.one']).toBe(zh['deleteAll.confirm'])
    expect(zh['notice.deletedMany.one']).toBe(zh['notice.deletedMany'])
  })

  it('narrows to one Workspace from the filter and names the unfiltered choice', () => {
    renderPage(ARCHIVED)
    expect(screen.getByRole('button', { name: en['workspace.filter'] }).textContent).toContain(en['workspace.all'])

    pickMenu(en['workspace.filter'], 'Notes (1)')

    expect(screen.getByText('Gamma log')).toBeTruthy()
    expect(screen.queryByText('Alpha report')).toBeNull()
  })

  it('orders by recency and switches to alphabetical', () => {
    renderPage(ARCHIVED)
    expect(screen.getByText(en['summary.count'].replace('{n}', '3'))).toBeTruthy()

    // The trigger names what it orders by before naming the order in force.
    const trigger = screen.getByRole('button', { name: en['sort.label'] })
    expect(trigger.textContent).toContain(en['sort.label'])
    expect(trigger.textContent).toContain(en['sort.updated'])

    pickMenu(en['sort.label'], en['sort.title'])

    const names = screen.getAllByText(/report|plan|log/).map(node => node.textContent)
    expect(names).toEqual(['Alpha report', 'Beta plan', 'Gamma log'])
    // The selected order stays readable on the trigger it came from.
    expect(screen.getByRole('button', { name: en['sort.label'] }).textContent).toContain(en['sort.title'])
  })

  it('orders by creation time as its own choice, naming it on the trigger', () => {
    // One Workspace, so the listing shows the order itself rather than the
    // group order. Created in the reverse of how recently each was touched, so
    // reading the update time would lead with a different row.
    renderPage({
      items: [workspace('w1', 'Project', ['s1', 's2', 's3'])],
      archived: ['s1', 's2', 's3'],
      rows: [
        summary('s1', 'Alpha report', 9, 1),
        summary('s2', 'Beta plan', 1, 5),
        summary('s3', 'Gamma log', 5, 3),
      ],
    })
    const trigger = screen.getByRole('button', { name: en['sort.label'] })
    expect(trigger.textContent).toContain(en['sort.label'])
    expect(trigger.textContent).toContain(en['sort.updated'])

    pickMenu(en['sort.label'], en['sort.created'])

    const names = screen.getAllByText(/report|plan|log/).map(node => node.textContent)
    expect(names).toEqual(['Alpha report', 'Gamma log', 'Beta plan'])
    // The chosen order stays readable on the trigger it came from.
    expect(screen.getByRole('button', { name: en['sort.label'] }).textContent).toContain(en['sort.created'])
  })

  it('leaves a row with no durable creation time last in the creation order', () => {
    // A row the Session list built locally carries no creation moment, so it
    // follows every dated row rather than standing in at the epoch.
    renderPage({
      items: [workspace('w1', 'Project', ['s1', 's2', 's3'])],
      archived: ['s1', 's2', 's3'],
      rows: [
        localSummary('s1', 'Alpha report', 1),
        summary('s2', 'Beta plan', 3),
        summary('s3', 'Gamma log', 5),
      ],
    })

    pickMenu(en['sort.label'], en['sort.created'])

    const names = screen.getAllByText(/report|plan|log/).map(node => node.textContent)
    expect(names).toEqual(['Beta plan', 'Gamma log', 'Alpha report'])
  })

  it('offers all three orders, and each one reorders the listing', () => {
    // One Workspace, so the listing shows each order rather than the group order.
    // Created in the reverse of how recently each was touched, so the first two
    // orders lead with different rows and neither can pass for the other.
    renderPage({
      items: [workspace('w1', 'Project', ['s1', 's2', 's3'])],
      archived: ['s1', 's2', 's3'],
      rows: [
        summary('s1', 'Alpha report', 9, 1),
        summary('s2', 'Beta plan', 1, 5),
        summary('s3', 'Gamma log', 5, 3),
      ],
    })

    fireEvent.click(screen.getByRole('button', { name: en['sort.label'] }))
    for (const order of [en['sort.updated'], en['sort.created'], en['sort.title']]) {
      expect(screen.getByRole('menuitem', { name: order })).toBeTruthy()
    }
    fireEvent.keyDown(document, { key: 'Escape' })

    const listed = (): (string | null)[] => screen.getAllByText(/report|plan|log/).map(node => node.textContent)
    expect(listed()).toEqual(['Beta plan', 'Gamma log', 'Alpha report'])

    pickMenu(en['sort.label'], en['sort.created'])
    expect(listed()).toEqual(['Alpha report', 'Gamma log', 'Beta plan'])

    pickMenu(en['sort.label'], en['sort.title'])
    expect(listed()).toEqual(['Alpha report', 'Beta plan', 'Gamma log'])

    // Back to the first row, so no order reaches the listing by falling through.
    pickMenu(en['sort.label'], en['sort.updated'])
    expect(listed()).toEqual(['Beta plan', 'Gamma log', 'Alpha report'])
  })

  it('restores one Session and reports the outcome', async () => {
    const { unarchiveSession } = renderPage(ARCHIVED)

    fireEvent.click(screen.getAllByRole('button', { name: en['row.restore'] })[0]!)

    await waitFor(() => { expect(unarchiveSession).toHaveBeenCalledWith(sid('s1')) })
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain(en['notice.restored']) })
  })

  it('reports a restore the Host refused', async () => {
    renderPage({ ...ARCHIVED, unarchive: async () => { throw new Error('refused') } })

    fireEvent.click(screen.getAllByRole('button', { name: en['row.restore'] })[0]!)

    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain(en['restore.failed']) })
  })

  it('deletes one Session only after its acknowledgement is checked', async () => {
    const { deleteSession } = renderPage(ARCHIVED)

    fireEvent.click(screen.getAllByRole('button', { name: en['row.delete'] })[0]!)

    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByText(/Alpha report/)).toBeTruthy()
    expect(dialog.getByRole<HTMLButtonElement>('button', { name: en['delete.confirm'] }).disabled).toBe(true)

    fireEvent.click(dialog.getByRole('checkbox'))
    expect(dialog.getByRole<HTMLButtonElement>('button', { name: en['delete.confirm'] }).disabled).toBe(false)

    fireEvent.click(dialog.getByRole('button', { name: en['delete.confirm'] }))
    await waitFor(() => { expect(deleteSession).toHaveBeenCalledWith(sid('s1')) })
  })

  it('closes a successful deletion instead of offering to repeat it', async () => {
    const { deleteSession } = renderPage(ARCHIVED)

    fireEvent.click(screen.getAllByRole('button', { name: en['row.delete'] })[0]!)
    const dialog = within(screen.getByRole('dialog'))
    fireEvent.click(dialog.getByRole('checkbox'))
    fireEvent.click(dialog.getByRole('button', { name: en['delete.confirm'] }))

    // The Host took the Session; the row leaves through the controller's own
    // event, so the confirmation must not survive to delete it a second time.
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(deleteSession).toHaveBeenCalledExactlyOnceWith(sid('s1'))
  })

  it('keeps a refused deletion on screen with the acknowledgement cleared', async () => {
    renderPage({ ...ARCHIVED, remove: async () => { throw new Error('writer lock') } })

    fireEvent.click(screen.getAllByRole('button', { name: en['row.delete'] })[0]!)
    const dialog = within(screen.getByRole('dialog'))
    fireEvent.click(dialog.getByRole('checkbox'))
    fireEvent.click(dialog.getByRole('button', { name: en['delete.confirm'] }))

    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain(en['delete.failed']) })
    // Still open, and the retry is a fresh tick rather than the carried-over one.
    expect(dialog.getByRole<HTMLInputElement>('checkbox').checked).toBe(false)
    expect(dialog.getByRole<HTMLButtonElement>('button', { name: en['delete.confirm'] }).disabled).toBe(true)
  })

  it('holds a running deletion open so a dismissal cannot hide it', async () => {
    const release = pendingCommand()
    const { deleteSession } = renderPage({ ...ARCHIVED, remove: () => release.pending })

    fireEvent.click(screen.getAllByRole('button', { name: en['row.delete'] })[0]!)
    const dialog = within(screen.getByRole('dialog'))
    fireEvent.click(dialog.getByRole('checkbox'))
    fireEvent.click(dialog.getByRole('button', { name: en['delete.confirm'] }))

    await waitFor(() => { expect(deleteSession).toHaveBeenCalledOnce() })
    // The command is already issued, so neither the cancel button nor Escape may
    // dismiss the only thing reporting it.
    expect(dialog.getByRole<HTMLButtonElement>('button', { name: commonEn.cancel }).disabled).toBe(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeNull()

    release.resolve()
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  })

  it('discards a cancelled deletion without issuing it', () => {
    const { deleteSession } = renderPage(ARCHIVED)

    fireEvent.click(screen.getAllByRole('button', { name: en['row.delete'] })[0]!)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: commonEn.cancel }))

    expect(deleteSession).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('takes two steps to delete every archived Session, naming the scope and count', async () => {
    const { deleteSession } = renderPage(ARCHIVED)

    fireEvent.click(screen.getByRole('button', { name: bulkActionLabel(3) }))

    // Step one only states the scope; the deletion is not reachable from it.
    const scopeStep = within(screen.getByRole('dialog'))
    expect(scopeStep.getByText(en['deleteAll.scope']
      .replace('{n}', '3').replace('{scope}', en['deleteAll.scope.all']))).toBeTruthy()
    fireEvent.click(scopeStep.getByRole('button', { name: commonEn.next }))

    // Step two still refuses until the acknowledgement is checked.
    const confirmStep = within(screen.getByRole('dialog'))
    const confirm = confirmStep.getByRole('button', { name: en['deleteAll.confirm'].replace('{n}', '3') })
    expect((confirm as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(confirmStep.getByRole('checkbox'))
    fireEvent.click(confirmStep.getByRole('button', { name: en['deleteAll.confirm'].replace('{n}', '3') }))

    await waitFor(() => { expect(deleteSession).toHaveBeenCalledTimes(3) })
    expect(deleteSession.mock.calls.map(([id]) => id)).toEqual([sid('s1'), sid('s2'), sid('s3')])
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain(en['notice.deletedMany'].replace('{n}', '3'))
    })
  })

  it('deletes only what the current filters select, and says which scope that is', async () => {
    const { deleteSession } = renderPage(ARCHIVED)
    pickMenu(en['workspace.filter'], 'Notes (1)')

    fireEvent.click(screen.getByRole('button', { name: bulkActionLabel(1) }))
    expect(within(screen.getByRole('dialog'))
      .getByText(en['deleteAll.scope.one'].replace('{n}', '1').replace('{scope}', en['deleteAll.scope.workspace'].replace('{name}', 'Notes'))))
      .toBeTruthy()

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: commonEn.next }))
    const confirmStep = within(screen.getByRole('dialog'))
    fireEvent.click(confirmStep.getByRole('checkbox'))
    fireEvent.click(confirmStep.getByRole('button', { name: en['deleteAll.confirm.one'].replace('{n}', '1') }))

    await waitFor(() => { expect(deleteSession).toHaveBeenCalledExactlyOnceWith(sid('s3')) })
  })

  it('names the search query as the scope of a searched deletion', () => {
    renderPage(ARCHIVED)
    fireEvent.change(screen.getByRole('searchbox', { name: en['search.label'] }), { target: { value: 'plan' } })

    fireEvent.click(screen.getByRole('button', { name: bulkActionLabel(1) }))

    expect(within(screen.getByRole('dialog')).getByText(en['deleteAll.scope.one']
      .replace('{n}', '1').replace('{scope}', en['deleteAll.scope.search'].replace('{query}', 'plan')))).toBeTruthy()
  })

  it('reports a deletion the Host refused', async () => {
    renderPage({ ...ARCHIVED, remove: async () => { throw new Error('writer lock') } })

    fireEvent.click(screen.getAllByRole('button', { name: en['row.delete'] })[0]!)
    const dialog = within(screen.getByRole('dialog'))
    fireEvent.click(dialog.getByRole('checkbox'))
    fireEvent.click(dialog.getByRole('button', { name: en['delete.confirm'] }))

    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain(en['delete.failed']) })
  })

  it('reports how much of a bulk deletion the Host refused', async () => {
    const { deleteSession } = renderPage({
      ...ARCHIVED,
      remove: async (id) => {
        if (id === sid('s2')) throw new Error('writer lock')
      },
    })

    fireEvent.click(screen.getByRole('button', { name: en['deleteAll.action'].replace('{n}', '3') }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: commonEn.next }))
    const confirmStep = within(screen.getByRole('dialog'))
    fireEvent.click(confirmStep.getByRole('checkbox'))
    fireEvent.click(confirmStep.getByRole('button', { name: en['deleteAll.confirm'].replace('{n}', '3') }))

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent)
        .toContain(en['deleteAll.partial'].replace('{done}', '2').replace('{failed}', '1'))
    })
    expect(deleteSession).toHaveBeenCalledTimes(3)
  })

  it('abandons a bulk deletion without issuing it', () => {
    const { deleteSession } = renderPage(ARCHIVED)

    fireEvent.click(screen.getByRole('button', { name: en['deleteAll.action'].replace('{n}', '3') }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: commonEn.cancel }))

    expect(deleteSession).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('starts a reopened bulk deletion at the scope step again', () => {
    renderPage(ARCHIVED)

    fireEvent.click(screen.getByRole('button', { name: en['deleteAll.action'].replace('{n}', '3') }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: commonEn.next }))
    expect(within(screen.getByRole('dialog')).getByRole('checkbox')).toBeTruthy()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: commonEn.cancel }))

    // The confirmation the first opening reached must not leak into the next
    // one, which has to name its scope before it can delete anything.
    fireEvent.click(screen.getByRole('button', { name: en['deleteAll.action'].replace('{n}', '3') }))
    const reopened = within(screen.getByRole('dialog'))
    expect(reopened.getByText(en['deleteAll.scope']
      .replace('{n}', '3').replace('{scope}', en['deleteAll.scope.all']))).toBeTruthy()
    expect(reopened.queryByRole('checkbox')).toBeNull()
  })

  it('deletes the scope the first confirmation named, not the current view', async () => {
    const deleteSession = vi.fn<PageCommand>(async () => {})
    const { rerender } = render(<ArchivedSessionsSection {...pageProps(ARCHIVED, { deleteSession })} />)

    fireEvent.click(screen.getByRole('button', { name: en['deleteAll.action'].replace('{n}', '3') }))
    // The Host un-archives two of them while the dialog is up: the view the
    // dialog already promised a count for is not the one it may delete.
    rerender(<ArchivedSessionsSection {...pageProps({ ...ARCHIVED, archived: ['s3'] }, { deleteSession })} />)

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: commonEn.next }))
    const confirmStep = within(screen.getByRole('dialog'))
    expect(confirmStep.getByText(en['deleteAll.scope']
      .replace('{n}', '3').replace('{scope}', en['deleteAll.scope.all']))).toBeTruthy()
    fireEvent.click(confirmStep.getByRole('checkbox'))
    fireEvent.click(confirmStep.getByRole('button', { name: en['deleteAll.confirm'].replace('{n}', '3') }))

    await waitFor(() => { expect(deleteSession).toHaveBeenCalledTimes(3) })
    expect(deleteSession.mock.calls.map(([id]) => id)).toEqual([sid('s1'), sid('s2'), sid('s3')])
  })

  it('holds a running bulk deletion open and reports what it could not delete', async () => {
    const release = pendingCommand()
    const { deleteSession } = renderPage({ ...ARCHIVED, remove: (id) => {
      if (id === sid('s2')) return Promise.reject(new Error('writer lock'))
      if (id === sid('s3')) return release.pending
      return Promise.resolve()
    } })

    fireEvent.click(screen.getByRole('button', { name: en['deleteAll.action'].replace('{n}', '3') }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: commonEn.next }))
    const confirmStep = within(screen.getByRole('dialog'))
    fireEvent.click(confirmStep.getByRole('checkbox'))
    fireEvent.click(confirmStep.getByRole('button', { name: en['deleteAll.confirm'].replace('{n}', '3') }))

    // One deletion is still in flight and one already failed; dismissing the
    // dialog now would leave the run going behind a closed card.
    await waitFor(() => {
      expect(confirmStep.getByRole<HTMLButtonElement>('button', { name: commonEn.cancel }).disabled).toBe(true)
    })
    expect(confirmStep.getByText(en['deleteAll.pending'].replace('{done}', '1').replace('{total}', '3'))).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeNull()

    release.resolve()
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent)
        .toContain(en['deleteAll.partial'].replace('{done}', '2').replace('{failed}', '1'))
    })
    expect(deleteSession).toHaveBeenCalledTimes(3)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes either dropdown without changing the view', () => {
    renderPage(ARCHIVED)

    for (const [trigger, row] of [[en['workspace.filter'], en['workspace.all']], [en['sort.label'], en['sort.updated']]] as const) {
      fireEvent.click(screen.getByRole('button', { name: trigger }))
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
      expect(screen.queryByRole('menu')).toBeNull()
      expect(row).toBeTruthy()
    }
    expect(screen.getByText('Alpha report')).toBeTruthy()
  })

  it('dismisses its outcome notice once the banner has finished', async () => {
    vi.useFakeTimers()
    try {
      renderPage(ARCHIVED)
      fireEvent.click(screen.getAllByRole('button', { name: en['row.restore'] })[0]!)
      await vi.waitFor(() => { expect(screen.getByRole('alert')).toBeTruthy() })

      await vi.advanceTimersByTimeAsync(60_000)
      expect(screen.queryByRole('alert')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a Workspace with nothing archived selectable rather than hiding the filter', () => {
    renderPage({ ...ARCHIVED, items: [workspace('w1', 'Project', ['s1', 's2']), workspace('w9', 'Empty', [])] })

    fireEvent.click(screen.getByRole('button', { name: en['workspace.filter'] }))
    expect(screen.getByRole('menuitem', { name: 'Empty (0)' })).toBeTruthy()
  })

  it('widens back to every Workspace after the chosen one disappears', () => {
    const { rerender } = render(<ArchivedSessionsSection {...pageProps(ARCHIVED)} />)
    pickMenu(en['workspace.filter'], 'Notes (1)')
    expect(screen.queryByText('Alpha report')).toBeNull()

    const without = { ...ARCHIVED, items: [workspace('w1', 'Project', ['s1', 's2'])] }
    rerender(<ArchivedSessionsSection {...pageProps(without)} />)

    expect(screen.getByText('Alpha report')).toBeTruthy()
    expect(screen.getByRole('button', { name: en['workspace.filter'] }).textContent).toContain(en['workspace.all'])
  })
})

/** Page props over one snapshot pair, for the render-and-rerender cases. */
function pageProps(fixture: Fixture, commands: PageCommands = {}): ArchivedSessionsSectionProps {
  return sectionProps(fixture, commands).props
}
