import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ElectronPluginLibrary, parsePluginBridgeRequest } from '../src/plugin-library.ts'
import type { DesktopProjectManager } from '../src/project-manager.ts'

const roots: string[] = []

afterEach(() => {
  vi.unstubAllGlobals()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-electron-plugin-library-'))
  roots.push(root)
  const runtime = join(root, 'runtime')
  const packageDir = join(runtime, 'node_modules', '@deepseek-ai', 'dsh-external-tools')
  mkdirSync(packageDir, { recursive: true })
  writeFileSync(join(packageDir, 'package.json'), '{"name":"@deepseek-ai/dsh-external-tools","version":"0.1.16"}\n')
  const listPlugins = vi.fn(() => [{ name: 'custom-bundle', version: '1.0.0', enabled: true }])
  const manager = { listPlugins, registryPluginVersion: (name: string) => name === 'custom-bundle' ? '1.0.0' : undefined } as unknown as DesktopProjectManager
  const mutate = vi.fn(async () => {})
  return { root, runtime, manager, mutate, library: new ElectronPluginLibrary(root, runtime, manager, mutate) }
}

describe('Electron plugin-library bridge', () => {
  it('lists embedded and external bundles while retaining inventory during registry failure', async () => {
    const { library } = fixture()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await expect(library.request({ action: 'list' })).resolves.toEqual({
      plugins: [
        { name: '@deepseek-ai/dsh-external-tools', displayName: '@deepseek-ai/dsh-external-tools', version: '0.1.16', removable: false },
        { name: 'custom-bundle', displayName: 'custom-bundle', version: '1.0.0', removable: true },
      ],
    })
  })

  it('reviews a commit-pinned GitHub bundle before installing the inspected package name', async () => {
    const { library, mutate } = fixture()
    const manifest = JSON.stringify({ name: 'example-bundle', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } } })
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : input.toString()
      if (url.includes('/commits/')) return new Response(JSON.stringify({ sha: 'a'.repeat(40) }), { status: 200 })
      if (url.endsWith('/package.json')) return new Response(manifest, { status: 200 })
      if (url.endsWith('/cordis.patch.yml')) return new Response('[]\n', { status: 200 })
      throw new Error(`unexpected URL ${url}`)
    }))
    const source = `https://github.com/example/example-bundle#${'a'.repeat(40)}`
    const reviewed = await library.request({ action: 'review', source }) as { report: { reviewId?: string; installable: boolean } }
    expect(reviewed.report.installable).toBe(true)
    expect(reviewed.report.reviewId).toBeTypeOf('string')
    await library.request({ action: 'install', reviewId: reviewed.report.reviewId!, force: false })
    expect(mutate).toHaveBeenCalledWith({
      type: 'plugin-add',
      spec: `https://github.com/example/example-bundle.git#${'a'.repeat(40)}`,
      expectedName: 'example-bundle',
    })
    const logs = await library.request({ action: 'logs' }) as { records: { status: string }[] }
    expect(logs.records.map(record => record.status)).toEqual(['success', 'review'])
  })
})

describe('plugin-library IPC parser', () => {
  it('projects supported requests and rejects untyped renderer input', () => {
    expect(parsePluginBridgeRequest({ action: 'install', reviewId: 'r', force: true }))
      .toEqual({ action: 'install', reviewId: 'r', force: true })
    expect(() => parsePluginBridgeRequest({ action: 'install', reviewId: 'r', force: 'yes' })).toThrow('force flag')
    expect(() => parsePluginBridgeRequest({ action: 'unknown' })).toThrow('unsupported')
  })
})
