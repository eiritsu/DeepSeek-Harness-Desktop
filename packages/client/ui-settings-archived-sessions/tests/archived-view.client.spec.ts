/** The page's view projection: which rows exist, how they group, order, and filter. */

import { describe, expect, it } from 'vitest'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  ALL_WORKSPACES,
  archivedReadStatus,
  archivedWorkspaceOptions,
  deriveArchivedRows,
  filterArchivedRows,
  groupArchivedRows,
  NO_WORKSPACE_KEY,
  sortArchivedRows,
} from '../src/client/archived-view.ts'

const sid = (id: string): SessionId => id as SessionId
const wid = (id: string): WorkspaceId => id as WorkspaceId

const summary = (id: string, displayTitle: string, updatedAt: number, createdAt?: number): SessionSummary => ({
  id: sid(id),
  displayTitle,
  running: false,
  retainedBy: {},
  blank: false,
  updatedAt,
  ...(createdAt === undefined ? {} : { createdAt }),
})

const workspace = (id: string, sessionIds: readonly string[]): WorkspaceView => ({
  workspaceId: wid(id),
  path: `/projects/${id}`,
  title: id,
  sessionIds: sessionIds.map(sid),
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
})

const byId = (rows: readonly SessionSummary[]): Record<SessionId, SessionSummary> =>
  Object.fromEntries(rows.map(row => [row.id, row]))

describe('deriveArchivedRows', () => {
  it('joins the archive set with the list and the owning Workspace', () => {
    const rows = deriveArchivedRows(
      byId([summary('s1', 'Alpha', 20), summary('s2', 'Beta', 30)]),
      [workspace('w1', ['s1', 's2'])],
      [sid('s2'), sid('s1')],
    )

    // Archive-set order, not list order, and the owning Workspace resolved.
    expect(rows).toEqual([
      { sessionId: sid('s2'), title: 'Beta', updatedAt: 30, createdAt: undefined, workspaceId: wid('w1') },
      { sessionId: sid('s1'), title: 'Alpha', updatedAt: 20, createdAt: undefined, workspaceId: wid('w1') },
    ])
  })

  it('carries the durable creation time onto the row, and its absence too', () => {
    const rows = deriveArchivedRows(
      byId([summary('s1', 'Dated', 20, 3), summary('s2', 'Locally built', 30)]),
      [],
      [sid('s2'), sid('s1')],
    )

    // The Session list builds some rows itself, and those carry no header.
    expect(rows.map(row => row.createdAt)).toEqual([undefined, 3])
  })

  it('leaves a Session with no Workspace ungrouped', () => {
    const rows = deriveArchivedRows(byId([summary('s1', 'Loose', 1)]), [], [sid('s1')])
    expect(rows[0]?.workspaceId).toBeUndefined()
  })

  it('keeps the first Workspace in Host order when several hold one Session', () => {
    const rows = deriveArchivedRows(
      byId([summary('s1', 'Shared', 1)]),
      [workspace('w1', ['s1']), workspace('w2', ['s1'])],
      [sid('s1')],
    )
    expect(rows[0]?.workspaceId).toBe(wid('w1'))
  })
})

describe('sortArchivedRows', () => {
  const rows = [
    { sessionId: sid('s1'), title: 'banana', updatedAt: 10, createdAt: 90, workspaceId: undefined },
    { sessionId: sid('s2'), title: 'Apple', updatedAt: 30, createdAt: 40, workspaceId: undefined },
    { sessionId: sid('s3'), title: 'apple pie', updatedAt: 20, createdAt: 5, workspaceId: undefined },
    // Same title as s2, so only the recency tie-break can order these two.
    { sessionId: sid('s4'), title: 'APPLE', updatedAt: 5, createdAt: 5, workspaceId: undefined },
  ]

  it('leads with the most recently updated', () => {
    expect(sortArchivedRows(rows, 'updated').map(row => row.sessionId))
      .toEqual([sid('s2'), sid('s3'), sid('s1'), sid('s4')])
  })

  it('leads with the most recently created, breaking ties by recency', () => {
    // s1 was created last but touched earliest, so the two orders disagree on
    // the leader: reading its update time instead would still pass 'updated'.
    expect(sortArchivedRows(rows, 'created').map(row => row.sessionId))
      .toEqual([sid('s1'), sid('s2'), sid('s3'), sid('s4')])
  })

  it('leaves a locally built row behind every dated one, never dating it from its update time', () => {
    const mixed = [
      { sessionId: sid('s1'), title: 'Local', updatedAt: 99, createdAt: undefined, workspaceId: undefined },
      { sessionId: sid('s2'), title: 'Dated', updatedAt: 1, createdAt: 7, workspaceId: undefined },
      { sessionId: sid('s3'), title: 'Other local', updatedAt: 50, createdAt: undefined, workspaceId: undefined },
    ]

    // An unknown creation moment is not the epoch, so it cannot outrank a
    // dated row however recently that row was touched.
    expect(sortArchivedRows(mixed, 'created').map(row => row.sessionId))
      .toEqual([sid('s2'), sid('s1'), sid('s3')])
  })

  it('falls back to the Session id when two locally built rows also share a time', () => {
    const tied = [
      { sessionId: sid('s2'), title: 'B', updatedAt: 4, createdAt: undefined, workspaceId: undefined },
      { sessionId: sid('s1'), title: 'A', updatedAt: 4, createdAt: undefined, workspaceId: undefined },
    ]

    expect(sortArchivedRows(tied, 'created').map(row => row.sessionId)).toEqual([sid('s1'), sid('s2')])
  })

  it('orders alphabetically regardless of case, breaking ties by recency', () => {
    expect(sortArchivedRows(rows, 'title').map(row => row.sessionId))
      .toEqual([sid('s2'), sid('s4'), sid('s3'), sid('s1')])
  })

  it('orders numerically inside titles', () => {
    const numbered = [
      { sessionId: sid('s1'), title: 'log 10', updatedAt: 1, createdAt: 1, workspaceId: undefined },
      { sessionId: sid('s2'), title: 'log 2', updatedAt: 1, createdAt: 1, workspaceId: undefined },
    ]
    expect(sortArchivedRows(numbered, 'title').map(row => row.title)).toEqual(['log 2', 'log 10'])
  })

  it('falls back to the Session id when title and recency both tie', () => {
    const tied = [
      { sessionId: sid('s2'), title: 'Report', updatedAt: 7, createdAt: 7, workspaceId: undefined },
      { sessionId: sid('s1'), title: 'report', updatedAt: 7, createdAt: 7, workspaceId: undefined },
    ]
    expect(sortArchivedRows(tied, 'title').map(row => row.sessionId)).toEqual([sid('s1'), sid('s2')])
    expect(sortArchivedRows(tied, 'updated').map(row => row.sessionId)).toEqual([sid('s1'), sid('s2')])
  })

  it('never mutates the rows it was given', () => {
    const original = [...rows]
    sortArchivedRows(rows, 'title')
    expect(rows).toEqual(original)
  })
})

