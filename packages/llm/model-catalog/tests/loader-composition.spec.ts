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
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader, { type ModuleLoaderV2 } from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as ModelCatalog from '../src/index.ts'
import { closeMockServers, mockServer, textEvents } from '../../llm-pi-ai/tests/mock-server.ts'

/** The catalog document the model catalog endpoint serves, keyed as models.dev keys it. */
const CATALOG = {
  models: {
    'deepseek/deepseek-v4-flash': {
      id: 'deepseek/deepseek-v4-flash',
      modalities: { input: ['text'] },
      limit: { context: 4_096, output: 512 },
      reasoning: true,
    },
  },
  providers: {
    deepseek: {
      id: 'deepseek',
      models: { 'deepseek-v4-flash': { reasoning_options: [{ type: 'effort', values: ['low', 'high'] }] } },
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
async function boot(catalogURL: string, providerURL: string, storageRoot: string): Promise<Context> {
  vi.stubEnv('PI_TEST_KEY', 'test-key')
  const root = await mkdtemp(join(tmpdir(), 'dsh-catalog-composition-'))
  roots.push(root)
  const configPath = join(root, 'cordis.yml')
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
    '- id: model-catalog',
    "  name: '@deepseek-ai/dsh-model-catalog'",
    '  config:',
    `    catalogURL: ${catalogURL}`,
    '- id: llm-pi-ai',
    "  name: '@deepseek-ai/dsh-llm-pi-ai'",
    '  config:',
    '    providers:',
    '      deepseek:',
    '        apiKeyEnv: PI_TEST_KEY',
    `        baseURL: ${providerURL}`,
    '',
  ].join('\n'))

  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-llm', LlmRuntime],
    ['@deepseek-ai/dsh-storage', Storage],
    ['@deepseek-ai/dsh-storage-json', StorageJson],
    ['@deepseek-ai/dsh-storage-domain', StorageDomain],
    ['@deepseek-ai/dsh-model-catalog', ModelCatalog],
    ['@deepseek-ai/dsh-llm-pi-ai', LlmPiAi],
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
    await expect(ctx.llm.resolveModelInfo('deepseek', 'deepseek-v4-flash')).resolves.toMatchObject({
      context: { contextWindow: 4_096 },
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
      provider: 'deepseek', model: 'deepseek-v4-flash', maxTokens: 1_024,
    })).rejects.toThrow(/produces at most 512 output tokens/)
    expect(provider.paths).toEqual([])

    // A cap the model can answer is sent, carrying the deployment's own budget.
    expect(await requestText(ctx, {
      provider: 'deepseek', model: 'deepseek-v4-flash', maxTokens: 512,
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
    expect(recovered.facts.facts({ model: 'deepseek-v4-flash', ownedBy: 'deepseek' })).toEqual({
      canonicalId: 'deepseek/deepseek-v4-flash',
      inputModalities: ['text'],
      contextWindow: 4_096,
      maxOutputTokens: 512,
      reasoning: true,
      reasoningEfforts: ['low', 'high'],
    })
    // The recovered generation is published before any request could have
    // been refused for want of facts.
    expect(recovered.facts.generation).toBeGreaterThan(0)
  }, 30_000)
})
