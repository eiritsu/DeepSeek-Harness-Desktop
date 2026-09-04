/** HTTP implementations for credential-gated providers. */
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { ExternalToolCatalogEntry } from './catalog.ts'

interface SearchArgs { readonly query: string; readonly maxResults?: number }

async function keyFor(ctx: Context, entry: ExternalToolCatalogEntry): Promise<string> {
  const credentials = ctx.get('credentials', false)
  if (credentials === undefined) throw new Error('external-tools: credentials service is unavailable')
  const result = await credentials.resolve(credentialRef(entry.credentialRef))
  if (result === undefined) throw new Error(`external-tools: ${entry.displayName} API key is not configured`)
  return result.value
}

async function readJson(response: Response): Promise<JsonValue> {
  if (!response.ok) throw new Error(`external-tools: provider returned HTTP ${String(response.status)}`)
  const value: unknown = await response.json()
  if (typeof value !== 'object' || value === null) throw new Error('external-tools: provider returned a non-object response')
  return value as JsonValue
}

/** Options for the credential-backed Tavily provider exposed through `ctx.web`. */
export interface TavilySearchProviderOptions {
  /** Endpoint base; `/search` is appended. */
  readonly baseURL: string
  /** Resolve the current Tavily key for one search operation. */
  readonly resolveApiKey: () => Promise<string>
  /** Return whether the provider currently has a configured credential. */
  readonly isConfigured?: () => boolean
}

/**
 * Convert one Tavily response into the normalized web result vocabulary.
 * @param value - parsed Tavily JSON response.
 * @returns normalized web search result.
 */
export function mapTavilyResponse(value: JsonValue): WebSearchResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new WebError('Tavily returned a non-object response', 'WEB_PROVIDER_ERROR')
  }
  const answer = typeof value.answer === 'string' && value.answer.length > 0 ? value.answer : undefined
  const rawResults = Array.isArray(value.results) ? value.results : []
  const sources: WebSearchSource[] = []
  for (const raw of rawResults) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue
    const url = raw.url
    if (typeof url !== 'string' || url.length === 0) continue
    const title = typeof raw.title === 'string' && raw.title.length > 0 ? raw.title : undefined
    const snippet = typeof raw.content === 'string' && raw.content.length > 0 ? raw.content : undefined
    const publishedAt = typeof raw.published_date === 'string' && raw.published_date.length > 0 ? raw.published_date : undefined
    sources.push({
      url,
      ...title === undefined ? {} : { title },
      ...snippet === undefined ? {} : { snippet },
      ...publishedAt === undefined ? {} : { publishedAt },
    })
  }
  return { ...answer === undefined ? {} : { content: answer }, sources, truncated: false }
}

/** Tavily's API adapter registered in the provider-neutral `ctx.web` seam. */
export class TavilySearchProvider implements WebSearchProvider {
  readonly id = 'tavily'

  constructor(private readonly options: TavilySearchProviderOptions) {}

