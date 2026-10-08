/**
 * The shipped composition: a Loader-booted `cordis.yml` where the shared
 * catalog and the pi-ai route that reads it are the only mocked boundary, and
 * the catalog endpoint and the provider endpoint are both local servers.
 *
 * The three facts under test are the ones a deployment cannot see from unit
 * tests: a real request is described and bounded by the catalog record, a
 * refused cap never reaches the provider, and a cold start with the catalog
 * unreachable still serves the last good generation from durable storage.
 */

import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader, { type ModuleLoaderV2 } from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as ModelCatalog from '../src/index.ts'
import { closeMockServers, mockServer, textEvents } from '../../llm-pi-ai/tests/mock-server.ts'

/** The catalog document the model catalog endpoint serves, keyed as models.dev keys it. */
const CATALOG = {
  models: {
    'deepseek/catalog-test-model': {
      id: 'deepseek/catalog-test-model',
      modalities: { input: ['text'] },
      limit: { context: 8_192, output: 512 },
      reasoning: true,
    },
  },
  providers: {
    deepseek: {
      id: 'deepseek',
      models: { 'catalog-test-model': { reasoning_options: [{ type: 'effort', values: ['low', 'high'] }] } },
    },
  },
}

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  await closeMockServers()
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/**
 * Boot one composition through the Loader, exactly as a profile's entry list
 * does: the same plugin names, the same config keys, and the same source
 * modules behind a resolver that refuses anything else.
 * @param catalogURL - where the shared catalog reads from.
 * @param providerURL - where the pi-ai route sends its requests.
 * @param storageRoot - durable root for the last-good snapshot.
 * @returns the booted root context.
 */
interface CoreModules {
  llm: unknown
  modelCatalog: unknown
  llmPiAi: unknown
}

async function boot(
  catalogURL: string,
  providerURL: string,
  storageRoot: string,
  route: {
    provider?: string
    model?: string
    models?: readonly string[]
    api?: string
    catalogOrder?: 'before-pi-ai' | 'after-pi-ai' | 'late'
  } = {},
  coreModules?: CoreModules,
): Promise<Context> {
  vi.stubEnv('PI_TEST_KEY', 'test-key')
  const root = await mkdtemp(join(tmpdir(), 'dsh-catalog-composition-'))
  roots.push(root)
  const configPath = join(root, 'cordis.yml')
  const catalogEntry = [
    '- id: model-catalog',
    "  name: '@deepseek-ai/dsh-model-catalog'",
    '  config:',
    `    catalogURL: ${catalogURL}`,
  ]
  const piAiEntry = [
    '- id: llm-pi-ai',
    "  name: '@deepseek-ai/dsh-llm-pi-ai'",
    '  config:',
    '    providers:',
    `      ${route.provider ?? 'deepseek'}:`,
    `        api: ${route.api ?? 'openai-completions'}`,
    '        apiKeyEnv: PI_TEST_KEY',
    `        baseURL: ${providerURL}`,
    '        models:',
    ...(route.models ?? [route.model ?? 'catalog-test-model']).flatMap(model => [
      `          - id: ${model}`,
      '            contextWindow: 1000000',
      '            maxTokens: 65536',
    ]),
  ]
  const catalogOrder = route.catalogOrder ?? 'before-pi-ai'
  await writeFile(configPath, [
    '- id: llm',
    "  name: '@deepseek-ai/dsh-llm'",
    '- id: storage',
    "  name: '@deepseek-ai/dsh-storage'",
    '- id: storage-json',
    "  name: '@deepseek-ai/dsh-storage-json'",
    '  config:',
    `    root: ${JSON.stringify(storageRoot)}`,
    '- id: storage-domain',
    "  name: '@deepseek-ai/dsh-storage-domain'",
    '  config:',
    '    backend: json',
    ...(catalogOrder === 'before-pi-ai' ? catalogEntry : []),
    ...piAiEntry,
    ...(catalogOrder === 'after-pi-ai' ? catalogEntry : []),
    '',
  ].join('\n'))

  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-llm', coreModules?.llm ?? LlmRuntime],
    ['@deepseek-ai/dsh-storage', Storage],
    ['@deepseek-ai/dsh-storage-json', StorageJson],
    ['@deepseek-ai/dsh-storage-domain', StorageDomain],
    ['@deepseek-ai/dsh-model-catalog', coreModules?.modelCatalog ?? ModelCatalog],
    ['@deepseek-ai/dsh-llm-pi-ai', coreModules?.llmPiAi ?? LlmPiAi],
  ])
  const internal: ModuleLoaderV2 = {
    version: 'v2',
    loadCache: new Map(),
    import: (specifier: string) => {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return Promise.resolve(modules.get(specifier))
    },
    register(): never { throw new Error('unexpected module hook registration') },
    getOrCreateModuleJob(): never { throw new Error('unexpected module job creation') },
    resolveSync(): never { throw new Error('unexpected synchronous module resolution') },
    load(): never { throw new Error('unexpected module load') },
  }
  ctx.loader.internal = internal
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  // An entry whose injections are still arriving has not mounted yet, so each
  // one is awaited the way a profile boot settles the whole entry list.
  for (const entry of ctx.loader.entries()) await entry.fiber?.await()
  return ctx
}

