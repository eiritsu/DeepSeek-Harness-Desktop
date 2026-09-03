import type { SkillHubBridge } from './bridge.ts'

/** SkillHub API projection used by the browser marketplace. */

export const SKILLHUB_WEB = 'https://skillhub.cloud.tencent.com'
const API = 'https://api.skillhub.cn'

/** One SkillHub skill list item. */
export interface SkillHubSkill {
  readonly slug: string
  readonly name: string
  readonly namespace?: string
  readonly publisher?: string
  readonly description?: string
  readonly descriptionZh?: string
  readonly category?: string
  readonly iconUrl?: string
  readonly downloads: number
  readonly stars: number
  readonly score?: number
  readonly version?: string
  readonly source?: string
  readonly requiresApiKey?: boolean
}

/** One SkillHub skill package list item. */
export interface SkillHubPackage {
  readonly id: string
  readonly slug: string
  readonly displayName: string
  readonly summary?: string
  readonly scene?: string
  readonly subScene?: string
}

interface SkillsResponse {
  data?: { skills?: readonly Record<string, unknown>[]; total?: number }
  skills?: readonly Record<string, unknown>[]
  total?: number
}
interface PackagesResponse {
  data?: { skillSets?: readonly Record<string, unknown>[]; total?: number }
  skillSets?: readonly Record<string, unknown>[]
  total?: number
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function number(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') { const parsed = Number(value); if (Number.isFinite(parsed)) return parsed }
  return 0
}

function skill(raw: Record<string, unknown>): SkillHubSkill {
  const result: SkillHubSkill = {
    slug: text(raw.slug) ?? text(raw.name) ?? 'unknown-skill',
    name: text(raw.name) ?? text(raw.displayName) ?? text(raw.slug) ?? 'Unnamed skill',
    downloads: number(raw.downloads) || number(raw.installs),
    stars: number(raw.stars),
  }
  const optional: Record<string, string | number | boolean | undefined> = {
    namespace: text(raw.namespace) ?? (typeof raw.namespace === 'object' && raw.namespace !== null
      ? text((raw.namespace as { displayName?: unknown }).displayName)
      : undefined),
    publisher: typeof raw.publisher === 'object' && raw.publisher !== null ? text((raw.publisher as { name?: unknown }).name) : undefined,
    description: text(raw.description), descriptionZh: text(raw.description_zh) ?? text(raw.descriptionZh),
    category: text(raw.category), iconUrl: text(raw.iconUrl), score: typeof raw.score === 'number' ? raw.score : undefined,
    version: text(raw.version), source: text(raw.source),
    requiresApiKey: raw.requires_api_key === true
      || String(raw.requires_api_key).toLowerCase() === 'true'
      || (typeof raw.labels === 'object' && raw.labels !== null
        && String((raw.labels as { requires_api_key?: unknown }).requires_api_key).toLowerCase() === 'true'),
  }
  for (const [key, value] of Object.entries(optional)) if (value !== undefined) (result as unknown as Record<string, unknown>)[key] = value
  return result
}

function skillPackage(raw: Record<string, unknown>): SkillHubPackage {
  const result: SkillHubPackage = {
    id: text(raw.id) ?? text(raw.slug) ?? 'unknown-package',
    slug: text(raw.slug) ?? 'unknown-package',
    displayName: text(raw.displayName) ?? text(raw.name) ?? text(raw.slug) ?? 'Unnamed package',
  }
  for (const [key, value] of Object.entries({ summary: text(raw.summary), scene: text(raw.scene), subScene: text(raw.subScene) })) {
    if (value !== undefined) (result as unknown as Record<string, unknown>)[key] = value
  }
  return result
}

async function request<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(`${API}${path}`, { signal, headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`SkillHub request failed (${response.status})`)
  return await response.json() as T
}

/** Fetch one paged skill list.
 * @param input - page, search, sort, category, and source filters.
 * @param signal - cancellation signal for the request.
 * @param bridge - optional native desktop bridge.
 * @returns normalized SkillHub skills and total count.
 */
export async function fetchSkills(
  input: { page: number; pageSize: number; query: string; sort: string; category: string; source: string },
  signal: AbortSignal,
  bridge?: SkillHubBridge,
): Promise<{ items: readonly SkillHubSkill[]; total: number }> {
  if (bridge !== undefined) {
    const result = await bridge.request({ action: 'skillHubSkills', ...input })
    return { items: result.items.map(skill), total: result.total }
  }
  const params = new URLSearchParams({ page: String(input.page), pageSize: String(input.pageSize), sortBy: input.sort, order: 'desc' })
  if (input.query) params.set('keyword', input.query)
  if (input.category) params.set('category', input.category)
  if (input.source && input.source !== 'all') params.set('source', input.source)
  const payload = await request<SkillsResponse>(`/api/skills?${params}`, signal)
  const data = payload.data ?? payload
  const items = (data.skills ?? []).map(skill)
  return {
    items,
    total: data.total ?? (items.length >= input.pageSize
      ? input.page * input.pageSize + 1
      : (input.page - 1) * input.pageSize + items.length),
  }
}

/** Fetch one paged SkillHub skill-package list.
 * @param input - page, search, and scene filters.
 * @param signal - cancellation signal for the request.
 * @param bridge - optional native desktop bridge.
 * @returns normalized SkillHub packages and total count.
 */
export async function fetchSkillPackages(
  input: { page: number; pageSize: number; query: string; scene: string },
  signal: AbortSignal,
  bridge?: SkillHubBridge,
): Promise<{ items: readonly SkillHubPackage[]; total: number }> {
  if (bridge !== undefined) {
    const result = await bridge.request({ action: 'skillHubPackages', ...input })
    return { items: result.items.map(skillPackage), total: result.total }
  }
  const params = new URLSearchParams({ page: String(input.page), pageSize: String(input.pageSize) })
  if (input.query) params.set('keyword', input.query)
  if (input.scene) params.set('scene', input.scene)
  const payload = await request<PackagesResponse>(`/api/v1/skillsets?${params}`, signal)
  const data = payload.data ?? payload
  const items = (data.skillSets ?? []).map(skillPackage)
  return {
    items,
    total: data.total ?? (items.length >= input.pageSize
      ? input.page * input.pageSize + 1
      : (input.page - 1) * input.pageSize + items.length),
  }
}

/** Build a public SkillHub URL for an item.
 * @param slug - SkillHub item slug.
 * @returns public item URL.
 */
export function skillUrl(slug: string): string { return `${SKILLHUB_WEB}/skills/${encodeURIComponent(slug)}` }

/** Build a public SkillHub URL for a package.
 * @param slug - SkillHub package slug.
 * @returns public package URL.
 */
export function packageUrl(slug: string): string { return `${SKILLHUB_WEB}/skillspackage/${encodeURIComponent(slug)}` }
