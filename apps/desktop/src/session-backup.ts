/** Safe export, import, and reset operations for the authoritative Desktop Session database. */

import { chmod, copyFile, mkdir, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/** Current SQLite store schema accepted by this desktop release. */
const MAX_SCHEMA_VERSION = 2

async function replaceFile(staged: string, destination: string): Promise<void> {
  const replaced = `${destination}.replaced`
  await rm(replaced, { force: true })
  let retained = false
  try {
    await rename(destination, replaced)
    retained = true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  try {
    await rename(staged, destination)
    if (retained) await rm(replaced, { force: true })
  } catch (error) {
    if (retained) await rename(replaced, destination)
    throw error
  }
}

/** Validate that a candidate is a supported Harness Session database. */
export function validateSessionBackup(path: string): void {
  const database = new DatabaseSync(path, { readOnly: true })
  try {
    const version = database.prepare('PRAGMA user_version').get() as { user_version: number }
    if (!Number.isSafeInteger(version.user_version) || version.user_version < 1
      || version.user_version > MAX_SCHEMA_VERSION) {
      throw new Error(`unsupported SQLite schema version ${String(version.user_version)}`)
    }
    const tables = database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('dsh_session_metadata', 'dsh_session_events') ORDER BY name",
    ).all() as Array<{ name: string }>
    if (tables.map(row => row.name).join(',') !== 'dsh_session_events,dsh_session_metadata') {
      throw new Error('required Session tables are missing')
    }
  } finally {
    database.close()
  }
}

/** Copy a closed authoritative database to a user-selected destination. */
export async function exportSessionBackup(source: string, destination: string): Promise<void> {
  validateSessionBackup(source)
  await mkdir(dirname(destination), { recursive: true })
  const staged = `${destination}.partial`
  await rm(staged, { force: true })
  try {
    await copyFile(source, staged)
    await chmod(staged, 0o600)
    validateSessionBackup(staged)
    await replaceFile(staged, destination)
  } catch (error) {
    await rm(staged, { force: true })
    throw error
  }
}

/** Validate and atomically replace a closed authoritative database. */
export async function importSessionBackup(source: string, destination: string): Promise<void> {
  validateSessionBackup(source)
  await mkdir(dirname(destination), { recursive: true })
  const staged = `${destination}.importing`
  await rm(staged, { force: true })
  try {
    await copyFile(source, staged)
    await chmod(staged, 0o600)
    validateSessionBackup(staged)
    await replaceFile(staged, destination)
    await Promise.all([
      rm(`${destination}-wal`, { force: true }),
      rm(`${destination}-shm`, { force: true }),
    ])
  } catch (error) {
    await rm(staged, { force: true })
    throw error
  }
}

/** Remove the closed authoritative database and its SQLite sidecars. */
export async function resetSessionDatabase(path: string): Promise<void> {
  await Promise.all([
    rm(path, { force: true }),
    rm(`${path}-wal`, { force: true }),
    rm(`${path}-shm`, { force: true }),
  ])
}
