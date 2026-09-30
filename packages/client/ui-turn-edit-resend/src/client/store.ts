/** One in-progress edit-and-resend attempt for a Session. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

/** The prompt text, target range, and disclosed tools of one open edit. */
export interface TurnResendEdit {
  readonly sessionId: string
  readonly operationId: string
  readonly turn: number
  readonly startSeq: number
  readonly text: string
  readonly toolCalls: readonly string[]
}

/**
 * How one submitted attempt settled, mapped from the Host's durable operation
 * record. `admitted` clears the presentation; every other outcome keeps it
 * open with copy that states exactly what the log proves.
 */
export type TurnResendOutcome =
  /** The Host recorded no replaceable turn to replace, so nothing was written. */
  | { readonly kind: 'not-admitted' }
  /** The Host declined the request; no model call was made. */
  | { readonly kind: 'refused'; readonly refusal: string }
  /** Admission threw after the operation was recorded. */
  | { readonly kind: 'failed'; readonly reason: string }
  /** The intent is recorded but no attempt started. */
  | { readonly kind: 'pending' }
  /**
   * The request started and the log does not record whether the model was
   * called. The result is unknown; repeating the same operation is unsafe.
   */
  | { readonly kind: 'uncertain' }
  /** The transport failed before the Host answered. */
  | { readonly kind: 'remote-failed'; readonly code: string }

/** A click the Host answered without an edit, shown in place of that message. */
export interface TurnResendNotice {
  /** Surface seq of the clicked user message. */
  readonly seq: number
  readonly outcome: TurnResendOutcome
}

interface TurnResendState {
  /** The one open edit per Session, or none. */
  readonly editing: Record<string, TurnResendEdit | undefined>
  readonly saving: Record<string, boolean>
  /** The last submission outcome of the open edit. */
  readonly outcome: Record<string, TurnResendOutcome | undefined>
  /** The one pre-edit notice per Session, or none. */
  readonly notice: Record<string, TurnResendNotice | undefined>
}

type TurnResendActions = {
  begin: (draft: TurnResendState, edit: TurnResendEdit) => void
  setText: (draft: TurnResendState, sessionId: string, text: string) => void
  saving: (draft: TurnResendState, sessionId: string, saving: boolean) => void
  settle: (draft: TurnResendState, sessionId: string, outcome: TurnResendOutcome | undefined) => void
  notice: (draft: TurnResendState, sessionId: string, notice: TurnResendNotice) => void
  clear: (draft: TurnResendState, sessionId: string) => void
}

/**
 * Shared edit state for the user-message entry and the in-place body editor, so
 * either can open, edit, and settle the same attempt across remounts.
 * @returns a Session-keyed store handle.
 */
export function createTurnResendStore(): EngineStoreHandle<TurnResendState, TurnResendActions> {
  return defineStore({
    init: (): TurnResendState => ({ editing: {}, saving: {}, outcome: {}, notice: {} }),
    actions: {
      begin: (draft, edit) => {
        draft.editing[edit.sessionId] = edit
        draft.outcome[edit.sessionId] = undefined
        draft.notice[edit.sessionId] = undefined
      },
      setText: (draft, sessionId, text) => {
        const edit = draft.editing[sessionId]
        if (edit !== undefined) draft.editing[sessionId] = { ...edit, text }
      },
      saving: (draft, sessionId, saving) => { draft.saving[sessionId] = saving },
      settle: (draft, sessionId, outcome) => { draft.outcome[sessionId] = outcome },
      notice: (draft, sessionId, notice) => {
        draft.notice[sessionId] = notice
        draft.editing[sessionId] = undefined
        draft.outcome[sessionId] = undefined
      },
      clear: (draft, sessionId) => {
        draft.editing[sessionId] = undefined
        draft.saving[sessionId] = false
        draft.outcome[sessionId] = undefined
        draft.notice[sessionId] = undefined
      },
    },
  })
}
