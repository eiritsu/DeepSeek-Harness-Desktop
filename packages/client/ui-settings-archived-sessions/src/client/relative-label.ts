/**
 * The trailing date label on an archived row. Bucketing stays with the shared
 * `relativeTime` primitive so the sidebar and this page name the same moment
 * the same way; only the words belong to this page's dictionary.
 */

import { relativeTime } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RelativeTimeUnit } from '@deepseek-ai/dsh-client-ui-primitives'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import type { ArchivedSessionsLocaleKey, ArchivedTranslate } from './locales.ts'

/**
 * Name one {@link relativeTime} bucket in this page's dictionary.
 * @param unit - the bucket `relativeTime` chose.
 * @returns the matching dictionary key.
 */
function unitKey(unit: RelativeTimeUnit): ArchivedSessionsLocaleKey {
  switch (unit) {
    case 'now': return 'time.now'
    case 'minutes': return 'time.minutes'
    case 'hours': return 'time.hours'
    case 'days': return 'time.days'
    case 'months': return 'time.months'
    case 'years': return 'time.years'
    /* v8 ignore next -- the closed union above is exhausted; only a forged bucket reaches this. */
    default: return assertNever(unit, 'relativeTime bucket')
  }
}

/**
 * Localize how long ago a moment happened.
 * @param at - epoch ms of the moment to describe.
 * @param now - current epoch ms, injected so rendering stays pure.
 * @param t - this page's translate function.
 * @returns the bucket's localized text, with its magnitude filled in.
 */
export function relativeLabel(at: number, now: number, t: ArchivedTranslate): string {
  const bucket = relativeTime(at, now)
  return t(unitKey(bucket.unit), { n: bucket.n })
}
