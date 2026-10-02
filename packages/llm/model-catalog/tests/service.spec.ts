/**
 * The catalog service: what one refresh publishes, what a failed refresh keeps,
 * what a cold start recovers from durable storage, and what the byte and
 * timeout bounds refuse.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import {
  apply as storageJsonApply, Config as storageJsonConfig, inject as storageJsonInject, name as storageJsonName,
} from '@deepseek-ai/dsh-storage-json'
import {
  apply as storageDomainApply, Config as storageDomainConfig, inject as storageDomainInject, name as storageDomainName,
} from '@deepseek-ai/dsh-storage-domain'
import SharedModelCatalog from '../src/index.ts'
import type { Config } from '../src/config.ts'

const DOCUMENT = {
  models: {
    'acme/one': { id: 'acme/one', modalities: { input: ['text'] }, limit: { context: 4_096, output: 512 } },
  },
  providers: { acme: { id: 'acme', models: { one: { reasoning_options: [{ type: 'effort', values: ['low'] }] } } } },
}

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** A fresh durable root, mounted with the storage stack the plugin injects. */
async function storageHarness(root?: string): Promise<Context> {
  const storageRoot = root ?? await mkdtemp(join(tmpdir(), 'dsh-model-catalog-'))
  if (root === undefined) roots.push(storageRoot)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin({
    name: storageJsonName,
    inject: storageJsonInject,
    apply: storageJsonApply,
    Config: storageJsonConfig,
  }, { root: storageRoot })
  await ctx.plugin({
    name: storageDomainName,
    inject: storageDomainInject,
    apply: storageDomainApply,
    Config: storageDomainConfig,
  }, { backend: 'json' })
  return ctx
}

function respondWith(body: string, init: ResponseInit = {}): void {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(body, init))))
}

/** Mount the service over a durable root with the given configuration. */
async function harness(config: Partial<Config> = {}): Promise<Context> {
  const ctx = await storageHarness()
  await ctx.plugin(SharedModelCatalog, {
    catalogURL: 'https://example.test/catalog.json',
    // Long enough that the periodic timer never fires inside a test; the
    // refreshes below are the ones under test.
    refreshIntervalMs: 3_600_000,
    requestTimeoutMs: 1_000,
    maxResponseBytes: 65_536,
    ...config,
  })
  return ctx
}

