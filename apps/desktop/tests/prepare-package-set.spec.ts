import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertDesktopHostPackageFiles,
  selectDesktopPackageClosure,
  type PackedDesktopPackage,
} from '../scripts/prepare-package-set.ts'

function packed(name: string, manifest: Record<string, unknown> = {}): PackedDesktopPackage {
  return { tarball: `${name}.tgz`, manifest: { name, version: '1.0.0', ...manifest } }
}

describe('desktop package-set selection', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('does not select a packaging target when imported as a library', async () => {
    vi.stubEnv('DSH_DESKTOP_TARGET_PLATFORM', 'linux')
    vi.stubEnv('DSH_DESKTOP_TARGET_ARCH', 'x64')
    vi.resetModules()
    await expect(import('../scripts/prepare-package-set.ts')).resolves.toHaveProperty('prepareDesktopPackageSet')
  })

  it('includes only the available internal production closure', () => {
    const available = new Map<string, PackedDesktopPackage>([
      ['@deepseek-ai/dsh', packed('@deepseek-ai/dsh', {
        dependencies: { '@deepseek-ai/dsh-base': '^1.0.0', external: '^2.0.0' },
        optionalDependencies: { '@deepseek-ai/platform-package': '1.0.0', '@deepseek-ai/missing-platform': '1.0.0' },
      })],
      ['@deepseek-ai/dsh-desktop-host', packed('@deepseek-ai/dsh-desktop-host', {
        dependencies: { '@deepseek-ai/dsh': '^1.0.0' },
      })],
      ['@deepseek-ai/dsh-base', packed('@deepseek-ai/dsh-base', {
        peerDependencies: { '@deepseek-ai/cordis': '^1.0.0' },
      })],
      ['@deepseek-ai/cordis', packed('@deepseek-ai/cordis')],
      ['@deepseek-ai/platform-package', packed('@deepseek-ai/platform-package')],
      ['@deepseek-ai/unused', packed('@deepseek-ai/unused')],
    ])
    expect(selectDesktopPackageClosure(available).map(entry => entry.manifest.name)).toEqual([
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh',
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-desktop-host',
      '@deepseek-ai/platform-package',
    ])
  })

  it('rejects a required internal package absent from the packed release inputs', () => {
    const available = new Map<string, PackedDesktopPackage>([
      ['@deepseek-ai/dsh', packed('@deepseek-ai/dsh', {
        dependencies: { '@deepseek-ai/dsh-base': '^1.0.0' },
      })],
      ['@deepseek-ai/dsh-desktop-host', packed('@deepseek-ai/dsh-desktop-host', {
        dependencies: { '@deepseek-ai/dsh': '^1.0.0' },
      })],
    ])
    expect(() => selectDesktopPackageClosure(available)).toThrow(/unpacked internal package/u)
    expect(() => selectDesktopPackageClosure(new Map([
      ['@deepseek-ai/dsh', packed('@deepseek-ai/dsh')],
    ]))).toThrow(/omit @deepseek-ai\/dsh-desktop-host/u)
  })

  it('requires the Desktop Host entry and its packaged overlay', () => {
    const files = [
      'package/lib/index.js',
      'package/config/desktop.cordis.patch.yml',
    ]
    expect(() => {
      assertDesktopHostPackageFiles(files)
    }).not.toThrow()
    expect(() => {
      assertDesktopHostPackageFiles(files.slice(0, 1))
    }).toThrow(/desktop\.cordis\.patch\.yml/u)
    expect(() => {
      assertDesktopHostPackageFiles(files.slice(1))
    }).toThrow(/lib\/index\.js/u)
  })

  it('keeps the Deepseek-Files recognizer in both Desktop profile overlays and package roots', () => {
    const profiles = [
      new URL('../../desktop-host/config/desktop.cordis.patch.yml', import.meta.url),
      new URL('../../../packages/bundle/desktop-lite/cordis.patch.yml', import.meta.url),
    ]
    for (const profile of profiles) {
      const source = readFileSync(profile, 'utf8')
      expect(source).toContain("id: file-recognizer-office\n      name: '@deepseek-ai/dsh-file-recognizer-office'")
      expect(source).toContain("id: ui-deepseek-files\n      name: '@deepseek-ai/dsh-client-ui-deepseek-files'")
    }
    const manifests = [
      new URL('../../desktop-host/package.json', import.meta.url),
      new URL('../../../packages/bundle/desktop-lite/package.json', import.meta.url),
    ]
    for (const manifest of manifests) {
      const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { dependencies?: Record<string, string> }
      expect(parsed.dependencies).toHaveProperty('@deepseek-ai/dsh-file-recognizer-office')
    }
  })

  it('keeps the Computer Use settings section in every Desktop profile overlay and closure root', () => {
    const profiles = [
      new URL('../../desktop-host/config/desktop.cordis.patch.yml', import.meta.url),
      new URL('../../../packages/bundle/desktop-lite/cordis.patch.yml', import.meta.url),
    ]
    for (const profile of profiles) {
      expect(readFileSync(profile, 'utf8'))
        .toContain("id: ui-computer-use\n      name: '@deepseek-ai/dsh-client-ui-computer-use'")
    }
    const manifests = [
      new URL('../../cli/package.json', import.meta.url),
      new URL('../../desktop-host/package.json', import.meta.url),
      new URL('../../../packages/bundle/desktop-lite/package.json', import.meta.url),
    ]
    for (const manifest of manifests) {
      const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { dependencies?: Record<string, string> }
      expect(parsed.dependencies).toHaveProperty('@deepseek-ai/dsh-client-ui-computer-use')
    }
  })
})
