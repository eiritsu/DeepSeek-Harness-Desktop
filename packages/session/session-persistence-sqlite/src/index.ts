/**
 * SQLite durable Session backend. One transaction stores each contiguous
 * append batch together with the metadata counters that drive cheap listing.
 * @module @deepseek-ai/dsh-session-persistence-sqlite
 */

/* oxlint-disable typescript/require-await -- DatabaseSync is synchronous while SessionPersistence methods return promises. */

import { randomUUID } from 'node:crypto'
import { closeSync, mkdirSync, openSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, SessionHeader, SessionId, SessionLogOffset as SessionLogOffsetType } from '@deepseek-ai/dsh-session'
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import {
  assertContiguous,
  assertStoredId,
  assertVersion,
  materializeAppendBatch,
  materializeCreateHeader,
  SessionAlreadyExistsError,
  SessionAlreadyOwnedError,
  SessionHandleClosedError,
  SessionPersistence,
  SessionPersistenceCorruptionError,
  SessionPersistenceNotFoundError,
  SessionPersistenceRevision,
  SessionReadOnlyError,
  validateStoredEvents,
} from '@deepseek-ai/dsh-session-persistence'
import type {
  SessionAccess,
  SessionHandle,
  SessionHandleAppendOptions,
  SessionHandleFlushOptions,
  SessionHandleReadOptions,
  SessionHandleReadResult,
  SessionPersistenceCreateOptions,
  SessionPersistenceDeleteOptions,
  SessionPersistenceListOptions,
  SessionPersistenceOpenOptions,
  SessionPersistenceSnapshot,
  SessionPersistenceStatOptions,
} from '@deepseek-ai/dsh-session-persistence'

/** Current SQLite layout version. Versions zero and one are legacy desktop layouts. */
export const SESSION_SQLITE_SCHEMA_VERSION = 2

/** Maximum intentional wait before a routed live-event batch is written. */
export const LIVE_WRITE_BATCH_MAX_DELAY_MS = 200

/** Plugin configuration. */
export interface Config {
  /** Absolute or process-relative SQLite database path, or `:memory:` in tests. */
  path: string
}

/** Configuration schema. */
export const Config: z<Config> = z.object({
  path: z.string().required(),
})

interface MetadataRow {
  readonly header_json: string
  readonly inherited_event_count: number
  readonly event_count: number
  readonly revision: number
}

interface EventRow {
  readonly seq: number
  readonly event_json: string
}

interface StoredSession {
  readonly header: SessionHeader
  readonly inheritedEventCount: SessionLogOffsetType
  readonly events: SessionEvent[]
  readonly revision: number
}

interface SessionMigration {
  readonly id: SessionId
  readonly header: SessionHeader
  readonly inheritedEventCount: SessionLogOffsetType
  readonly events: readonly SessionEvent[]
}

interface PendingSession {
  readonly header: SessionHeader
  readonly inheritedEventCount: SessionLogOffsetType
  readonly revision: ReturnType<typeof SessionPersistenceRevision>
}

/** Deep-freeze one acyclic stored JSON event without recursive calls. */
function freezeStoredEvent(event: SessionEvent): void {
  const pending: object[] = [event]
  while (pending.length > 0) {
    const current = pending.pop()
    /* v8 ignore next -- the loop length check proves pop returns an object in this synchronous body. */
    if (current === undefined) break
    Object.freeze(current)
    for (const key in current) {
      const child = (current as Record<string, unknown>)[key]
      if (child !== null && typeof child === 'object') pending.push(child)
    }
  }
}

/** Convert a durable revision counter into the provider-neutral opaque token. */
function sqliteRevision(revision: number) {
  return SessionPersistenceRevision(`sqlite:${String(revision)}`)
}

/** Validate create-time fork metadata exactly as the Session format requires. */
function createInheritedEventCount(
  header: SessionHeader,
  options?: SessionPersistenceCreateOptions,
): SessionLogOffsetType {
  if (header.isSeeded && options?.inheritedEventCount === undefined) {
    throw new Error('seeded session header requires an inherited event count')
  }
  const inheritedEventCount = SessionLogOffset(options?.inheritedEventCount ?? 0)
  if (!header.isSeeded && inheritedEventCount !== 0) {
    throw new Error('unseeded session header inherited event count must be 0')
  }
  return inheritedEventCount
}

