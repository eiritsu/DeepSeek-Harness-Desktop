/**
 * Per-Session admission of the latest Turn's edit-and-resend and stop-resume
 * actions. The controller owns one in-flight admission: a click admits once, a
 * connection reset invalidates a settlement that started on the previous
 * generation, and the view reads the published state through the
 * framework-bound hook.
 * @module @deepseek-ai/dsh-client-ui-chat/client/chat/turn-actions
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { MessageId, RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the connection/reset declaration and the ctx.remote merge.
import type {} from '@deepseek-ai/dsh-api-session-controller/client'

/** Latest-Turn action whose admission the controller tracks. */
export type TurnAction = 'resend' | 'resume'

/** Published admission state for one Session. */
export interface TurnActionsView {
  /** Whether an admission is on the wire. */
  readonly pending: boolean
  /** Last failure, addressed to the action that produced it; cleared by the next attempt. */
  readonly error: {
    readonly action: TurnAction
    readonly code: string
    readonly message: string
  } | null
}

const INITIAL_VIEW: TurnActionsView = Object.freeze({ pending: false, error: null })

/** Per-Session edit-and-resend and stop-resume admission controller. */
export class TurnActionsController implements HostObservable<TurnActionsView> {
  private view = INITIAL_VIEW
  private readonly listeners = new Set<() => void>()
  /** Bumped on dispose or connection reset; a settlement from another epoch is dropped. */
  private epoch = 0
  private disposed = false

  /**
   * @param ctx - the browser plugin context carrying the Session Remote namespace.
   * @param sessionId - Session owning the latest Turn.
   */
  constructor(private readonly ctx: ClientContext, private readonly sessionId: SessionId) {}

  /** Return the cached immutable view. */
  getSnapshot = (): TurnActionsView => this.view

  /** Subscribe to view replacement. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Admit one edit-and-resend of the latest Turn's opening user message. A call
   * while one is pending is ignored, so a double click accepts once.
   * @param messageId - durable id of the addressed user message.
   * @param text - replacement prompt text; omission replays the durable content
   *   verbatim while the durable attachment references stay in place.
   */
  resend(messageId: MessageId, text?: string): void {
    if (this.disposed || this.view.pending) return
    this.admit('resend', this.ctx.remote.session.resend({
      sessionId: this.sessionId,
      messageId,
      ...(text === undefined ? {} : { content: [{ type: 'text', text }] }),
    }))
  }

  /** Admit one resume of the latest stopped Turn. A pending admission is ignored. */
  resume(): void {
    if (this.disposed || this.view.pending) return
    this.admit('resume', this.ctx.remote.session.resume({ sessionId: this.sessionId }))
  }

  /** Drop a settlement from a superseded connection generation. */
  invalidate(): void {
    if (this.disposed) return
    this.epoch += 1
    this.publish(INITIAL_VIEW)
  }

  /** Refuse further work and drop subscribers when the owning fiber unloads. */
  dispose(): void {
    this.disposed = true
    this.epoch += 1
    this.listeners.clear()
  }

  /** Publish the pending state and settle it only on the admitting generation. */
  private admit(action: TurnAction, call: Promise<RemoteResult<unknown>>): void {
    this.publish({ pending: true, error: null })
    const epoch = this.epoch
    void call.then(
      (carried) => {
        if (epoch !== this.epoch || this.disposed) return
        this.publish({
          pending: false,
          error: carried.ok
            ? null
            : { action, code: carried.error.code, message: carried.error.message },
        })
      },
      (error: unknown) => {
        if (epoch !== this.epoch || this.disposed) return
        this.publish({
          pending: false,
          error: { action, code: 'gateway/internal', message: error instanceof Error ? error.message : String(error) },
        })
      },
    )
  }

  /** Replace the view and contain subscriber failures at the observable boundary. */
  private publish(view: TurnActionsView): void {
    this.view = Object.freeze(view)
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error: unknown) {
        console.error('[ui-chat] turn-action subscriber threw:', error)
      }
    }
  }
}
