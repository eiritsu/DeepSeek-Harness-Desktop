/**
 * The one reasoning-level vocabulary every model selector offers, and the
 * projection that materializes it for a surface.
 *
 * A selector's rows are a harness decision, not a provider one: which levels a
 * route can encode is adapter-owned and reported through
 * `LlmResolvedModelInfo.reasoning.efforts`, while the rows themselves are the
 * fixed escalation ladder below. Naming a level the route cannot encode is a
 * request-time `UNSUPPORTED_REASONING_EFFORT` refusal, never a silent downgrade
 * to a neighboring level.
 *
 * "Default" is not a level. It is the choice to send no effort at all, which
 * leaves the provider's own default — or a route-configured one materialized by
 * `LlmRuntime.prepareCall()` — in force.
 *
 * @module dsh-llm/reasoning
 */

import { ReasoningEffortId } from './brand.ts'
import type { LlmReasoningEffortInfo } from './types.ts'

/** Every reasoning level a model selector offers, in escalation order. */
export const MODEL_REASONING_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/** One harness reasoning level, provider-neutral and identical across routes. */
export type ModelReasoningEffort = (typeof MODEL_REASONING_EFFORTS)[number]

/**
 * Every level as a selectable row, in escalation order. A surface renders this
 * for each model instead of the route's own `efforts`, so the ladder a person
 * reads does not change with the provider or channel serving the model.
 *
 * `name` is the untranslated caption for surfaces that have no dictionary of
 * their own; a localized surface keys its own copy off `id`.
 */
const EFFORT_ROWS: readonly LlmReasoningEffortInfo[] = [
  { id: ReasoningEffortId('minimal'), name: 'Minimal' },
  { id: ReasoningEffortId('low'), name: 'Low' },
  { id: ReasoningEffortId('medium'), name: 'Medium' },
  { id: ReasoningEffortId('high'), name: 'High' },
  { id: ReasoningEffortId('xhigh'), name: 'Extra high' },
  { id: ReasoningEffortId('max'), name: 'Max' },
]

/**
 * The rows every model selector offers, detached so one surface's rendering or
 * editing cannot reach another's.
 * @returns one entry per {@link MODEL_REASONING_EFFORTS} level, in escalation order.
 */
export function modelReasoningEfforts(): LlmReasoningEffortInfo[] {
  return EFFORT_ROWS.map(effort => ({ ...effort }))
}

/**
 * Whether an effort id names one of the fixed levels.
 * @param effort - the adapter-owned effort id, possibly a route-specific one.
 * @returns whether the id is a canonical level.
 */
export function isModelReasoningEffort(effort: string): effort is ModelReasoningEffort {
  return (MODEL_REASONING_EFFORTS as readonly string[]).includes(effort)
}
