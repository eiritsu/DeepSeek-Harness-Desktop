import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { claimDesktopDataLock } from '../src/data-lock.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('shared Desktop data lock', () => {
  it('rejects a live owner and permits the next owner after release', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-data-lock-'))
    roots.push(root)
    const path = join(root, 'runtime.lock')
    const first = claimDesktopDataLock(path)
    expect(() => claimDesktopDataLock(path)).toThrow(/Another DeepSeek Harness/)
    first.release()
    claimDesktopDataLock(path).release()
  })

  it('replaces a stale regular owner but rejects a non-file target', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-data-lock-stale-'))
    roots.push(root)
    const path = join(root, 'runtime.lock')
    writeFileSync(path, '99999999\n')
    claimDesktopDataLock(path).release()
    mkdirSync(path)
    expect(() => claimDesktopDataLock(path)).toThrow(/Another DeepSeek Harness/)
  })
})
