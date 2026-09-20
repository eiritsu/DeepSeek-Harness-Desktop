/** Computer Use section apply wiring: availability-gated section registration,
 * scope projection, write routing, retraction, and teardown recovery. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import Schema from '@deepseek-ai/schemastery'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply, inject } from '../src/client/index.ts'
import type { ComputerUseInjected } from '../src/client/index.ts'
import { ComputerUseSection } from '../src/client/ComputerUseSection.tsx'
import type { createComputerUseStore } from '../src/client/settings-store.ts'
import { ENABLED_FIELD, SETTINGS_NAMESPACE } from '../src/settings-contract.ts'

const SLOT = 'settings.section'
const LOCALE = 'settings.computerUse'
const SCHEMA = Schema.object({ enabled: Schema.boolean().default(true) }).toJSON()

async function bench(options: { isLoopback?: boolean; available?: boolean } = {}) {
  let available = options.available ?? true
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const section: Record<string, unknown> = { [ENABLED_FIELD]: true }
  const namespace = () => ({
    ns: SETTINGS_NAMESPACE,
    schema: SCHEMA,
    value: { ...section },
    applies: 'live' as const,
    secrets: [],
    revision: 0,
  })
  const describe = vi.fn(() => Promise.resolve({
    ok: true as const,
    value: { writable: true, hasDocument: true, namespaces: available ? [namespace()] : [] },
  }))
  const mutate = vi.fn((_ns: string, ops: { path: string[]; value: unknown }[]) => {
    const op = ops[0]!
    section[op.path[0]!] = op.value
    return Promise.resolve({ ok: true as const, value: namespace() })
  })
  const events = new TestRemote(ctx, { settings: { describe, mutate } })
  events.$host = { home: undefined, isLoopback: options.isLoopback ?? true }
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  return {
    ctx, slots: ctx.get('slots') as SlotRegistry, locale, describe, mutate, events,
    setHostSection: (next: Record<string, unknown>) => { Object.assign(section, next) },
    setAvailable: (next: boolean) => { available = next },
  }
}

/** Stand in for the settings shell: declare the section slot from root. */
function declareSections(slots: SlotRegistry): () => void {
  return slots.register(
    { name: 'root', children: { [SLOT]: { kind: 'list', scope: 'root' } } } as never,
    () => null,
  )
}

/** Mirror the framework's inject choreography: bake a real instance from the
 * declared handle and hand its actions to the entry's inject factory. */
function faceOf(slots: SlotRegistry) {
  const entry = slots.entries(SLOT).find(candidate => candidate.component === ComputerUseSection)!
  const handle = entry.store as ReturnType<typeof createComputerUseStore>
  const instance = handle.create()
  const face = (entry.inject as unknown as (actions: typeof instance.actions) => ComputerUseInjected)(instance.actions)
  return { entry, instance, face }
}

/** Wait for the availability-gated section contribution to land. */
async function sectionReady(slots: SlotRegistry): Promise<void> {
  await vi.waitFor(() => {
    expect(slots.entries(SLOT).some(entry => entry.component === ComputerUseSection)).toBe(true)
  })
}

