import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { JsonlSessionPersistence } from '@deepseek-ai/dsh-session-persistence-jsonl'
import SqliteSessionPersistence from '@deepseek-ai/dsh-session-persistence-sqlite'

describe('SQLite session persistence', () => {
  it('stores headers and contiguous events in one database and reloads them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-session-sqlite-'))
    const path = join(root, 'dsh.sqlite')
    try {
      const ctx = new Context()
      await ctx.plugin(SessionStore)
      const fiber = await ctx.plugin(SqliteSessionPersistence, { path })
      const id = SessionId('sqlite-session')
      const meta: SessionHeader = { version: 0, id, createdAt: 1, cwd: '/tmp' }
      const event: SessionEvent = { type: 'session/end-seed', seq: 0, time: 2, data: {} }
      await ctx.sessionPersistence.create(meta)
      await ctx.sessionPersistence.append(id, [event])
      expect((await ctx.sessionPersistence.load(id)).events).toEqual([event])
      expect((await ctx.sessionPersistence.listSnapshots()).map(snapshot => snapshot.header.id)).toEqual([id])
      await fiber.dispose()

      const ctx2 = new Context()
      await ctx2.plugin(SessionStore)
      const fiber2 = await ctx2.plugin(SqliteSessionPersistence, { path })
      expect((await ctx2.sessionPersistence.load(id)).meta).toEqual(meta)
      expect((await ctx2.sessionPersistence.readRaw(id))?.content).toContain('session/end-seed')
      await fiber2.dispose()
      expect((await readFile(path)).byteLength).toBeGreaterThan(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('imports legacy JSONL sessions once before serving SQLite reads', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-session-sqlite-import-'))
    const legacyRoot = join(root, 'sessions')
    const path = join(root, 'dsh.sqlite')
    try {
      const id = SessionId('legacy-session')
      const meta: SessionHeader = { version: 0, id, createdAt: 3, cwd: '/tmp' }
      const event: SessionEvent = { type: 'session/end-seed', seq: 0, time: 4, data: {} }
      const legacyContext = new Context()
      await legacyContext.plugin(SessionStore)
      const legacy = new JsonlSessionPersistence(legacyContext, { root: legacyRoot, compression: 'none' })
      await legacy.create(meta)
      await legacy.append(id, [event])
      await legacyContext.fiber.dispose()

      const ctx = new Context()
      await ctx.plugin(SessionStore)
      const fiber = await ctx.plugin(SqliteSessionPersistence, { path, legacyRoot })
      expect((await ctx.sessionPersistence.load(id)).events).toEqual([event])
      expect((await ctx.sessionPersistence.list()).map(header => header.id)).toEqual([id])
      await fiber.dispose()

      const ctx2 = new Context()
      await ctx2.plugin(SessionStore)
      const fiber2 = await ctx2.plugin(SqliteSessionPersistence, { path, legacyRoot })
      expect((await ctx2.sessionPersistence.load(id)).events).toEqual([event])
      await fiber2.dispose()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
