/**
 * Per-Session retry of the latest safe assistant answer. The controller owns
 * one in-flight admission: a click admits once, a connection reset invalidates
 * a settlement that started on the previous generation, and the view reads the
 * published state through the framework-bound hook.
 * @module @deepseek-ai/dsh-client-ui-chat/client/chat/retry-interrupted
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionInterruptedRetryTarget } from '@deepseek-ai/dsh-api-remotes/client'
import type { AssistantMessageNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the connection/reset declaration and the ctx.remote merge.
import type {} from '@deepseek-ai/dsh-api-session-controller/client'

/** Published retry state for one Session. */
export interface RetryInterruptedView {
  /** Whether an admission is on the wire. */
  readonly pending: boolean
  /** Last failure, addressed to the target it targeted; cleared by the next attempt. */
  readonly error: {
    readonly target: SessionInterruptedRetryTarget
    readonly code: string
    readonly message: string
  } | null
}

const INITIAL_VIEW: RetryInterruptedView = Object.freeze({ pending: false, error: null })

/**
 * Durable address a closing assistant answer can be regenerated from. A surface
 * message carries its own id; a log-only attempt carries only its seq.
 * @param finalNode - closing Assistant settlement, or absence.
 * @returns the durable retry target, or undefined when neither identity exists.
 */
export function retryTargetOf(
  finalNode: AssistantMessageNode | undefined,
): SessionInterruptedRetryTarget | undefined {
  if (finalNode?.messageId !== undefined) {
    return { kind: 'assistant-message', messageId: finalNode.messageId }
  }
  if (finalNode?.attemptSeq !== undefined) {
    return { kind: 'assistant-attempt', seq: finalNode.attemptSeq }
  }
  return undefined
}

/**
 * Whether two durable retry targets address the same assistant settlement.
 * @param left - first address.
 * @param right - second address.
 * @returns whether both name the same settlement kind and identity.
 */
export function sameRetryTarget(
  left: SessionInterruptedRetryTarget,
  right: SessionInterruptedRetryTarget,
): boolean {
  if (left.kind === 'assistant-message') {
    return right.kind === 'assistant-message' && left.messageId === right.messageId
  }
  return right.kind === 'assistant-attempt' && left.seq === right.seq
}

/** Per-Session retry admission controller behind the assistant-action entry. */
export class RetryInterruptedController implements HostObservable<RetryInterruptedView> {
  private view = INITIAL_VIEW
  private readonly listeners = new Set<() => void>()
  /** Bumped on dispose or connection reset; a settlement from another epoch is dropped. */
  private epoch = 0
  private disposed = false

  /**
   * @param ctx - the browser plugin context carrying the Session Remote namespace.
   * @param sessionId - Session owning the interrupted answer.
   */
  constructor(private readonly ctx: ClientContext, private readonly sessionId: SessionId) {}

  /** Return the cached immutable view. */
  getSnapshot = (): RetryInterruptedView => this.view

  /** Subscribe to view replacement. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Admit one retry for a retryable assistant settlement. A call while one is
   * pending is ignored, so a double click accepts once.
   * @param target - durability-addressed assistant settlement to regenerate.
   */
  retry(target: SessionInterruptedRetryTarget): void {
    if (this.disposed || this.view.pending) return
    this.publish({ pending: true, error: null })
    const epoch = this.epoch
    void this.ctx.remote.session.retryInterrupted({ sessionId: this.sessionId, target }).then(
      (carried) => {
        if (epoch !== this.epoch || this.disposed) return
        this.publish({
          pending: false,
          error: carried.ok
            ? null
            : { target, code: carried.error.code, message: carried.error.message },
        })
      },
      (error: unknown) => {
        if (epoch !== this.epoch || this.disposed) return
        this.publish({
          pending: false,
          error: { target, code: 'gateway/internal', message: error instanceof Error ? error.message : String(error) },
        })
      },
    )
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

  /** Replace the view and contain subscriber failures at the observable boundary. */
  private publish(view: RetryInterruptedView): void {
    this.view = Object.freeze(view)
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error: unknown) {
        console.error('[ui-chat] retry subscriber threw:', error)
      }
    }
  }
}
