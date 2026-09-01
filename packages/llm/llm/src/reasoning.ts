/** Provider-neutral reasoning controls for model routes without catalog metadata. */
import { ReasoningEffortId } from './brand.ts'
import type { LlmModelReasoningInfo, LlmReasoningEffortInfo } from './types.ts'

/** Stable effort list used when an endpoint does not publish per-model levels. */
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
