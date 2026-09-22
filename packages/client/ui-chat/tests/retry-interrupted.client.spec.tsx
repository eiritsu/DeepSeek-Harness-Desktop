// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach } from 'vitest'
import type { ComponentProps } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { MessageId } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import type { ChatNodeViewProps, TurnActionsOwnerProps } from '../src/client/contract/slots.ts'
import type { TurnActionsView } from '../src/client/chat/turn-actions.ts'
import { TurnActionsController } from '../src/client/chat/turn-actions.ts'
import { AssistantMarkdown } from '../src/client/chat/AssistantMarkdown.tsx'
import { UserMessageNodeView } from '../src/client/chat/MessageItem.tsx'
import { en } from '../src/client/locale.ts'

afterEach(cleanup)

interface Deferred {
  readonly promise: Promise<unknown>
  resolve(value: unknown): void
  reject(reason: unknown): void
}

function deferred(): Deferred {
  let resolve = (_value: unknown): void => {}
  let reject = (_reason: unknown): void => {}
  const promise = new Promise<unknown>((settle, fail) => {
    resolve = settle
    reject = fail
  })
  return { promise, resolve, reject }
}

const MESSAGE_ID = 'user-1' as MessageId

function controllerFor(remotes: {
  readonly resend: ReturnType<typeof vi.fn>
  readonly resume: ReturnType<typeof vi.fn>
}): TurnActionsController {
  const ctx = { remote: { session: remotes } } as unknown as ClientContext
  return new TurnActionsController(ctx, 's1' as SessionId)
}

describe('TurnActionsController', () => {
  it('replays the durable prompt when no replacement text is supplied', () => {
    const resend = vi.fn(() => deferred().promise)
    const resume = vi.fn()
    const controller = controllerFor({ resend, resume })

    controller.resend(MESSAGE_ID)
    expect(resend).toHaveBeenCalledWith({ sessionId: 's1', messageId: MESSAGE_ID })
    expect(resume).not.toHaveBeenCalled()
  })

  it('sends replacement text as a text-only content list', () => {
    const resend = vi.fn(() => deferred().promise)
    const controller = controllerFor({ resend, resume: vi.fn() })

    controller.resend(MESSAGE_ID, 'edited')
    expect(resend).toHaveBeenCalledWith({
      sessionId: 's1',
      messageId: MESSAGE_ID,
      content: [{ type: 'text', text: 'edited' }],
    })
  })

  it('resumes the latest stopped turn', () => {
    const resume = vi.fn(() => deferred().promise)
    const resend = vi.fn()
    const controller = controllerFor({ resend, resume })

    controller.resume()
    expect(resume).toHaveBeenCalledWith({ sessionId: 's1' })
    expect(resend).not.toHaveBeenCalled()
  })

  it('publishes pending then clears on acceptance', async () => {
    const call = deferred()
    const controller = controllerFor({ resend: vi.fn(() => call.promise), resume: vi.fn() })
    const seen: unknown[] = []
    controller.subscribe(() => { seen.push(controller.getSnapshot()) })

    controller.resend(MESSAGE_ID)
    expect(controller.getSnapshot().pending).toBe(true)
    call.resolve({ ok: true, value: { accepted: true } })
    await act(async () => { await call.promise })
    expect(controller.getSnapshot()).toEqual({ pending: false, error: null })
    expect(seen).toEqual([{ pending: true, error: null }, { pending: false, error: null }])
  })

  it('accepts one admission while another is pending', () => {
    const call = deferred()
    const resend = vi.fn(() => call.promise)
    const resume = vi.fn(() => call.promise)
    const controller = controllerFor({ resend, resume })
    controller.resend(MESSAGE_ID)
    controller.resend(MESSAGE_ID)
    controller.resume()
    expect(resend).toHaveBeenCalledTimes(1)
    expect(resume).not.toHaveBeenCalled()
    call.resolve({ ok: true, value: { accepted: true } })
  })

  it('publishes the addressed failure action', async () => {
    const call = deferred()
    const controller = controllerFor({ resend: vi.fn(), resume: vi.fn(() => call.promise) })
    controller.resume()
    call.resolve({ ok: false, error: { code: 'session/resume-unavailable', message: 'nope' } })
    await act(async () => { await call.promise })
    expect(controller.getSnapshot()).toEqual({
      pending: false,
      error: { action: 'resume', code: 'session/resume-unavailable', message: 'nope' },
    })
  })

  it('drops a settlement invalidated by a connection reset', async () => {
    const call = deferred()
    const controller = controllerFor({ resend: vi.fn(() => call.promise), resume: vi.fn() })
    controller.resend(MESSAGE_ID, 'edited')
    controller.invalidate()
    expect(controller.getSnapshot()).toEqual({ pending: false, error: null })
    call.resolve({ ok: false, error: { code: 'gateway/internal', message: 'stale' } })
    await act(async () => { await call.promise })
    expect(controller.getSnapshot()).toEqual({ pending: false, error: null })
  })

  it('refuses further work after disposal', () => {
    const resend = vi.fn(() => deferred().promise)
    const resume = vi.fn(() => deferred().promise)
    const controller = controllerFor({ resend, resume })
    controller.dispose()
    controller.resend(MESSAGE_ID)
    controller.resume()
    expect(resend).not.toHaveBeenCalled()
    expect(resume).not.toHaveBeenCalled()
    expect(() => { controller.invalidate() }).not.toThrow()
    expect(controller.getSnapshot()).toEqual({ pending: false, error: null })
  })

  it('publishes a carrier rejection and contains a throwing subscriber', async () => {
    const call = deferred()
    const controller = controllerFor({ resend: vi.fn(() => call.promise), resume: vi.fn() })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    controller.subscribe(() => { throw new Error('bad subscriber') })
    controller.resend(MESSAGE_ID)
    call.reject(new Error('boom'))
    await act(async () => { await call.promise.catch(() => {}) })
    expect(controller.getSnapshot()).toEqual({
      pending: false,
      error: { action: 'resend', code: 'gateway/internal', message: 'boom' },
    })
    consoleError.mockRestore()
  })
})

