import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { rmSync } from 'node:fs'
import {
  exportSessionBackup,
  importSessionBackup,
  resetSessionDatabase,
  validateSessionBackup,
} from '../src/session-backup.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function database(path: string, version = 2): void {
  const db = new DatabaseSync(path)
  db.exec(`
    CREATE TABLE dsh_session_metadata(id TEXT PRIMARY KEY, header_json TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE dsh_session_events(session_id TEXT NOT NULL, seq INTEGER NOT NULL, event_json TEXT NOT NULL, PRIMARY KEY(session_id, seq));
    PRAGMA user_version = ${String(version)};
  `)
  db.close()
}

describe('desktop Session backups', () => {
  it('exports, validates, imports, and resets a closed authoritative database', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-backup-'))
    roots.push(root)
    const active = join(root, 'active.sqlite')
    const backup = join(root, 'backup.sqlite')
    database(active)

    await exportSessionBackup(active, backup)
    await exportSessionBackup(active, backup)
    validateSessionBackup(backup)
    expect(readFileSync(backup).subarray(0, 16).toString()).toBe('SQLite format 3\0')

    await importSessionBackup(backup, active)
    validateSessionBackup(active)
    await resetSessionDatabase(active)
    expect(() => { validateSessionBackup(active) }).toThrow()
  })

  it('rejects a newer schema before replacing active data', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-backup-newer-'))
    roots.push(root)
    const active = join(root, 'active.sqlite')
    const newer = join(root, 'newer.sqlite')
    database(active)
    database(newer, 3)

    await expect(importSessionBackup(newer, active)).rejects.toThrow(/unsupported SQLite schema/)
    validateSessionBackup(active)
  })
})
