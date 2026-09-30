/** Loaded-window visibility for append-only user-message surface replacements. */

import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import { isReplacementSurfaceEvent } from '@deepseek-ai/dsh-session/surface'

/**
 * Tracks which loaded event seqs an append-only surface replacement shadowed, so
 * the visible conversation presents the replacement in place of the old
 * generation. The Session log keeps every event; only the current generation is
 * shown.
 */
export class ConversationPresentationState {
  private readonly shadowed = new Set<number>()

  /**
   * Replace all loaded visibility facts from one contiguous window.
   * @param entries - complete loaded event window.
   */
  replace(entries: readonly SessionEventLikeEntry[]): void {
    this.shadowed.clear()
    this.apply(entries)
  }

  /**
   * Apply newly loaded entries to the visibility facts.
   * @param entries - newly loaded event entries.
   */
  apply(entries: readonly SessionEventLikeEntry[]): void {
    const events = entries
      .filter((entry): entry is Extract<SessionEventLikeEntry, { type: 'event' }> => entry.type === 'event')
      .map(entry => entry.event)
      .sort((left, right) => left.seq - right.seq)
    for (const event of events) {
      if (!isReplacementSurfaceEvent(event)) continue
      for (const seq of event.sourceEventSeqs ?? []) this.shadowed.add(seq)
    }
  }

  /**
   * Whether one loaded entry belongs to the current visible generation.
   * @param entry - loaded event or transient Assistant frame.
   * @returns false when a replacement shadowed the event's seq.
   */
  visible(entry: SessionEventLikeEntry): boolean {
    return entry.type !== 'event' || !this.shadowed.has(entry.event.seq)
  }
}
