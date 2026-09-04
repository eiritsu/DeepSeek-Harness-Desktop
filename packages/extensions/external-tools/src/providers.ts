/** HTTP implementations for credential-gated providers. */
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { ExternalToolCatalogEntry } from './catalog.ts'

interface SearchArgs { readonly query: string; readonly maxResults?: number }

async function keyFor(ctx: Context, entry: ExternalToolCatalogEntry): Promise<string> {
  const credentials = ctx.get('credentials')
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

export function toolForProvider(ctx: Context, entry: ExternalToolCatalogEntry) {
  switch (entry.id) {
    case 'brave-search': return searchTool(ctx, entry, async (key, args, signal) => {
      const url = new URL('/res/v1/web/search', entry.baseURL); url.searchParams.set('q', args.query); url.searchParams.set('count', String(args.maxResults ?? 5))
      return readJson(await fetch(url, { headers: { accept: 'application/json', 'X-Subscription-Token': key }, signal }))
    })
    case 'tavily': return searchTool(ctx, entry, async (key, args, signal) => readJson(await fetch(new URL('/search', entry.baseURL), { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ api_key: key, query: args.query, max_results: args.maxResults ?? 5 }), signal })))
    case 'exa': return searchTool(ctx, entry, async (key, args, signal) => readJson(await fetch(new URL('/search', entry.baseURL), { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify({ query: args.query, numResults: args.maxResults ?? 5, contents: { highlights: {} } }), signal })))
    case 'github': return searchTool(ctx, entry, async (key, args, signal) => { const url = new URL('/search/code', entry.baseURL); url.searchParams.set('q', args.query); return readJson(await fetch(url, { headers: { accept: 'application/json', authorization: `Bearer ${key}`, 'X-GitHub-Api-Version': '2022-11-28' }, signal })) })
    case 'firecrawl': return defineTool({ name: entry.toolName as string, description: `${entry.description}。调用前需要在设置 → 工具与连接中配置 ${entry.displayName}。`, parameters: { url: { type: 'string', required: true, description: '要提取的网页 URL' } }, output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] }, execute: async (raw, exec) => readJson(await fetch(new URL('/v1/scrape', entry.baseURL), { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${await keyFor(ctx, entry)}` }, body: JSON.stringify({ url: (raw as { readonly url: string }).url, formats: ['markdown'] }), signal: exec.signal })) })
    default: return undefined
  }
}

export const IMPLEMENTED_EXTERNAL_TOOL_IDS = new Set(['brave-search', 'tavily', 'exa', 'github', 'firecrawl'])
