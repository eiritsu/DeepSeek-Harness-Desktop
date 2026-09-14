// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, inject, NS } from '../src/client/index.ts'
import { SkillLibraryOverlay } from '../src/client/SkillLibraryOverlay.tsx'
import { SkillLibraryTrigger } from '../src/client/SkillLibraryTrigger.tsx'

afterEach(() => {
  Reflect.deleteProperty(window, 'dshDesktop')
  Reflect.deleteProperty(window, 'dshDesktopPluginBridge')
})

function context() {
  const entries: unknown[] = []
  const slots = {
    inject: vi.fn((_name: string, mount: () => unknown) => mount()),
    register: vi.fn((options: unknown, component: unknown) => { entries.push({ options, component }); return vi.fn() }),
  }
  const locale = { register: vi.fn(() => vi.fn()) }
  return { ctx: { effect: (effect: () => unknown) => effect(), slots, locale }, entries, locale }
}

describe('ui-skill-library browser entry', () => {
  it('does not register outside a desktop shell', () => {
    const test = context()
    expect(inject).toEqual(['slots', 'locale'])
    expect(NS).toBe('skillLibrary')
    apply(test.ctx as never)
    expect(test.entries).toEqual([])
  })

  it.each(['swift', 'electron'] as const)('registers trigger and overlay through the %s bridge', (shell) => {
    const bridge = { request: vi.fn() }
    if (shell === 'swift') Object.defineProperty(window, 'dshDesktopPluginBridge', { configurable: true, value: bridge })
    else Object.defineProperty(window, 'dshDesktop', { configurable: true, value: { skills: bridge } })
    const test = context()
    apply(test.ctx as never)
    expect(test.locale.register).toHaveBeenCalledOnce()
    const [trigger, overlay] = test.entries as Array<{ options: { inject: () => unknown }; component: unknown }>
    expect(trigger?.component).toBe(SkillLibraryTrigger)
    expect(overlay?.component).toBe(SkillLibraryOverlay)
    const triggerFace = trigger?.options.inject() as { controller: unknown }
    expect(overlay?.options.inject()).toEqual({ controller: triggerFace.controller, bridge })
  })

  it('prefers the dedicated Electron Skill bridge when the legacy Swift bridge is also present', () => {
    const electron = { request: vi.fn() }
    const legacy = { request: vi.fn() }
    Object.defineProperty(window, 'dshDesktop', { configurable: true, value: { skills: electron } })
    Object.defineProperty(window, 'dshDesktopPluginBridge', { configurable: true, value: legacy })
    const test = context()

    apply(test.ctx as never)

    const overlay = test.entries[1] as { options: { inject: () => { bridge: unknown } } }
    expect(overlay.options.inject().bridge).toBe(electron)
  })
})