describe('computer-use section client apply', () => {
  it('declares the settings, locale, and slot services', () => {
    expect(inject).toEqual(['slots', 'locale', 'settingsScope'])
  })

  it('registers the localized top-level section once the namespace resolves', async () => {
    const b = await bench()
    declareSections(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    await sectionReady(b.slots)
    expect(b.locale.bind(LOCALE)('computerUse.nav')).toBe('电脑操作')
    b.locale.setLocale('en')
    expect(b.locale.bind(LOCALE)('computerUse.nav')).toBe('Computer Use')
    const entry = b.slots.entries(SLOT).find(candidate => candidate.component === ComputerUseSection)!
    expect(entry.options).toMatchObject({ id: 'computer-use', order: 20 })
    expect(resolveSlotLabel(entry.options.label)).toBe('Computer Use')
    expect(entry.locale).toBe(LOCALE)
  })

  it('activates before a late declaration and contributes once the slot appears', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries(SLOT)).toHaveLength(0)
    declareSections(b.slots)
    await sectionReady(b.slots)
  })

  it('keeps the section absent while the namespace is unavailable, then contributes on late availability', async () => {
    const b = await bench({ available: false })
    declareSections(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    // The mirror resolved to "unavailable": no page and no navigation entry.
    await vi.waitFor(() => { expect(b.describe).toHaveBeenCalled() })
    expect(b.slots.entries(SLOT)).toHaveLength(0)

    b.setAvailable(true)
    b.events.emit('settings/document-updated', [SETTINGS_NAMESPACE, 0])
    await sectionReady(b.slots)
  })

  it('retracts the section when the namespace disappears and restores it on reconnect', async () => {
    const b = await bench()
    declareSections(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    await sectionReady(b.slots)

    b.setAvailable(false)
    b.ctx.emit('connection/reset')
    await vi.waitFor(() => { expect(b.slots.entries(SLOT)).toHaveLength(0) })

    b.setAvailable(true)
    b.ctx.emit('connection/reset')
    await sectionReady(b.slots)
  })

  it('projects scope snapshots into the section store and routes face writes back', async () => {
    const b = await bench()
    declareSections(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    await sectionReady(b.slots)
    const { instance, face } = faceOf(b.slots)
    expect(instance.getSnapshot()).toEqual({ available: true, writable: true, enabled: true })

    face.setEnabled(false)
    await vi.waitFor(() => { expect(b.mutate).toHaveBeenCalledTimes(1) })
    await vi.waitFor(() => { expect(instance.getSnapshot().enabled).toBe(false) })
  })

  it('re-syncs from the scope getter when the renderer binds actions after a change', async () => {
    const b = await bench()
    declareSections(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    await sectionReady(b.slots)
    b.setHostSection({ [ENABLED_FIELD]: false })
    b.events.emit('settings/document-updated', [SETTINGS_NAMESPACE, 0])
    await vi.waitFor(() => { expect(b.describe).toHaveBeenCalledTimes(2) })

    const { instance } = faceOf(b.slots)
    // The inject-time re-sync sealed the init window: the mirror is current.
    expect(instance.getSnapshot().enabled).toBe(false)
  })

  it('contains a failed write and reports it', async () => {
    const b = await bench()
    declareSections(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    await sectionReady(b.slots)
    const error = vi.spyOn(b.ctx.logger, 'error')
    const { face } = faceOf(b.slots)
    b.mutate.mockRejectedValueOnce(new Error('settings wire unavailable'))
    face.setEnabled(false)
    await vi.waitFor(() => { expect(error).toHaveBeenCalled() })
    error.mockRestore()
  })

  it('keeps a remote browser process-local', async () => {
    const b = await bench({ isLoopback: false })
    declareSections(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries(SLOT)).toHaveLength(0)
    expect(b.describe).not.toHaveBeenCalled()
  })

  it('recovers after an HMR collapse of the declaring entry', async () => {
    const b = await bench()
    const host = declareSections(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    await sectionReady(b.slots)

    host()
    expect(b.slots.entries(SLOT)).toHaveLength(0)

    declareSections(b.slots)
    await sectionReady(b.slots)
  })

  it('teardown removes the section and the dictionary; teardown without a declaration is quiet', async () => {
    const b = await bench()
    declareSections(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await sectionReady(b.slots)
    await fiber.dispose()
    expect(b.slots.entries(SLOT)).toHaveLength(0)
    expect(b.locale.bind(LOCALE)('computerUse.nav')).toBe('computerUse.nav')

    const quiet = await bench()
    const f2 = quiet.ctx.plugin({ inject: [...inject], apply })
    await f2.await()
    await f2.dispose()
    expect(quiet.slots.entries(SLOT)).toHaveLength(0)
  })
})
