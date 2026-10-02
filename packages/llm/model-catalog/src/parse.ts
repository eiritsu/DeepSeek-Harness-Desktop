/**
 * Bounded parsing of one models.dev catalog document into the records this
 * package keeps. Parsing is total over the document: a record the schema
 * cannot make sense of is skipped, never guessed at, and a document that
 * yields no usable record at all is rejected so a malformed refresh cannot
 * replace a good last-good cache with an empty one.
 *
 * The byte limit is applied to the response before this module runs, so the
 * work here is bounded by what a caller was already willing to read.
 *
 * @module @deepseek-ai/dsh-model-catalog/src/parse
 */

import type { ModelModality } from '@deepseek-ai/dsh-llm'

/** The modalities a canonical record may declare that the harness can request. */
const REQUEST_MODALITIES: readonly ModelModality[] = ['text', 'image']

/** One canonical model's shared facts, keyed in the document by `owner/model`. */
export interface CanonicalRecord {
  /** Qualified `owner/model` identifier. */
  readonly id: string
  /** Request modalities the record declares, filtered to what the harness can request. */
  readonly input?: readonly ModelModality[]
  /** Maximum combined request and response context in tokens. */
  readonly contextWindow?: number
  /** Maximum output tokens. */
  readonly maxOutputTokens?: number
  /** Whether the record declares this a reasoning model. */
  readonly reasoning?: boolean
}

/** One provider model entry retained for canonical identity or declared efforts. */
export interface ChannelEfforts {
  /** Channel namespace, the provider entry's own key. */
  readonly namespace: string
  /** Model id as the channel names it, the provider entry's own key. */
  readonly model: string
  /** Qualified canonical model id when the provider entry identifies one. */
  readonly canonicalId?: string
  /** Levels the channel declares; an empty list declares that it accepts none. */
  readonly efforts?: readonly string[]
}

/** Everything one accepted document yields. */
export interface ParsedCatalog {
  /** Canonical records by qualified id. */
  readonly canonical: readonly CanonicalRecord[]
  /** Provider entries that identify canonical models or declare effort vocabularies. */
  readonly channels: readonly ChannelEfforts[]
}

/** A plain object, or nothing. The document boundary is untrusted. */
function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/** A positive safe integer, or undefined. */
function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

/** Declared input modalities, narrowed to the ones the harness can request. */
function inputModalities(value: unknown): readonly ModelModality[] | undefined {
  if (!Array.isArray(value)) return undefined
  const accepted = value.filter((item): item is ModelModality =>
    REQUEST_MODALITIES.includes(item as ModelModality))
  return accepted.length > 0 ? accepted : undefined
}

/**
 * The levels one channel declares, or undefined when it declares none.
 * A record that says the model does not reason declares the empty vocabulary:
 * every explicit level is then refused, which is a fact rather than silence.
 * @param reasoning - the record's own reasoning declaration.
 * @param options - its `reasoning_options` list.
 * @returns the declared levels, or undefined when the record is silent.
 */
function channelEfforts(reasoning: unknown, options: unknown): readonly string[] | undefined {
  if (reasoning === false) return []
  if (!Array.isArray(options)) return undefined
  const values = new Set<string>()
  let declared = false
  for (const option of options) {
    const entry = record(option)
    if (entry?.type !== 'effort' || !Array.isArray(entry.values)) continue
    declared = true
    for (const value of entry.values) {
      if (typeof value === 'string' && value.length > 0) values.add(value)
    }
  }
  return declared ? [...values] : undefined
}

/**
 * Read one models.dev document.
 * @param document - the decoded JSON body.
 * @returns the canonical records and per-channel vocabularies it carries.
 * @throws when the document is not the catalog's shape, or carries no usable
 *   canonical record — a refresh that throws leaves the last-good cache alone.
 */
export function parseCatalogDocument(document: unknown): ParsedCatalog {
  const root = record(document)
  const models = record(root?.models)
  const providers = record(root?.providers)
  if (models === undefined || providers === undefined) {
    throw new Error('the model catalog document must carry both models and providers objects')
  }
  const canonical: CanonicalRecord[] = []
  for (const [id, value] of Object.entries(models)) {
    // The key is the identity: a record whose own `id` disagrees, or that
    // names no owner, cannot be addressed by exact id or by basename.
    const model = record(value)
    if (model?.id !== id) continue
    const separator = id.indexOf('/')
    if (separator < 1 || separator === id.length - 1) continue
    const limit = record(model.limit)
    const input = inputModalities(record(model.modalities)?.input)
    const contextWindow = positiveInteger(limit?.context)
    const maxOutputTokens = positiveInteger(limit?.output)
    const reasoning = typeof model.reasoning === 'boolean' ? model.reasoning : undefined
    if (input === undefined && contextWindow === undefined
      && maxOutputTokens === undefined && reasoning === undefined) continue
    canonical.push({
      id,
      ...input === undefined ? {} : { input },
      ...contextWindow === undefined ? {} : { contextWindow },
      ...maxOutputTokens === undefined ? {} : { maxOutputTokens },
      ...reasoning === undefined ? {} : { reasoning },
    })
  }
  if (canonical.length === 0) throw new Error('the model catalog document carries no usable canonical model record')
  const channels: ChannelEfforts[] = []
  for (const [namespace, value] of Object.entries(providers)) {
    const channelModels = record(record(value)?.models)
    if (channelModels === undefined) continue
    for (const [model, entry] of Object.entries(channelModels)) {
      const providerModel = record(entry)
      const declared = channelEfforts(providerModel?.reasoning, providerModel?.reasoning_options)
      const canonicalId = typeof providerModel?.canonical_model_id === 'string'
        && providerModel.canonical_model_id.includes('/')
        ? providerModel.canonical_model_id
        : undefined
      if (declared !== undefined || canonicalId !== undefined) {
        channels.push({
          namespace,
          model,
          ...(declared === undefined ? {} : { efforts: declared }),
          ...(canonicalId === undefined ? {} : { canonicalId }),
        })
      }
    }
  }
  return { canonical, channels }
}