/** The shared catalog service, which the Loader mounts in its own scope. */
function catalogOf(ctx: Context) {
  const catalog = ctx.get('modelCatalog')
  if (catalog === undefined) throw new Error('expected the shared catalog service to be composed')
  return catalog
}

const builtLibraryTestEnabled = process.env.DSH_TEST_BUILT_CORE === '1'
const testDirectory = dirname(fileURLToPath(import.meta.url))
const builtLibraryPaths = {
  llm: join(testDirectory, '../../llm/lib/index.js'),
  modelCatalog: join(testDirectory, '../lib/index.js'),
  llmPiAi: join(testDirectory, '../../llm-pi-ai/lib/index.js'),
}

async function importBuiltLibrary(path: string): Promise<unknown> {
  if (!existsSync(path)) throw new Error(`built core composition requires ${path}`)
  const loaded: unknown = await import(pathToFileURL(path).href)
  return loaded
}

/**
 * Drive one request through the service the loop drives. An adapter failure
 * arrives as the stream protocol's terminal error chunk, which is how the loop
 * records a refused turn, so this surfaces it as a rejection like the adapter
 * boundary itself would.
 * @param ctx - the booted composition root.
 * @param options - the route and the request controls under test.
 * @returns the assembled visible text.
 * @throws the terminal failure the adapter reported.
 */
async function requestText(ctx: Context, options: {
  provider: string
  model: string
  maxTokens?: number
  reasoningEffort?: ReturnType<typeof ReasoningEffortId>
}): Promise<string> {
  const assembler = new (await import('@deepseek-ai/dsh-llm')).BlockAssembler()
  for await (const chunk of ctx.llm.stream({ messages: [], ...options })) {
    if (chunk.type === 'finish' && chunk.reason.kind === 'error') {
      throw new Error(chunk.reason.failure.message)
    }
    assembler.push(chunk)
  }
  return assembler.message({ provider: options.provider, model: options.model }).content
    .map(block => 'type' in block && block.type === 'text' ? block.text : '')
    .join('')
}

