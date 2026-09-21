// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach } from 'vitest'
import type { ComponentProps } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionInterruptedRetryTarget } from '@deepseek-ai/dsh-api-remotes/client'
import type { MessageId } from '@deepseek-ai/dsh-api-remotes/client'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { ChatNodeViewProps, RetryInterruptedOwnerProps } from '../src/client/contract/slots.ts'
import type { RetryInterruptedView } from '../src/client/chat/retry-interrupted.ts'
import { RetryInterruptedController } from '../src/client/chat/retry-interrupted.ts'
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

const MESSAGE_TARGET: SessionInterruptedRetryTarget = {
  kind: 'assistant-message',
  messageId: 'm1' as MessageId,
}
const ATTEMPT_TARGET: SessionInterruptedRetryTarget = { kind: 'assistant-attempt', seq: SessionSeq(4) }

function controllerFor(remote: ReturnType<typeof vi.fn>): RetryInterruptedController {
  const ctx = { remote: { session: { retryInterrupted: remote } } } as unknown as ClientContext
  return new RetryInterruptedController(ctx, 's1' as SessionId)
}

describe('RetryInterruptedController', () => {
  it('publishes pending then clears on acceptance', async () => {
    const call = deferred()
    const remote = vi.fn(() => call.promise)
    const controller = controllerFor(remote)
    const seen: unknown[] = []
    controller.subscribe(() => { seen.push(controller.getSnapshot()) })

    controller.retry(MESSAGE_TARGET)
    expect(controller.getSnapshot().pending).toBe(true)
    call.resolve({ ok: true, value: { accepted: true } })
    await act(async () => { await call.promise })
    expect(controller.getSnapshot()).toEqual({ pending: false, error: null })
    expect(seen).toEqual([{ pending: true, error: null }, { pending: false, error: null }])
  })

  it('accepts a double click once', () => {
    const call = deferred()
    const remote = vi.fn(() => call.promise)
    const controller = controllerFor(remote)
    controller.retry(MESSAGE_TARGET)
    controller.retry(MESSAGE_TARGET)
    expect(remote).toHaveBeenCalledTimes(1)
    call.resolve({ ok: true, value: { accepted: true } })
  })

  it('publishes the addressed failure', async () => {
    const call = deferred()
    const controller = controllerFor(vi.fn(() => call.promise))
    controller.retry(ATTEMPT_TARGET)
    call.resolve({ ok: false, error: { code: 'session/retry-unavailable', message: 'nope' } })
    await act(async () => { await call.promise })
    expect(controller.getSnapshot()).toEqual({
      pending: false,
      error: { target: ATTEMPT_TARGET, code: 'session/retry-unavailable', message: 'nope' },
    })
  })

  it('drops a settlement invalidated by a connection reset', async () => {
    const call = deferred()
    const controller = controllerFor(vi.fn(() => call.promise))
    controller.retry(MESSAGE_TARGET)
    controller.invalidate()
    expect(controller.getSnapshot()).toEqual({ pending: false, error: null })
    call.resolve({ ok: false, error: { code: 'gateway/internal', message: 'stale' } })
    await act(async () => { await call.promise })
    expect(controller.getSnapshot()).toEqual({ pending: false, error: null })
  })

  it('refuses further work after disposal', () => {
    const remote = vi.fn(() => deferred().promise)
    const controller = controllerFor(remote)
    controller.dispose()
    controller.retry(MESSAGE_TARGET)
    expect(remote).not.toHaveBeenCalled()
    expect(() => { controller.invalidate() }).not.toThrow()
    expect(controller.getSnapshot()).toEqual({ pending: false, error: null })
  })

  it('publishes a carrier rejection and contains a throwing subscriber', async () => {
    const call = deferred()
    const controller = controllerFor(vi.fn(() => call.promise))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    controller.subscribe(() => { throw new Error('bad subscriber') })
    controller.retry(MESSAGE_TARGET)
    call.reject(new Error('boom'))
    await act(async () => { await call.promise.catch(() => {}) })
    expect(controller.getSnapshot()).toEqual({
      pending: false,
      error: { target: MESSAGE_TARGET, code: 'gateway/internal', message: 'boom' },
    })
    consoleError.mockRestore()
  })
})

