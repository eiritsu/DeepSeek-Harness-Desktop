/** SQLite durable session-persistence backend. */
import { DatabaseSync } from 'node:sqlite'
import { chmodSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, SessionHeader, SessionPreparation } from '@deepseek-ai/dsh-session'
import { JsonlSessionPersistence } from '@deepseek-ai/dsh-session-persistence-jsonl'
import {
  DEFAULT_PREPARED_SESSION_CACHE_SIZE,
  DEFAULT_WRITE_BATCH_MAX_DELAY_MS,
  MAX_WRITE_BATCH_DELAY_MS,
  PersistenceCoordinator,
  SessionPersistence,
  SessionPersistenceRevision,
  type PersistenceBackend,
  type SessionInspection,
  type SessionLocation,
  type SessionPersistenceSnapshot,
  type SessionRawArtifact,
  type StoredPrefix,
} from '@deepseek-ai/dsh-session-persistence'

/** Plugin configuration. */
export interface Config {
  /** Absolute or process-relative SQLite database path. */
  path: string
  /** Maximum detached preparations retained by the shared coordinator. */
  preparedSessionCacheSize?: number
  /** Maximum intentional write batching delay. */
  writeBatchMaxDelayMs?: number
  /** Optional legacy JSONL root imported before SQLite serves reads. */
  legacyRoot?: string
}

/** Configuration schema. */
export const Config: z<Config> = z.object({
  path: z.string().required(),
  preparedSessionCacheSize: z.number().step(1).min(1).default(DEFAULT_PREPARED_SESSION_CACHE_SIZE),
  writeBatchMaxDelayMs: z.number().step(1).min(1).max(MAX_WRITE_BATCH_DELAY_MS)
    .default(DEFAULT_WRITE_BATCH_MAX_DELAY_MS),
  legacyRoot: z.string(),
})

type StoredRow = { header_json: string; updated_at: string }
type EventRow = { seq: number; event_json: string }

/** Persist sessions as rows in one SQLite database instead of per-session files. */
export default class SqliteSessionPersistence extends SessionPersistence implements PersistenceBackend {
  static inject = ['sessions']
  static Config = Config
  override readonly name = 'session-persistence-sqlite'
  override readonly supportsRawArtifacts = true

