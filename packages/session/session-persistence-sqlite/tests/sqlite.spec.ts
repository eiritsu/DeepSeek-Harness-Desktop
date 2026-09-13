import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId, SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import SqliteSessionPersistence, {
  LIVE_WRITE_BATCH_MAX_DELAY_MS,
  SESSION_SQLITE_SCHEMA_VERSION,
} from '../src/index.ts'
import {
  meta, oneTurnLog, releasedV1OneTurnLog, runPersistenceContract,
} from '../../session-persistence/tests/contract.ts'
import { runLiveWritePathContract } from '../../session-persistence/tests/live-write-contract.ts'

const directories: string[] = []
const contexts: Context[] = []

async function makePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-session-sqlite-'))
  directories.push(directory)
  return join(directory, 'sessions.sqlite')
}

async function mount(path: string, withSessions: boolean): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  if (withSessions) await ctx.plugin(SessionStore)
  await ctx.plugin(SqliteSessionPersistence, { path })
  return ctx
}

function databaseOf(ctx: Context): DatabaseSync {
  return (ctx.sessionPersistence as unknown as { database: DatabaseSync }).database
}

function createLegacyStore(
  path: string,
  headerJson: string,
  events: Array<{ seq: number; json: string }> = [],
  beforeUpdateTrigger = false,
): void {
  const database = new DatabaseSync(path)
  database.exec(`
    PRAGMA user_version = 1;
    CREATE TABLE dsh_session_metadata (
      id TEXT PRIMARY KEY,
      header_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      inherited_event_count INTEGER NOT NULL DEFAULT 0,
      event_count INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 1
    ) STRICT;
    CREATE TABLE dsh_session_events (
      session_id TEXT NOT NULL REFERENCES dsh_session_metadata(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      event_json TEXT NOT NULL,
      PRIMARY KEY(session_id, seq)
    ) STRICT;
    CREATE TABLE dsh_session_store_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;
  `)
  database.prepare(`
    INSERT INTO dsh_session_metadata(
      id, header_json, updated_at, inherited_event_count, event_count, revision
    ) VALUES ('legacy', ?, '1', 0, ?, 1)
  `).run(headerJson, events.length)
  const insert = database.prepare(
    'INSERT INTO dsh_session_events(session_id, seq, event_json) VALUES (\'legacy\', ?, ?)',
  )
  for (const event of events) insert.run(event.seq, event.json)
  if (beforeUpdateTrigger) {
    database.exec(`
      CREATE TRIGGER block_legacy_update BEFORE UPDATE ON dsh_session_metadata
      BEGIN SELECT RAISE(ABORT, 'migration update blocked'); END;
    `)
  }
  database.close()
}

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  const disposing = contexts.splice(0).map(ctx => ctx.fiber.dispose())
  const results = await Promise.allSettled(disposing)
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
  const failures: unknown[] = []
  for (const result of results) {
    if (result.status === 'rejected') {
      const reason: unknown = result.reason
      failures.push(reason)
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, 'SQLite test cleanup failed')
})

runPersistenceContract('sqlite', async () => {
  const path = await makePath()
  const instance = async (): Promise<{ persistence: SessionPersistence; dispose: () => Promise<void> }> => {
    const ctx = await mount(path, true)
    return {
      persistence: ctx.sessionPersistence,
      dispose: async () => { await ctx.fiber.dispose() },
    }
  }
  const primary = await instance()
  return {
    ...primary,
    reopen: instance,
  }
})

runLiveWritePathContract('sqlite', LIVE_WRITE_BATCH_MAX_DELAY_MS, async () => {
  const path = await makePath()
  const remount = (): Promise<Context> => mount(path, true)
  return { ctx: await remount(), remount }
})

