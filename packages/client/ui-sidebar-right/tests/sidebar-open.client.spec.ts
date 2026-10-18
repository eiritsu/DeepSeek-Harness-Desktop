import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { MutableSessionEventSource } from '@deepseek-ai/dsh-api-session-controller/client'
import { apply, inject } from '../src/client/index.ts'

const SESSION = 's-test' as SessionId

describe('ui-sidebar-right sidebar_open live event listener', () => {
  it('opens sidebar tabs and resources upon receiving live tool/call and tool/ptc-dispatch-start events', async () => {
    const ctx = new Context()
    const eventSource = new MutableSessionEventSource()

    const current = createSnapshotStore<{ key: SessionId | undefined }>({ key: SESSION })
    const sessions = {
      retain: vi.fn(() => ({ ready: Promise.resolve(), release: vi.fn() })),
      binding: vi.fn((sessionId: SessionId) => ({
        sessionId,
        eventSource,
      })),
    }

    const slots = {
      inject: vi.fn((_name: string, register: Parameters<Context['effect']>[0]) => ctx.effect(register)),
      register: vi.fn(() => () => {}),
    }
    const locale = {
      bind: vi.fn(() => (key: string) => key),
      register: vi.fn(() => () => {}),
    }
    const layout = {
      openRightbar: vi.fn(),
      closeRightbar: vi.fn(),
      panelInfo: createSnapshotStore<{ activePanelId: string | null }>({ activePanelId: null }),
    }
    const shortcuts = {
      runtime: 'web',
      register: () => () => {},
      catalog: { getSnapshot: () => [], subscribe: () => () => {} },
    }
    const resources = {
      pin: vi.fn(),
    }

    ctx.provide('slots', slots as never)
    ctx.provide('locale', locale as never)
    ctx.provide('shortcuts', shortcuts as never)
    ctx.provide('layout', layout as never)
    ctx.provide('resources', resources as never)
    ctx.provide('sessions', sessions as never)
    ctx.provide('uiSession', { adapter: { current } } as never)

    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    const controller = ctx.sidebarRight
    const openTabInSpy = vi.spyOn(controller, 'openTabIn').mockImplementation(() => {})
    const openResourceInSpy = vi.spyOn(controller, 'openResourceIn').mockImplementation(() => {})

    // 1. Native tool/call for session-inspector
    eventSource.append({
      type: 'event',
      event: {
        type: 'tool/call',
        seq: 1,
        time: 100,
        data: {
          turn: 1,
          step: 1,
          callId: 'call-1',
          name: 'sidebar_open',
          arguments: JSON.stringify({ tab: 'session-inspector' }),
        },
      } as never,
    })
    expect(openTabInSpy).toHaveBeenCalledWith(SESSION, 'session-inspector-log')

    // 2. Native tool/call for terminal
    eventSource.append({
      type: 'event',
      event: {
        type: 'tool/call',
        seq: 2,
        time: 200,
        data: {
          turn: 1,
          step: 1,
          callId: 'call-2',
          name: 'sidebar_open',
          arguments: JSON.stringify({ tab: 'terminal' }),
        },
      } as never,
    })
    expect(openTabInSpy).toHaveBeenCalledWith(SESSION, 'terminal')

    // 3. Native tool/call for browser with url target
    eventSource.append({
      type: 'event',
      event: {
        type: 'tool/call',
        seq: 3,
        time: 300,
        data: {
          turn: 1,
          step: 1,
          callId: 'call-3',
          name: 'sidebar_open',
          arguments: JSON.stringify({ tab: 'browser', target: 'https://example.com' }),
        },
      } as never,
    })
    expect(openTabInSpy).toHaveBeenCalledWith(SESSION, 'browser', { params: { url: 'https://example.com' } })

    // 4. Native tool/call for files with specific file target
    eventSource.append({
      type: 'event',
      event: {
        type: 'tool/call',
        seq: 4,
        time: 400,
        data: {
          turn: 1,
          step: 1,
          callId: 'call-4',
          name: 'sidebar_open',
          arguments: JSON.stringify({ tab: 'files', target: 'src/index.ts' }),
        },
      } as never,
    })
    expect(openResourceInSpy).toHaveBeenCalledWith(SESSION, 'dsh-resource://file/session/s-test/src/index.ts')

    // 5. Native tool/call for files without target
    eventSource.append({
      type: 'event',
      event: {
        type: 'tool/call',
        seq: 5,
        time: 500,
        data: {
          turn: 1,
          step: 1,
          callId: 'call-5',
          name: 'sidebar_open',
          arguments: JSON.stringify({ tab: 'files' }),
        },
      } as never,
    })
    expect(openTabInSpy).toHaveBeenCalledWith(SESSION, 'files')

    // 5b. Native tool/call for browser_open
    eventSource.append({
      type: 'event',
      event: {
        type: 'tool/call',
        seq: 51,
        time: 550,
        data: {
          turn: 1,
          step: 1,
          callId: 'call-51',
          name: 'browser_open',
          arguments: JSON.stringify({ url: 'https://deepseek.com' }),
        },
      } as never,
    })
    expect(openTabInSpy).toHaveBeenCalledWith(SESSION, 'browser', { params: { url: 'https://deepseek.com' } })

    // 6. PTC mode tool/ptc-dispatch-start
    eventSource.append({
      type: 'event',
      event: {
        type: 'tool/ptc-dispatch-start',
        seq: 6,
        time: 600,
        data: {
          rootCallId: 'root-call',
          parentCallId: 'root-call',
          subCallId: 'sub-call-1',
          name: 'sidebar_open',
          arguments: { tab: 'terminal' },
        },
      } as never,
    })
    expect(openTabInSpy).toHaveBeenCalledWith(SESSION, 'terminal')

    // 7. Duplicate callId should be ignored
    openTabInSpy.mockClear()
    eventSource.append({
      type: 'event',
      event: {
        type: 'tool/call',
        seq: 7,
        time: 700,
        data: {
          turn: 1,
          step: 1,
          callId: 'call-1', // already handled
          name: 'sidebar_open',
          arguments: JSON.stringify({ tab: 'session-inspector' }),
        },
      } as never,
    })
    expect(openTabInSpy).not.toHaveBeenCalled()

    await fiber.dispose()
  })
})
