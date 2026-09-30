/**
 * Process-local claims over one user message's body. A plugin that presents a
 * message in place — an editor replacing the shipped bubble — claims that
 * message's body, and the Chat node renderer swaps the bubble while the claim
 * is live. Claims survive node unmounts because they are keyed by Session and
 * surface seq rather than by a mounted renderer.
 *
 * @module @deepseek-ai/dsh-client-ui-chat/src/message-claims
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createSnapshotStore, type ObservableSnapshot, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** Claims of one Session, as the claimed message seqs. */
export type MessageBodyClaimSet = ReadonlySet<number>

/**
 * Registry of user-message body claims. One claim owns a message at a time; a
 * newer claim replaces the older one, and the older release becomes a no-op so
 * a replaced claimant can never unclaim its successor's message.
 */
export class MessageBodyClaims {
  /** Claimed seqs per Session; one stable observable source per Session. */
  private readonly sessions = new Map<SessionId, SnapshotStore<MessageBodyClaimSet>>()
  /** Current claim token per session+seq, so only the newest release takes effect. */
  private readonly tokens = new Map<string, symbol>()

  /**
   * Claim one user message's body.
   * @param sessionId - Session whose message is claimed.
   * @param seq - surface seq of the claimed user message.
   * @param owner - claimant id used in diagnostics and claim replacement.
   * @returns release of this claim; releasing a replaced claim is a no-op.
   */
  claim(sessionId: SessionId, seq: number, owner: string): () => void {
    const token = Symbol(owner)
    const key = `${sessionId}\0${String(seq)}`
    this.tokens.set(key, token)
    this.write(sessionId, seq, true)
    return () => {
      if (this.tokens.get(key) !== token) return
      this.tokens.delete(key)
      this.write(sessionId, seq, false)
    }
  }

  /**
   * The claimed seqs of one Session as a stable observable source.
   * @param sessionId - Session whose claims are read.
   * @returns the source; its snapshot changes only when a claim moves.
   */
  source(sessionId: SessionId): ObservableSnapshot<MessageBodyClaimSet> {
    return this.store(sessionId)
  }

  private store(sessionId: SessionId): SnapshotStore<MessageBodyClaimSet> {
    let store = this.sessions.get(sessionId)
    if (store === undefined) {
      store = createSnapshotStore<MessageBodyClaimSet>(new Set())
      this.sessions.set(sessionId, store)
    }
    return store
  }

  private write(sessionId: SessionId, seq: number, claimed: boolean): void {
    const store = this.store(sessionId)
    const current = store.getSnapshot()
    if (claimed === current.has(seq)) return
    const next = new Set(current)
    if (claimed) next.add(seq)
    else next.delete(seq)
    store.set(next)
  }
}

/** Chat-owned UI capabilities a feature plugin claims. */
export interface UiChatService {
  /**
   * Claim one user message's body, so a registered
   * `conversation.chat.user-body` presenter renders in place of the shipped
   * bubble until the claim is released.
   * @param sessionId - Session whose message is claimed.
   * @param seq - surface seq of the claimed user message.
   * @param owner - claimant id used in diagnostics and claim replacement.
   * @returns release of this claim; releasing a replaced claim is a no-op.
   */
  claimUserMessageBody(sessionId: SessionId, seq: number, owner: string): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Chat-owned UI capabilities a feature plugin claims. */
    uiChat: UiChatService
  }
}
