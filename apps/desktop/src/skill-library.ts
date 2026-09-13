/** Electron-owned SkillHub catalog and reviewed local Skill installation. */

import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import extractZip from 'extract-zip'

const API = 'https://api.skillhub.cn'
const MAX_CATALOG_BYTES = 2 * 1024 * 1024
const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024
const MAX_ARCHIVE_ENTRIES = 4_096
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

export type DesktopSkillRequest =
  | {
    readonly action: 'skillHubSkills'
    readonly page: number
    readonly pageSize: number
    readonly query: string
    readonly sort?: string
    readonly category?: string
    readonly source?: string
  }
  | {
    readonly action: 'skillHubPackages'
    readonly page: number
    readonly pageSize: number
    readonly query: string
    readonly scene?: string
  }
  | { readonly action: 'downloadSkill'; readonly slug: string }
  | { readonly action: 'listSkills' }
  | { readonly action: 'removeSkill'; readonly name: string }

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('dsh desktop: invalid Skill library request')
  }
  return value as Record<string, unknown>
}

function textField(
  value: unknown,
  name: string,
  options: { readonly optional?: boolean; readonly maximum?: number } = {},
): string | undefined {
  if (value === undefined && options.optional === true) return undefined
  if (typeof value !== 'string' || value.length > (options.maximum ?? 1_024)) {
    throw new TypeError(`dsh desktop: Skill library ${name} must be a bounded string`)
  }
  return value
}

function requiredText(value: unknown, name: string, maximum = 1_024): string {
  const parsed = textField(value, name, { maximum })
  if (parsed === undefined) throw new TypeError(`dsh desktop: Skill library ${name} is required`)
  return parsed
}

/** Parse an untrusted renderer request before it reaches filesystem or network operations. */
export function parseDesktopSkillRequest(input: unknown): DesktopSkillRequest {
  const request = record(input)
  switch (request.action) {
    case 'skillHubSkills':
      return {
        action: request.action,
        page: pageNumber(request.page as number, 'page', 10_000),
        pageSize: pageNumber(request.pageSize as number, 'pageSize', 100),
        query: requiredText(request.query, 'query'),
        ...optionalText('sort', request.sort, 64),
        ...optionalText('category', request.category, 128),
        ...optionalText('source', request.source, 128),
      }
    case 'skillHubPackages':
      return {
        action: request.action,
        page: pageNumber(request.page as number, 'page', 10_000),
        pageSize: pageNumber(request.pageSize as number, 'pageSize', 100),
        query: requiredText(request.query, 'query'),
        ...optionalText('scene', request.scene, 128),
      }
    case 'downloadSkill': {
      const slug = requiredText(request.slug, 'slug', 128)
      if (!SLUG.test(slug)) throw new TypeError('dsh desktop: invalid SkillHub skill identifier')
      return { action: request.action, slug }
    }
    case 'listSkills':
      return { action: request.action }
    case 'removeSkill':
      return { action: request.action, name: requiredText(request.name, 'name', 256) }
    default:
      throw new TypeError('dsh desktop: unknown Skill library action')
  }
}

function optionalText<Key extends string>(key: Key, value: unknown, maximum: number): { readonly [K in Key]?: string } {
  const parsed = textField(value, key, { optional: true, maximum })
  return parsed === undefined ? {} : { [key]: parsed } as { readonly [K in Key]: string }
}

function pageNumber(value: number, name: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(`dsh desktop: SkillHub ${name} must be an integer from 1 through ${maximum}`)
  }
  return value
}

async function responseBytes(response: Response, maximum: number): Promise<Uint8Array> {
  if (!response.ok) throw new Error(`SkillHub request failed (${response.status})`)
  const reader = response.body?.getReader()
  if (reader === undefined) throw new Error('SkillHub response has no body')
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const next = await reader.read()
    if (next.done) break
    size += next.value.byteLength
    if (size > maximum) {
      await reader.cancel()
      throw new Error('SkillHub response exceeds the desktop download limit')
    }
    chunks.push(next.value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

async function jsonResponse(url: URL): Promise<Record<string, unknown>> {
  const response = await fetch(url, { headers: { Accept: 'application/json' } })
  const text = new TextDecoder().decode(await responseBytes(response, MAX_CATALOG_BYTES))
  const value: unknown = JSON.parse(text)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('SkillHub returned an invalid JSON document')
  }
  return value as Record<string, unknown>
}

function pageResult(
  payload: Record<string, unknown>,
  collection: 'skills' | 'skillSets',
  page: number,
  pageSize: number,
): { readonly items: readonly Record<string, unknown>[]; readonly total: number } {
  const nested = payload.data !== null && typeof payload.data === 'object' && !Array.isArray(payload.data)
    ? payload.data as Record<string, unknown>
    : payload
  const rawItems = nested[collection]
  const items = Array.isArray(rawItems)
    ? rawItems.filter((item): item is Record<string, unknown> =>
      item !== null && typeof item === 'object' && !Array.isArray(item))
    : []
  const suppliedTotal = nested.total
  const total = typeof suppliedTotal === 'number' && Number.isSafeInteger(suppliedTotal) && suppliedTotal >= 0
    ? suppliedTotal
    : items.length >= pageSize ? page * pageSize + 1 : (page - 1) * pageSize + items.length
  return { items, total }
}

function frontmatterName(text: string, fallback: string): string {
  const match = /^---\s*$([\s\S]*?)^---\s*$/m.exec(text)
  const name = match?.[1]?.match(/^name:\s*["']?([^"'\r\n]+?)["']?\s*$/m)?.[1]?.trim()
  return name === undefined || name.length === 0 ? fallback : name
}

async function inspectSkillDirectory(path: string): Promise<{ readonly folder: string; readonly name: string } | undefined> {
  const marker = join(path, 'SKILL.md')
  try {
    const metadata = await lstat(marker)
    if (!metadata.isFile() || metadata.isSymbolicLink()) return undefined
    return { folder: basename(path), name: frontmatterName(await readFile(marker, 'utf8'), basename(path)) }
  } catch {
    return undefined
  }
}

async function skillDirectories(root: string): Promise<readonly { readonly folder: string; readonly name: string }[]> {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const inspected = await Promise.all(entries
    .filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith('.'))
    .map(async entry => inspectSkillDirectory(join(root, entry.name))))
  return inspected.filter((item): item is { folder: string; name: string } => item !== undefined)
}