  available(): boolean {
    return (this.options.isConfigured?.() ?? true) && URL.canParse(this.options.baseURL)
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    let apiKey: string
    try {
      apiKey = await this.options.resolveApiKey()
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') throw new WebError('Tavily search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`Tavily credential resolution failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
    let response: Response
    try {
      response = await fetch(new URL('/search', this.options.baseURL), {
        method: 'POST',
        redirect: 'error',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey, query: request.query, max_results: request.maxResults ?? 5 }),
        ...signal === undefined ? {} : { signal },
      })
    } catch (error: unknown) {
      if (signal?.aborted === true || error instanceof DOMException && error.name === 'AbortError') throw new WebError('Tavily search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`Tavily search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
    if (!response.ok) throw new WebError(`Tavily API error (HTTP ${String(response.status)})`, 'WEB_PROVIDER_ERROR')
    try {
      return mapTavilyResponse(await readJson(response))
    } catch (error: unknown) {
      if (signal?.aborted === true || error instanceof DOMException && error.name === 'AbortError') throw new WebError('Tavily search aborted', 'WEB_ABORTED', { cause: error })
      if (error instanceof WebError) throw error
      throw new WebError(`Tavily returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }
}

/** Options shared by API-key-backed external search providers. */
export interface ExternalSearchProviderOptions {
  /** Stable provider id. */
  readonly id: string
  /** Endpoint base used by the provider request. */
  readonly baseURL: string
  /** Resolve the current provider key for one operation. */
  readonly resolveApiKey: () => Promise<string>
  /** Return whether the provider currently has a configured credential. */
  readonly isConfigured: () => boolean
  /** Execute the provider-specific HTTP request. */
  readonly request: (baseURL: string, apiKey: string, request: WebSearchRequest, signal?: AbortSignal) => Promise<JsonValue>
  /** Normalize the provider response into the web seam vocabulary. */
  readonly mapResponse: (value: JsonValue) => WebSearchResult
}

/** Generic lifecycle and error handling for external search adapters. */
export class ExternalSearchProvider implements WebSearchProvider {
  readonly id: string

  constructor(private readonly options: ExternalSearchProviderOptions) {
    this.id = options.id
  }

  available(): boolean {
    return this.options.isConfigured() && URL.canParse(this.options.baseURL)
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    try {
      return this.options.mapResponse(await this.options.request(this.options.baseURL, await this.options.resolveApiKey(), request, signal))
    } catch (error: unknown) {
      if (error instanceof WebError) throw error
      if (signal?.aborted === true || error instanceof DOMException && error.name === 'AbortError') throw new WebError(`${this.id} search aborted`, 'WEB_ABORTED', { cause: error })
      throw new WebError(`${this.id} search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }
}

/**
 * Normalize Brave Search's `web.results` response.
 * @param value - parsed Brave JSON response.
 * @returns normalized web search result.
 */
export function mapBraveResponse(value: JsonValue): WebSearchResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new WebError('Brave Search returned a non-object response', 'WEB_PROVIDER_ERROR')
  const web = value.web
  if (typeof web !== 'object' || web === null || Array.isArray(web)) return { sources: [], truncated: false }
  const rawResults = Array.isArray(web.results) ? web.results : []
  const sources: WebSearchSource[] = []
  for (const raw of rawResults) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue
    if (typeof raw.url !== 'string' || raw.url.length === 0) continue
    const title = typeof raw.title === 'string' && raw.title.length > 0 ? raw.title : undefined
    const snippet = typeof raw.description === 'string' && raw.description.length > 0 ? raw.description : undefined
    const publishedAt = typeof raw.page_age === 'string' && raw.page_age.length > 0 ? raw.page_age : undefined
    sources.push({
      url: raw.url,
      ...title === undefined ? {} : { title },
      ...snippet === undefined ? {} : { snippet },
      ...publishedAt === undefined ? {} : { publishedAt },
    })
  }
  return { sources, truncated: false }
}

/**
 * Normalize Exa's highlight-based search response.
 * @param value - parsed Exa JSON response.
 * @returns normalized web search result.
 */
export function mapExaResponse(value: JsonValue): WebSearchResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new WebError('Exa returned a non-object response', 'WEB_PROVIDER_ERROR')
  const rawResults = Array.isArray(value.results) ? value.results : []
  const sources: WebSearchSource[] = []
  for (const raw of rawResults) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || typeof raw.url !== 'string' || raw.url.length === 0) continue
    const snippet = Array.isArray(raw.highlights) ? raw.highlights.find(item => typeof item === 'string' && item.length > 0) : undefined
    sources.push({ url: raw.url, ...typeof raw.title === 'string' && raw.title.length > 0 ? { title: raw.title } : {}, ...typeof snippet === 'string' ? { snippet } : {}, ...typeof raw.publishedDate === 'string' && raw.publishedDate.length > 0 ? { publishedAt: raw.publishedDate } : {} })
  }
  return { sources, truncated: false }
}

function searchTool(
  ctx: Context,
  entry: ExternalToolCatalogEntry,
  call: (key: string, args: SearchArgs, signal: AbortSignal) => Promise<JsonValue>,
) {
  return defineTool({
    name: entry.toolName as string,
    description: `${entry.description}。调用前需要在设置 → 工具与连接中配置 ${entry.displayName}。`,
    parameters: { query: { type: 'string', required: true, description: '搜索问题或关键词' }, maxResults: { type: 'number', description: '返回结果数量，默认 5' } },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
    execute: async (raw, exec) => call(await keyFor(ctx, entry), raw as SearchArgs, exec.signal),
  })
}

