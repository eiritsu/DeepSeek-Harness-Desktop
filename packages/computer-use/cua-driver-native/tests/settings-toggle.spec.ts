/** The durable provider setting drives the native runtime lifecycle. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ComputerUseRegistry from '@deepseek-ai/dsh-computer-use'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import * as NativeProvider from '../src/index.ts'
import { DEFAULT_ENABLED, ENABLED_FIELD, SETTINGS_NAMESPACE } from '../src/settings.ts'
import { fixture, resetFixture } from './fixtures/cua-driver.ts'

vi.mock('@trycua/cua-driver', async () => import('./fixtures/cua-driver.ts'))

/** Minimal real settings provider: the external storage boundary for this suite. */
class MemorySettings extends SettingsProvider {
  /** Raw stored document. */
  doc: Record<string, unknown>

  /**
   * @param ctx - owning context.
   * @param options - initial document.
   */
  constructor(ctx: ConstructorParameters<typeof SettingsProvider>[0], options?: { doc?: Record<string, unknown> }) {
    super(ctx)
    this.doc = structuredClone(options?.doc ?? {})
  }

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc[ns] = structuredClone(section)
    return Promise.resolve()
  }
}

let ctx: Context

beforeEach(async () => {
  resetFixture()
  ctx = new Context()
  await ctx.plugin(ComputerUseRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(MemorySettings)
})

afterEach(async () => {
  await ctx.fiber.dispose()
})

/** Wait until the provider holds the exclusive computer-use registration. */
async function mounted(): Promise<void> {
  await vi.waitFor(() => { expect(ctx.computerUse.providerName).toBe('cua-driver-native') })
}

/** Wait until the provider's settings namespace is served. */
async function registered(): Promise<void> {
  await vi.waitFor(() => {
    expect(ctx.settings.describe().some(descriptor => descriptor.ns === SETTINGS_NAMESPACE)).toBe(true)
  })
}

describe('native provider settings toggle', () => {
  it('pins the durable namespace, field, and default the browser half restates', () => {
    expect(SETTINGS_NAMESPACE).toBe('computer-use-cua-driver-native')
    expect(ENABLED_FIELD).toBe('enabled')
    expect(DEFAULT_ENABLED).toBe(true)
  })

  it('unmounts on the durable disable and mounts again on enable', async () => {
    const fiber = ctx.plugin(NativeProvider)
    await fiber
    await registered()
    await mounted()
    expect(fixture.creates).toBe(1)

    await ctx.settings.update(SETTINGS_NAMESPACE, { enabled: false })
    await vi.waitFor(() => { expect(ctx.computerUse.providerName).toBeUndefined() })
    expect(ctx.tools.schemas()).toEqual([])
    expect(fixture.shutdowns).toBe(1)
    expect(fixture.destroys).toBe(1)

    await ctx.settings.update(SETTINGS_NAMESPACE, { enabled: true })
    await vi.waitFor(() => { expect(fixture.creates).toBe(2) })
    await mounted()
    expect(ctx.tools.schemas().length).toBeGreaterThan(0)
  })

  it('keeps a disabled composition unmounted and reports the composition base', async () => {
    const fiber = ctx.plugin(NativeProvider, { enabled: false })
    await fiber
    await registered()
    expect(ctx.computerUse.providerName).toBeUndefined()
    expect(fixture.creates).toBe(0)
    const descriptor = ctx.settings.describe().find(candidate => candidate.ns === SETTINGS_NAMESPACE)
    expect(descriptor?.base).toEqual({ enabled: false })
    expect(descriptor?.value).toEqual({ enabled: false })

    await ctx.settings.update(SETTINGS_NAMESPACE, { enabled: true })
    await vi.waitFor(() => { expect(fixture.creates).toBe(1) })
    await mounted()
  })

  it('closes the old runtime before a superseding enable starts the next', async () => {
    const shutdownStarted: PromiseWithResolvers<void> = Promise.withResolvers()
    const shutdownSettled: PromiseWithResolvers<void> = Promise.withResolvers()
    fixture.shutdown = async () => {
      shutdownStarted.resolve()
      await shutdownSettled.promise
    }
    const fiber = ctx.plugin(NativeProvider)
    await fiber
    await registered()
    await mounted()

    await ctx.settings.update(SETTINGS_NAMESPACE, { enabled: false })
    await shutdownStarted.promise
    await ctx.settings.update(SETTINGS_NAMESPACE, { enabled: true })
    // The enable waits for the shutdown that still owns the exclusive registration.
    expect(fixture.creates).toBe(1)
    expect(ctx.computerUse.providerName).toBe('cua-driver-native')

    shutdownSettled.resolve()
    await vi.waitFor(() => { expect(fixture.creates).toBe(2) })
    expect(fixture.shutdowns).toBe(1)
    expect(fixture.destroys).toBe(1)
    await mounted()
  })

  it('supersedes an in-flight startup disable without failing activation', async () => {
    fixture.list = signal => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => { reject(new Error('Native discovery aborted')) }, { once: true })
    })
    const fiber = ctx.plugin(NativeProvider)
    await registered()
    await vi.waitFor(() => { expect(fixture.creates).toBe(1) })

    await ctx.settings.update(SETTINGS_NAMESPACE, { enabled: false })
    await vi.waitFor(() => { expect(fixture.destroys).toBe(1) })
    await fiber
    expect(ctx.computerUse.providerName).toBeUndefined()
    expect(ctx.tools.schemas()).toEqual([])
    expect(fixture.shutdowns).toBe(1)

    delete fixture.list
    await ctx.settings.update(SETTINGS_NAMESPACE, { enabled: true })
    await vi.waitFor(() => { expect(fixture.creates).toBe(2) })
    await mounted()
  })

  it('aborts a pending native call on disable and releases the reservation after settlement', async () => {
    const called: PromiseWithResolvers<void> = Promise.withResolvers()
    const callSettled: PromiseWithResolvers<unknown> = Promise.withResolvers()
    fixture.call = async () => {
      called.resolve()
      return callSettled.promise
    }
    const fiber = ctx.plugin(NativeProvider)
    await fiber
    await registered()
    await mounted()

    const result = ctx.tools.execute({
      name: 'cua_driver_native__click',
      callId: ToolCallId('toggle-abort'),
      arguments: { pid: 9, window_id: 7 },
      signal: new AbortController().signal,
    })
    await called.promise
    await ctx.settings.update(SETTINGS_NAMESPACE, { enabled: false })
    await vi.waitFor(() => { expect(fixture.calls[0]?.signal?.aborted).toBe(true) })
    expect(ctx.computerUse.providerName).toBe('cua-driver-native')
    expect(ctx.tools.schemas()).toEqual([])
    expect(fixture.destroys).toBe(0)

    callSettled.resolve({ content: [{ type: 'text', text: 'late completion' }] })
    await vi.waitFor(() => { expect(ctx.computerUse.providerName).toBeUndefined() })
    expect((await result).isError).toBe(true)
    expect(fixture.shutdowns).toBe(1)
    expect(fixture.destroys).toBe(1)
  })

  it('contains a failed enable and recovers on the next change', async () => {
    const fiber = ctx.plugin(NativeProvider, { enabled: false })
    await fiber
    await registered()

    fixture.createError = new Error('native library initialization failed')
    await ctx.settings.update(SETTINGS_NAMESPACE, { enabled: true })
    await vi.waitFor(() => { expect(fixture.creates).toBe(1) })
    await vi.waitFor(() => { expect(ctx.computerUse.providerName).toBeUndefined() })
    expect(ctx.tools.schemas()).toEqual([])
    expect(fixture.shutdowns).toBe(0)

    delete fixture.createError
    await ctx.settings.update(SETTINGS_NAMESPACE, { enabled: false })
    await ctx.settings.update(SETTINGS_NAMESPACE, { enabled: true })
    await vi.waitFor(() => { expect(fixture.creates).toBe(2) })
    await mounted()
  })

  it('logs a failed rollback teardown and keeps the reservation', async () => {
    fixture.list = () => Promise.reject(new Error('native discovery failed'))
    fixture.shutdown = () => Promise.reject(new Error('native shutdown failed'))
    const error = vi.spyOn(ctx.logger, 'error')
    const fiber = ctx.plugin(NativeProvider, { enabled: false })
    await fiber
    await registered()

    await ctx.settings.update(SETTINGS_NAMESPACE, { enabled: true })
    await vi.waitFor(() => { expect(fixture.shutdowns).toBe(1) })
    // A failed start rolls back; when that teardown also fails, the child's
    // tools are gone but the registration stays occupied, the documented
    // failed-shutdown behavior. The rollback failure is logged.
    await vi.waitFor(() => { expect(error).toHaveBeenCalled() })
    expect(ctx.tools.schemas()).toEqual([])
    expect(ctx.computerUse.providerName).toBe('cua-driver-native')
    error.mockRestore()
  })

  it('coalesces repeated requests for the current state', async () => {
    const fiber = ctx.plugin(NativeProvider)
    await fiber
    await registered()
    await mounted()

    await ctx.settings.update(SETTINGS_NAMESPACE, { enabled: true })
    await ctx.settings.update(SETTINGS_NAMESPACE, { enabled: true })
    await Promise.resolve()
    expect(fixture.creates).toBe(1)
    expect(fixture.destroys).toBe(0)
    await mounted()
  })
})
