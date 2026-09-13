/** Versioned Desktop configuration backup import and export shared by packaged Electron targets. */

import { createWriteStream } from 'node:fs'
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import extract from 'extract-zip'
import { load as loadYaml } from 'js-yaml'
import { ZipFile } from 'yazl'

const FORMAT = 'dsh-desktop-configuration'
const VERSION = 1
const IGNORED_NAMES = new Set(['.git', 'node_modules', '__MACOSX'])

interface ConfigurationBackupPaths {
  readonly profile: string
  readonly skills: string
  readonly settings: string
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function migratedSettings(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('configuration backup settings must be a JSON object')
  }
  const settings = { ...value } as Record<string, unknown>
  if (settings['llm-pi-ai'] === undefined && settings['llm-dsh-ai'] !== undefined) {
    settings['llm-pi-ai'] = settings['llm-dsh-ai']
    delete settings['llm-dsh-ai']
  }
  return settings
}

function legacySettings(databasePath: string): Record<string, unknown> | undefined {
  const database = new DatabaseSync(databasePath, { readOnly: true })
  try {
    const table = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'").get()
    if (table === undefined) return undefined
    const rows = database.prepare('SELECT namespace, payload_json FROM settings').all() as Array<{
      namespace: string
      payload_json: string
    }>
    if (rows.length === 0) return undefined
    return migratedSettings(Object.fromEntries(rows.map(row => [row.namespace, JSON.parse(row.payload_json) as unknown])))
  } finally {
    database.close()
  }
}

async function archiveRoot(stage: string): Promise<string> {
  try {
    await lstat(join(stage, 'manifest.json'))
    return stage
  } catch {}
  const entries = (await readdir(stage, { withFileTypes: true }))
    .filter(entry => entry.name !== '__MACOSX')
  if (entries.length !== 1 || !entries[0]?.isDirectory()) {
    throw new Error('configuration backup directory layout is invalid')
  }
  return archiveRoot(join(stage, entries[0].name))
}

async function validateManifest(root: string): Promise<void> {
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')) as Record<string, unknown>
  if (manifest.format !== FORMAT || manifest.version !== VERSION) {
    throw new Error('configuration backup manifest is unsupported')
  }
}

async function copyArtifacts(source: string, destination: string): Promise<void> {
  let entries
  try {
    entries = await readdir(source, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  await mkdir(destination, { recursive: true })
  for (const entry of entries) {
    if (IGNORED_NAMES.has(entry.name) || entry.name.startsWith('.')) continue
    const from = join(source, entry.name)
    const to = join(destination, entry.name)
    if (entry.isDirectory()) await copyArtifacts(from, to)
    else if (entry.isFile()) await copyFile(from, to)
  }
}

async function mergeLegacyProfile(source: string, destination: string): Promise<void> {
  let legacy: { dependencies?: Record<string, string>; dsh?: { profile?: { bundles?: string[] } } }
  let current: { dependencies?: Record<string, string>; dsh?: { profile?: { bundles?: string[] } } }
  try {
    legacy = JSON.parse(await readFile(source, 'utf8')) as typeof legacy
    current = JSON.parse(await readFile(destination, 'utf8')) as typeof current
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  const dependencies = { ...current.dependencies }
  for (const [name, version] of Object.entries(legacy.dependencies ?? {})) {
    if (!name.startsWith('@deepseek-ai/')) dependencies[name] = version
  }
  const bundles = [...(current.dsh?.profile?.bundles ?? [])]
  for (const name of legacy.dsh?.profile?.bundles ?? []) {
    if (name.startsWith('@deepseek-ai/') || bundles.includes(name)) continue
    // Configuration archives omit executable dependencies. Preserve the
    // requested version, but activate it only when this profile already owns
    // an installed copy that the Desktop plugin manager can inspect.
    if (await exists(join(dirname(destination), 'node_modules', name, 'package.json'))) bundles.push(name)
  }
  const merged = {
    ...current,
    dependencies,
    dsh: { ...current.dsh, profile: { ...current.dsh?.profile, bundles } },
  }
  await writeFile(destination, `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o600 })
}

async function addTree(zip: ZipFile, source: string, archivePrefix: string): Promise<void> {
  let entries
  try {
    entries = await readdir(source, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  for (const entry of entries) {
    if (IGNORED_NAMES.has(entry.name) || entry.name.startsWith('.')) continue
    const diskPath = join(source, entry.name)
    const archivePath = `${archivePrefix}/${entry.name}`
    if (entry.isDirectory()) await addTree(zip, diskPath, archivePath)
    else if (entry.isFile()) zip.addFile(diskPath, archivePath)
  }
}

async function addFileIfPresent(zip: ZipFile, source: string, archivePath: string): Promise<void> {
  if (await exists(source)) zip.addFile(source, archivePath)
}

/** Export settings, Skills, and the Electron profile without credentials or Session data. */
export async function exportConfigurationBackup(paths: ConfigurationBackupPaths, destination: string): Promise<void> {
  await mkdir(dirname(destination), { recursive: true })
  const staged = `${destination}.partial`
  await rm(staged, { force: true })
  const zip = new ZipFile()
  zip.addBuffer(Buffer.from(`${JSON.stringify({
    format: FORMAT,
    version: VERSION,
    createdAt: new Date().toISOString(),
    contents: ['settings', 'plugins', 'skills', 'profiles'],
    redactions: ['credentials', 'sessions', 'attachments', 'logs', 'machineIdentity'],
  }, null, 2)}\n`), 'manifest.json')
  await addFileIfPresent(zip, paths.settings, 'settings.yaml')
  await addTree(zip, paths.skills, 'skills')
  await addFileIfPresent(zip, join(paths.profile, 'package.json'), 'profiles/desktop/package.json')
  await new Promise<void>((resolvePromise, reject) => {
    const output = createWriteStream(staged, { mode: 0o600 })
    output.once('close', resolvePromise)
    output.once('error', reject)
    zip.outputStream.once('error', reject)
    zip.outputStream.pipe(output)
    zip.end()
  })
  await chmod(staged, 0o600)
  await rm(destination, { force: true })
  await copyFile(staged, destination)
  await chmod(destination, 0o600)
  await rm(staged, { force: true })
}

/** Import old or current Desktop configuration without replacing the authoritative Session database. */
export async function importConfigurationBackup(paths: ConfigurationBackupPaths, archive: string): Promise<void> {
  const stage = await mkdtemp(join(tmpdir(), 'dsh-electron-config-import-'))
  try {
    await extract(archive, { dir: stage })
    const root = await archiveRoot(stage)
    await validateManifest(root)
    let settings: Record<string, unknown> | undefined
    try {
      settings = migratedSettings(loadYaml(await readFile(join(root, 'settings.yaml'), 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      try {
        settings = legacySettings(join(root, 'dsh-desktop.sqlite'))
      } catch (databaseError) {
        if ((databaseError as NodeJS.ErrnoException).code !== 'ENOENT') throw databaseError
      }
    }
    if (settings !== undefined) {
      await mkdir(dirname(paths.settings), { recursive: true })
      await writeFile(paths.settings, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 })
      await chmod(paths.settings, 0o600)
    }
    await copyArtifacts(join(root, 'skills'), paths.skills)
    for (const name of ['web', 'desktop-lite', 'desktop']) {
      await mergeLegacyProfile(join(root, 'profiles', name, 'package.json'), join(paths.profile, 'package.json'))
    }
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
}
