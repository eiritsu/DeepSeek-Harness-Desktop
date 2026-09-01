/** Provider-neutral reasoning controls for models without catalog metadata. */
import { ReasoningEffortId } from './brand.ts'
import type { LlmModelReasoningInfo, LlmReasoningEffortInfo } from './types.ts'

/** Stable fallback effort list exposed for compatible provider routes. */
export const STANDARD_REASONING_EFFORTS: readonly LlmReasoningEffortInfo[] = Object.freeze([
  Object.freeze({ id: ReasoningEffortId('off'), name: 'Off' }),
  Object.freeze({ id: ReasoningEffortId('low'), name: 'Low' }),
  Object.freeze({ id: ReasoningEffortId('high'), name: 'High' }),
  Object.freeze({ id: ReasoningEffortId('max'), name: 'Max' }),
])

/** Provider-neutral reasoning metadata for routes without a catalog map. */
export const STANDARD_MODEL_REASONING: LlmModelReasoningInfo = Object.freeze({
  efforts: STANDARD_REASONING_EFFORTS,
})
