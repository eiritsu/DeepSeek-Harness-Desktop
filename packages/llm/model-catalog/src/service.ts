/**
 * The shared model catalog (`ctx.modelCatalog`): one startup revalidation and
 * periodic reads of an external document, the last-good snapshot every read
 * is answered from, and the immutable generation a consumer pins while it works.
 *
 * Refresh is best-effort in both directions. A failed request leaves the
 * published view exactly as it was, so a deployment that starts offline
 * answers from its durable last-good cache and one whose catalog is briefly
 * unreachable keeps serving the facts it had rather than degrading every model
 * to "unknown". A document that parses to nothing is rejected outright rather
 * than published, so a truncated or reshaped response can never replace good
 * facts with none.
 *
 * The durable copy exists so a cold start with no reachable catalog still has
 * facts. It is a cache, never an authority: the first successful refresh
 * replaces it, and a stored document naming another URL is discarded rather
 * than read under configuration it was not collected for.
 *
 * @module @deepseek-ai/dsh-model-catalog/src/service
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import type { DomainGlobal } from '@deepseek-ai/dsh-storage-domain'
import { Config, resolveConfig } from './config.ts'
import type { ResolvedConfig } from './config.ts'
import { EMPTY_FACTS } from './facts.ts'
import type { ModelFactsView } from './facts.ts'
import { parseCatalogDocument } from './parse.ts'
import { CatalogView, validateAliases } from './resolve.ts'
import type { CatalogAlias } from './resolve.ts'

const modality = z.enum(['text', 'image'])

/** One durable snapshot, in the same terms the parser reads. */
const cacheSchema = z.object({
  catalogURL: z.string().min(1),
  checkedAt: z.number().int().nonnegative(),
  models: z.array(z.object({
    id: z.string().min(1),
    modalities: z.object({ input: z.array(modality).optional() }).optional(),
    limit: z.object({
      context: z.number().int().positive().optional(),
      output: z.number().int().positive().optional(),
    }).optional(),
    reasoning: z.boolean().optional(),
  })),
  channels: z.array(z.object({
    namespace: z.string().min(1),
    model: z.string().min(1),
    canonicalId: z.string().min(1).optional(),
    efforts: z.array(z.string().min(1)).optional(),
    reasoningControl: z.enum(['none', 'toggle', 'effort']).optional(),
    toggle: z.boolean().optional(),
    budget: z.boolean().optional(),
    // models.dev publishes environment templates such as
    // `${NEON_AI_GATEWAY_BASE_URL}/v1`; keep them in the cache verbatim. The
    // resolver validates HTTP(S) URLs before using endpoint identity.
    apiURL: z.string().min(1).optional(),
  })),
})
type Cache = z.infer<typeof cacheSchema>

const modelCatalogDomain = defineDomain({
  name: 'model_catalog',
  version: 1,
  global: {
    schema: cacheSchema,
    initial: { catalogURL: '', checkedAt: 0, models: [], channels: [] },
  },
  tables: {},
})

/** Message of any thrown value, for a log line that must not itself throw. */
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Read one response body under a byte limit. The limit is enforced while the
 * body streams, so an oversized or endless response is abandoned at the limit
 * rather than after buffering whatever it chose to send.
 * @param response - the fetch response to read.
 * @param limit - largest body accepted, in bytes.
 * @returns the decoded JSON value.
 * @throws when the response is not ok, carries no body, exceeds the limit, or
 *   is not JSON.
 */
