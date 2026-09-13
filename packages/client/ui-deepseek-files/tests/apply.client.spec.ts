// @vitest-environment jsdom
import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply, inject } from '../src/client/index.ts'
import { DeepseekFilesSection } from '../src/client/DeepseekFilesSection.tsx'
import { DeepseekFilesSettingsController, type DeepseekFilesSettings } from '../src/client/controller.ts'

class RemoteService extends Service {
  readonly disposeListener = vi.fn()
  listener?: (ref: string) => void

  constructor(ctx: Context) {
    super(ctx, 'remote')
  }

  $on(_event: string, listener: (ref: string) => void): () => void {
    this.listener = listener
    return this.disposeListener
  }
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const remote = new RemoteService(ctx)
  const scope: SettingsScope<DeepseekFilesSettings> = {
    getSnapshot: () => ({
      status: 'ready', value: {}, base: undefined, user: undefined,
      revision: 0, writable: true, mode: 'host',
    }),
    subscribe: () => () => {},
    mutate: () => Promise.resolve(),
    set: () => Promise.resolve(),
    unset: () => Promise.resolve(),
  }
  ctx.provide('settingsScope', { bind: () => scope })
  ctx.provide('remote.credentials', {
    describe: vi.fn(() => Promise.resolve({ ok: true, value: {} })),
    set: vi.fn(),
    unset: vi.fn(),
  })
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
  return { ctx, slots, locale, remote }
}

describe('ui-deepseek-files browser plugin', () => {
  it('declares the settings and credential services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.credentials', 'settingsScope'])
  })

  it('registers and releases the localized Settings sections', async () => {
    const test = await bench()
    const fiber = test.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    const entry = test.slots.entries('settings.section').find(candidate => candidate.options.id === 'deepseek-files')
    expect(entry?.component).toBe(DeepseekFilesSection)
    expect(resolveSlotLabel(entry?.options.label)).toBe('Deepseek-Files')
    const face = (entry?.inject as (() => unknown) | undefined)?.() as { controller?: unknown } | undefined
    expect(face?.controller).toBeInstanceOf(DeepseekFilesSettingsController)
    const dataEntry = test.slots.entries('settings.section').find(candidate => candidate.options.id === 'desktop-data')
    expect(resolveSlotLabel(dataEntry?.options.label)).toBe('Desktop data')
    expect((dataEntry?.inject as (() => unknown) | undefined)?.()).toEqual({})
    test.remote.listener?.('DEEPSEEK_FILES_OCR_API_KEY')
    test.locale.setLocale('en')
    expect(resolveSlotLabel(entry?.options.label)).toBe('Deepseek-Files')

    await fiber.dispose()
    expect(test.slots.entries('settings.section').some(candidate => candidate.options.id === 'deepseek-files')).toBe(false)
    expect(test.remote.disposeListener).toHaveBeenCalledOnce()
    await test.ctx.fiber.dispose()
  })
})