/**
 * Build the dedicated model tool for one catalog provider.
 * @param ctx - Cordis context used for credential resolution.
 * @param entry - provider catalog entry.
 * @returns a model tool, or `undefined` when no implementation exists.
 */
export function toolForProvider(ctx: Context, entry: ExternalToolCatalogEntry): ToolDefinition | undefined {
  switch (entry.id) {
    case 'brave-search': return searchTool(ctx, entry, async (key, args, signal) => {
      const url = new URL('/res/v1/web/search', entry.baseURL); url.searchParams.set('q', args.query); url.searchParams.set('count', String(args.maxResults ?? 5))
      return readJson(await fetch(url, { redirect: 'error', headers: { accept: 'application/json', 'X-Subscription-Token': key }, signal }))
    })
    case 'tavily': return searchTool(ctx, entry, async (key, args, signal) => readJson(await fetch(new URL('/search', entry.baseURL), { method: 'POST', redirect: 'error', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ api_key: key, query: args.query, max_results: args.maxResults ?? 5 }), signal })))
    case 'exa': return searchTool(ctx, entry, async (key, args, signal) => readJson(await fetch(new URL('/search', entry.baseURL), { method: 'POST', redirect: 'error', headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify({ query: args.query, numResults: args.maxResults ?? 5, contents: { highlights: {} } }), signal })))
    case 'github': return searchTool(ctx, entry, async (key, args, signal) => { const url = new URL('/search/code', entry.baseURL); url.searchParams.set('q', args.query); return readJson(await fetch(url, { redirect: 'error', headers: { accept: 'application/json', authorization: `Bearer ${key}`, 'X-GitHub-Api-Version': '2022-11-28' }, signal })) })
    case 'firecrawl': return defineTool({ name: entry.toolName as string, description: `${entry.description}。调用前需要在设置 → 工具与连接中配置 ${entry.displayName}。`, parameters: { url: { type: 'string', required: true, description: '要提取的网页 URL' } }, output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] }, execute: async (raw, exec) => readJson(await fetch(new URL('/v1/scrape', entry.baseURL), { method: 'POST', redirect: 'error', headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${await keyFor(ctx, entry)}` }, body: JSON.stringify({ url: (raw as { readonly url: string }).url, formats: ['markdown'] }), signal: exec.signal })) })
    default: return undefined
  }
}

/**
 * Build a provider-neutral web adapter for external providers that implement the seam.
 * @param ctx - Cordis context used for credential resolution.
 * @param entry - provider catalog entry.
 * @param isConfigured - synchronous credential-presence predicate.
 * @returns a native web adapter, or `undefined` when the provider is not a search adapter.
 */
export function webProviderForProvider(
  ctx: Context,
  entry: ExternalToolCatalogEntry,
  isConfigured: () => boolean,
): WebSearchProvider | undefined {
  if (entry.baseURL === undefined) return undefined
  const shared = { baseURL: entry.baseURL, resolveApiKey: () => keyFor(ctx, entry), isConfigured }
  switch (entry.id) {
    case 'tavily': return new TavilySearchProvider(shared)
    case 'brave-search': return new ExternalSearchProvider({
      ...shared, id: entry.id, mapResponse: mapBraveResponse,
      request: async (baseURL, apiKey, request, signal) => {
        const url = new URL('/res/v1/web/search', baseURL)
        url.searchParams.set('q', request.query)
        url.searchParams.set('count', String(request.maxResults ?? 5))
        return readJson(await fetch(url, { redirect: 'error', headers: { accept: 'application/json', 'X-Subscription-Token': apiKey }, ...signal === undefined ? {} : { signal } }))
      },
    })
    case 'exa': return new ExternalSearchProvider({
      ...shared, id: entry.id, mapResponse: mapExaResponse,
      request: async (baseURL, apiKey, request, signal) => readJson(await fetch(new URL('/search', baseURL), {
        method: 'POST', redirect: 'error', headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ query: request.query, numResults: request.maxResults ?? 5, contents: { highlights: {} } }),
        ...signal === undefined ? {} : { signal },
      })),
    })
    default: return undefined
  }
}

/** Provider ids with a dedicated implemented model tool. */
export const IMPLEMENTED_EXTERNAL_TOOL_IDS = new Set(['brave-search', 'tavily', 'exa', 'github', 'firecrawl'])
