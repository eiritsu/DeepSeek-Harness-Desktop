/** The trailing date on a row: one shared bucket, this page's words. */

import { describe, expect, it } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en } from '../src/client/locales.ts'
import type { ArchivedTranslate } from '../src/client/locales.ts'
import { relativeLabel } from '../src/client/relative-label.ts'

// The page's translate seat, resolving this page's dictionary.
const t: ArchivedTranslate = makeTranslate(en)

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

describe('relativeLabel', () => {
  it('names each bucket the shared primitive chose', () => {
    const now = 400 * DAY
    expect(relativeLabel(now, now, t)).toBe(en['time.now'])
    expect(relativeLabel(now - 5 * MIN, now, t)).toBe('5min')
    expect(relativeLabel(now - 3 * HOUR, now, t)).toBe('3h')
    expect(relativeLabel(now - 2 * DAY, now, t)).toBe('2d')
    expect(relativeLabel(now - 90 * DAY, now, t)).toBe('3mo')
    expect(relativeLabel(now - 400 * DAY, now, t)).toBe('1y')
  })

  it('reads a moment in the future as the present rather than a negative span', () => {
    const now = 10 * DAY
    expect(relativeLabel(now + 5 * HOUR, now, t)).toBe(en['time.now'])
  })
})