describe('SQLite storage', () => {
  it('stamps the current schema and exposes event counts', async () => {
    const ctx = await mount(':memory:', true)
    const handle = await ctx.sessionPersistence.create(meta('counted'))
    await handle.append(oneTurnLog())
    await expect(ctx.sessionPersistence.stat(SessionId('counted'))).resolves.toMatchObject({
      eventCount: oneTurnLog().length,
    })
    expect(SESSION_SQLITE_SCHEMA_VERSION).toBe(2)
    await handle.close()
  })

  it('upgrades the original desktop v0 tables and Session rows before serving reads', async () => {
    const path = await makePath()
    const legacy = new DatabaseSync(path)
    legacy.exec(`
      PRAGMA user_version = 1;
      CREATE TABLE dsh_session_metadata (
        id TEXT PRIMARY KEY,
        header_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE dsh_session_events (
        session_id TEXT NOT NULL REFERENCES dsh_session_metadata(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        event_json TEXT NOT NULL,
        PRIMARY KEY(session_id, seq)
      ) STRICT;
      CREATE TABLE dsh_session_store_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;
    `)
    const id = SessionId('legacy-v0')
    legacy.prepare(
      'INSERT INTO dsh_session_metadata(id, header_json, updated_at) VALUES (?, ?, ?)',
    ).run(id, JSON.stringify({
      version: 0, id, createdAt: 1, delegationDepth: 0,
    }), '1')
    const insert = legacy.prepare(
      'INSERT INTO dsh_session_events(session_id, seq, event_json) VALUES (?, ?, ?)',
    )
    const [turn, user, step, ...tail] = releasedV1OneTurnLog()
    const legacyEvents = [turn!, { ...step!, time: 2 }, { ...user!, time: 3 }, ...tail]
      .map((event, seq) => ({ ...event, seq: SessionSeq(seq) }))
    for (const event of legacyEvents) insert.run(id, event.seq, JSON.stringify(event))
    legacy.close()

    const ctx = await mount(path, true)
    const snapshot = await ctx.sessionPersistence.stat(id)
    expect(snapshot).toMatchObject({ header: { id, version: 3, isSeeded: false } })
    const handle = await ctx.sessionPersistence.open(id, 'read')
    const restored = await handle.read()
    expect(restored.events.map(event => event.type)).toContain('system/message')
    expect(snapshot?.eventCount).toBe(restored.events.length)
    const upgraded = new DatabaseSync(path, { readOnly: true })
    expect(upgraded.prepare('PRAGMA user_version').get()).toEqual({ user_version: 2 })
    upgraded.close()
    await handle.close()
  })

  it('validates seeded inherited counts at creation', async () => {
    const ctx = await mount(':memory:', true)
    const seeded = { ...meta('seeded'), isSeeded: true, parentSession: SessionId('parent') }
    await expect(ctx.sessionPersistence.create(seeded)).rejects.toThrow(/requires an inherited event count/)
    await expect(ctx.sessionPersistence.create(meta('unseeded'), { inheritedEventCount: SessionLogOffset(1) }))
      .rejects.toThrow(/must be 0/)
    const handle = await ctx.sessionPersistence.create(seeded, { inheritedEventCount: SessionLogOffset(1) })
    await handle.close()
  })

  it('detects disappearance and shrinkage observed through an open read handle', async () => {
    const ctx = await mount(':memory:', true)
    const writer = await ctx.sessionPersistence.create(meta('shrinking'))
    await writer.append(oneTurnLog())
    await writer.close()
    const reader = await ctx.sessionPersistence.open(SessionId('shrinking'), 'read')
    await reader.read()
    const database = databaseOf(ctx)
    database.prepare('DELETE FROM dsh_session_events WHERE session_id = ? AND seq = ?')
      .run('shrinking', oneTurnLog().length - 1)
    database.prepare('UPDATE dsh_session_metadata SET event_count = event_count - 1 WHERE id = ?')
      .run('shrinking')
    await expect(reader.read()).rejects.toThrow(/stored log shrank/)
    database.prepare('DELETE FROM dsh_session_metadata WHERE id = ?').run('shrinking')
    await expect(reader.read()).rejects.toThrow(/not found/i)
    await reader.close()
  })

  it('wraps non-Error live-drain failures and retains buffered events', async () => {
    const ctx = await mount(':memory:', true)
    const handle = await ctx.sessionPersistence.create(meta('non-error-drain'))
    const persistence = ctx.sessionPersistence as unknown as {
      persistBatch: ReturnType<typeof vi.fn>
    }
    persistence.persistBatch = vi.fn(async () => { throw { refusal: true } })
    const live = handle as unknown as {
      enqueueLive(event: ReturnType<typeof oneTurnLog>[number], report: (error: unknown) => void): void
    }
    live.enqueueLive(oneTurnLog()[0]!, () => {})
    await expect(handle.close()).rejects.toMatchObject({
      message: 'SQLite live-event drain failed with a non-Error value',
      cause: { refusal: true },
    })
  })

  it('rejects invalid database paths and closes a database that fails configuration', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-session-sqlite-long-'))
    directories.push(directory)
    const tooLong = join(directory, 'x'.repeat(300))
    const invalidCtx = new Context()
    contexts.push(invalidCtx)
    expect(() => new SqliteSessionPersistence(invalidCtx, { path: tooLong })).toThrow()

    const path = await makePath()
    const bytes = new TextEncoder().encode('not a sqlite database')
    await writeFile(path, bytes)
    const corruptCtx = new Context()
    contexts.push(corruptCtx)
    expect(() => new SqliteSessionPersistence(corruptCtx, { path })).toThrow()
  })

  it('aggregates writer flush failures and ignores handles already closing', async () => {
    const ctx = await mount(':memory:', true)
    const failed = await ctx.sessionPersistence.create(meta('flush-failed'))
    const persistence = ctx.sessionPersistence as unknown as {
      writers: Map<SessionId, unknown>
      flush(): Promise<void>
    }
    const failedInternals = failed as unknown as { drainLive(): Promise<void> }
    vi.spyOn(failedInternals, 'drainLive').mockRejectedValueOnce(new Error('drain failed'))
    await expect(persistence.flush()).rejects.toMatchObject({ errors: [expect.any(Error)] })
    await failed.close()
    persistence.writers.set(SessionId('closed'), failed)
    await expect(persistence.flush()).resolves.toBeUndefined()
    persistence.writers.delete(SessionId('closed'))
  })

  it('detects every stored row corruption class', async () => {
    const ctx = await mount(':memory:', true)
    const createStored = async (id: string): Promise<void> => {
      const handle = await ctx.sessionPersistence.create(meta(id))
      await handle.append(oneTurnLog())
      await handle.close()
    }
    const database = databaseOf(ctx)

    await createStored('bad-count')
    database.prepare('UPDATE dsh_session_metadata SET event_count = 99 WHERE id = ?').run('bad-count')
    await expect(ctx.sessionPersistence.open(SessionId('bad-count'), 'read')).rejects.toThrow(/event count mismatch/)

    await createStored('bad-row-seq')
    database.prepare('UPDATE dsh_session_events SET seq = 99 WHERE session_id = ? AND seq = 0').run('bad-row-seq')
    await expect(ctx.sessionPersistence.open(SessionId('bad-row-seq'), 'read')).rejects.toThrow(/non-contiguous/)

    await createStored('bad-json')
    database.prepare('UPDATE dsh_session_events SET event_json = ? WHERE session_id = ? AND seq = 0')
      .run('{', 'bad-json')
    await expect(ctx.sessionPersistence.open(SessionId('bad-json'), 'read')).rejects.toThrow(/invalid event JSON/)

    await createStored('bad-payload-seq')
    const event = { ...oneTurnLog()[0]!, seq: SessionSeq(9) }
    database.prepare('UPDATE dsh_session_events SET event_json = ? WHERE session_id = ? AND seq = 0')
      .run(JSON.stringify(event), 'bad-payload-seq')
    await expect(ctx.sessionPersistence.open(SessionId('bad-payload-seq'), 'read'))
      .rejects.toThrow(/payload seq/)

    await createStored('bad-header')
    database.prepare('UPDATE dsh_session_metadata SET header_json = ? WHERE id = ?').run('{', 'bad-header')
    await expect(ctx.sessionPersistence.stat(SessionId('bad-header'))).rejects.toThrow(/invalid header JSON/)
  })

  it('rolls back missing, stale, and colliding append transactions', async () => {
    const ctx = await mount(':memory:', true)
    const persistence = ctx.sessionPersistence as unknown as {
      persistHeader(header: ReturnType<typeof meta>, inherited: number): Promise<void>
      persistBatch(
        header: ReturnType<typeof meta>, inherited: number, cursor: number,
        events: ReturnType<typeof oneTurnLog>, materialized: boolean,
      ): Promise<void>
    }
    await expect(persistence.persistBatch(meta('missing-row'), 0, 0, oneTurnLog(), true))
      .rejects.toThrow(/not found/i)

    const writer = await ctx.sessionPersistence.create(meta('stale-row'))
    await writer.append(oneTurnLog())
    await expect(persistence.persistBatch(meta('stale-row'), 0, 0, oneTurnLog(), true))
      .rejects.toThrow(/expected seq/)
    await writer.close()

    await expect(persistence.persistHeader(meta('stale-row'), 0)).rejects.toThrow(/already exists/i)
    await expect(persistence.persistBatch(meta('stale-row'), 0, 0, oneTurnLog(), false))
      .rejects.toThrow(/already exists/i)
  })

  it('rejects future schema versions', async () => {
    const path = await makePath()
    const database = new DatabaseSync(path)
    database.exec(`PRAGMA user_version = ${SESSION_SQLITE_SCHEMA_VERSION + 1}`)
    database.close()
    const ctx = new Context()
    contexts.push(ctx)
    expect(() => new SqliteSessionPersistence(ctx, { path })).toThrow(/incompatible/)
  })

  it('re-drains live events enqueued while close is settling', async () => {
    const ctx = await mount(':memory:', true)
    const handle = await ctx.sessionPersistence.create(meta('close-redrain'))
    const live = handle as unknown as {
      drainLive(): Promise<void>
      enqueueLive(event: ReturnType<typeof oneTurnLog>[number], report: (error: unknown) => void): void
    }
    const originalDrain = live.drainLive.bind(live)
    let first = true
    vi.spyOn(live, 'drainLive').mockImplementation(async () => {
      if (!first) return originalDrain()
      first = false
      live.enqueueLive(oneTurnLog()[0]!, () => {})
    })
    await handle.close()
    const reopened = await ctx.sessionPersistence.open(SessionId('close-redrain'), 'read')
    await expect(reopened.read()).resolves.toMatchObject({ events: [{ type: 'turn/start' }] })
    await reopened.close()
  })

  it('does not duplicate a pending snapshot if another writer materializes the same id', async () => {
    const ctx = await mount(':memory:', true)
    const handle = await ctx.sessionPersistence.create(meta('pending-race'))
    databaseOf(ctx).prepare(`
      INSERT INTO dsh_session_metadata(
        id, header_json, updated_at, inherited_event_count, event_count, revision
      ) VALUES (?, ?, '1', 0, 0, 1)
    `).run('pending-race', JSON.stringify(meta('pending-race')))
    const listed = await ctx.sessionPersistence.list()
    expect(listed.filter(item => item.header.id === 'pending-race')).toHaveLength(1)
    await handle.close()
  })

  it('rejects malformed and unsupported legacy Session headers', async () => {
    for (const [header, expected] of [
      ['{', /invalid header JSON/],
      ['null', /cannot be upgraded/],
      [JSON.stringify({ version: 99, id: 'legacy', createdAt: 1, isSeeded: false }), /cannot be upgraded/],
    ] as const) {
      const path = await makePath()
      createLegacyStore(path, header)
      const ctx = new Context()
      contexts.push(ctx)
      expect(() => new SqliteSessionPersistence(ctx, { path })).toThrow(expected)
    }
  })

  it('wraps non-contiguous and malformed legacy event rows as migration corruption', async () => {
    const legacyHeader = JSON.stringify({
      version: 0,
      id: 'legacy',
      createdAt: 1,
      delegationDepth: 0,
    })
    for (const events of [
      [{ seq: 1, json: JSON.stringify(oneTurnLog()[0]) }],
      [{ seq: 0, json: '{' }],
    ]) {
      const path = await makePath()
      createLegacyStore(path, legacyHeader, events)
      const ctx = new Context()
      contexts.push(ctx)
      expect(() => new SqliteSessionPersistence(ctx, { path })).toThrow(/could not be upgraded/)
    }
  })

  it('rolls back an atomic legacy migration when its metadata update fails', async () => {
    const path = await makePath()
    createLegacyStore(path, JSON.stringify({
      version: 0,
      id: 'legacy',
      createdAt: 1,
      delegationDepth: 0,
    }), [], true)
    const ctx = new Context()
    contexts.push(ctx)
    expect(() => new SqliteSessionPersistence(ctx, { path })).toThrow(/migration update blocked/)
    const database = new DatabaseSync(path, { readOnly: true })
    const row = database.prepare('SELECT header_json FROM dsh_session_metadata WHERE id = \'legacy\'').get() as {
      header_json: string
    }
    expect(JSON.parse(row.header_json)).toMatchObject({ version: 0 })
    database.close()
  })
})
