import { mkdtempSync, rmSync } from 'node:fs'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { load as loadYaml } from 'js-yaml'
import { afterEach, describe, expect, it } from 'vitest'
import { exportConfigurationBackup, importConfigurationBackup } from '../src/configuration-backup.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('desktop configuration backups', () => {
  it('round-trips settings, Skills, and profile metadata without touching Sessions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-configuration-'))
    roots.push(root)
    const data = join(root, 'data')
    const profile = join(data, 'profiles', 'desktop')
    const skills = join(data, 'skills')
    const settings = join(data, 'settings.yaml')
    const session = join(data, 'dsh-desktop.sqlite')
    await mkdir(join(skills, 'example'), { recursive: true })
    await mkdir(profile, { recursive: true })
    await writeFile(settings, 'agent-default-model:\n  provider: chiyun\n  model: deepseek-v4-flash\n')
    await writeFile(join(skills, 'example', 'SKILL.md'), '# Example\n')
    await writeFile(join(profile, 'package.json'), `${JSON.stringify({
      dependencies: { 'current-plugin': '1.0.0' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'current-plugin'] } },
    })}\n`)
    await writeFile(session, 'authoritative Session bytes')

    const archive = join(root, 'configuration.dshbackup.zip')
    const paths = { profile, skills, settings }
    await exportConfigurationBackup(paths, archive)
    expect((await stat(archive)).mode & 0o777).toBe(0o600)

    await writeFile(settings, '{}\n')
    await rm(join(skills, 'example'), { recursive: true })
    await importConfigurationBackup(paths, archive)

    const restored = loadYaml(await readFile(settings, 'utf8')) as Record<string, unknown>
    expect(restored['agent-default-model']).toEqual({ provider: 'chiyun', model: 'deepseek-v4-flash' })
    expect(await readFile(join(skills, 'example', 'SKILL.md'), 'utf8')).toBe('# Example\n')
    expect(await readFile(session, 'utf8')).toBe('authoritative Session bytes')
    expect((await stat(settings)).mode & 0o777).toBe(0o600)
  })
})
