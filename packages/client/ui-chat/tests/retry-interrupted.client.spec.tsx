// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach } from 'vitest'
import type { ComponentProps } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { MessageId } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { RetryInterruptedController } from '../src/client/chat/retry-interrupted.ts'
import { TurnTailNodeView } from '../src/client/chat/TurnTailNodeView.tsx'
import { en } from '../src/client/locale.ts'
import type { RetryInterruptedOwnerProps } from '../src/client/contract/slots.ts'

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

    controller.retry('m1' as MessageId)
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
    controller.retry('m1' as MessageId)
    controller.retry('m1' as MessageId)
    expect(remote).toHaveBeenCalledTimes(1)
    call.resolve({ ok: true, value: { accepted: true } })
  })

  it('publishes the addressed failure', async () => {
    const call = deferred()
    const controller = controllerFor(vi.fn(() => call.promise))
    controller.retry('m1' as MessageId)
    call.resolve({ ok: false, error: { code: 'session/retry-unavailable', message: 'nope' } })
    await act(async () => { await call.promise })
    expect(controller.getSnapshot()).toEqual({
      pending: false,
      error: { messageId: 'm1', code: 'session/retry-unavailable', message: 'nope' },
    })
  })

  it('drops a settlement invalidated by a connection reset', async () => {
    const call = deferred()
    const controller = controllerFor(vi.fn(() => call.promise))
    controller.retry('m1' as MessageId)
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
    controller.retry('m1' as MessageId)
    expect(remote).not.toHaveBeenCalled()
    expect(() => { controller.invalidate() }).not.toThrow()
    expect(controller.getSnapshot()).toEqual({ pending: false, error: null })
  })

  it('publishes a carrier rejection and contains a throwing subscriber', async () => {
    const call = deferred()
    const controller = controllerFor(vi.fn(() => call.promise))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    controller.subscribe(() => { throw new Error('bad subscriber') })
    controller.retry('m1' as MessageId)
    call.reject(new Error('boom'))
    await act(async () => { await call.promise.catch(() => {}) })
    expect(controller.getSnapshot()).toEqual({
      pending: false,
      error: { messageId: 'm1', code: 'gateway/internal', message: 'boom' },
    })
    consoleError.mockRestore()
  })
})

interface TailOptions {
  readonly retryable?: boolean
  readonly latest?: boolean
  readonly sessionRunning?: boolean
  readonly pending?: boolean
  readonly omitMessageId?: boolean
  readonly error?: { readonly messageId: string; readonly code: string; readonly message: string } | null
  readonly run?: (messageId: MessageId) => void
}

function renderTail(options: TailOptions = {}) {
  const t = makeTranslate(en)
  const run = options.run ?? vi.fn<(messageId: MessageId) => void>()
  const retryInterrupted: RetryInterruptedOwnerProps = {
    sessionRunning: options.sessionRunning ?? false,
    state: { pending: options.pending ?? false, error: (options.error ?? null) as never },
    run,
  }
  const nodeKey = 'tail-1'
  const turnOrder = options.latest === false ? [1, 2] : [1]
  const snapshot = {
    locations: { getTurn: () => [{ key: nodeKey }] },
    timeline: { turnOrder },
  }
  const node = {
    key: nodeKey,
    kind: 'turn-tail',
    id: '1',
    target: 'chat',
    anchorSeq: 5,
    visibility: 'visible',
    location: { kind: 'turn', turn: { turn: 1, start: { time: 0 }, end: { time: 1000 } } },
    data: {
      turn: 1,
      seq: 5,
      time: 1000,
      closing: {
        status: 'interrupted',
        turn: 1,
        step: 1,
        time: 900,
        blocks: [{ kind: 'text', text: 'half an answer' }],
        finalNode: {
          kind: 'assistant',
          seq: 4,
          ...(options.omitMessageId === true ? {} : { messageId: 'm1' }),
          time: 900,
          turn: 1,
          step: 1,
          blocks: [{ kind: 'text', text: 'half an answer' }],
          timing: { stepStartTime: 0, firstTokenTime: 1, completedTime: 900 },
          interrupted: true,
        },
      },
      branchUnavailable: false,
      retryable: options.retryable ?? true,
    },
  }
  const props = {
    node,
    openFile: () => {},
    openSkill: () => {},
    inspectCall: () => {},
    forkAt: () => {},
    loadImage: (() => Promise.reject(new Error('unused'))) as never,
    renderMessageImages: () => null,
    fileMentions: () => undefined,
    useTurnData: () => undefined,
    renderSlot: () => null,
    renderSlotChain: () => null,
    retryInterrupted,
    t: t as never,
    useChat: ((selector: (value: unknown) => unknown) => selector(snapshot)) as never,
  } as unknown as ComponentProps<typeof TurnTailNodeView>
  render(<TurnTailNodeView {...props} />)
  return { run }
}

describe('TurnTailNodeView retry action', () => {
  it('shows the Retry action and admits the addressed message', () => {
    const { run } = renderTail()
    const button = screen.getByRole('button', { name: 'Retry' })
    fireEvent.click(button)
    expect(run).toHaveBeenCalledWith('m1')
  })

  it('hides the action when the turn is not retryable', () => {
    renderTail({ retryable: false })
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('hides the action when the closing answer carries no durable message id', () => {
    renderTail({ omitMessageId: true })
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('hides the action when a later turn exists', () => {
    renderTail({ latest: false })
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('hides the action while the session is running', () => {
    renderTail({ sessionRunning: true })
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('disables the action while an admission is pending', () => {
    renderTail({ pending: true })
    expect(screen.getByRole('button', { name: 'Retry' }).getAttribute('disabled')).not.toBeNull()
  })

  it('shows the addressed failure beside the action', () => {
    renderTail({ error: { messageId: 'm1', code: 'session/retry-unavailable', message: 'nope' } })
    expect(screen.getByRole('status').textContent).toBe('This answer can no longer be retried')
  })
})
