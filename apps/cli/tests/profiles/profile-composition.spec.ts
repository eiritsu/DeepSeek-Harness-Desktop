/**
 * Shipped profile composition: which bundle layers a profile applies and
 * whether the composed tree selects a computer-use provider. The Desktop
 * profile is not a shipped template (the Electron host owns it), so its chain
 * mirrors `DESKTOP_PROFILE_BUNDLES` in `apps/desktop/src/project-manager.ts`
 * plus the host's own overlay.
 */

import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { composeEntries, loadOverlayPatches, PROFILE_TEMPLATES } from '@deepseek-ai/dsh-app-boot'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))

/** Shipped bundle package name to its directory under `packages/bundle`. */
const BUNDLE_DIRS: Readonly<Record<string, string>> = {
  '@deepseek-ai/dsh-base': 'base',
  '@deepseek-ai/dsh-web-app': 'web-app',
  '@deepseek-ai/dsh-desktop-lite': 'desktop-lite',
  '@deepseek-ai/dsh-headless': 'headless',
  '@deepseek-ai/dsh-acp-app': 'acp-app',
  '@deepseek-ai/dsh-sdk-app': 'sdk-app',
  '@deepseek-ai/dsh-sdk-minimal': 'sdk-minimal',
}

const NATIVE = '@deepseek-ai/dsh-computer-use-cua-driver-native'

/**
 * The model-catalog network tunables the Desktop host pins. They belong to the
 * `model-catalog` row and must never migrate onto an adjacent inserted row.
 */
const CATALOG_CONFIG = {
  catalogURL: 'https://models.dev/api.json',
  refreshIntervalMs: 86_400_000,
  requestTimeoutMs: 15_000,
  maxResponseBytes: 8_388_608,
} as const

function bundlePatch(name: string): string {
  const dir = BUNDLE_DIRS[name]
  if (dir === undefined) throw new Error(`unknown shipped bundle ${name}`)
  return join(repoRoot, 'packages/bundle', dir, 'cordis.patch.yml')
}

/** Compose bundle layers and launcher overlays into one id-keyed row map. */
function rowsFor(
  bundles: readonly string[],
  ...overlays: string[]
): Map<string, { name?: string; config?: Record<string, unknown>; disabled?: boolean | null }> {
  const layers = bundles.map(name => loadOverlayPatches('test', bundlePatch(name)))
  layers.push(...overlays.map(path => loadOverlayPatches('test', path)))
  return new Map(composeEntries(layers).flatMap(entry => typeof entry.id === 'string' ? [[entry.id, entry] as const] : []))
}

describe('shipped profile composition selects the computer-use provider', () => {
  it('mounts the native provider only in the Desktop and Lite profiles', () => {
    const desktop = rowsFor(
      ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
      join(repoRoot, 'apps/desktop-host/config/desktop.cordis.patch.yml'),
    )
    const lite = rowsFor(PROFILE_TEMPLATES['desktop-lite']!.bundles)

    for (const [label, rows] of [['desktop', desktop], ['desktop-lite', lite]] as const) {
      expect(rows.get('computer-use')?.name, label).toBe('@deepseek-ai/dsh-computer-use')
      expect(rows.get('computer-use-cua-driver-native')?.name, label).toBe(NATIVE)
    }

    for (const profile of ['web', 'headless', 'acp', 'sdk'] as const) {
      const rows = rowsFor(PROFILE_TEMPLATES[profile]!.bundles)
      expect(rows.get('computer-use')?.name, profile).toBe('@deepseek-ai/dsh-computer-use')
      expect(rows.has('computer-use-cua-driver-native'), profile).toBe(false)
    }
    expect(rowsFor(PROFILE_TEMPLATES['sdk-minimal']!.bundles).has('computer-use-cua-driver-native')).toBe(false)
  })

  it('mounts the Computer Use settings section only in the Desktop and Lite profiles', () => {
    const SECTION = '@deepseek-ai/dsh-client-ui-computer-use'
    const desktop = rowsFor(
      ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
      join(repoRoot, 'apps/desktop-host/config/desktop.cordis.patch.yml'),
    )
    const lite = rowsFor(PROFILE_TEMPLATES['desktop-lite']!.bundles)

    for (const [label, rows] of [['desktop', desktop], ['desktop-lite', lite]] as const) {
      expect(rows.get('ui-computer-use')?.name, label).toBe(SECTION)
    }

    for (const profile of ['web', 'headless', 'acp', 'sdk'] as const) {
      expect(rowsFor(PROFILE_TEMPLATES[profile]!.bundles).has('ui-computer-use'), profile).toBe(false)
    }
    expect(rowsFor(PROFILE_TEMPLATES['sdk-minimal']!.bundles).has('ui-computer-use')).toBe(false)
  })

  it('lets the packaging smoke overlay disable only the native provider', () => {
    const desktopPatch = join(repoRoot, 'apps/desktop-host/config/desktop.cordis.patch.yml')
    const smokeOverlay = join(repoRoot, 'apps/desktop/scripts/packaging-smoke.overlay.yml')
    const formal = rowsFor(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'], desktopPatch)
    const smoke = rowsFor(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'], desktopPatch, smokeOverlay)

    expect([...smoke.keys()]).toEqual([...formal.keys()])
    for (const [id, row] of formal) {
      if (id === 'computer-use-cua-driver-native') continue
      expect(smoke.get(id), id).toEqual(row)
    }
    expect(formal.get('computer-use-cua-driver-native')?.disabled).toBeUndefined()
    expect(smoke.get('computer-use-cua-driver-native')).toEqual({
      ...formal.get('computer-use-cua-driver-native'),
      disabled: true,
    })
  })

  it('keeps the Desktop model-catalog config on model-catalog, not the native provider', () => {
    const desktop = rowsFor(
      ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
      join(repoRoot, 'apps/desktop-host/config/desktop.cordis.patch.yml'),
    )

    expect(desktop.get('model-catalog')?.name).toBe('@deepseek-ai/dsh-model-catalog')
    expect(desktop.get('model-catalog')?.config).toEqual(CATALOG_CONFIG)

    const native = desktop.get('computer-use-cua-driver-native')
    expect(native?.name).toBe(NATIVE)
    const nativeConfig = native?.config ?? {}
    for (const field of Object.keys(CATALOG_CONFIG)) {
      expect(nativeConfig, field).not.toHaveProperty(field)
    }
    expect(nativeConfig).toEqual({})
  })
})