async function readBoundedJson(response: Response, limit: number): Promise<unknown> {
  if (!response.ok) throw new Error(`the model catalog returned HTTP ${response.status}`)
  const reader = response.body?.getReader()
  if (reader === undefined) throw new Error('the model catalog returned no response body')
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const next = await reader.read()
    if (next.done) break
    size += next.value.byteLength
    if (size > limit) {
      await reader.cancel()
      throw new Error(`the model catalog response exceeded ${limit} bytes`)
    }
    chunks.push(next.value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  const decoded: unknown = JSON.parse(new TextDecoder().decode(bytes))
  return decoded
}

/** Rebuild a stored snapshot as the document shape the parser reads. */
function documentOf(cache: Cache): unknown {
  // The models each namespace recorded, collected before the provider entries
  // are built: one entry per channel would let every model of a provider
  // overwrite the levels its siblings declared.
  const modelsByNamespace = new Map<string, Record<string, unknown>>()
  for (const channel of cache.channels) {
    const models = modelsByNamespace.get(channel.namespace) ?? {}
    // An empty level list reloads as an empty declaration, which is the same
    // refusal the live document produced: a channel that declared no level
    // stays a channel that accepts none.
    const control = channel.reasoningControl
      ?? (channel.efforts === undefined ? undefined : channel.efforts.length === 0 ? 'none' : 'effort')
    const reasoningOptions = [
      ...(control === 'toggle' || channel.toggle === true ? [{ type: 'toggle' }] : []),
      ...(channel.budget === true ? [{ type: 'budget' }] : []),
      ...(control === 'effort' && channel.efforts !== undefined
        ? [{ type: 'effort', values: [...channel.efforts] }]
        : []),
    ]
    models[channel.model] = {
      ...(channel.canonicalId === undefined ? {} : { canonical_model_id: channel.canonicalId }),
      ...(control === undefined
        ? {}
        : { reasoning_options: control === 'none' ? [] : reasoningOptions }),
    }
    modelsByNamespace.set(channel.namespace, models)
  }
  return {
    models: Object.fromEntries(cache.models.map(model => [model.id, model])),
    providers: Object.fromEntries(
      [...modelsByNamespace].map(([namespace, models]) => [namespace, {
        id: namespace,
        models,
        api: cache.channels.find(channel => channel.namespace === namespace)?.apiURL,
      }]),
    ),
  }
}

/** Project a parsed document onto the fields the durable snapshot keeps. */
function cacheOf(catalog: ReturnType<typeof parseCatalogDocument>, catalogURL: string, checkedAt: number): Cache {
  return {
    catalogURL,
    checkedAt,
    models: catalog.canonical.map(model => ({
      id: model.id,
      ...model.input === undefined ? {} : { modalities: { input: [...model.input] } },
      ...model.contextWindow === undefined && model.maxOutputTokens === undefined
        ? {}
        : {
          limit: {
            ...model.contextWindow === undefined ? {} : { context: model.contextWindow },
            ...model.maxOutputTokens === undefined ? {} : { output: model.maxOutputTokens },
          },
        },
      ...model.reasoning === undefined ? {} : { reasoning: model.reasoning },
    })),
    // Canonical links persist even when a provider entry declares no efforts.
    channels: catalog.channels.map(channel => ({
      namespace: channel.namespace,
      model: channel.model,
      ...channel.canonicalId === undefined ? {} : { canonicalId: channel.canonicalId },
      ...channel.efforts === undefined ? {} : { efforts: [...channel.efforts] },
      ...channel.reasoningControl === undefined ? {} : { reasoningControl: channel.reasoningControl },
      ...channel.toggle === undefined ? {} : { toggle: channel.toggle },
      ...channel.budget === undefined ? {} : { budget: channel.budget },
      ...channel.apiURL === undefined ? {} : { apiURL: channel.apiURL },
    })),
  }
}

/**
 * The shared model catalog service: one published generation of canonical
 * per-model facts, read on an interval and recovered from durable storage.
 *
 * Reads are synchronous from the published view; only {@link refresh} awaits.
 * The view is replaced whole on every accepted document, so a consumer that
 * captured one keeps reading the generation it captured.
 */
export class SharedModelCatalog extends Service {
  static inject = ['storageDomain']

  static Config = Config

  private config!: ResolvedConfig
  private view: ModelFactsView = EMPTY_FACTS
  private generation = 0
  private checkedAt = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private inFlight: Promise<void> | undefined
  private readonly abortController = new AbortController()
  private stored?: DomainGlobal<Cache>

  constructor(ctx: Context, config: Config) {
    super(ctx, 'modelCatalog')
    this.config = resolveConfig(config)
  }

  /**
   * The published generation. A consumer compares the view's identity, not the
   * number, to notice that a refresh landed between two of its operations: the
   * object is replaced wholesale and never mutated.
   */
  get facts(): ModelFactsView {
    return this.view
  }

  /** Whether a document has been published, from the network or the durable cache. */
  get loaded(): boolean {
    return this.checkedAt > 0
  }

  /** Validate the configuration, publish the durable cache, and start refreshing. */
  protected async [Service.init](): Promise<void> {
    validateAliases(this.config.aliases)
    const domain = await this.ctx.storageDomain.open(modelCatalogDomain)
    this.stored = domain.global
    // A stored document collected for another URL describes a catalog this
    // deployment is not configured to read; keeping it would answer with
    // another deployment's facts.
    const cached = this.stored.get()
    if (cached.catalogURL === this.config.catalogURL && cached.models.length > 0) {
      const parsed = parseCatalogDocument(documentOf(cached))
      this.checkedAt = cached.checkedAt
      this.publish(parsed)
    }
    this.ctx.effect(() => async () => {
      this.clearTimer()
      this.abortController.abort()
      try {
        // Shutdown owns this canceled read; refreshNow already reports its failure.
        await this.inFlight?.catch((_readError: unknown) => undefined)
      } finally {
        await domain.close()
      }
    }, 'modelCatalog.shutdown')
    this.schedule()
    // The first read must not hold plugin load open: an unreachable catalog
    // is an ordinary condition, and the durable cache above is the answer.
    void this.refreshNow()
  }

  /**
   * Wait for an active read or re-read a stale catalog snapshot.
   *
   * A failed request is reported and swallowed: the last-good view stays
   * published, so an unreachable catalog costs freshness and nothing else.
   * Concurrent callers share one request.
   * @param signal - optional cancellation for this caller.
   * @returns resolution once the snapshot is fresh, or once the attempt failed.
   * @throws the caller's own abort, and nothing else.
   */
  async refresh(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    if (this.inFlight !== undefined || !this.fresh()) await this.refreshNow()
    signal?.throwIfAborted()
  }

  /** Start or join a catalog read, including an unconditional startup revalidation. */
  private async refreshNow(): Promise<void> {
    this.inFlight ??= this.readAndPublish().finally(() => { this.inFlight = undefined })
    try {
      await this.inFlight
    } catch (error) {
      this.ctx.logger.warn(`model catalog: refresh failed, keeping the last good facts: ${message(error)}`)
    }
  }

  /** Whether the last accepted catalog document is still within its refresh interval. */
  private fresh(): boolean {
    return this.checkedAt > 0 && Date.now() - this.checkedAt < this.config.refreshIntervalMs
  }

  /** Arm the next periodic attempt, replacing any armed one. */
  private schedule(): void {
    this.clearTimer()
    if (this.abortController.signal.aborted) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.refreshNow()
        .catch((error: unknown) => { this.ctx.logger.warn(`model catalog: refresh failed: ${message(error)}`) })
        .finally(() => { if (!this.abortController.signal.aborted) this.schedule() })
    }, this.config.refreshIntervalMs)
    // The catalog is background work: a process that exits on its own must not
    // be held open by a poll that has not come due.
    this.timer.unref()
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  /**
   * Fetch, parse, publish, and persist one document. A persistence failure is
   * reported on its own: the facts are already published, so the next cold
   * start is the only thing that loses.
   */
  private async readAndPublish(): Promise<void> {
    const response = await fetch(this.config.catalogURL, {
      signal: AbortSignal.any([
        AbortSignal.timeout(this.config.requestTimeoutMs),
        this.abortController.signal,
      ]),
      headers: { accept: 'application/json' },
    })
    const catalog = parseCatalogDocument(await readBoundedJson(response, this.config.maxResponseBytes))
    this.checkedAt = Date.now()
    this.publish(catalog)
    try {
      await this.stored?.set(cacheOf(catalog, this.config.catalogURL, this.checkedAt))
    } catch (error) {
      this.ctx.logger.warn(`model catalog: could not persist the last good facts: ${message(error)}`)
    }
  }

  /** Publish one parsed document as the next generation. */
  private publish(catalog: ReturnType<typeof parseCatalogDocument>): void {
    this.generation += 1
    this.view = new CatalogView(this.generation, catalog, this.config.aliases)
    this.ctx.emit('model-catalog/updated', { generation: this.generation })
  }
}

export type { CatalogAlias }
