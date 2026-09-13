/** Cross-shell exclusive ownership of the shared Desktop Session database. */

import { closeSync, lstatSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** Process-lifetime lock shared by Electron and the native Lite shell. */
export interface DesktopDataLock {
  release(): void
}

function ownerIsAlive(path: string): boolean {
  const owner = Number.parseInt(readFileSync(path, 'utf8').trim(), 10)
  if (!Number.isSafeInteger(owner) || owner < 1) return false
  try {
    process.kill(owner, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Claim a regular, owner-only lock file; remove one stale owner and retry once. */
export function claimDesktopDataLock(path: string): DesktopDataLock {
  mkdirSync(dirname(path), { recursive: true })
  let descriptor: number | undefined
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      descriptor = openSync(path, 'wx', 0o600)
      writeFileSync(descriptor, `${String(process.pid)}\n`)
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const stat = lstatSync(path)
      if (!stat.isFile() || stat.isSymbolicLink() || ownerIsAlive(path)) {
        throw new Error('Another DeepSeek Harness desktop shell is using the shared Session database.')
      }
      unlinkSync(path)
    }
  }
  if (descriptor === undefined) throw new Error('Could not claim the shared Desktop Session database.')
  let held = descriptor
  return {
    release(): void {
      if (held < 0) return
      closeSync(held)
      held = -1
      try { unlinkSync(path) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    },
  }
}