/** One SQLite-backed open Session channel. */
class SqliteSessionHandle implements SessionHandle {
  private chain: Promise<unknown> = Promise.resolve()
  private closing: Promise<void> | undefined
  private observedLength = 0
  private buffered: SessionEvent[] = []
  private batchTimer: ReturnType<typeof setTimeout> | undefined
  private drainPaused = false
  private draining: Promise<void> | undefined

  constructor(
    private readonly owner: SqliteSessionPersistence,
    readonly id: SessionId,
    readonly header: SessionHeader,
    readonly inheritedEventCount: SessionLogOffsetType,
    readonly access: SessionAccess,
    private cursor: number,
    private materialized: boolean,
  ) {}

  /** Read a validated Session event slice. */
  async read(
    offset = 0,
    length = Number.MAX_SAFE_INTEGER,
    options?: SessionHandleReadOptions,
  ): Promise<SessionHandleReadResult> {
    this.assertOpen('read')
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new TypeError(`read offset must be a non-negative safe integer, got ${String(offset)}`)
    }
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new TypeError(`read length must be a non-negative safe integer, got ${String(length)}`)
    }
    options?.signal?.throwIfAborted()
    const stored = this.owner.readSession(this.id)
    if (stored === undefined) {
      if (!this.owner.hasPending(this.id)) throw new SessionPersistenceNotFoundError(this.id)
      return { eventState: 'detached', events: [] }
    }
    if (stored.events.length < this.observedLength) {
      throw new Error(`session "${this.id}": stored log shrank below a previously observed prefix (${stored.events.length} < ${this.observedLength})`)
    }
    this.observedLength = stored.events.length
    return {
      eventState: 'shared-frozen',
      events: stored.events.slice(offset, offset + length),
    }
  }

  /** Append one contiguous batch in a durable SQLite transaction. */
  async append(events: readonly SessionEvent[], options?: SessionHandleAppendOptions): Promise<void> {
    this.assertOpen('append')
    const batch = materializeAppendBatch(events)
    await this.run('append', async () => {
      options?.signal?.throwIfAborted()
      await this.persist(batch)
    })
  }

  /** Materialize an empty Session; non-empty appends are already durable. */
  flush(options?: SessionHandleFlushOptions): Promise<void> {
    return this.run('flush', async () => {
      options?.signal?.throwIfAborted()
      if (this.access !== 'write') throw new SessionReadOnlyError(this.id, 'flush')
      if (!this.materialized) {
        await this.owner.persistHeader(this.header, this.inheritedEventCount)
        this.materialized = true
      }
    })
  }

  /** Drain routed events and release this handle. */
  close(): Promise<void> {
    this.closing ??= (async () => {
      let drainFailure: unknown
      for (;;) {
        try {
          await this.drainLive()
        } catch (error: unknown) {
          drainFailure = error
          break
        }
        await this.chain
        if (this.buffered.length === 0) break
      }
      await this.chain
      this.owner.releaseHandle(this, this.materialized)
      if (drainFailure !== undefined) {
        throw drainFailure instanceof Error
          ? drainFailure
          : new Error(typeof drainFailure === 'string'
            ? drainFailure
            : 'SQLite live-event drain failed with a non-Error value',
          { cause: drainFailure })
      }
    })()
    return this.closing
  }

  /** `await using` support. */
  [Symbol.asyncDispose](): Promise<void> {
    return this.close()
  }

  /** Retain one live event for the bounded write-behind window. */
  enqueueLive(event: SessionEvent, reportBackgroundFailure: (error: unknown) => void): void {
    this.buffered.push(structuredClone(event))
    if (this.batchTimer !== undefined || this.drainPaused) return
    this.batchTimer = setTimeout(() => {
      this.batchTimer = undefined
      this.drainLive().catch(reportBackgroundFailure)
    }, LIVE_WRITE_BATCH_MAX_DELAY_MS)
  }

  /** Drain all routed live events in order. */
  drainLive(): Promise<void> {
    return this.draining ??= this.drainBuffered().finally(() => {
      this.draining = undefined
    })
  }

  private async drainBuffered(): Promise<void> {
    if (this.batchTimer !== undefined) {
      clearTimeout(this.batchTimer)
      this.batchTimer = undefined
    }
    this.drainPaused = false
    while (this.buffered.length > 0) {
      await this.enqueueChain(async () => {
        const batch = this.buffered.splice(0)
        try {
          await this.persist(materializeAppendBatch(batch))
        } catch (error: unknown) {
          this.buffered = batch.concat(this.buffered)
          this.drainPaused = true
          throw error
        }
      })
    }
  }

  private async persist(batch: readonly SessionEvent[]): Promise<void> {
    if (this.access !== 'write') throw new SessionReadOnlyError(this.id, 'append')
    if (batch.length === 0) return
    assertContiguous(this.id, batch, this.cursor)
    await this.owner.persistBatch(this.header, this.inheritedEventCount, this.cursor, batch, this.materialized)
    this.materialized = true
    this.cursor += batch.length
    this.observedLength = this.cursor
  }

  private enqueueChain(operation: () => Promise<void>): Promise<void> {
    const next = this.chain.then(operation)
    this.chain = next.catch(() => {})
    return next
  }

  private async run(operation: string, callback: () => Promise<void>): Promise<void> {
    this.assertOpen(operation)
    return this.enqueueChain(async () => {
      this.assertOpen(operation)
      return callback()
    })
  }

  private assertOpen(operation: string): void {
    if (this.closing !== undefined) throw new SessionHandleClosedError(this.id, operation)
  }
}