interface UserOptions {
  readonly resendable?: boolean
  readonly resumable?: boolean
  /** Render the surface message as an ordinary completed answer rather than interrupted. */
  readonly settled?: boolean
  readonly latest?: boolean
  readonly sessionRunning?: boolean
  readonly pending?: boolean
  readonly kind?: 'user' | 'steering'
  readonly error?: TurnActionsView['error']
  readonly resend?: TurnActionsOwnerProps['resend']
  readonly resume?: TurnActionsOwnerProps['resume']
  /** Render the stopped Assistant marker beside the user row. */
  readonly withStopped?: boolean
}

/** Render the user row over the same Turn's tail, defaulting to a zero-output stopped answer. */
function renderUser(options: UserOptions = {}) {
  const t = makeTranslate(en, commonEn)
  const resend = options.resend ?? vi.fn<TurnActionsOwnerProps['resend']>()
  const resume = options.resume ?? vi.fn<TurnActionsOwnerProps['resume']>()
  const turnActions: TurnActionsOwnerProps = {
    sessionRunning: options.sessionRunning ?? false,
    state: { pending: options.pending ?? false, error: options.error ?? null },
    resend,
    resume,
  }
  const blocks: readonly never[] = []
  const finalNode = {
    kind: 'assistant',
    seq: 4,
    time: 900,
    turn: 1,
    step: 1,
    blocks,
    ...options.settled === true ? {} : { interrupted: true },
    messageId: 'assistant-1',
  }
  const userKey = 'user-key'
  const tailKey = 'tail-key'
  const turn = { turn: 1, start: { time: 0 }, end: { time: 1_000 } }
  const userNode = {
    key: userKey,
    kind: options.kind ?? 'user',
    id: 'user-1',
    target: 'chat',
    anchorSeq: 2,
    visibility: 'visible',
    location: { kind: 'turn', turn },
    data: options.kind === 'steering'
      ? { kind: 'steering', messageId: MESSAGE_ID, seq: 2, time: 2_000, turn: 1, content: [{ type: 'text', text: 'question' }], source: null }
      : { kind: 'user', messageId: MESSAGE_ID, seq: 2, time: 2_000, content: [{ type: 'text', text: 'question' }], source: null },
  }
  const tailNode = {
    key: tailKey,
    kind: 'turn-tail',
    id: '1',
    target: 'chat',
    anchorSeq: 5,
    visibility: 'visible',
    location: { kind: 'turn', turn },
    data: {
      turn: 1,
      seq: 5,
      time: 1_000,
      closing: { status: options.settled === true ? 'settled' : 'interrupted', turn: 1, step: 1, blocks, time: 900, finalNode },
      branchUnavailable: false,
      resendable: options.resendable ?? true,
      resumable: options.resumable ?? false,
    },
  }
  const turnOrder = options.latest === false ? [1, 2] : [1]
  const snapshot = {
    order: [userKey, tailKey],
    nodes: {
      get: (key: string) => key === userKey ? userNode : key === tailKey ? tailNode : undefined,
    },
    locations: { getTurn: (value: number) => value === 1 ? [userKey, tailKey] : [] },
    timeline: { turnOrder, turns: new Map() },
  }
  const props = {
    node: userNode,
    renderMessageImages: () => null,
    openFile: () => {},
    openSkill: () => {},
    turnActions,
    useChat: ((selector: (value: unknown) => unknown) => selector(snapshot)) as never,
    t: t as never,
  } as unknown as ChatNodeViewProps<'user' | 'steering'>
  const renderMessageImages = () => null
  const view = render(
    <>
      {options.withStopped === true && (
        <AssistantMarkdown
          blocks={blocks}
          streaming={false}
          interrupted
          renderMessageImages={renderMessageImages}
          t={t as ComponentProps<typeof AssistantMarkdown>['t']}
        />
      )}
      <UserMessageNodeView {...props} />
    </>,
  )
  return { resend, resume, view }
}

