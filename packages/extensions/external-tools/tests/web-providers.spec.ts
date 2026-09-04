import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import WebRuntime from '@deepseek-ai/dsh-web'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import * as externalTools from '../src/index.ts'
import {
  ExternalSearchProvider,
  TavilySearchProvider,
  mapBraveResponse,
  mapExaResponse,
  mapTavilyResponse,
} from '../src/providers.ts'

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

afterEach(() => { vi.unstubAllGlobals() })

class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}
  get writable(): boolean { return true }
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve(structuredClone(this.doc)) }
  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

describe('native external search adapters', () => {
  it('normalizes Tavily answer and citations', () => {
    expect(mapTavilyResponse({ answer: 'summary', results: [{ title: 'A', url: 'https://a.test', content: 'excerpt', published_date: '2026-09-04' }] })).toEqual({
      content: 'summary', sources: [{ title: 'A', url: 'https://a.test', snippet: 'excerpt', publishedAt: '2026-09-04' }], truncated: false,
    })
  })

  it('normalizes Brave and Exa result fields', () => {
    expect(mapBraveResponse({ web: { results: [{ title: 'A', url: 'https://a.test', description: 'excerpt', page_age: 'today' }] } })).toMatchObject({ sources: [{ title: 'A', url: 'https://a.test', snippet: 'excerpt', publishedAt: 'today' }] })
    expect(mapExaResponse({ results: [{ title: 'A', url: 'https://a.test', highlights: ['excerpt'], publishedDate: '2026-09-04' }] })).toMatchObject({ sources: [{ title: 'A', url: 'https://a.test', snippet: 'excerpt', publishedAt: '2026-09-04' }] })
  })

  it('sends Tavily requests with redirect rejection and the resolved key', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [{ url: 'https://a.test' }] }))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new TavilySearchProvider({ baseURL: 'https://api.tavily.test', resolveApiKey: async () => 'secret', isConfigured: () => true })
    await expect(provider.search({ query: 'weather', maxResults: 2 })).resolves.toMatchObject({ sources: [{ url: 'https://a.test' }] })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(String(url)).toBe('https://api.tavily.test/search')
    expect(init.redirect).toBe('error')
    expect(JSON.parse(init.body as string)).toMatchObject({ api_key: 'secret', query: 'weather', max_results: 2 })
  })

  it('does not advertise an unconfigured generic external provider', () => {
    const provider = new ExternalSearchProvider({ id: 'exa', baseURL: 'https://api.exa.test', resolveApiKey: async () => 'secret', isConfigured: () => false, request: async () => ({ results: [] }), mapResponse: mapExaResponse })
    expect(provider.available()).toBe(false)
  })

  it('selects the highest-priority configured native search provider', async () => {
    const previous = process.env.DSH_DESKTOP_SHELL
    process.env.DSH_DESKTOP_SHELL = '1'
    const ctx = new Context()
    const dir = await mkdtemp(join(tmpdir(), 'dsh-external-tools-'))
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => jsonResponse(String(input).includes('brave') ? { web: { results: [{ url: 'https://brave.test' }] } } : { results: [{ url: 'https://tavily.test' }] }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(WebRuntime)
      await ctx.plugin(ToolRuntime)
      await ctx.plugin(MemorySettings)
      await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
      expect(ctx.get('credentials')).toBeDefined()
      expect(ctx.get('settings')).toBeDefined()
      expect(ctx.get('web')).toBeDefined()
      ctx.web.registerSearchProvider({ id: 'deepseek-official', available: () => true, search: async () => ({ content: 'deepseek', sources: [], truncated: false }) })
      await ctx.plugin(externalTools, {})
      await ctx.credentials.set(credentialRef('TAVILY_API_KEY'), 'tavily-key')
      await new Promise(resolve => setTimeout(resolve, 50))
      await expect(ctx.web.search({ query: 'q' })).resolves.toMatchObject({ sources: [{ url: 'https://tavily.test' }] })
      await ctx.credentials.set(credentialRef('BRAVE_SEARCH_API_KEY'), 'brave-key')
      await ctx.settings.update(externalTools.EXTERNAL_TOOLS_SETTINGS_NAMESPACE, { searchPriority: ['brave-search', 'tavily', 'exa'] })
      await new Promise(resolve => setTimeout(resolve, 50))
      await expect(ctx.web.search({ query: 'q' })).resolves.toMatchObject({ sources: [{ url: 'https://brave.test' }] })
      await ctx.credentials.unset(credentialRef('BRAVE_SEARCH_API_KEY'))
      await ctx.credentials.unset(credentialRef('TAVILY_API_KEY'))
      await new Promise(resolve => setTimeout(resolve, 50))
      await expect(ctx.web.search({ query: 'q' })).resolves.toMatchObject({ content: 'deepseek' })
    } finally {
      await ctx.fiber.dispose()
      await rm(dir, { recursive: true, force: true })
      if (previous === undefined) delete process.env.DSH_DESKTOP_SHELL
      else process.env.DSH_DESKTOP_SHELL = previous
    }
  })
})
