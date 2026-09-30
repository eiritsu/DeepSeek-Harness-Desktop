/**
 * The catalog service: what one refresh publishes, what a failed refresh keeps,
 * what a cold start recovers from durable storage, and what the byte and
 * timeout bounds refuse.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
async function storageHarness(): Promise<Context> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-model-catalog-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin({ name: storageJsonName, inject: storageJsonInject, apply: storageJsonApply, Config: storageJsonConfig }, { root })
  await ctx.plugin({ name: storageDomainName, inject: storageDomainInject, apply: storageDomainApply, Config: storageDomainConfig }, { backend: 'json' })
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
            // A channel that declared no level accepts none, and stays that way
            // across a restart rather than regaining the transport's own list.
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

  it('serves a fresh snapshot without another request, and re-reads a stale one', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify(DOCUMENT))))
    vi.stubGlobal('fetch', fetchMock)
    const fresh = await harness({ refreshIntervalMs: 3_600_000 })
    // The mount reads the document once; every later caller shares that answer.
    await vi.waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(1) })
    await fresh.modelCatalog.refresh()
    await fresh.modelCatalog.refresh()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const stale = await harness({ refreshIntervalMs: 1 })
    await new Promise((resolve) => { setTimeout(resolve, 5) })
    await stale.modelCatalog.refresh()
    expect(fetchMock).toHaveBeenCalledTimes(2)
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