/** SQLite implementation of the handle-based Session persistence service. */
export default class SqliteSessionPersistence extends SessionPersistence {
  static inject = ['sessions']
  static Config = Config
  override readonly name = 'session-persistence-sqlite'

  private readonly path: string
  private readonly database: DatabaseSync
  private readonly openHandles = new Set<SqliteSessionHandle>()
  private readonly writers = new Map<SessionId, SqliteSessionHandle>()
  private readonly pending = new Map<SessionId, PendingSession>()

  /** Open and validate the database, then install live Session routing. */
  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.path = config.path === ':memory:' ? ':memory:' : resolve(config.path)
    if (this.path !== ':memory:') {
      mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
      try {
        closeSync(openSync(this.path, 'wx', 0o600))
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }
    this.database = new DatabaseSync(this.path)
    try {
      this.configureDatabase()
    } catch (error: unknown) {
      this.database.close()
      throw error
    }
    this.install(ctx)
  }

  /** Create a pending Session and return its write handle. */
  async create(header: SessionHeader, options?: SessionPersistenceCreateOptions): Promise<SessionHandle> {
    options?.signal?.throwIfAborted()
    const snapshot = materializeCreateHeader(header)
    const inheritedEventCount = createInheritedEventCount(snapshot, options)
    if (this.writers.has(snapshot.id) || this.pending.has(snapshot.id) || this.metadata(snapshot.id) !== undefined) {
      throw new SessionAlreadyExistsError(snapshot.id)
    }
    const handle = new SqliteSessionHandle(this, snapshot.id, snapshot, inheritedEventCount, 'write', 0, false)
    this.writers.set(snapshot.id, handle)
    this.pending.set(snapshot.id, {
      header: snapshot,
      inheritedEventCount,
      revision: SessionPersistenceRevision(`memory:sqlite:${randomUUID()}`),
    })
    this.openHandles.add(handle)
    return handle
  }