describe('filterArchivedRows', () => {
  const rows = [
    { sessionId: sid('s1'), title: 'Release notes', updatedAt: 3, createdAt: 1, workspaceId: wid('w1') },
    { sessionId: sid('s2'), title: 'Old build', updatedAt: 2, createdAt: 2, workspaceId: wid('w2') },
    { sessionId: sid('s3'), title: 'Loose idea', updatedAt: 1, createdAt: 3, workspaceId: undefined },
  ]

  it('keeps every row for the unfiltered choice and an empty query', () => {
    expect(filterArchivedRows(rows, ALL_WORKSPACES, '   ')).toHaveLength(3)
  })

  it('narrows to the chosen Workspace, leaving ungrouped rows out of it', () => {
    expect(filterArchivedRows(rows, wid('w1'), '').map(row => row.sessionId)).toEqual([sid('s1')])
  })

  it('matches a case-insensitive substring of the title', () => {
    expect(filterArchivedRows(rows, ALL_WORKSPACES, '  NOTES ').map(row => row.sessionId)).toEqual([sid('s1')])
  })

  it('matches a query typed without the accents a title carries, either way round', () => {
    const accented = [{ sessionId: sid('s1'), title: 'Résumé polish', updatedAt: 1, createdAt: 1, workspaceId: undefined }]
    const matched = (query: string): readonly SessionId[] =>
      filterArchivedRows(accented, ALL_WORKSPACES, query).map(row => row.sessionId)

    expect(matched('resume')).toEqual([sid('s1')])
    expect(matched('RÉSUMÉ')).toEqual([sid('s1')])
    expect(matched('polish')).toEqual([sid('s1')])
    expect(matched('unrelated')).toEqual([])
  })

  it('applies the Workspace and the query together', () => {
    expect(filterArchivedRows(rows, wid('w2'), 'release')).toEqual([])
  })
})

describe('groupArchivedRows', () => {
  const rows = [
    { sessionId: sid('s1'), title: 'Alpha', updatedAt: 2, createdAt: 1, workspaceId: wid('w1') },
    { sessionId: sid('s2'), title: 'Beta', updatedAt: 3, createdAt: 2, workspaceId: wid('w2') },
    { sessionId: sid('s3'), title: 'Loose', updatedAt: 1, createdAt: 3, workspaceId: undefined },
  ]

  it('orders groups by the Host registry and appends the ungrouped remainder', () => {
    const groups = groupArchivedRows(rows, [workspace('w2', ['s2']), workspace('w1', ['s1'])], () => 'No workspace')

    expect(groups.map(group => group.key)).toEqual(['w2', 'w1', NO_WORKSPACE_KEY])
    expect(groups[2]?.title).toBe('No workspace')
    expect(groups[2]?.workspaceId).toBeUndefined()
  })

  it('omits Workspaces holding nothing in the current view', () => {
    const groups = groupArchivedRows(rows, [workspace('w1', ['s1']), workspace('w9', [])], () => 'No workspace')
    expect(groups.map(group => group.key)).toEqual(['w1', NO_WORKSPACE_KEY])
  })
})

describe('archivedWorkspaceOptions', () => {
  it('offers every Workspace with its archived count, zero included', () => {
    const options = archivedWorkspaceOptions(
      [workspace('w1', []), workspace('w2', [])],
      [
        { sessionId: sid('s1'), title: 'Alpha', updatedAt: 1, createdAt: 1, workspaceId: wid('w2') },
        { sessionId: sid('s2'), title: 'Beta', updatedAt: 2, createdAt: 2, workspaceId: wid('w2') },
        { sessionId: sid('s3'), title: 'Loose', updatedAt: 3, createdAt: 3, workspaceId: undefined },
      ],
    )

    expect(options).toEqual([
      { workspaceId: wid('w1'), title: 'w1', count: 0 },
      { workspaceId: wid('w2'), title: 'w2', count: 2 },
    ])
  })
})

describe('archivedReadStatus', () => {
  it('reports a broken Workspace stream as failed', () => {
    expect(archivedReadStatus('ready', 'error')).toBe('failed')
  })

  it('waits while either authority has not settled', () => {
    expect(archivedReadStatus('pending', 'idle')).toBe('pending')
    expect(archivedReadStatus('ready', 'loading')).toBe('pending')
  })

  it('claims readiness only once both have settled', () => {
    expect(archivedReadStatus('ready', 'idle')).toBe('ready')
  })
})