describe('shared model catalog in the shipped composition', () => {
  it.skipIf(!builtLibraryTestEnabled)('resolves live channel controls through built Llm, catalog and PiAI packages in Loader', async () => {
    const catalog = await mockServer([{
      body: JSON.stringify({
        models: {
          'minimax/MiniMax-M3': { id: 'minimax/MiniMax-M3', reasoning: true },
          'minimax/MiniMax-M2.7-highspeed': { id: 'minimax/MiniMax-M2.7-highspeed', reasoning: true },
          'minimax/MiniMax-M3.1-Flash-Preview': { id: 'minimax/MiniMax-M3.1-Flash-Preview', reasoning: true },
        },
        providers: {
          'minimax-cn': {
            api: 'https://api.minimax.cn/anthropic/v1',
            models: {
              'MiniMax-M3': { reasoning_options: [{ type: 'toggle' }] },
              'MiniMax-M2.7-highspeed': { reasoning_options: [] },
            },
          },
          'minimax-cn-coding-plan': {
            api: 'https://api.minimax.cn/anthropic/v1',
            models: { 'MiniMax-M3.1-Flash-Preview': {
              canonical_model_id: 'minimax/MiniMax-M3.1-Flash-Preview',
              reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high', 'xhigh', 'max'] }],
            } },
          },
        },
      }),
    }])
    const storageRoot = join(await mkdtemp(join(tmpdir(), 'dsh-built-catalog-storage-')), 'storages')
    roots.push(join(storageRoot, '..'))
    const coreModules: CoreModules = {
      llm: await importBuiltLibrary(builtLibraryPaths.llm),
      modelCatalog: await importBuiltLibrary(builtLibraryPaths.modelCatalog),
      llmPiAi: await importBuiltLibrary(builtLibraryPaths.llmPiAi),
    }
    const ctx = await boot(catalog.url, 'https://api.minimax.cn/v1', storageRoot, {
      provider: 'minimax-cn-custom',
      api: 'openai-responses',
      models: ['MiniMax-M3', 'MiniMax-M2.7-highspeed', 'MiniMax-M3.1-Flash-Preview'],
    }, coreModules)
    await catalogOf(ctx).refresh()

    await expect(ctx.llm.resolveModelInfo('minimax-cn-custom', 'MiniMax-M3')).resolves.toMatchObject({
      reasoning: { control: 'toggle', efforts: [{ id: 'off' }, { id: 'on' }] },
    })
    await expect(ctx.llm.resolveModelInfo('minimax-cn-custom', 'MiniMax-M3.1-Flash-Preview')).resolves.toMatchObject({
      reasoning: {
        control: 'effort',
        efforts: [{ id: 'low' }, { id: 'medium' }, { id: 'high' }, { id: 'xhigh' }, { id: 'max' }],
      },
    })
    expect((await ctx.llm.resolveModelInfo('minimax-cn-custom', 'MiniMax-M2.7-highspeed')).reasoning)
      .toBeUndefined()
  })

  it.skipIf(!builtLibraryTestEnabled)('PiAI observes a catalog mounted after its route', async () => {
    const catalog = await mockServer([{
      body: JSON.stringify({
        models: { 'minimax/MiniMax-M3': { id: 'minimax/MiniMax-M3', reasoning: true } },
        providers: {
          'minimax-cn': {
            api: 'https://api.minimax.cn/anthropic/v1',
            models: { 'MiniMax-M3': { reasoning_options: [{ type: 'toggle' }] } },
          },
        },
      }),
    }])
    const storageRoot = join(await mkdtemp(join(tmpdir(), 'dsh-built-late-catalog-storage-')), 'storages')
    roots.push(join(storageRoot, '..'))
    const coreModules: CoreModules = {
      llm: await importBuiltLibrary(builtLibraryPaths.llm),
      modelCatalog: await importBuiltLibrary(builtLibraryPaths.modelCatalog),
      llmPiAi: await importBuiltLibrary(builtLibraryPaths.llmPiAi),
    }
    const ctx = await boot(catalog.url, 'https://api.minimax.cn/v1', storageRoot, {
      provider: 'minimax-cn-custom',
      api: 'openai-responses',
      model: 'MiniMax-M3',
      catalogOrder: 'late',
    }, coreModules)

    expect(ctx.get('modelCatalog')).toBeUndefined()
    await expect(ctx.llm.resolveModelInfo('minimax-cn-custom', 'MiniMax-M3')).resolves.not.toMatchObject({
      reasoning: { control: 'toggle' },
    })

    const entryId = await ctx.loader.create({
      name: '@deepseek-ai/dsh-model-catalog',
      config: { catalogURL: catalog.url },
    })
    const entry = ctx.loader.resolve(entryId)
    await entry.fiber?.await()
    await catalogOf(ctx).refresh()

    await expect(ctx.llm.resolveModelInfo('minimax-cn-custom', 'MiniMax-M3')).resolves.toMatchObject({
      reasoning: { control: 'toggle', efforts: [{ id: 'off' }, { id: 'on' }] },
    })
  })

  it('describes and bounds a real request from the catalog record', async () => {
    const catalog = await mockServer([{ body: JSON.stringify(CATALOG) }])
    const provider = await mockServer([{ events: textEvents }])
    const storageRoot = join(await mkdtemp(join(tmpdir(), 'dsh-catalog-storage-')), 'storages')
    roots.push(join(storageRoot, '..'))
    const ctx = await boot(catalog.url, provider.url, storageRoot)
    await catalogOf(ctx).refresh()

    // The installed pi-ai entry claims a million tokens of context and
    // 65,536 of output; the shared record is the one a deployment reads, and
    // the route it names is the one the request is bounded by.
    await expect(ctx.llm.resolveModelInfo('deepseek', 'catalog-test-model')).resolves.toMatchObject({
      context: { contextWindow: 8_192 },
      inputModalities: ['text'],
      reasoning: {
        efforts: [
          { id: 'low', name: 'Low' },
          { id: 'high', name: 'High' },
        ],
      },
    })

    // A cap above what the record says the model produces is refused before
    // the provider is asked, so no request leaves the process at all.
    await expect(requestText(ctx, {
      provider: 'deepseek', model: 'catalog-test-model', maxTokens: 1_024,
    })).rejects.toThrow(/produces at most 512 output tokens/)
    expect(provider.paths).toEqual([])

    // A cap the model can answer reaches the configured route.
    expect(await requestText(ctx, {
      provider: 'deepseek', model: 'catalog-test-model', maxTokens: 512,
    })).toBe('hello')
    expect(provider.requests[0]).toMatchObject({ max_tokens: 512 })
  }, 30_000)

  it('recovers the last good facts from durable storage when the catalog is unreachable', async () => {
    // One URL throughout: the snapshot belongs to the URL it was collected
    // for, so an unreachable catalog is exercised by failing that same URL,
    // not by repointing the deployment at a different one.
    const catalogScript: { body?: string; status?: number }[] = [{ body: JSON.stringify(CATALOG) }]
    const first = await mockServer(catalogScript)
    const provider = await mockServer([])
    const storageRoot = join(await mkdtemp(join(tmpdir(), 'dsh-catalog-storage-')), 'storages')
    roots.push(join(storageRoot, '..'))
    const live = await boot(first.url, provider.url, storageRoot)
    const firstFacts = catalogOf(live)
    await firstFacts.refresh()
    await live.fiber.dispose()

    // The snapshot the refresh persisted is what a cold start reads; the
    // provider is never asked because nothing about the request changed.
    await expect(readdir(storageRoot)).resolves.toContain('model_catalog.json')
    catalogScript.push({ status: 503 })
    const second = await boot(first.url, provider.url, storageRoot)
    const recovered = catalogOf(second)

    expect(recovered.loaded).toBe(true)
    expect(recovered.facts.facts({ model: 'catalog-test-model', ownedBy: 'deepseek' })).toEqual({
      canonicalId: 'deepseek/catalog-test-model',
      inputModalities: ['text'],
      contextWindow: 8_192,
      maxOutputTokens: 512,
      reasoning: true,
      reasoningEfforts: ['low', 'high'],
      reasoningControl: { type: 'effort', efforts: ['low', 'high'] },
    })
    // The recovered generation is published before any request could have
    // been refused for want of facts.
    expect(recovered.facts.generation).toBeGreaterThan(0)
  }, 30_000)

  it('resolves custom-route toggle controls and serializes explicit On through Loader and LlmRuntime', async () => {
    const provider = await mockServer([{ status: 401, body: '{}' }, { status: 401, body: '{}' }, { status: 401, body: '{}' }])
    const catalog = await mockServer([{
      body: JSON.stringify({
        models: { 'minimax/MiniMax-M3': { id: 'minimax/MiniMax-M3', reasoning: true } },
        providers: {
          'minimax-cn': {
            api: provider.url,
            models: { 'MiniMax-M3': { reasoning_options: [{ type: 'toggle' }] } },
          },
        },
      }),
    }])
    const storageRoot = join(await mkdtemp(join(tmpdir(), 'dsh-catalog-toggle-storage-')), 'storages')
    roots.push(join(storageRoot, '..'))
    const ctx = await boot(catalog.url, provider.url, storageRoot, {
      provider: 'minimax-custom', model: 'MiniMax-M3', api: 'openai-responses',
    })
    await catalogOf(ctx).refresh()

    await expect(ctx.llm.resolveModelInfo('minimax-custom', 'MiniMax-M3')).resolves.toMatchObject({
      reasoning: {
        control: 'toggle',
        efforts: [{ id: 'off' }, { id: 'on' }],
      },
    })
    await expect(requestText(ctx, {
      provider: 'minimax-custom', model: 'MiniMax-M3',
    })).rejects.toThrow()
    await expect(requestText(ctx, {
      provider: 'minimax-custom', model: 'MiniMax-M3', reasoningEffort: ReasoningEffortId('on'),
    })).rejects.toThrow()
    await expect(requestText(ctx, {
      provider: 'minimax-custom', model: 'MiniMax-M3', reasoningEffort: ReasoningEffortId('off'),
    })).rejects.toThrow()

    expect(provider.requests).toHaveLength(3)
    const bodies = provider.requests as Record<string, unknown>[]
    expect(bodies[0]).not.toHaveProperty('reasoning')
    expect(bodies[1]).toMatchObject({ reasoning: { effort: 'high' } })
    expect(bodies[2]).toMatchObject({ reasoning: { effort: 'none' } })
  }, 30_000)
})
