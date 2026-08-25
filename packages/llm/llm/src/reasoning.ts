/**
 * Provider-neutral reasoning controls exposed for every model route.
 *
 * @module @deepseek-ai/dsh-llm/reasoning
 */

import { ReasoningEffortId } from './brand.ts'
import type { LlmModelReasoningInfo, LlmReasoningEffortInfo } from './types.ts'

/** Fixed explicit reasoning efforts offered after the provider-default choice. */
export const STANDARD_REASONING_EFFORTS: readonly LlmReasoningEffortInfo[] = Object.freeze([
  Object.freeze({ id: ReasoningEffortId('off'), name: 'Off' }),
  Object.freeze({ id: ReasoningEffortId('low'), name: 'Low' }),
  Object.freeze({ id: ReasoningEffortId('high'), name: 'High' }),
  Object.freeze({ id: ReasoningEffortId('max'), name: 'Max' }),
])

/** Fixed reasoning metadata exposed for every resolved model route. */
export const STANDARD_MODEL_REASONING: LlmModelReasoningInfo = Object.freeze({
  efforts: STANDARD_REASONING_EFFORTS,
})