/** Open the inline editor and return its textarea. */
function openEditor(): HTMLTextAreaElement {
  fireEvent.click(screen.getByRole('button', { name: 'Edit and resend' }))
  return screen.getByRole('textbox', { name: 'Edit message and resend' }) as HTMLTextAreaElement
}

describe('UserMessageNodeView turn actions', () => {
  it('marks a zero-output stopped answer and offers edit / continue beside copy', () => {
    renderUser({ withStopped: true, resumable: true })
    // The aborted answer's durable settlement still renders its stopped marker.
    expect(screen.getByText('Stopped')).toBeTruthy()
    const copy = screen.getByRole('button', { name: 'Copy' })
    const edit = screen.getByRole('button', { name: 'Edit and resend' })
    const resume = screen.getByRole('button', { name: 'Continue' })
    // The controls ride copy's own chrome, seated immediately after it.
    expect(edit.className).toBe(copy.className)
    expect(resume.className).toBe(copy.className)
    expect(copy.compareDocumentPosition(edit) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    expect(edit.compareDocumentPosition(resume) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
  })

  it('prefills the editor with the prompt and replays the durable content when unchanged', () => {
    const { resend } = renderUser()
    const textarea = openEditor()
    expect(textarea.value).toBe('question')
    fireEvent.click(screen.getByRole('button', { name: 'Resend' }))
    expect(resend).toHaveBeenCalledWith(MESSAGE_ID, undefined)
    expect(screen.queryByRole('textbox', { name: 'Edit message and resend' })).toBeNull()
  })

  it('sends edited text and closes the editor', () => {
    const { resend } = renderUser()
    const textarea = openEditor()
    fireEvent.change(textarea, { target: { value: 'edited question' } })
    fireEvent.click(screen.getByRole('button', { name: 'Resend' }))
    expect(resend).toHaveBeenCalledWith(MESSAGE_ID, 'edited question')
    expect(screen.queryByRole('textbox', { name: 'Edit message and resend' })).toBeNull()
  })

  it('cancels the editor without admitting anything', () => {
    const { resend } = renderUser()
    openEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(resend).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: 'Edit message and resend' })).toBeNull()
  })

  it('refuses to submit an all-whitespace edit', () => {
    const { resend } = renderUser()
    const textarea = openEditor()
    fireEvent.change(textarea, { target: { value: '   ' } })
    const submit = screen.getByRole('button', { name: 'Resend' })
    expect(submit.getAttribute('disabled')).not.toBeNull()
    fireEvent.click(submit)
    expect(resend).not.toHaveBeenCalled()
  })

  it('continues a stopped latest turn', () => {
    const { resume } = renderUser({ resumable: true })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(resume).toHaveBeenCalledTimes(1)
  })

  it('hides the edit control when the turn is not resendable', () => {
    renderUser({ resendable: false })
    expect(screen.queryByRole('button', { name: 'Edit and resend' })).toBeNull()
  })

  it('hides both controls when a later turn exists', () => {
    renderUser({ resumable: true, latest: false })
    expect(screen.queryByRole('button', { name: 'Edit and resend' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()
  })

  it('hides both controls while the session is running', () => {
    renderUser({ resumable: true, sessionRunning: true })
    expect(screen.queryByRole('button', { name: 'Edit and resend' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()
  })

  it('hides both controls for a steering message', () => {
    renderUser({ kind: 'steering', resumable: true })
    expect(screen.queryByRole('button', { name: 'Edit and resend' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()
  })

  it('disables the edit control while an admission is pending', () => {
    renderUser({ pending: true })
    expect(screen.getByRole('button', { name: 'Edit and resend' }).getAttribute('disabled')).not.toBeNull()
  })

  it('shows the addressed resend failure after the row', () => {
    renderUser({ error: { action: 'resend', code: 'session/resend-unavailable', message: 'nope' } })
    expect(screen.getByRole('status').textContent).toBe('This message can no longer be resent')
  })

  it('shows the resume failure on the row that offers continue', () => {
    renderUser({ resumable: true, error: { action: 'resume', code: 'session/resume-unavailable', message: 'nope' } })
    expect(screen.getByRole('status').textContent).toBe('This turn can no longer continue')
  })

  it('translates an unclassified resend failure', () => {
    renderUser({ error: { action: 'resend', code: 'gateway/internal', message: 'nope' } })
    expect(screen.getByRole('status').textContent).toBe('Resend failed')
  })

  it('translates an unclassified resume failure', () => {
    renderUser({ resumable: true, error: { action: 'resume', code: 'gateway/internal', message: 'nope' } })
    expect(screen.getByRole('status').textContent).toBe('Continue failed')
  })

  it('shows no failure on a row that offers neither control', () => {
    renderUser({ resendable: false, error: { action: 'resend', code: 'gateway/internal', message: 'nope' } })
    expect(screen.queryByRole('status')).toBeNull()
  })
})
