import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as yaml from 'js-yaml'
import { Context } from '@deepseek-ai/cordis'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as ModelCatalogPiAi from '../src/index.ts'

let context: Context | undefined
let storageRoot: string | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (storageRoot !== undefined) await rm(storageRoot, { recursive: true, force: true })
  storageRoot = undefined
  vi.unstubAllGlobals()
})

async function mountRuntime(ctx: Context): Promise<void> {
  storageRoot = await mkdtemp(join(tmpdir(), 'dsh-model-catalog-'))
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: storageRoot })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(LlmRuntime)
}

describe('pi-ai model-discovery catalog', () => {
  it('uses exact owners or exact-id consensus and withdraws enrichment on disposal', async () => {
    const ctx = new Context()
    context = ctx
    await mountRuntime(ctx)
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      xai: { models: { 'grok-4.6': {
        modalities: { input: ['text', 'image', 'audio', 'video', 'pdf'] },
        limit: { context: 1_000_000, output: 131_072 },
      } } },
      gateway: { models: { 'grok-4.6': {
        modalities: { input: ['pdf', 'video', 'audio', 'image', 'text'] },
        limit: { context: 1_000_000, output: 131_072 },
      } } },
      zai: { models: { 'glm-5.3-flash': {
        modalities: { input: ['text', 'image', 'video', 'pdf'] },
        limit: { context: 1_000_000, output: 131_072 },
      } } },
      'zai-coding-plan': { models: { 'glm-5.3-flash': {
        modalities: { input: ['text', 'image', 'video', 'pdf'] },
        limit: { context: 1_000_000, output: 131_072 },
      } } },
    })))))
    ctx.llm.registerModelDiscovery('llm-example', () => Promise.resolve([
      { id: 'gpt-5.6-luna', ownedBy: 'custom' },
      { id: 'gpt-5.6-terra', ownedBy: 'openai' },
      { id: 'unknown-model', ownedBy: 'openai' },
      { id: 'gpt-5.6-sol' },
      { id: 'grok-4.6', ownedBy: 'custom' },
      { id: 'gpt-5.3-codex-spark', ownedBy: 'custom' },
      { id: 'glm-5.3-flash', ownedBy: 'zai-coding-cn' },
    ]))
    ctx.llm.registerModelDiscovery('llm-xai', () => Promise.resolve([
      { id: 'grok-4.6', ownedBy: 'xai' },
    ]))
    ctx.llm.registerModelDiscovery('llm-openai', () => Promise.resolve([
      { id: 'gpt-5.3-codex-spark', ownedBy: 'openai' },
    ]))
    ctx.llm.registerModelDiscovery('llm-codex', () => Promise.resolve([
      { id: 'gpt-5.3-codex-spark', ownedBy: 'openai-codex' },
    ]))
    ctx.llm.registerModelDiscovery('llm-explicit', () => Promise.resolve([
      { id: 'gpt-5.6-luna', ownedBy: 'custom', inputModalities: ['text'] },
    ]))
    const plugin = await ctx.plugin(ModelCatalogPiAi, { refreshIntervalMs: 60_000 })

    await expect(ctx.llm.discoverModels('llm-example', { provider: 'gateway' })).resolves.toEqual([
      { id: 'gpt-5.6-luna', ownedBy: 'custom', maxTokens: 128_000, inputModalities: ['text', 'image'] },
      {
        id: 'gpt-5.6-terra',
        ownedBy: 'openai',
        contextWindow: 272_000,
        maxTokens: 128_000,
        inputModalities: ['text', 'image'],
      },
      { id: 'unknown-model', ownedBy: 'openai' },
      { id: 'gpt-5.6-sol', maxTokens: 128_000, inputModalities: ['text', 'image'] },
      {
        id: 'grok-4.6',
        ownedBy: 'custom',
        contextWindow: 1_000_000,
        maxTokens: 131_072,
        inputModalities: ['text', 'image', 'audio', 'video', 'pdf'],
      },
      { id: 'gpt-5.3-codex-spark', ownedBy: 'custom', contextWindow: 128_000 },
      {
        id: 'glm-5.3-flash',
        ownedBy: 'zai-coding-cn',
        contextWindow: 1_000_000,
        maxTokens: 131_072,
        inputModalities: ['text', 'image', 'video', 'pdf'],
      },
    ])
    await expect(ctx.llm.discoverModels('llm-xai', { provider: 'gateway' })).resolves.toEqual([
      {
        id: 'grok-4.6',
        ownedBy: 'xai',
        contextWindow: 1_000_000,
        maxTokens: 131_072,
        inputModalities: ['text', 'image', 'audio', 'video', 'pdf'],
      },
    ])
    await expect(ctx.llm.discoverModels('llm-openai', { provider: 'gateway' })).resolves.toEqual([
      {
        id: 'gpt-5.3-codex-spark',
        ownedBy: 'openai',
        contextWindow: 128_000,
        maxTokens: 32_000,
        inputModalities: ['text', 'image'],
      },
    ])
    await expect(ctx.llm.discoverModels('llm-codex', { provider: 'gateway' })).resolves.toEqual([
      {
        id: 'gpt-5.3-codex-spark',
        ownedBy: 'openai-codex',
        contextWindow: 128_000,
        maxTokens: 128_000,
        inputModalities: ['text'],
      },
    ])
    await expect(ctx.llm.discoverModels('llm-explicit', { provider: 'gateway' })).resolves.toEqual([
      { id: 'gpt-5.6-luna', ownedBy: 'custom', maxTokens: 128_000, inputModalities: ['text'] },
    ])
    await expect(ctx.llm.resolveModelInput('gateway', 'grok-4.6'))
      .resolves.toEqual(['text', 'image', 'audio', 'video', 'pdf'])
    await expect(ctx.llm.resolveModelInput('openai-codex', 'gpt-5.3-codex-spark'))
      .resolves.toEqual(['text'])
    await expect(ctx.llm.resolveModelInput('gateway', 'unknown-model')).resolves.toBeUndefined()
    await expect(ctx.llm.resolveModelCapacity('zai-coding-cn', 'glm-5.3-flash'))
      .resolves.toEqual({ contextWindow: 1_000_000, maxOutputTokens: 131_072 })

    await plugin.dispose()
    await expect(ctx.llm.resolveModelInput('gateway', 'grok-4.6')).resolves.toBeUndefined()
    await expect(ctx.llm.discoverModels('llm-example', { provider: 'gateway' })).resolves.toEqual([
      { id: 'gpt-5.6-luna', ownedBy: 'custom' },
      { id: 'gpt-5.6-terra', ownedBy: 'openai' },
      { id: 'unknown-model', ownedBy: 'openai' },
      { id: 'gpt-5.6-sol' },
      { id: 'grok-4.6', ownedBy: 'custom' },
      { id: 'gpt-5.3-codex-spark', ownedBy: 'custom' },
      { id: 'glm-5.3-flash', ownedBy: 'zai-coding-cn' },
    ])
  })

  it('refreshes a legacy modality-only cache and persists capacity metadata', async () => {
    const ctx = new Context()
    context = ctx
    await mountRuntime(ctx)
    const cachePath = join(storageRoot!, 'model_catalog_pi_ai.json')
    await writeFile(cachePath, JSON.stringify({
      unit: { name: 'model_catalog_pi_ai', version: 0 },
      global: {
        checkedAt: Date.now(),
        declarations: [{ provider: 'zai', id: 'glm-5.3-flash', input: ['text'] }],
      },
      tables: {},
    }))
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      zai: { models: { 'glm-5.3-flash': {
        modalities: { input: ['text', 'image'] },
        limit: { context: 1_000_000, output: 131_072 },
      } } },
    }))))
    vi.stubGlobal('fetch', fetchMock)
    await ctx.plugin(ModelCatalogPiAi, { refreshIntervalMs: 60_000 })

    await expect(ctx.llm.resolveModelCapacity('zai-coding-cn', 'glm-5.3-flash'))
      .resolves.toEqual({ contextWindow: 1_000_000, maxOutputTokens: 131_072 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const persisted = JSON.parse(await readFile(cachePath, 'utf8')) as {
      global: { format?: number; providers?: unknown[]; declarations: unknown[] }
    }
    expect(persisted.global).toMatchObject({
      format: 2,
      providers: [{ id: 'zai' }],
      declarations: [{
        provider: 'zai',
        id: 'glm-5.3-flash',
        input: ['text', 'image'],
        contextWindow: 1_000_000,
        maxOutputTokens: 131_072,
      }],
    })
  })

  it('uses an exact provider endpoint when a route owner is only a local alias', async () => {
    const ctx = new Context()
    context = ctx
    await mountRuntime(ctx)
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      zai: {
        api: 'https://api.z.ai/api/paas/v4',
        models: { 'glm-5.3-flash': { limit: { context: 1_048_576, output: 131_072 } } },
      },
      'zhipuai-coding-plan': {
        api: 'https://open.bigmodel.cn/api/coding/paas/v4',
        models: { 'glm-5.3-flash': { limit: { context: 1_000_000, output: 131_072 } } },
      },
    })))))
    await ctx.plugin(ModelCatalogPiAi, { refreshIntervalMs: 60_000 })

    await expect(ctx.llm.resolveModelCapacity(
      'zai-coding-cn',
      'glm-5.3-flash',
      undefined,
      'zai-coding-cn',
      'https://open.bigmodel.cn/api/coding/paas/v4/',
    )).resolves.toEqual({ contextWindow: 1_000_000, maxOutputTokens: 131_072 })
  })

  it('normalizes partial metadata and rejects malformed catalog members', async () => {
    const ctx = new Context()
    context = ctx
    await mountRuntime(ctx)
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      ignoredNull: null,
      ignoredArray: [],
      missingModels: { api: 'invalid endpoint' },
      invalidModels: { models: [] },
      target: {
        api: 'https://catalog.example/v1/',
        models: {
          audio: { modalities: { input: ['audio'] } },
          context: { limit: { context: 4_096 } },
          output: { limit: { output: 512 } },
          unsupported: { modalities: { input: ['tool'] }, limit: { context: 0, output: -1 } },
          malformed: null,
          malformedArray: [],
        },
      },
      alternate: { models: {
        context: { limit: { context: 8_192 } },
        'alternate-only': { limit: { context: 16_384 } },
      } },
    })))))
    ctx.llm.registerModelDiscovery('llm-partial', () => Promise.resolve([
      { id: 'context', ownedBy: 'local-route' },
    ]))
    await ctx.plugin(ModelCatalogPiAi, {})

    await expect(ctx.llm.resolveModelInput('target', 'audio')).resolves.toEqual(['audio'])
    await expect(ctx.llm.resolveModelCapacity('target', 'audio')).resolves.toBeUndefined()
    await expect(ctx.llm.resolveModelCapacity('target', 'context'))
      .resolves.toEqual({ contextWindow: 4_096 })
    await expect(ctx.llm.resolveModelCapacity('target', 'output'))
      .resolves.toEqual({ maxOutputTokens: 512 })
    await expect(ctx.llm.resolveModelCapacity('target', 'unsupported')).resolves.toBeUndefined()
    await expect(ctx.llm.resolveModelCapacity(
      'local-route',
      'context',
      undefined,
      'local-route',
      'not a URL',
    )).resolves.toBeUndefined()
    await expect(ctx.llm.discoverModels('llm-partial', {
      provider: 'local-route',
      baseURL: 'https://catalog.example/v1',
    })).resolves.toEqual([
      { id: 'context', ownedBy: 'local-route', contextWindow: 4_096 },
    ])
    await expect(ctx.llm.resolveModelCapacity(
      'local-route',
      'alternate-only',
      undefined,
      'local-route',
      'https://catalog.example/v1',
    )).resolves.toEqual({ contextWindow: 16_384 })
  })

  it('reads partial declarations from a fresh format-two cache without provider metadata', async () => {
    const ctx = new Context()
    context = ctx
    await mountRuntime(ctx)
    await writeFile(join(storageRoot!, 'model_catalog_pi_ai.json'), JSON.stringify({
      unit: { name: 'model_catalog_pi_ai', version: 0 },
      global: {
        format: 2,
        checkedAt: Date.now(),
        declarations: [
          { provider: 'cached', id: 'context-only', contextWindow: 4_096 },
          { provider: 'cached', id: 'output-only', maxOutputTokens: 512 },
        ],
      },
      tables: {},
    }))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await ctx.plugin(ModelCatalogPiAi, { refreshIntervalMs: 60_000 })

    await expect(ctx.llm.resolveModelCapacity('cached', 'context-only'))
      .resolves.toEqual({ contextWindow: 4_096 })
    await expect(ctx.llm.resolveModelCapacity('cached', 'output-only'))
      .resolves.toEqual({ maxOutputTokens: 512 })
    await expect(ctx.llm.resolveModelCapacity(
      'local-route',
      'missing',
      undefined,
      'local-route',
      'https://catalog.example/v1',
    )).resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('applies implementation defaults when invoked without schema normalization', async () => {
    const ctx = new Context()
    context = ctx
    await mountRuntime(ctx)
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}'))))

    await ModelCatalogPiAi.apply(ctx, {})
    await expect(ctx.llm.resolveModelCapacity('unknown', 'unknown')).resolves.toBeUndefined()
  })

  it.each([
    ['an HTTP error', () => new Response('{}', { status: 503 })],
    ['a missing response body', () => new Response(null)],
    ['an oversized response', () => new Response('{}')],
    ['a non-object catalog', () => new Response('[]')],
  ])('retains the offline catalog after %s', async (_label, response) => {
    const ctx = new Context()
    context = ctx
    await mountRuntime(ctx)
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(response())))
    await ctx.plugin(ModelCatalogPiAi, {
      maxResponseBytes: _label === 'an oversized response' ? 1 : 1_024,
    })

    await expect(ctx.llm.resolveModelCapacity('openai', 'gpt-5.6-terra'))
      .resolves.toEqual({ contextWindow: 272_000, maxOutputTokens: 128_000 })
  })

  it('declares one parseable Profile Bundle patch', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    const parsed = yaml.load(
      readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'),
      { schema: entryListSchema },
    )
    expect(parsed).toEqual([{
      insert: [{
        id: 'model-catalog',
        name: '@deepseek-ai/dsh-model-catalog',
        config: {
          catalogURL: 'https://models.dev/api.json',
          refreshIntervalMs: 86_400_000,
          requestTimeoutMs: 15_000,
          maxResponseBytes: 8_388_608,
        },
      }],
    }])
  })
})
