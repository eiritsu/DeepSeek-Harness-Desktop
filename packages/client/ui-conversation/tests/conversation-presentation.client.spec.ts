/**
 * A `user/message` surface replacement hides the seqs it shadowed from the
 * visible conversation while the append-only log keeps them.
 */

import { describe, expect, it } from 'vitest'
import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import { ConversationPresentationState } from '../src/client/conversation/presentation.ts'

function plain(seq: number): SessionEventLikeEntry {
  return { type: 'event', event: { type: 'assistant/message', seq } as never }
}

function replacement(seq: number, shadowed: readonly number[]): SessionEventLikeEntry {
  return {
    type: 'event',
    event: {
      type: 'user/message',
      seq,
      surfaceOp: { op: 'replace', startSeq: shadowed[0], endSeq: shadowed[shadowed.length - 1] },
      sourceEventSeqs: shadowed,
    } as never,
  }
}

describe('ConversationPresentationState', () => {
  it('hides every shadowed seq and keeps the replacement visible', () => {
    const entries = [plain(2), plain(3), plain(4), plain(6), replacement(9, [3, 4, 6])]
    const presentation = new ConversationPresentationState()
    presentation.replace(entries)

    expect(presentation.visible(plain(2))).toBe(true)
    expect(presentation.visible(plain(3))).toBe(false)
    expect(presentation.visible(plain(4))).toBe(false)
    expect(presentation.visible(plain(6))).toBe(false)
    expect(presentation.visible(entries[4]!)).toBe(true)
  })

  it('accumulates live shadowing and resets on a window replace', () => {
    const presentation = new ConversationPresentationState()
    presentation.replace([plain(1), plain(3)])
    presentation.apply([replacement(4, [1, 3])])
    expect(presentation.visible(plain(1))).toBe(false)
    expect(presentation.visible(plain(3))).toBe(false)

    presentation.replace([plain(1), plain(3)])
    expect(presentation.visible(plain(1))).toBe(true)
    expect(presentation.visible(plain(3))).toBe(true)
  })
})