  /** Open a durable or process-local pending Session. */
  async open(
    id: SessionId,
    access: SessionAccess,
    options?: SessionPersistenceOpenOptions,
  ): Promise<SessionHandle> {
    options?.signal?.throwIfAborted()
    const pending = this.pending.get(id)
    if (access === 'write' && this.writers.has(id)) throw new SessionAlreadyOwnedError(id)
    const stored = this.readSession(id)
    let source = stored
    if (source === undefined) {
      if (pending === undefined) throw new SessionPersistenceNotFoundError(id)
      source = {
        header: pending.header,
        inheritedEventCount: pending.inheritedEventCount,
        events: [],
        revision: 0,
      }
    }
    options?.signal?.throwIfAborted()
    const handle = new SqliteSessionHandle(
      this,
      id,
      source.header,
      source.inheritedEventCount,
      access,
      source.events.length,
      stored !== undefined,
    )
    if (access === 'write') this.writers.set(id, handle)
    this.openHandles.add(handle)
    return handle
  }

  /** Flush every active write handle and aggregate failures. */
  async flush(): Promise<void> {
    const errors: unknown[] = []
    for (const writer of [...this.writers.values()]) {
      try {
        await writer.drainLive()
        await writer.flush()
      } catch (error: unknown) {
        if (!(error instanceof SessionHandleClosedError)) errors.push(error)
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, `${this.name} flush failed`)
  }

  /** Observe one Session without reading its events. */
  async stat(
    id: SessionId,
    options?: SessionPersistenceStatOptions,
  ): Promise<SessionPersistenceSnapshot | undefined> {
    options?.signal?.throwIfAborted()
    const pending = this.pending.get(id)
    if (pending !== undefined) {
      return { header: pending.header, revision: pending.revision }
    }
    const row = this.metadata(id)
    if (row === undefined) return undefined
    return {
      header: this.parseHeader(id, row.header_json),
      revision: sqliteRevision(row.revision),
      eventCount: row.event_count,
    }
  }

  /** List all durable and process-local pending Sessions. */
  async list(options?: SessionPersistenceListOptions): Promise<readonly SessionPersistenceSnapshot[]> {
    options?.signal?.throwIfAborted()
    const rows = this.database.prepare(
      'SELECT id, header_json, inherited_event_count, event_count, revision FROM dsh_session_metadata ORDER BY id',
    ).all() as unknown as Array<MetadataRow & { readonly id: string }>
    const snapshots: SessionPersistenceSnapshot[] = rows.map(row => ({
      header: this.parseHeader(row.id as SessionId, row.header_json),
      revision: sqliteRevision(row.revision),
      eventCount: row.event_count,
    }))
    const durable = new Set(rows.map(row => row.id))
    for (const [id, pending] of this.pending) {
      if (!durable.has(id)) snapshots.push({ header: pending.header, revision: pending.revision })
    }
    options?.signal?.throwIfAborted()
    return snapshots
  }

  /** Permanently delete one Session in a single SQLite transaction. */
  async delete(id: SessionId, options?: SessionPersistenceDeleteOptions): Promise<void> {
    options?.signal?.throwIfAborted()
    if (this.writers.has(id)) throw new SessionAlreadyOwnedError(id)
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const result = this.database.prepare(
        'DELETE FROM dsh_session_metadata WHERE id = ?',
      ).run(id)
      if (result.changes === 0) throw new SessionPersistenceNotFoundError(id)
      this.database.exec('COMMIT')
    } catch (error: unknown) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  /**
   * Whether a created Session remains process-local and unmaterialized.
   * @param id - Session identity to inspect.
   * @returns whether the Session has not reached its first durable write.
   */
  hasPending(id: SessionId): boolean {
    return this.pending.has(id)
  }

  /**
   * Read and validate one complete durable Session.
   * @param id - Durable Session identity to read.
   * @returns the validated stored Session, or `undefined` when it does not exist.
   */
  readSession(id: SessionId): StoredSession | undefined {
    const row = this.metadata(id)
    if (row === undefined) return undefined
    const header = this.parseHeader(id, row.header_json)
    const eventRows = this.database.prepare(
      'SELECT seq, event_json FROM dsh_session_events WHERE session_id = ? ORDER BY seq',
    ).all(id) as unknown as EventRow[]
    if (eventRows.length !== row.event_count) {
      throw new SessionPersistenceCorruptionError(
        `stored session "${id}" event count mismatch: metadata ${row.event_count}, rows ${eventRows.length}`,
        { cause: new Error('SQLite metadata/event count mismatch') },
      )
    }
    const events: SessionEvent[] = []
    for (const [index, eventRow] of eventRows.entries()) {
      if (eventRow.seq !== index) {
        throw new SessionPersistenceCorruptionError(
          `stored session "${id}" has non-contiguous event row ${eventRow.seq}; expected ${index}`,
          { cause: new Error('SQLite event sequence gap') },
        )
      }
      let event: SessionEvent
      try {
        event = JSON.parse(eventRow.event_json) as SessionEvent
      } catch (error: unknown) {
        throw new SessionPersistenceCorruptionError(
          `stored session "${id}" contains invalid event JSON at seq ${eventRow.seq}`,
          { cause: error },
        )
      }
      if (event.seq !== eventRow.seq) {
        throw new SessionPersistenceCorruptionError(
          `stored session "${id}" event payload seq ${event.seq} does not match row ${eventRow.seq}`,
          { cause: new Error('SQLite event sequence mismatch') },
        )
      }
      events.push(event)
    }
    validateStoredEvents(header, events, { kind: 'sqlite', path: this.path })
    for (const event of events) freezeStoredEvent(event)
    Object.freeze(events)
    return {
      header,
      inheritedEventCount: SessionLogOffset(row.inherited_event_count),
      events,
      revision: row.revision,
    }
  }

  /**
   * Materialize a header-only Session.
   * @param header - Immutable Session header to store.
   * @param inheritedEventCount - Exact inherited prefix length for a fork.
   */
  async persistHeader(header: SessionHeader, inheritedEventCount: SessionLogOffsetType): Promise<void> {
    const result = this.database.prepare(`
      INSERT INTO dsh_session_metadata(
        id, header_json, inherited_event_count, event_count, revision, updated_at
      ) VALUES (?, ?, ?, 0, 1, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(header.id, JSON.stringify(header), inheritedEventCount, String(Date.now()))
    if (result.changes === 0 && !this.pending.has(header.id)) throw new SessionAlreadyExistsError(header.id)
    this.pending.delete(header.id)
  }

  /**
   * Commit one append and its count/revision update atomically.
   * @param header - Immutable Session header used for first materialization.
   * @param inheritedEventCount - Exact inherited prefix length for a fork.
   * @param cursor - Expected durable event count before this append.
   * @param events - Contiguous event batch to insert.
   * @param materialized - Whether metadata already exists for this handle.
   */
  async persistBatch(
    header: SessionHeader,
    inheritedEventCount: SessionLogOffsetType,
    cursor: number,
    events: readonly SessionEvent[],
    materialized: boolean,
  ): Promise<void> {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      if (!materialized) {
        this.database.prepare(`
          INSERT INTO dsh_session_metadata(
            id, header_json, inherited_event_count, event_count, revision, updated_at
          ) VALUES (?, ?, ?, 0, 0, ?)
        `).run(header.id, JSON.stringify(header), inheritedEventCount, String(Date.now()))
      }
      const row = this.database.prepare(
        'SELECT event_count FROM dsh_session_metadata WHERE id = ?',
      ).get(header.id) as { readonly event_count: number } | undefined
      if (row === undefined) throw new SessionPersistenceNotFoundError(header.id)
      if (row.event_count !== cursor) {
        throw new Error(`session "${header.id}" expected seq ${row.event_count}, got ${cursor}`)
      }
      assertContiguous(header.id, events, cursor)
      const insert = this.database.prepare(
        'INSERT INTO dsh_session_events(session_id, seq, event_json) VALUES (?, ?, ?)',
      )
      for (const event of events) insert.run(header.id, event.seq, JSON.stringify(event))
      this.database.prepare(`
        UPDATE dsh_session_metadata
        SET event_count = ?, revision = revision + 1, updated_at = ?
        WHERE id = ?
      `).run(cursor + events.length, String(Date.now()), header.id)
      this.database.exec('COMMIT')
      this.pending.delete(header.id)
    } catch (error: unknown) {
      this.database.exec('ROLLBACK')
      if (!materialized && this.metadata(header.id) !== undefined) {
        throw new SessionAlreadyExistsError(header.id)
      }
      throw error
    }
  }

  /**
   * Drop handle ownership and erase a never-materialized create.
   * @param handle - Closing handle whose ownership should be released.
   * @param materialized - Whether the handle reached durable storage.
   */
  releaseHandle(handle: SqliteSessionHandle, materialized: boolean): void {
    this.openHandles.delete(handle)
    if (handle.access !== 'write') return
    this.writers.delete(handle.id)
    if (!materialized) this.pending.delete(handle.id)
  }

  private metadata(id: SessionId): MetadataRow | undefined {
    return this.database.prepare(`
      SELECT header_json, inherited_event_count, event_count, revision
      FROM dsh_session_metadata WHERE id = ?
    `).get(id) as MetadataRow | undefined
  }

  private parseHeader(id: SessionId, json: string): SessionHeader {
    let parsed: unknown
    try {
      parsed = JSON.parse(json)
    } catch (error: unknown) {
      throw new SessionPersistenceCorruptionError(
        `stored session "${id}" contains invalid header JSON`,
        { cause: error },
      )
    }
    const header = materializeCreateHeader(parsed as SessionHeader)
    assertStoredId(id, header)
    assertVersion(header, { kind: 'sqlite', path: this.path })
    return header
  }

  private configureDatabase(): void {
    this.database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;')
    const { user_version: version } = this.database.prepare('PRAGMA user_version').get() as { user_version: number }
    if (!Number.isSafeInteger(version) || version < 0 || version > SESSION_SQLITE_SCHEMA_VERSION) {
      throw new Error(
        `session SQLite database at "${this.path}" has schema version ${version}, incompatible with this build (${SESSION_SQLITE_SCHEMA_VERSION})`,
      )
    }
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS dsh_session_metadata (
        id TEXT PRIMARY KEY,
        header_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        inherited_event_count INTEGER NOT NULL DEFAULT 0,
        event_count INTEGER NOT NULL DEFAULT 0,
        revision INTEGER NOT NULL DEFAULT 1
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
    const columns = new Set(
      (this.database.prepare('PRAGMA table_info(dsh_session_metadata)').all() as Array<{ name: string }>)
        .map(column => column.name),
    )
    if (!columns.has('inherited_event_count')) {
      this.database.exec('ALTER TABLE dsh_session_metadata ADD COLUMN inherited_event_count INTEGER NOT NULL DEFAULT 0')
    }
    if (!columns.has('event_count')) {
      this.database.exec('ALTER TABLE dsh_session_metadata ADD COLUMN event_count INTEGER NOT NULL DEFAULT 0')
      this.database.exec(`
        UPDATE dsh_session_metadata
        SET event_count = (
          SELECT COUNT(*) FROM dsh_session_events WHERE session_id = dsh_session_metadata.id
        )
      `)
    }
    if (!columns.has('revision')) {
      this.database.exec('ALTER TABLE dsh_session_metadata ADD COLUMN revision INTEGER NOT NULL DEFAULT 1')
    }
    this.migrateSessionFormats()
    if (version < SESSION_SQLITE_SCHEMA_VERSION) {
      this.database.exec(`PRAGMA user_version = ${SESSION_SQLITE_SCHEMA_VERSION}`)
    }
  }

  /** Upgrade legacy desktop Session rows through the installed format catalog. */
  private migrateSessionFormats(): void {
    const metadata = this.database.prepare(
      'SELECT id, header_json FROM dsh_session_metadata ORDER BY id',
    ).all() as Array<{ readonly id: string; readonly header_json: string }>
    const migrations: SessionMigration[] = []
    for (const row of metadata) {
      let parsed: unknown
      try {
        parsed = JSON.parse(row.header_json)
      } catch (error: unknown) {
        throw new SessionPersistenceCorruptionError(
          `stored session "${row.id}" contains invalid header JSON`,
          { cause: error },
        )
      }
      const physicalHeader = parsed !== null && typeof parsed === 'object'
        ? { type: 'session', delegationDepth: 0, ...parsed }
        : parsed
      const classification = sessionFormatCatalog.readHeader(physicalHeader)
      if (classification.status === 'current') continue
      if ('reason' in classification) {
        throw new SessionPersistenceCorruptionError(
          `stored session "${row.id}" cannot be upgraded: ${classification.reason}`,
          { cause: new Error(classification.reason) },
        )
      }
      try {
        const restore = sessionFormatCatalog.createRestore(physicalHeader, {
          recovery: 'strict', validation: 'current',
        })
        const eventRows = this.database.prepare(
          'SELECT seq, event_json FROM dsh_session_events WHERE session_id = ? ORDER BY seq',
        ).all(row.id) as unknown as EventRow[]
        for (const [index, eventRow] of eventRows.entries()) {
          if (eventRow.seq !== index) throw new Error(`event row ${eventRow.seq} is not contiguous at ${index}`)
          restore.decodeRow(JSON.parse(eventRow.event_json) as unknown)
        }
        const artifact = restore.finish()
        const header = materializeCreateHeader(artifact.header as unknown as SessionHeader)
        assertStoredId(row.id as SessionId, header)
        migrations.push({
          id: row.id as SessionId,
          header,
          inheritedEventCount: SessionLogOffset(artifact.inheritedEventCount),
          events: artifact.events as SessionEvent[],
        })
      } catch (error: unknown) {
        throw new SessionPersistenceCorruptionError(
          `stored session "${row.id}" could not be upgraded to Session format v${sessionFormatCatalog.currentVersion}`,
          { cause: error },
        )
      }
    }
    if (migrations.length === 0) return
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const deleteEvents = this.database.prepare('DELETE FROM dsh_session_events WHERE session_id = ?')
      const insertEvent = this.database.prepare(
        'INSERT INTO dsh_session_events(session_id, seq, event_json) VALUES (?, ?, ?)',
      )
      const updateMetadata = this.database.prepare(`
        UPDATE dsh_session_metadata
        SET header_json = ?, inherited_event_count = ?, event_count = ?,
            revision = revision + 1, updated_at = ?
        WHERE id = ?
      `)
      for (const migration of migrations) {
        deleteEvents.run(migration.id)
        for (const event of migration.events) {
          insertEvent.run(migration.id, event.seq, JSON.stringify(event))
        }
        updateMetadata.run(
          JSON.stringify(migration.header),
          migration.inheritedEventCount,
          migration.events.length,
          String(Date.now()),
          migration.id,
        )
      }
      this.database.exec('COMMIT')
    } catch (error: unknown) {
      this.database.exec('ROLLBACK')
      throw error
    }
    this.ctx.logger.info(`${this.name}: upgraded ${migrations.length} legacy Session(s) to format v${sessionFormatCatalog.currentVersion}`)
  }

  private install(ctx: Context): void {
    ctx.on('session/event', (session: Session, event) => {
      this.writers.get(session.id)?.enqueueLive(event, (error) => {
        ctx.logger.warn(`session-persistence: background write for session "${session.id}" failed (buffered events retained): ${String(error)}`)
      })
    })
    ctx.on('session/flush', (session: Session) => {
      const writer = this.writers.get(session.id)
      if (writer === undefined) return undefined
      return (async () => {
        await writer.drainLive()
        await writer.flush()
      })()
    })
    ctx.on('session/disposed', (session: Session) => {
      const writer = this.writers.get(session.id)
      if (writer === undefined) return
      writer.close().catch((error: unknown) => {
        ctx.logger.warn(`session-persistence: final drain for session "${session.id}" failed: ${String(error)}`)
      })
    })
    ctx.effect(() => async () => {
      const errors: unknown[] = []
      for (const handle of [...this.openHandles]) {
        try {
          await handle.close()
        } catch (error: unknown) {
          errors.push(error)
        }
      }
      this.database.close()
      if (errors.length > 0) throw new AggregateError(errors, `${this.name} dispose failed`)
    }, `${this.name} open handles and database`)
  }
}
