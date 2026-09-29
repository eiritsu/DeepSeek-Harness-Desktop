/**
 * Resolution of a route-local model id onto one canonical record, and the
 * immutable view that publishes the result for a whole generation.
 *
 * Three ways in, in precedence order: an explicit mapping, an exact qualified
 * `owner/model` id, and a bare basename. Every one of them refuses rather than
 * guesses — a basename two providers publish, or a mapping two configurations
 * claim, resolves to nothing rather than to whichever entry was parsed first.
 *
 * @module @deepseek-ai/dsh-model-catalog/src/resolve
 */

import type { ModelFacts, ModelFactsRequest, ModelFactsView } from './facts.ts'
import type { CanonicalRecord, ParsedCatalog } from './parse.ts'

/** One configured route-local model id mapped onto a canonical catalog id. */
export interface CatalogAlias {
  /** Upstream owner this mapping belongs to; absent matches any owner. */
  readonly ownedBy?: string
  /** Model id the serving route uses. */
  readonly modelId: string
  /** Qualified `owner/model` identifier the catalog must carry. */
  readonly canonicalId: string
}

/** Key one channel's vocabulary is stored under; NUL cannot occur in a catalog id. */
function channelKey(namespace: string, model: string): string {
  return `${namespace.toLowerCase()}\u0000${model.toLowerCase()}`
}

/** Ids compare case-insensitively: providers are inconsistent about casing. */
function sameId(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase()
}

/** The part of a qualified id after its owner. */
function basenameOf(qualified: string): string {
  return qualified.slice(qualified.indexOf('/') + 1)
}

/** One immutable generation: the parsed records plus the mappings that select them. */
export class CatalogView implements ModelFactsView {
  /** Canonical records by lowercased qualified id. */
  private readonly byId: ReadonlyMap<string, CanonicalRecord>
  /** Canonical records by lowercased basename; a key holds a record only when the basename is unique. */
  private readonly byBasename: ReadonlyMap<string, CanonicalRecord | undefined>
  /** Channel vocabularies by channel key. */
  private readonly channelByModel: ReadonlyMap<string, readonly string[]>
  /** Configured mappings, in the order the deployment declared them. */
  private readonly aliases: readonly CatalogAlias[]

  /**
   * @param generation - the monotonic generation these records are published under.
   * @param catalog - the parsed document this generation was built from.
   * @param aliases - the configured route-local to canonical mappings.
   */
  constructor(
    readonly generation: number,
    catalog: ParsedCatalog,
    aliases: readonly CatalogAlias[],
  ) {
    const byId = new Map<string, CanonicalRecord>()
    const candidates = new Map<string, CanonicalRecord | null>()
    for (const model of catalog.canonical) {
      byId.set(model.id.toLowerCase(), model)
      const base = basenameOf(model.id).toLowerCase()
      // `null` marks a basename more than one owner publishes. The ambiguity
      // is remembered so a later record cannot accidentally resolve it.
      candidates.set(base, candidates.has(base) ? null : model)
    }
    this.byId = byId
    this.byBasename = new Map([...candidates].map(([key, value]) => [key, value ?? undefined]))
    const channels = new Map<string, readonly string[]>()
    for (const channel of catalog.channels) {
      // First entry wins: two channel keys differing only in case are one
      // channel as far as addressing is concerned, and taking the first keeps
      // the answer independent of the document's property order.
      const key = channelKey(channel.namespace, channel.model)
      if (!channels.has(key)) channels.set(key, channel.efforts)
    }
    this.channelByModel = channels
    this.aliases = aliases
  }

  /**
   * @param request - the model id and the owner that disambiguates it.
   * @returns the record, or undefined when the catalog has none, when a bare
   *   id matches several canonical basenames, or when a configured mapping
   *   names a canonical id this generation does not carry.
   */
  facts(request: ModelFactsRequest): ModelFacts | undefined {
    const model = this.resolveModel(request)
    if (model === undefined) return undefined
    const owner = model.id.slice(0, model.id.indexOf('/'))
    const efforts = this.channelByModel.get(channelKey(owner, basenameOf(model.id)))
    return {
      canonicalId: model.id,
      ...model.input === undefined ? {} : { inputModalities: model.input },
      ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
      ...model.maxOutputTokens === undefined ? {} : { maxOutputTokens: model.maxOutputTokens },
      ...model.reasoning === undefined ? {} : { reasoning: model.reasoning },
      // A canonical record that denies reasoning denies it through every
      // channel, even where the channel entry says nothing.
      ...efforts === undefined && model.reasoning !== false
        ? {}
        : { reasoningEfforts: efforts ?? [] },
    }
  }

  /**
   * The one canonical record a request names, or undefined when it names
   * none or names more than one.
   * @param request - the model id and the owner that disambiguates it.
   * @returns the matched record.
   */
  private resolveModel(request: ModelFactsRequest): CanonicalRecord | undefined {
    const mapped = this.aliases.filter(alias => sameId(alias.modelId, request.model))
    // A mapping that applies decides the answer, including when it decides
    // there is none: falling through would answer a question the deployment
    // already answered with an id this generation does not carry.
    if (mapped.length > 0) return this.select(mapped, request)
    // A qualified id is addressed exactly. Matching its basename instead
    // would answer with a different model that happens to share the name.
    if (request.model.includes('/')) return this.byId.get(request.model.toLowerCase())
    return this.byBasename.get(request.model.toLowerCase())
  }

  /**
   * The record the applicable mappings select. An owner-qualified mapping wins
   * over an unqualified one, and two applicable mappings resolve to nothing:
   * a deployment that cannot say which canonical model it means has not said
   * it, and the adapter keeps whatever facts it had.
   * @param mapped - every mapping claiming this route-local id.
   * @param request - the request, whose owner selects among them.
   * @returns the mapped record, or undefined when the mappings do not resolve.
   */
  private select(
    mapped: readonly CatalogAlias[],
    request: ModelFactsRequest,
  ): CanonicalRecord | undefined {
    const owned = mapped.filter(alias =>
      request.ownedBy !== undefined && alias.ownedBy !== undefined
      && sameId(alias.ownedBy, request.ownedBy))
    const applicable = owned.length > 0 ? owned : mapped.filter(alias => alias.ownedBy === undefined)
    if (applicable.length !== 1) return undefined
    const [mapping] = applicable
    if (mapping === undefined) return undefined
    return this.byId.get(mapping.canonicalId.toLowerCase())
  }
}

/**
 * Reject a mapping set that cannot address one model.
 * @param aliases - the configured mappings.
 * @throws when a mapping has an unusable id, or when two mappings claim the
 *   same route-local model under the same owner scope. Mappings are deployment
 *   configuration, so an unusable set fails at load rather than resolving to
 *   whichever entry happens to be declared first.
 */
export function validateAliases(aliases: readonly CatalogAlias[]): void {
  const claimed = new Set<string>()
  for (const alias of aliases) {
    const separator = alias.canonicalId.indexOf('/')
    if (alias.modelId.trim() === '' || alias.ownedBy?.trim() === ''
      || separator < 1 || separator === alias.canonicalId.length - 1) {
      throw new Error(
        `a model catalog mapping needs a modelId and a qualified canonicalId, got "${alias.modelId}"`,
      )
    }
    const key = `${alias.ownedBy?.toLowerCase() ?? '*'}\u0000${alias.modelId.toLowerCase()}`
    if (claimed.has(key)) {
      throw new Error(`model catalog mappings name "${alias.modelId}" twice for the same owner scope`)
    }
    claimed.add(key)
  }
}
