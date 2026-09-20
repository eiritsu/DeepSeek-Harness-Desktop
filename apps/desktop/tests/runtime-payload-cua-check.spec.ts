/**
 * Focused evidence for the packaged native-SDK import check: the resolver reads
 * the packaged entry, the API assertion runs without creating a driver, and the
 * payload smoke wires both.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkCuaDriverApi, cuaDriverEntry } from './fixtures/cua-driver-payload-check.mjs'

const roots: string[] = []

function runtimeRootWithSdk(exports: unknown, main?: string): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-cua-entry-'))
  roots.push(root)
  const packageRoot = join(root, 'node_modules', '@trycua', 'cua-driver')
  mkdirSync(packageRoot, { recursive: true })
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({
    name: '@trycua/cua-driver', version: '0.28.0', type: 'module',
    ...(exports === undefined ? {} : { exports }),
    ...(main === undefined ? {} : { main }),
  }))
  return root
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('packaged Cua Driver import check', () => {
  it('resolves the packaged ESM entry declared by the SDK manifest', () => {
    const root = runtimeRootWithSdk({ '.': { types: './dist/index.d.ts', import: './dist/index.js' } })
    expect(cuaDriverEntry(root)).toBe(join(root, 'node_modules', '@trycua', 'cua-driver', 'dist', 'index.js'))
  })

  it('accepts the provider API without creating a driver', async () => {
    const create = vi.fn()
    class CuaDriver {
      static create = create
      async listToolsJson(): Promise<string> { return '{"tools":[]}' }
    }
    const load = vi.fn(async () => ({ CuaDriver }))

    await checkCuaDriverApi('/runtime/@trycua/cua-driver/dist/index.js', load)

    expect(load).toHaveBeenCalledWith(expect.stringContaining('/runtime/@trycua/cua-driver/dist/index.js'))
    expect(create).not.toHaveBeenCalled()
  })

  it('rejects an SDK that no longer exposes create or listToolsJson', async () => {
    const missingCreate = { CuaDriver: class { async listToolsJson(): Promise<string> { return '{}' } } }
    await expect(checkCuaDriverApi('/sdk.js', async () => missingCreate)).rejects.toThrow(/CuaDriver\.create/u)

    const missingList = {
      CuaDriver: Object.assign((): object => ({}), { create: (): object => ({}) }),
    }
    await expect(checkCuaDriverApi('/sdk.js', async () => missingList)).rejects.toThrow(/listToolsJson/u)
  })

  it('wires the check into the payload smoke', () => {
    const fixture = readFileSync(fileURLToPath(new URL('./fixtures/runtime-payload-smoke.mjs', import.meta.url)), 'utf8')
    expect(fixture).toContain("from './cua-driver-payload-check.mjs'")
    expect(fixture).toContain('await checkCuaDriverApi(cuaDriverEntry(root))')
  })
})
