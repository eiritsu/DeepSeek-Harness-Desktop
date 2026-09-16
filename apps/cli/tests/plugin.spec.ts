import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { removeDeclaredPluginSettings } from '../src/plugin.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('plugin settings cleanup', () => {
  it('removes declared namespaces and restores them when package removal fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-cli-plugin-settings-'))
    roots.push(root)
    const packageDir = join(root, 'profile', 'node_modules', 'settings-plugin')
    mkdirSync(packageDir, { recursive: true })
    writeFileSync(join(packageDir, 'package.json'), JSON.stringify({
      dsh: { settings: { namespaces: ['plugin-settings'] } },
    }))
    const settingsPath = join(root, 'settings.yaml')
    writeFileSync(settingsPath, 'plugin-settings:\n  enabled: true\nother-settings:\n  keep: true\n')

    const restore = removeDeclaredPluginSettings('settings-plugin', join(root, 'profile'), root)
    const cleaned = readFileSync(settingsPath, 'utf8')
    expect(cleaned).not.toContain('plugin-settings')
    expect(cleaned).toContain('other-settings')

    restore?.()
    const restored = readFileSync(settingsPath, 'utf8')
    expect(restored).toContain('plugin-settings')
  })
})