describe('model catalog service', () => {
  it('publishes what one document says, under its own generation', async () => {
    respondWith(JSON.stringify(DOCUMENT))
    const ctx = await harness()

    await ctx.modelCatalog.refresh()

    expect(ctx.modelCatalog.loaded).toBe(true)
    expect(ctx.modelCatalog.facts.generation).toBeGreaterThan(0)
    expect(ctx.modelCatalog.facts.facts({ model: 'one', ownedBy: 'acme' })).toEqual({
      canonicalId: 'acme/one',
      inputModalities: ['text'],
      contextWindow: 4_096,
      maxOutputTokens: 512,
      reasoningEfforts: ['low'],
    })
  })

  it('keeps the last good facts when a later refresh fails, and recovers them after a restart', async () => {
    respondWith(JSON.stringify(DOCUMENT))
    const root = await mkdtemp(join(tmpdir(), 'dsh-model-catalog-'))
    roots.push(root)
    const mount = async (catalogURL = 'https://example.test/catalog.json'): Promise<Context> => {
      const ctx = new Context()
      contexts.push(ctx)
      await ctx.plugin(Storage)
      await ctx.plugin({ name: storageJsonName, inject: storageJsonInject, apply: storageJsonApply, Config: storageJsonConfig }, { root })
      await ctx.plugin({ name: storageDomainName, inject: storageDomainInject, apply: storageDomainApply, Config: storageDomainConfig }, { backend: 'json' })
      await ctx.plugin(SharedModelCatalog, { catalogURL, refreshIntervalMs: 3_600_000 })
      return ctx
    }
    const first = await mount()
    await first.modelCatalog.refresh()
    await first.fiber.dispose()

    // A cold start with no reachable catalog answers from durable storage.
    respondWith('', { status: 503 })
    const second = await mount()
    await vi.waitFor(() => { expect(second.modelCatalog.loaded).toBe(true) })
    expect(second.modelCatalog.facts.facts({ model: 'one', ownedBy: 'acme' })).toEqual({
      canonicalId: 'acme/one',
      inputModalities: ['text'],
      contextWindow: 4_096,
      maxOutputTokens: 512,
      reasoningEfforts: ['low'],
    })

    // A stored document belongs to the URL it was collected for, so a
    // deployment that points somewhere else starts with no facts at all
    // rather than with this one's.
    const failed = vi.fn(() => Promise.resolve(new Response('', { status: 503 })))
    vi.stubGlobal('fetch', failed)
    const third = await mount('https://other.test/catalog.json')
    await vi.waitFor(() => { expect(failed).toHaveBeenCalled() })
    expect(third.modelCatalog.loaded).toBe(false)
    expect(third.modelCatalog.facts.facts({ model: 'one' })).toBeUndefined()
  })

  it('recovers every channel of one provider from durable storage, not just the last', async () => {
    // Two models under one provider: the reload has to rebuild the provider
    // once with both of them, or the second declaration overwrites the first
    // and a model silently loses the levels its channel declared.
    const document = {
      models: {
        'acme/one': { id: 'acme/one', modalities: { input: ['text'] }, limit: { context: 4_096, output: 512 } },
        'acme/two': { id: 'acme/two', modalities: { input: ['text', 'image'] }, limit: { context: 8_192 } },
        'acme/quiet': { id: 'acme/quiet', modalities: { input: ['text'] } },
      },
      providers: {
        acme: {
          id: 'acme',
          models: {
            one: { reasoning_options: [{ type: 'effort', values: ['low'] }] },
            two: { reasoning_options: [{ type: 'effort', values: ['low', 'high', 'max'] }] },
            // Keep an explicit refusal across restarts.
            quiet: { reasoning: false },
          },
        },
      },
    }
    respondWith(JSON.stringify(document))
    const root = await mkdtemp(join(tmpdir(), 'dsh-model-catalog-'))
    roots.push(root)
    const mount = async (): Promise<Context> => {
      const ctx = new Context()
      contexts.push(ctx)
      await ctx.plugin(Storage)
      await ctx.plugin({ name: storageJsonName, inject: storageJsonInject, apply: storageJsonApply, Config: storageJsonConfig }, { root })
      await ctx.plugin({ name: storageDomainName, inject: storageDomainInject, apply: storageDomainApply, Config: storageDomainConfig }, { backend: 'json' })
      await ctx.plugin(SharedModelCatalog, { catalogURL: 'https://example.test/catalog.json', refreshIntervalMs: 3_600_000 })
      return ctx
    }
    const first = await mount()
    await first.modelCatalog.refresh()
    const live = (ctx: Context) => ({
      one: ctx.modelCatalog.facts.facts({ model: 'one', ownedBy: 'acme' }),
      two: ctx.modelCatalog.facts.facts({ model: 'two', ownedBy: 'acme' }),
      quiet: ctx.modelCatalog.facts.facts({ model: 'quiet', ownedBy: 'acme' }),
    })
    const before = live(first)
    await first.fiber.dispose()

    respondWith('', { status: 503 })
    const second = await mount()
    await vi.waitFor(() => { expect(second.modelCatalog.loaded).toBe(true) })
    expect(live(second)).toEqual(before)
    expect(before.two?.reasoningEfforts).toEqual(['low', 'high', 'max'])
    expect(before.one?.reasoningEfforts).toEqual(['low'])
    expect(before.quiet?.reasoningEfforts).toEqual([])
  })

  it('rejects a body over the byte limit and an unsuccessful response', async () => {
    respondWith(JSON.stringify({ ...DOCUMENT, pad: 'x'.repeat(200) }))
    const ctx = await harness({ maxResponseBytes: 128 })
    await ctx.modelCatalog.refresh()

    expect(ctx.modelCatalog.loaded).toBe(false)
    expect(ctx.modelCatalog.facts.facts({ model: 'one' })).toBeUndefined()
  })

  it('revalidates during mount and only re-reads after the configured interval', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify(DOCUMENT))))
    vi.stubGlobal('fetch', fetchMock)
    const fresh = await harness({ refreshIntervalMs: 3_600_000 })
    // The mount reads the document once; later fresh callers share that answer.
    await vi.waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(1) })
    await fresh.modelCatalog.refresh()
    await fresh.modelCatalog.refresh()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const stale = await harness({ refreshIntervalMs: 3_600_000 })
    await stale.modelCatalog.refresh()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const originalNow = Date.now()
    vi.setSystemTime(originalNow + 3_600_001)
    try {
      await stale.modelCatalog.refresh()
    } finally {
      vi.setSystemTime(originalNow)
    }
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('publishes a typed update event for each accepted generation and shares concurrent reads', async () => {
    let finish!: (response: Response) => void
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve }))
    vi.stubGlobal('fetch', fetcher)
    const ctx = await storageHarness()
    const updates: number[] = []
    ctx.on('model-catalog/updated', ({ generation }) => { updates.push(generation) })
    await ctx.plugin(SharedModelCatalog, {
      catalogURL: 'https://example.test/catalog.json', refreshIntervalMs: 3_600_000,
    })

    const pending = [ctx.modelCatalog.refresh(), ctx.modelCatalog.refresh()]
    expect(fetcher).toHaveBeenCalledTimes(1)
    finish(new Response(JSON.stringify(DOCUMENT)))
    await Promise.all(pending)

    expect(updates).toEqual([1])
    expect(ctx.modelCatalog.facts.generation).toBe(1)
  })

  it('aborts an in-flight periodic read during disposal without rearming its timer', async () => {
    vi.useFakeTimers()
    let periodicSignal: AbortSignal | undefined
    let periodicStarted!: () => void
    const started = new Promise<void>((resolve) => { periodicStarted = resolve })
    const fetcher = vi.fn((_input: string | URL, init?: RequestInit): Promise<Response> => {
      if (fetcher.mock.calls.length === 1) return Promise.resolve(new Response(JSON.stringify(DOCUMENT)))
      periodicSignal = init?.signal ?? undefined
      periodicStarted()
      return new Promise((_resolve, reject) => {
        periodicSignal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        }, { once: true })
      })
    })
    try {
      vi.stubGlobal('fetch', fetcher)
      const ctx = await storageHarness()
      const catalogFiber = ctx.plugin(SharedModelCatalog, {
        catalogURL: 'https://example.test/catalog.json', refreshIntervalMs: 25,
      })
      await catalogFiber
      await ctx.modelCatalog.refresh()
      await vi.advanceTimersByTimeAsync(25)
      await started

      await expect(catalogFiber.dispose()).resolves.toBeUndefined()
      await vi.advanceTimersByTimeAsync(25)

      expect(periodicSignal?.aborted).toBe(true)
      expect(fetcher).toHaveBeenCalledTimes(2)
      const reopened = await ctx.storageDomain.open(defineDomain({
        name: 'model_catalog',
        version: 1,
        global: {
          schema: z.object({
            catalogURL: z.string(),
            checkedAt: z.number(),
            models: z.array(z.unknown()),
            channels: z.array(z.unknown()),
          }),
          initial: { catalogURL: '', checkedAt: 0, models: [], channels: [] },
        },
        tables: {},
      }))
      await reopened.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it('loads an existing version 1 durable cache with its original schema', async () => {
    const ctx = await storageHarness()
    const oldDomain = defineDomain({
      name: 'model_catalog',
      version: 1,
      global: {
        schema: z.object({
          catalogURL: z.string(),
          checkedAt: z.number(),
          models: z.array(z.object({
            id: z.string(),
            modalities: z.object({ input: z.array(z.enum(['text', 'image'])).optional() }).optional(),
            limit: z.object({ context: z.number().int().positive().optional(), output: z.number().int().positive().optional() }).optional(),
            reasoning: z.boolean().optional(),
          })),
          channels: z.array(z.object({ namespace: z.string(), model: z.string(), efforts: z.array(z.string()) })),
        }),
        initial: { catalogURL: '', checkedAt: 0, models: [], channels: [] },
      },
      tables: {},
    })
    const old = await ctx.storageDomain.open(oldDomain)
    await old.global.set({
      catalogURL: 'https://example.test/catalog.json',
      checkedAt: Date.now(),
      models: [{ id: 'acme/one', limit: { context: 8_192 } }],
      channels: [{ namespace: 'acme', model: 'one', efforts: ['low'] }],
    })
    await old.close()
    respondWith('', { status: 503 })

    await ctx.plugin(SharedModelCatalog, {
      catalogURL: 'https://example.test/catalog.json', refreshIntervalMs: 3_600_000,
    })
    await vi.waitFor(() => { expect(ctx.modelCatalog.loaded).toBe(true) })

    expect(ctx.modelCatalog.facts.facts({ model: 'one' })).toMatchObject({
      canonicalId: 'acme/one',
      contextWindow: 8_192,
      reasoningEfforts: ['low'],
    })
  })

  it('publishes a fresh cache before a network update and persists canonical channel aliases', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-model-catalog-revalidate-'))
    roots.push(root)
    const first = await storageHarness(root)
    respondWith(JSON.stringify({
      models: { 'deepseek/deepseek-v4.1-flash': { id: 'deepseek/deepseek-v4.1-flash', limit: { context: 1_000_000 } } },
      providers: { chiyun: { id: 'chiyun', models: {
        'deepseek-flash': {
          canonical_model_id: 'deepseek/deepseek-v4.1-flash',
          reasoning_options: [{ type: 'effort', values: ['low', 'max'] }],
        },
      } } },
    }))
    await first.plugin(SharedModelCatalog, {
      catalogURL: 'https://example.test/catalog.json', refreshIntervalMs: 3_600_000,
    })
    await first.modelCatalog.refresh()
    await first.fiber.dispose()

    const second = await storageHarness(root)
    contexts.push(second)
    const updates: number[] = []
    second.on('model-catalog/updated', ({ generation }) => { updates.push(generation) })
    const updated = {
      models: { 'deepseek/deepseek-v4.1-flash': { id: 'deepseek/deepseek-v4.1-flash', limit: { context: 2_000_000 } } },
      providers: { chiyun: { id: 'chiyun', models: {
        'deepseek-flash': {
          canonical_model_id: 'deepseek/deepseek-v4.1-flash',
          reasoning_options: [{ type: 'effort', values: ['low', 'high'] }],
        },
      } } },
    }
    let finish!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { finish = resolve })))
    await second.plugin(SharedModelCatalog, {
      catalogURL: 'https://example.test/catalog.json', refreshIntervalMs: 3_600_000,
    })
    const cached = second.modelCatalog.facts.facts({ model: 'deepseek-flash', ownedBy: 'chiyun' })
    expect(cached?.reasoningEfforts).toEqual(['low', 'max'])
    const refresh = second.modelCatalog.refresh()
    finish(new Response(JSON.stringify(updated)))
    await refresh

    expect(second.modelCatalog.facts.facts({ model: 'deepseek-flash', ownedBy: 'chiyun' })).toMatchObject({
      contextWindow: 2_000_000,
      reasoningEfforts: ['low', 'high'],
    })
    expect(updates).toEqual([1, 2])
  })

  it('fails loud at mount on a mapping set that cannot address one model', async () => {
    respondWith(JSON.stringify(DOCUMENT))
    const ctx = await storageHarness()

    await expect(ctx.plugin(SharedModelCatalog, {
      catalogURL: 'https://example.test/catalog.json',
      aliases: [{ modelId: 'one', canonicalId: 'unqualified' }],
    })).rejects.toThrow(/qualified canonicalId/)
  })

  it('reports an already-aborted caller and keeps the catalog loaded for the rest', async () => {
    respondWith(JSON.stringify(DOCUMENT))
    const ctx = await harness()
    await ctx.modelCatalog.refresh()

    await expect(ctx.modelCatalog.refresh(AbortSignal.abort())).rejects.toThrow()
    expect(ctx.modelCatalog.loaded).toBe(true)
  })
})
