/** Prepare the disposable npm-project view used by an unpackaged Electron shell. */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { createDevelopmentProjectMetadata } from '../src/project-manager.ts'
import type { DesktopRelease } from '../src/release.ts'

interface PackageManifest {
  readonly name?: string
  readonly version?: string
  readonly dependencies?: Readonly<Record<string, string>>
}

const FIRST_PARTY_SCOPE = '@deepseek-ai/'

/** Inputs whose locations differ between the launcher and isolated tests. */
export interface DevelopmentProjectOptions {
  /** Directory replaced with the generated development project. */
  readonly projectDir: string
  /** Current workspace's `apps/cli` package directory. */
  readonly cliDir: string
  /** Current workspace's private Desktop Host application directory. */
  readonly hostDir: string
  /** pnpm's workspace-wide virtual-hoist directory. */
  readonly dependencyDir: string
  /** Release identity written into the disposable project metadata. */
  readonly release: DesktopRelease
}

function readManifest(path: string): PackageManifest {
  return JSON.parse(readFileSync(path, 'utf8')) as PackageManifest
}

function removeOwnedPath(path: string): void {
  let stat: ReturnType<typeof lstatSync>
  try {
    stat = lstatSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  if (stat.isSymbolicLink()) {
    unlinkSync(path)
    return
  }
  if (stat.isDirectory()) {
    rmSync(path, { recursive: true })
    return
  }
  unlinkSync(path)
}

function linkDirectory(source: string, destination: string): void {
  mkdirSync(dirname(destination), { recursive: true })
  symlinkSync(realpathSync(source), destination, process.platform === 'win32' ? 'junction' : 'dir')
}

function mirrorDependencyLinks(sourceRoot: string, destinationRoot: string): void {
  for (const entry of readdirSync(sourceRoot, { withFileTypes: true })) {
    if (entry.name === '.bin') continue
    const source = join(sourceRoot, entry.name)
    if (entry.name.startsWith('@') && (entry.isDirectory() || entry.isSymbolicLink())) {
      mkdirSync(join(destinationRoot, entry.name), { recursive: true })
      for (const scoped of readdirSync(source, { withFileTypes: true })) {
        if (!scoped.isDirectory() && !scoped.isSymbolicLink()) continue
        linkDirectory(join(source, scoped.name), join(destinationRoot, entry.name, scoped.name))
      }
      continue
    }
    if (entry.isDirectory() || entry.isSymbolicLink()) linkDirectory(source, join(destinationRoot, entry.name))
  }
}

/**
 * Link each first-party runtime dependency that an owning application installed for itself.
 *
 * pnpm resolves a direct dependency through the owning project's `node_modules`, but it may not
 * hoist a workspace package into the shared virtual-hoist directory the project mirror starts
 * from. Mirroring the owner's own links keeps every declared runtime dependency resolvable.
 * A name already supplied by the mirror keeps the workspace graph's choice.
 * @param ownerDir - CLI or Desktop Host application directory.
 * @param destinationRoot - Disposable project's `node_modules` directory.
 */
function linkOwnedDependencies(ownerDir: string, destinationRoot: string): void {
  const dependencies = readManifest(join(ownerDir, 'package.json')).dependencies ?? {}
  for (const name of Object.keys(dependencies).sort()) {
    if (!name.startsWith(FIRST_PARTY_SCOPE)) continue
    const destination = join(destinationRoot, name)
    if (existsSync(destination)) continue
    const source = join(ownerDir, 'node_modules', name)
    if (!existsSync(source)) {
      throw new Error(`desktop development: ${ownerDir} requires ${name} but it is not installed; run pnpm install`)
    }
    linkDirectory(source, destination)
  }
}

/**
 * Replace one disposable project with links to the current built workspace.
 * @param options - Project destination, CLI package, and release identity.
 * @returns the absolute project directory supplied by the caller.
 */
export function prepareDevelopmentProject(options: DevelopmentProjectOptions): string {
  const cliManifest = readManifest(join(options.cliDir, 'package.json'))
  if (cliManifest.name !== '@deepseek-ai/dsh' || cliManifest.version !== options.release.version) {
    throw new Error(
      `desktop development: apps/cli must be @deepseek-ai/dsh@${options.release.version}, found `
      + `${String(cliManifest.name)}@${String(cliManifest.version)}`,
    )
  }
  if (!existsSync(options.dependencyDir)) {
    throw new Error('desktop development: workspace dependency links are missing; run pnpm install')
  }
  const hostManifest = readManifest(join(options.hostDir, 'package.json'))
  if (hostManifest.name !== '@deepseek-ai/dsh-desktop-host' || hostManifest.version !== options.release.version) {
    throw new Error(
      `desktop development: apps/desktop-host must be @deepseek-ai/dsh-desktop-host@${options.release.version}, found `
      + `${String(hostManifest.name)}@${String(hostManifest.version)}`,
    )
  }
  if (!existsSync(join(options.hostDir, 'lib', 'index.js'))) {
    throw new Error('desktop development: apps/desktop-host/lib/index.js is missing; run pnpm run build')
  }

  removeOwnedPath(options.projectDir)
  createDevelopmentProjectMetadata(options.projectDir, options.release)
  const destinationModules = join(options.projectDir, 'node_modules')
  mkdirSync(destinationModules, { recursive: true })
  mirrorDependencyLinks(options.dependencyDir, destinationModules)
  const dshLink = join(destinationModules, '@deepseek-ai', 'dsh')
  removeOwnedPath(dshLink)
  linkDirectory(options.cliDir, dshLink)
  const hostLink = join(destinationModules, '@deepseek-ai', 'dsh-desktop-host')
  removeOwnedPath(hostLink)
  linkDirectory(options.hostDir, hostLink)
  linkOwnedDependencies(options.cliDir, destinationModules)
  linkOwnedDependencies(options.hostDir, destinationModules)
  return options.projectDir
}