async function validateExtractedTree(root: string): Promise<number> {
  let count = 0
  const pending = [root]
  while (pending.length > 0) {
    const directory = pending.pop()
    if (directory === undefined) throw new Error('SkillHub archive traversal lost its pending directory')
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      count += 1
      if (count > MAX_ARCHIVE_ENTRIES) throw new Error('SkillHub archive has too many entries')
      const path = join(directory, entry.name)
      const metadata = await lstat(path)
      if (metadata.isSymbolicLink()) throw new Error('SkillHub archive contains a symbolic link')
      if (metadata.isDirectory()) pending.push(path)
    }
  }
  return count
}

async function payloadRoot(stage: string): Promise<string> {
  if (await inspectSkillDirectory(stage) !== undefined) return stage
  const entries = await readdir(stage, { withFileTypes: true })
  const directories = entries.filter(entry => entry.isDirectory() && !entry.isSymbolicLink())
  if (directories.length !== 1) throw new Error('SkillHub archive must contain one Skill directory')
  const directory = directories[0]
  if (directory === undefined) throw new Error('SkillHub archive must contain one Skill directory')
  const candidate = join(stage, directory.name)
  if (await inspectSkillDirectory(candidate) === undefined) throw new Error('SkillHub archive is missing SKILL.md')
  return candidate
}

/** Cross-platform SkillHub operations exposed only to the trusted application document. */
export class DesktopSkillLibrary {
  constructor(private readonly root: string) {}

  /** Execute one validated catalog or local-install request. */
  async request(request: DesktopSkillRequest): Promise<unknown> {
    switch (request.action) {
      case 'skillHubSkills': {
        const page = pageNumber(request.page, 'page', 10_000)
        const pageSize = pageNumber(request.pageSize, 'pageSize', 100)
        const url = new URL('/api/skills', API)
        url.searchParams.set('page', String(page))
        url.searchParams.set('pageSize', String(pageSize))
        url.searchParams.set('sortBy', request.sort ?? 'score')
        url.searchParams.set('order', 'desc')
        if (request.query !== '') url.searchParams.set('keyword', request.query)
        if (request.category !== undefined && request.category !== '') url.searchParams.set('category', request.category)
        if (request.source !== undefined && request.source !== 'all') url.searchParams.set('source', request.source)
        return pageResult(await jsonResponse(url), 'skills', page, pageSize)
      }
      case 'skillHubPackages': {
        const page = pageNumber(request.page, 'page', 10_000)
        const pageSize = pageNumber(request.pageSize, 'pageSize', 100)
        const url = new URL('/api/v1/skillsets', API)
        url.searchParams.set('page', String(page))
        url.searchParams.set('pageSize', String(pageSize))
        if (request.query !== '') url.searchParams.set('keyword', request.query)
        if (request.scene !== undefined && request.scene !== '') url.searchParams.set('scene', request.scene)
        return pageResult(await jsonResponse(url), 'skillSets', page, pageSize)
      }
      case 'downloadSkill':
        return { path: await this.download(request.slug) }
      case 'listSkills':
        return { skills: (await skillDirectories(this.root)).map(item => item.name).sort() }
      case 'removeSkill':
        await this.remove(request.name)
        return { ok: true }
      default:
        return request satisfies never
    }
  }

  private async download(slug: string): Promise<string> {
    if (!SLUG.test(slug)) throw new TypeError('dsh desktop: invalid SkillHub skill identifier')
    await mkdir(this.root, { recursive: true })
    const existing = join(this.root, slug)
    try {
      await lstat(existing)
      throw new Error(`Skill is already installed: ${slug}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const url = new URL('/api/v1/download', API)
    url.searchParams.set('slug', slug)
    const bytes = await responseBytes(await fetch(url), MAX_ARCHIVE_BYTES)
    const temporary = await mkdtemp(join(this.root, '.install-'))
    try {
      const archive = join(temporary, 'skill.zip')
      const extraction = join(temporary, 'extracted')
      await mkdir(extraction)
      await writeFile(archive, bytes, { mode: 0o600 })
      await extractZip(archive, { dir: extraction })
      await validateExtractedTree(extraction)
      const payload = await payloadRoot(extraction)
      await rename(payload, existing)
      return this.root
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  }

  private async remove(name: string): Promise<void> {
    if (name.length === 0 || name.length > 256) throw new TypeError('dsh desktop: invalid Skill name')
    const matches = (await skillDirectories(this.root)).filter(item => item.name === name)
    if (matches.length !== 1) throw new Error(`Expected one installed Skill named ${JSON.stringify(name)}`)
    const match = matches[0]
    if (match === undefined) throw new Error(`Expected one installed Skill named ${JSON.stringify(name)}`)
    await rm(join(this.root, match.folder), { recursive: true })
  }
}
