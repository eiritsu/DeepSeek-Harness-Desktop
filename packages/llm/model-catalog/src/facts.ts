/**
 * The model-fact vocabulary this catalog publishes.
 *
 * A fact is a property of one canonical model as models.dev records it, and it
 * is the same for every channel that serves that model. A channel separately
 * declares which reasoning controls it accepts; this is distinct from the
 * model's `reasoning` capability flag.
 *
 * @module @deepseek-ai/dsh-model-catalog/src/facts
 */

import type { ModelModality } from '@deepseek-ai/dsh-llm'

/** One model's shared catalog facts, as the current generation records them. */
export interface ModelFacts {
  /** Qualified `owner/model` identifier of the canonical record that answered. */
  readonly canonicalId: string
  /** Request modalities the canonical record declares; absent means unknown. */
  readonly inputModalities?: readonly ModelModality[]
  /** Maximum combined request and response context in tokens. */
  readonly contextWindow?: number
  /**
   * Maximum output tokens the model can produce. A capability ceiling: a
   * request default stays what the deployment configured, and this only
   * bounds what such a default may claim.
   */
  readonly maxOutputTokens?: number
  /** Whether the canonical record declares this a reasoning model. */
  readonly reasoning?: boolean
  /**
   * Reasoning levels the serving channel declares it accepts. Absent means the
   * channel says nothing; an empty list means it declares that it accepts
   * none, which refuses every explicit level.
   */
  readonly reasoningEfforts?: readonly string[]
  /** Selectable control declared by the serving channel; absent means unknown. */
  readonly reasoningControl?: ReasoningControl
}

/** Selectable reasoning controls models.dev declares for one serving channel. */
export type ReasoningControl =
  | { readonly type: 'none' }
  | { readonly type: 'toggle'; readonly budget?: boolean }
  | { readonly type: 'effort'; readonly efforts: readonly string[]; readonly toggle?: boolean; readonly budget?: boolean }

/** Which route-local model a caller wants facts for. */
export interface ModelFactsRequest {
  /** Model id the serving route uses, either bare (`gpt-5`) or qualified (`openai/gpt-5`). */
  readonly model: string
  /** Upstream owner, required to disambiguate between mappings or basenames. */
  readonly ownedBy?: string
  /** Route API endpoint, used to associate custom routes with published providers. */
  readonly apiURL?: string
}

/**
 * One immutable generation of catalog facts.
 *
 * A consumer that must answer from the same facts twice — describing a model
 * in a selector and encoding a request against it — holds one view for the
 * whole operation. A refresh publishes a new view object, never a mutation of
 * a published one, so a view's identity is the generation a consumer can
 * compare against.
 */
export interface ModelFactsView {
  /**
   * Monotonic generation of these facts, starting at 0 before any catalog has
   * been read. Advances once per accepted document, never on a failed
   * refresh, so two views with the same number are the same facts.
   */
  readonly generation: number
  /**
   * The facts for one route-local model.
   * @param request - the model id and the owner that disambiguates it.
   * @returns the record, or `undefined` when the catalog has none, the id is
   *   not qualified and matches several canonical basenames, or a configured
   *   mapping names a canonical id this generation does not carry.
   */
  facts(request: ModelFactsRequest): ModelFacts | undefined
}

/** The view published before any document has been read. */
export const EMPTY_FACTS: ModelFactsView = { generation: 0, facts: () => undefined }