interface UserOptions {
  readonly retryable?: boolean
  /** Defaults to the zero-output aborted attempt: no surface message, empty stream. */
  readonly surfaceMessage?: boolean
  /** Render the surface message as an ordinary completed answer rather than interrupted. */
  readonly settled?: boolean
  readonly attemptSeq?: number
  /** Closing settlement carries neither a message id nor an attempt seq. */
  readonly noAddress?: boolean
  readonly latest?: boolean
  readonly sessionRunning?: boolean
  readonly pending?: boolean
  readonly kind?: 'user' | 'steering'
  readonly error?: RetryInterruptedView['error']
  readonly run?: (target: SessionInterruptedRetryTarget) => void
  /** Render the stopped Assistant marker beside the user row. */
  readonly withStopped?: boolean
}

/** Render the user row over the same Turn's tail, defaulting to a zero-output stopped answer. */
function renderUser(options: UserOptions = {}) {
  const t = makeTranslate(en)
  const run = options.run ?? vi.fn<(target: SessionInterruptedRetryTarget) => void>()
  const retryInterrupted: RetryInterruptedOwnerProps = {
    sessionRunning: options.sessionRunning ?? false,
    state: { pending: options.pending ?? false, error: options.error ?? null },
    run,
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
    ...options.surfaceMessage === true
      ? { messageId: 'm1' }
      : options.noAddress === true ? {} : { attemptSeq: options.attemptSeq ?? 4 },
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
      ? { kind: 'steering', messageId: 'steer-1', seq: 2, time: 2_000, turn: 1, content: [{ type: 'text', text: 'question' }], source: null }
      : { kind: 'user', seq: 2, time: 2_000, content: [{ type: 'text', text: 'question' }], source: null },
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
      retryable: options.retryable ?? true,
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
    retryInterrupted,
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
  return { run, view }
}

describe('UserMessageNodeView retry action', () => {
  it('marks a zero-output stopped answer and offers retry after copy, admitting its attempt seq', () => {
    const { run } = renderUser({ withStopped: true })
    // The aborted answer's durable settlement still renders its stopped marker.
    expect(screen.getByText('Stopped')).toBeTruthy()
    const copy = screen.getByRole('button', { name: 'copy' })
    const retry = screen.getByRole('button', { name: 'Retry' })
    // Retry rides copy's own control chrome and sits immediately after it.
    expect(retry.className).toBe(copy.className)
    expect(copy.compareDocumentPosition(retry) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    fireEvent.click(retry)
    expect(run).toHaveBeenCalledWith(ATTEMPT_TARGET)
  })

  it('admits the interrupted surface message id', () => {
    const { run } = renderUser({ surfaceMessage: true })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(run).toHaveBeenCalledWith(MESSAGE_TARGET)
  })

  it('admits the completed surface message id of the latest safe answer', () => {
    const { run } = renderUser({ surfaceMessage: true, settled: true })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(run).toHaveBeenCalledWith(MESSAGE_TARGET)
  })

  it('hides retry when the turn is not retryable', () => {
    renderUser({ retryable: false })
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('hides retry when a later turn exists', () => {
    renderUser({ latest: false })
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('hides retry while the session is running', () => {
    renderUser({ sessionRunning: true })
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('hides retry for a steering message', () => {
    renderUser({ kind: 'steering' })
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('hides retry when the closing answer addresses no durable settlement', () => {
    renderUser({ noAddress: true })
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('disables retry while an admission is pending', () => {
    renderUser({ pending: true })
    expect(screen.getByRole('button', { name: 'Retry' }).getAttribute('disabled')).not.toBeNull()
  })

  it('shows the addressed failure after the row', () => {
    renderUser({ error: { target: ATTEMPT_TARGET, code: 'session/retry-unavailable', message: 'nope' } })
    expect(screen.getByRole('status').textContent).toBe('This answer can no longer be retried')
  })

  it('does not show a failure addressed to another settlement', () => {
    renderUser({
      error: { target: { kind: 'assistant-attempt', seq: SessionSeq(99) }, code: 'session/retry-unavailable', message: 'nope' },
    })
    expect(screen.queryByRole('status')).toBeNull()
  })
})
