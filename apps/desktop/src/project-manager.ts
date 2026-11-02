/** Desktop profile initialization and native recovery. */

import {
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  closeSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { join } from 'node:path'
import { parse } from 'semver'
import {
  DESKTOP_HOST_PACKAGE,
  desktopCorePackageOverrides,
  verifyDesktopCorePackageSet,
} from './core-package-set.ts'
import type { DesktopPaths } from './paths.ts'
import type { DesktopRelease } from './release.ts'
import { readDesktopRuntime } from './runtime-tree.ts'
import { initProfile, removeLinkProjections, sanitizeProfile } from '@deepseek-ai/dsh-app-boot'
import { ON_DEMAND_BUNDLES, PROFILE_TEMPLATES, type ProfileTemplate } from '@deepseek-ai/dsh-official-bundles'

const PROJECT_NAME = '@deepseek-ai/dsh-desktop-runtime'
const DSH_PACKAGE = '@deepseek-ai/dsh'
const CORE_BUILD_PACKAGE = '@deepseek-ai/dsh-subprocess-local'
const WEB_PROFILE = PROFILE_TEMPLATES.web as ProfileTemplate
const WORKSPACE_SETTINGS = 'nodeLinker: hoisted\nautoInstallPeers: false\n'
function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, undefined, 2)}\n`, { mode: 0o600 })
}

function workspaceFile(overrides: Readonly<Record<string, string>> = {}): string {
  const entries = Object.entries(overrides).sort(([left], [right]) => left.localeCompare(right))
  const overrideSection = entries.length === 0
    ? ''
    : `overrides:\n${entries.map(([name, spec]) => `  ${JSON.stringify(name)}: ${JSON.stringify(spec)}`).join('\n')}\n`
  if (entries.length === 0) return `packages:\n  - .\n\n${WORKSPACE_SETTINGS}`
  const coreBuildSpec = overrides[CORE_BUILD_PACKAGE]
  const coreBuildKey = coreBuildSpec === undefined
    ? CORE_BUILD_PACKAGE
    : `${CORE_BUILD_PACKAGE}@${coreBuildSpec.replace('file:./', 'file:')}`
  return `packages:\n  - .\n\n${overrideSection}${WORKSPACE_SETTINGS}allowBuilds:\n  node-pty: true\n  koffi: true\n  fs-ext: true\n  ${JSON.stringify(coreBuildKey)}: true\n  '@google/genai': false\n  protobufjs: false\n  node-addon-require-builtin: false\n`
}

function migrateProfileSettings(projectDir: string): void {
  const path = join(projectDir, 'pnpm-workspace.yaml')
  if (!existsSync(path)) return
  const legacy = `packages:\n  - .\n\n${WORKSPACE_SETTINGS}strictDepBuilds: true\nallowBuilds:\n  node-pty: true\n  koffi: true\n  fs-ext: true\n  "${CORE_BUILD_PACKAGE}": true\n  '@google/genai': false\n  protobufjs: false\n  node-addon-require-builtin: false\n`
  if (readFileSync(path, 'utf8').replaceAll('\r\n', '\n') === legacy) {
    writeFileSync(path, workspaceFile())
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

/**
 * The ecosystem plugins this deployment ships beside the harness. An exemption
 * key names one exact plugin version, so each of these names is resolved
 * against the version the profile holds; a key pinned to one version stops
 * matching as soon as the plugin is upgraded, and the exemption then silently
 * stops applying.
 */
const ECOSYSTEM_PLUGIN_NAMES = [
  '@deepseek-ai/dsh-im-integration',
  '@deepseek-ai/dsh-tools-connections',
  '@deepseek-ai/dsh-calendar',
  '@deepseek-ai/dsh-community-plugin-catalog',
  '@deepseek-ai/dsh-community-skill-catalog',
  '@deepseek-ai/dsh-lark-integration',
  '@deepseek-ai/dsh-subagent-claude-code',
  '@deepseek-ai/dsh-subagent-codex',
  '@deepseek-ai/dsh-superagent',
]

/**
 * The ecosystem release this deployment publishes. The marketplace serves these
 * plugins at this version, so the exemption is granted before the plugin is
 * installed and the gate reads it at install time; the versions the profile
 * already holds are granted in addition, so an upgraded copy stays covered.
 */
const ECOSYSTEM_RELEASE_VERSION = '0.2.1-rc.3'

/**
 * Whether a version spec names one exact release, which a compatibility
 * exemption key must.
 * @param value - Version spec read from a manifest.
 * @returns True for an exact version, false for a range or a locator.
 */
function isExactVersion(value: string): boolean {
  const parsed = parse(value)
  return parsed !== null && value === `${parsed.version}${parsed.build.length === 0 ? '' : `+${parsed.build.join('.')}`}`
}

/**
 * Read the version of one package the profile actually installed.
 * @param projectDir - Profile directory.
 * @param name - Package name.
 * @returns The installed version, or undefined when the package is absent.
 */
function installedPackageVersion(projectDir: string, name: string): string | undefined {
  const manifestPath = join(projectDir, 'node_modules', ...name.split('/'), 'package.json')
  try {
    const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (isRecord(parsed) && typeof parsed.version === 'string' && isExactVersion(parsed.version)) {
      return parsed.version
    }
  } catch {
    // The package is not installed under this profile.
  }
  return undefined
}

/**
 * Ensure compatibility exemptions exist for ecosystem plugins and local dependencies.
 * Each exemption names one exact plugin version, so a plugin the profile already
 * installed is exempted at its installed version and an ecosystem plugin is also
 * exempted at the version this deployment publishes.
 * @param projectDir - Profile directory.
 * @param runtimeVersion - Running DSH version to grant exemption for.
 */
export function ensureCompatibilityExemptions(projectDir: string, runtimeVersion: string): void {
  const compatPath = join(projectDir, 'compatibility.json')
  const exemptions: Record<string, string[]> = {}
  if (existsSync(compatPath)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(compatPath, 'utf8'))
      if (isRecord(parsed)) {
        for (const [key, value] of Object.entries(parsed)) {
          if (isStringArray(value)) {
            exemptions[key] = [...value]
          }
        }
      }
    } catch {
      // Treat unreadable compatibility file as empty
    }
  }

  const manifestPath = join(projectDir, 'package.json')
  const packageDeps: string[] = []
  if (existsSync(manifestPath)) {
    try {
      const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
      if (isRecord(manifest)) {
        const manifestsToInspect = [manifest.dependencies, manifest.optionalDependencies, manifest.peerDependencies]
        for (const depMap of manifestsToInspect) {
          if (isRecord(depMap)) {
            for (const [name, versionSpec] of Object.entries(depMap)) {
              if (typeof versionSpec === 'string' && name.startsWith('@deepseek-ai/') && versionSpec.length > 0) {
                packageDeps.push(`${name}@${versionSpec}`)
              }
            }
          }
        }
      }
    } catch {
      // Ignore unparseable manifest
    }
  }

  // An exemption key names one exact plugin version, so a version the
  // profile does not hold cannot be named. A dependency spec may be a range or
  // a locator, so the installed manifest decides the exact version.
  const targets = new Set<string>()
  for (const name of ECOSYSTEM_PLUGIN_NAMES) {
    const version = installedPackageVersion(projectDir, name)
    if (version !== undefined) targets.add(`${name}@${version}`)
    targets.add(`${name}@${ECOSYSTEM_RELEASE_VERSION}`)
  }
  for (const dependency of packageDeps) {
    const separator = dependency.lastIndexOf('@')
    if (separator <= 0) continue
    const name = dependency.slice(0, separator)
    const spec = dependency.slice(separator + 1)
    const version = installedPackageVersion(projectDir, name) ?? (isExactVersion(spec) ? spec : undefined)
    if (version !== undefined) targets.add(`${name}@${version}`)
  }

  let modified = false
  for (const target of targets) {
    const list = exemptions[target] ?? []
    if (!list.includes(runtimeVersion)) {
      exemptions[target] = [...list, runtimeVersion]
      modified = true
    }
  }

  if (modified || !existsSync(compatPath)) {
    writeJson(compatPath, exemptions)
  }
}

/**
 * Remove uninstalled on-demand bundles from dsh.profile.bundles to prevent "not-bundle" errors.
 * @param projectDir - Profile directory.
 */
export function cleanUninstalledOnDemandBundles(projectDir: string): void {
  const manifestPath = join(projectDir, 'package.json')
  if (!existsSync(manifestPath)) return
  try {
    const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (!isRecord(manifest)) return
    const dsh = manifest.dsh
    if (!isRecord(dsh)) return
    const profile = dsh.profile
    if (!isRecord(profile) || !Array.isArray(profile.bundles)) return
    const bundles = profile.bundles as unknown[]
    const deps = isRecord(manifest.dependencies) ? manifest.dependencies : {}
    const filtered = bundles.filter((bundle) => {
      if (typeof bundle !== 'string') return false
      if (ON_DEMAND_BUNDLES.includes(bundle)) {
        return Object.hasOwn(deps, bundle) || existsSync(join(projectDir, 'node_modules', bundle))
      }
      return true
    })
    if (filtered.length !== bundles.length) {
      profile.bundles = filtered
      writeJson(manifestPath, manifest)
    }
  } catch {
    // Leave invalid manifest for standard error handling
  }
}

const USER_CONFIG_PATCH_IDS = [
  'llm-pi-ai',
  'agent-default-model',
  'agent-preset-registry',
  'subagent-model-selection-settings',
  'permission',
  'locale',
  'ui-theme',
  'web',
  'ui-conversation',
]

/**
 * Extract top-level patch entry blocks keyed by their identifier.
 * @param content - cordis.patch.yml content.
 * @returns Map of patch id to verbatim YAML block string.
 */
export function extractPatchBlocks(content: string): Map<string, string> {
  const blocks = new Map<string, string>()
  const lines = content.split(/\r?\n/)
  let currentId: string | undefined
  let currentLines: string[] = []

  const flush = (): void => {
    if (currentId !== undefined && currentLines.length > 0) {
      blocks.set(currentId, currentLines.join('\n'))
    }
  }

  for (const line of lines) {
    const match = /^- id:\s*([^\s#]+)/.exec(line)
    if (match) {
      flush()
      currentId = match[1]
      currentLines = [line]
    } else if (currentId !== undefined) {
      currentLines.push(line)
    }
  }
  flush()
  return blocks
}

/**
 * Restore user configurations from previous patch backups if active patch was wiped or reset.
 * A block the active patch still carries is kept, and a block only the backup carries
 * is restored, so a profile that lost one configuration keeps the others.
 * @param projectDir - Profile directory.
 */
export function migrateRecoveredPatch(projectDir: string): void {
  const patchPath = join(projectDir, 'cordis.patch.yml')
  if (!existsSync(patchPath)) return

  let activeContent = readFileSync(patchPath, 'utf8')
  const activeBlocks = extractPatchBlocks(activeContent)

  // A reset drops every user-config block at once, but a partial loss keeps
  // some of them. Skip the recovery only when every block this function
  // restores is still present; a profile that kept 'llm-pi-ai' while losing
  // 'web' still needs the missing ones back.
  if (USER_CONFIG_PATCH_IDS.every(id => activeBlocks.has(id))) return

  let files: string[]
  try {
    files = readdirSync(projectDir)
  } catch {
    return
  }

  const backupFiles = files
    .filter(f => f.startsWith('cordis.patch.yml.bak-'))
    .map((name) => {
      const fullPath = join(projectDir, name)
      try {
        const stat = statSync(fullPath)
        return { name, path: fullPath, mtimeMs: stat.mtimeMs }
      } catch {
        return undefined
      }
    })
    .filter((entry): entry is { name: string; path: string; mtimeMs: number } => entry !== undefined)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)

  let backupBlocks: Map<string, string> | undefined
  for (const backup of backupFiles) {
    try {
      const content = readFileSync(backup.path, 'utf8')
      const blocks = extractPatchBlocks(content)
      if (blocks.has('llm-pi-ai')) {
        backupBlocks = blocks
        break
      }
    } catch {
      // Continue to next backup
    }
  }

  if (backupBlocks === undefined) return

  const blocksToRestore: string[] = []
  for (const id of USER_CONFIG_PATCH_IDS) {
    const block = backupBlocks.get(id)
    if (!activeBlocks.has(id) && block !== undefined) {
      blocksToRestore.push(block)
    }
  }

  if (blocksToRestore.length === 0) return

  const trimmed = activeContent.trim()
  if (trimmed === '[]' || trimmed.endsWith('\n[]') || trimmed.endsWith('\r\n[]')) {
    activeContent = activeContent.replace(/\[\]\s*$/, '').trimEnd()
  }

  const separator = activeContent.length > 0 ? '\n\n' : ''
  const restoredContent = `${activeContent}${separator}${blocksToRestore.join('\n\n')}\n`
  writeFileSync(patchPath, restoredContent, { mode: 0o600 })
}

/** Initializes the Desktop profile and disables third-party bundles during recovery. */
export class DesktopProjectManager {
  /**
   * @param paths - Electron-owned package state and reserved desktop profile paths.
   * @param runtime - location of the bundled application runtime.
   */
  constructor(
    readonly paths: DesktopPaths,
    readonly runtime: { readonly dsh: string },
  ) {}

  /**
   * Back up the profile patch and disable third-party bundles without loading application resources.
   * The caller must stop the Host first.
   * @returns Backup path after the locked profile write, or undefined if the patch was absent.
   */
  async disableAllPlugins(): Promise<string | undefined> {
    return this.withLock(() => sanitizeProfile('dsh', this.paths.profile, WEB_PROFILE.bundles))
  }

  /**
   * Load application metadata and prepare the external plugin profile without installing packages.
   */
  async applyRelease(): Promise<void> {
    await this.withLock(() => {
      // Validation only: an unreadable or mismatched runtime descriptor stops preparation before the Host starts.
      const runtime = readDesktopRuntime(this.runtime.dsh)
      migrateProfileSettings(this.paths.profile)
      createPluginProfile(this.paths.profile)
      cleanUninstalledOnDemandBundles(this.paths.profile)
      ensureCompatibilityExemptions(this.paths.profile, runtime.release.version)
      migrateRecoveredPatch(this.paths.profile)
      removeLinkProjections(this.paths.profile)
    })
  }

  private async withLock<T>(operation: () => T | Promise<T>): Promise<T> {
    mkdirSync(this.paths.profile, { recursive: true, mode: 0o700 })
    const lockPath = join(realpathSync(this.paths.profile), 'lock')
    let descriptor: number
    try {
      descriptor = openSync(lockPath, 'wx', 0o600)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        const lock = lstatSync(lockPath)
        if (lock.isSymbolicLink() || !lock.isFile()) {
          throw new Error('desktop project: profile lock is not a regular file')
        }
        const owner = Number.parseInt(readFileSync(lockPath, 'utf8').trim(), 10)
        let active = !Number.isSafeInteger(owner) || owner <= 0
        if (!active) {
          try {
            process.kill(owner, 0)
            active = true
          } catch (signalError) {
            active = (signalError as NodeJS.ErrnoException).code !== 'ESRCH'
          }
        }
        if (active) throw new Error('desktop project: another profile operation is active')
        unlinkSync(lockPath)
        descriptor = openSync(lockPath, 'wx', 0o600)
      } else {
        throw error
      }
    }
    try {
      writeSync(descriptor, `${String(process.pid)}\n`)
      fsyncSync(descriptor)
      return await operation()
    } finally {
      closeSync(descriptor)
      unlinkSync(lockPath)
    }
  }
}

/** Create build-only project metadata for materializing the signed runtime. */
export function createRuntimeProjectMetadata(projectDir: string, release: DesktopRelease): void {
  mkdirSync(projectDir, { recursive: true, mode: 0o700 })
  const packageSet = verifyDesktopCorePackageSet(projectDir, release.version)
  const manifest = {
    name: PROJECT_NAME,
    private: true,
    version: '0.0.0',
    dependencies: desktopCorePackageOverrides(packageSet),
    dsh: { profile: { bundles: [...WEB_PROFILE.bundles] } },
  }
  writeJson(join(projectDir, 'package.json'), manifest)
  writeFileSync(
    join(projectDir, 'pnpm-workspace.yaml'),
    workspaceFile(desktopCorePackageOverrides(packageSet)),
    { mode: 0o600 },
  )
}

/**
 * Create metadata for the unpackaged development project that links the current workspace.
 * @param projectDir - Disposable development profile directory.
 * @param release - Release identity shared by the linked CLI package and Electron shell.
 */
export function createDevelopmentProjectMetadata(projectDir: string, release: DesktopRelease): void {
  mkdirSync(projectDir, { recursive: true, mode: 0o700 })
  const manifest = {
    name: PROJECT_NAME,
    private: true,
    version: '0.0.0',
    dependencies: {
      [DSH_PACKAGE]: release.version,
      [DESKTOP_HOST_PACKAGE]: release.version,
    },
    dsh: { profile: { bundles: [...WEB_PROFILE.bundles] } },
  }
  writeJson(join(projectDir, 'package.json'), manifest)
  writeFileSync(join(projectDir, 'pnpm-workspace.yaml'), workspaceFile(), { mode: 0o600 })
}

/** Create the first external plugin profile without running a package manager. */
export function createPluginProfile(projectDir: string): void {
  initProfile(projectDir, WEB_PROFILE.bundles)
}