  private readonly path: string
  private readonly database: DatabaseSync
  private readonly coordinator: PersistenceCoordinator
  private readonly legacyImport: Promise<void>

  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.path = resolve(config.path)
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    this.database = new DatabaseSync(this.path)
    chmodSync(this.path, 0o600)
    this.database.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;')
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS dsh_session_metadata (
        id TEXT PRIMARY KEY,
        header_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS dsh_session_events (
        session_id TEXT NOT NULL REFERENCES dsh_session_metadata(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        event_json TEXT NOT NULL,
        PRIMARY KEY(session_id, seq)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS dsh_session_store_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;
    `)
    this.legacyImport = config.legacyRoot === undefined
      ? Promise.resolve()
      : this.importLegacy(resolve(config.legacyRoot))
    this.legacyImport.catch(() => {})
    this.coordinator = new PersistenceCoordinator(ctx, this, {
      preparedSessionCacheSize: config.preparedSessionCacheSize ?? DEFAULT_PREPARED_SESSION_CACHE_SIZE,
      writeBatchMaxDelayMs: config.writeBatchMaxDelayMs ?? DEFAULT_WRITE_BATCH_MAX_DELAY_MS,
    })
  }

  locate(_meta: SessionHeader): SessionLocation {
    return { kind: 'sqlite', path: this.path }
  }

  override create(meta: SessionHeader): Promise<void> { return this.coordinator.create(meta) }
  override ensureMaterialized(session: Session): Promise<void> { return this.coordinator.ensureMaterialized(session) }
  override append(id: SessionId, events: readonly SessionEvent[]): Promise<void> { return this.coordinator.append(id, events) }
  override delete(id: SessionId): Promise<void> { return this.coordinator.delete(id) }
  override prepare(id: SessionId, signal?: AbortSignal): Promise<SessionPreparation> { return this.coordinator.prepare(id, signal) }
  override load(id: SessionId): Promise<SessionInspection> { return this.coordinator.load(id) }
  override inspect(id: SessionId, signal?: AbortSignal): Promise<SessionInspection> { return this.coordinator.inspect(id, signal) }
  override borrowSession(id: SessionId, signal?: AbortSignal) { return this.coordinator.borrowSession(id, signal) }
  override readFrom(id: SessionId, fromSeq: number, signal?: AbortSignal) { return this.coordinator.readFrom(id, fromSeq, signal) }

  async loadStored(id: SessionId, signal?: AbortSignal): Promise<StoredPrefix | undefined> {
    await this.legacyImport
    signal?.throwIfAborted()
    const row = this.database.prepare('SELECT header_json, updated_at FROM dsh_session_metadata WHERE id = ?').get(id) as StoredRow | undefined
    if (row === undefined) return undefined
    const events = this.readEvents(id, signal)
    return {
      meta: JSON.parse(row.header_json) as SessionHeader,
      events,
      revision: SessionPersistenceRevision(row.updated_at),
    }
  }

  async readStoredRevision(id: SessionId, signal?: AbortSignal) {
    await this.legacyImport
    signal?.throwIfAborted()
    const row = this.database.prepare('SELECT updated_at FROM dsh_session_metadata WHERE id = ?').get(id) as { updated_at: string } | undefined
    return row === undefined ? undefined : SessionPersistenceRevision(row.updated_at)
  }

  override async readRaw(id: SessionId, signal?: AbortSignal): Promise<SessionRawArtifact | undefined> {
    await this.legacyImport
    const stored = await this.loadStored(id, signal)
    if (stored === undefined) return undefined
    const content = [JSON.stringify(stored.meta), ...stored.events.map(event => JSON.stringify(event)), ''].join('\n')
    return { meta: stored.meta, filename: `${id}.jsonl`, content }
  }

  async list(signal?: AbortSignal): Promise<SessionHeader[]> {
    await this.legacyImport
    signal?.throwIfAborted()
    const rows = this.database.prepare('SELECT header_json FROM dsh_session_metadata ORDER BY id').all() as { header_json: string }[]
    return rows.map(row => JSON.parse(row.header_json) as SessionHeader)
  }

  async listSnapshots(signal?: AbortSignal): Promise<SessionPersistenceSnapshot[]> {
    await this.legacyImport
    signal?.throwIfAborted()
    const rows = this.database.prepare('SELECT id, header_json, updated_at FROM dsh_session_metadata ORDER BY id').all() as {
      id: string
      header_json: string
      updated_at: string
    }[]
    return rows.map(row => ({
      header: JSON.parse(row.header_json) as SessionHeader,
      revision: SessionPersistenceRevision(row.updated_at),
    }))
  }

  async materializeHeader(meta: SessionHeader): Promise<void> {
    await this.legacyImport
    this.database.prepare(
      'INSERT INTO dsh_session_metadata(id, header_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING',
    ).run(meta.id, JSON.stringify(meta), String(Date.now()))
  }

  async appendBatch(meta: SessionHeader, events: readonly SessionEvent[], _isMaterialized: boolean): Promise<void> {
    await this.legacyImport
    if (events.length === 0) return
    const firstEvent = events[0]
    if (firstEvent === undefined) return
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const timestamp = String(Date.now())
      this.database.prepare(
        'INSERT INTO dsh_session_metadata(id, header_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at',
      ).run(meta.id, JSON.stringify(meta), timestamp)
      const current = this.database.prepare(
        'SELECT COALESCE(MAX(seq) + 1, 0) AS next_seq FROM dsh_session_events WHERE session_id = ?',
      ).get(meta.id) as { next_seq: number }
      if (current.next_seq !== firstEvent.seq) {
        throw new Error(`session "${meta.id}" expected seq ${current.next_seq}, got ${firstEvent.seq}`)
      }
      const insert = this.database.prepare(
        'INSERT INTO dsh_session_events(session_id, seq, event_json) VALUES (?, ?, ?)',
      )
      for (const event of events) insert.run(meta.id, event.seq, JSON.stringify(event))
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  async commitRepair(meta: SessionHeader, _tornMarker: unknown, closers: readonly SessionEvent[]): Promise<void> {
    if (closers.length > 0) await this.appendBatch(meta, closers, true)
  }

  async deleteStored(id: SessionId): Promise<boolean> {
    await this.legacyImport
    const result = this.database.prepare('DELETE FROM dsh_session_metadata WHERE id = ?').run(id)
    return result.changes > 0
  }

  async close(): Promise<void> {
    this.database.close()
  }

  private readEvents(id: SessionId, signal?: AbortSignal): SessionEvent[] {
    const rows = this.database.prepare(
      'SELECT seq, event_json FROM dsh_session_events WHERE session_id = ? ORDER BY seq',
    ).all(id) as unknown as EventRow[]
    const events: SessionEvent[] = []
    for (const row of rows) {
      signal?.throwIfAborted()
      const event = JSON.parse(row.event_json) as SessionEvent
      if (event.seq !== row.seq) throw new Error(`session "${id}" has mismatched event seq ${row.seq}`)
      events.push(event)
    }
    return events
  }

  /** Import legacy per-session JSONL files once before serving SQLite reads. */
  private async importLegacy(root: string): Promise<void> {
    const marker = this.database.prepare(
      "SELECT value FROM dsh_session_store_metadata WHERE key = 'legacy-jsonl-import'",
    ).get() as { value: string } | undefined
    if (marker?.value === 'complete' || !existsSync(root)) {
      this.database.prepare(
        "INSERT OR REPLACE INTO dsh_session_store_metadata(key, value) VALUES ('legacy-jsonl-import', 'complete')",
      ).run()
      return
    }

    const readLegacy = async (compression: 'zstd' | 'none') => {
      const legacyContext = new Context()
      await legacyContext.plugin(SessionStore)
      const legacy = new JsonlSessionPersistence(legacyContext, { root, compression })
      try {
        const imported: Array<{ meta: SessionHeader; events: readonly SessionEvent[] }> = []
        for (const header of await legacy.list()) {
          try {
            const inspection = await legacy.load(header.id)
            imported.push({ meta: inspection.meta, events: inspection.events })
          } catch (error) {
            this.ctx.logger.warn(`${this.name}: skipped legacy session "${header.id}" during SQLite import: ${String(error)}`)
          }
        }
        return imported
      } finally {
        await legacyContext.fiber.dispose()
      }
    }

    let imported: Array<{ meta: SessionHeader; events: readonly SessionEvent[] }>
    try {
      imported = await readLegacy('zstd')
    } catch (error) {
      if (!String(error).includes('uses .jsonl')) throw error
      imported = await readLegacy('none')
    }

    this.database.exec('BEGIN IMMEDIATE')
    try {
      const insertMeta = this.database.prepare(
        'INSERT OR IGNORE INTO dsh_session_metadata(id, header_json, updated_at) VALUES (?, ?, ?)',
      )
      const insertEvent = this.database.prepare(
        'INSERT OR IGNORE INTO dsh_session_events(session_id, seq, event_json) VALUES (?, ?, ?)',
      )
      const timestamp = Date.now()
      imported.forEach(({ meta, events }, index) => {
        insertMeta.run(meta.id, JSON.stringify(meta), String(timestamp + index))
        for (const event of events) insertEvent.run(meta.id, event.seq, JSON.stringify(event))
      })
      this.database.prepare(
        "INSERT OR REPLACE INTO dsh_session_store_metadata(key, value) VALUES ('legacy-jsonl-import', 'complete')",
      ).run()
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    this.ctx.logger.info(`${this.name}: imported ${imported.length} legacy JSONL session(s) into SQLite`)
  }
}
