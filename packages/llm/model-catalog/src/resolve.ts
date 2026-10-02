/**
 * Resolution of a route-local model id onto one canonical record, and the
 * immutable view that publishes the result for a whole generation.
 *
 * Explicit mappings, exact qualified ids, unique canonical basenames, and
 * provider entry ids resolve in that order. Every lookup refuses ambiguity
 * rather than choosing whichever document entry appeared first.
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
  /** Channel vocabularies grouped by their canonical identity or legacy owner/model key. */
  private readonly channels: readonly ParsedCatalog['channels'][number][]
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
    this.channels = catalog.channels
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
    const efforts = this.channelEfforts(request, model.id, owner)
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

  /** Resolve one route's channel declaration without choosing among providers. */
  private channelEfforts(request: ModelFactsRequest, canonicalId: string, canonicalOwner: string): readonly string[] | undefined {
    const requestedOwner = request.ownedBy ?? canonicalOwner
    const requestedModel = basenameOf(request.model)
    const explicit = this.channels.filter(channel => channel.canonicalId !== undefined
      && sameId(channel.canonicalId, canonicalId)
      && sameId(channel.namespace, requestedOwner))
    const exact = explicit.filter(channel => sameId(channel.model, requestedModel))
    if (exact.length > 0) return this.uniqueEfforts(exact)
    if (explicit.length === 1) return explicit[0]?.efforts
    if (explicit.length > 1) return undefined

    // An unknown route can use declarations from the canonical owner's
    // channel. Prefer an exact canonical model entry; otherwise accept only
    // one provider entry for that canonical model.
    const ownerChannels = this.channels.filter(channel => sameId(channel.namespace, canonicalOwner)
      && (channel.canonicalId === undefined
        ? sameId(channel.model, basenameOf(canonicalId))
        : sameId(channel.canonicalId, canonicalId)))
    const ownerExact = ownerChannels.filter(channel => sameId(channel.model, requestedModel))
    return this.uniqueEfforts(ownerExact.length > 0 ? ownerExact : ownerChannels)
  }

  /** Conflicting declarations are ambiguous; identical duplicates are equivalent. */
  private uniqueEfforts(channels: readonly ParsedCatalog['channels'][number][]): readonly string[] | undefined {
    if (channels.length === 0) return undefined
    const distinct = new Map(channels.map(channel => [
      channel.efforts === undefined ? undefined : JSON.stringify([...channel.efforts].sort()),
      channel.efforts,
    ]))
    return distinct.size === 1 ? distinct.values().next().value : undefined
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
    if (request.model.includes('/')) {
      return this.byId.get(request.model.toLowerCase()) ?? this.resolveChannelModel(request)
    }
    return this.byBasename.get(request.model.toLowerCase()) ?? this.resolveChannelModel(request)
  }

  /** Resolve a provider model alias only when every matching entry names one canonical record. */
  private resolveChannelModel(request: ModelFactsRequest): CanonicalRecord | undefined {
    const matching = this.channels.filter(channel => sameId(channel.model, request.model)
      && channel.canonicalId !== undefined)
    const ownedBy = request.ownedBy
    const owned = ownedBy === undefined
      ? []
      : matching.filter(channel => sameId(channel.namespace, ownedBy))
    const candidates = owned.length > 0 ? owned : matching
    const ids = new Set(candidates
      .map(channel => channel.canonicalId?.toLowerCase())
      .filter((id): id is string => id !== undefined))
    if (ids.size !== 1) return undefined
    const [id] = ids
    return id === undefined ? undefined : this.byId.get(id)
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
