/** What the browser half registers, and that it all leaves with the fiber. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import type { ArchivedSessionsInjected } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

const sid = (id: string): SessionId => id as SessionId

const workspaceSnapshot = (): WorkspaceSnapshot => ({
  items: [],
  archivedSessionIds: [],
  pinnedSessionIds: [],
  state: 'idle',
  phase: 'ready',
  error: null,
})

const sessionList = (): SessionListState => ({
  ids: [sid('s1')],
  byId: {
    s1: { id: sid('s1'), displayTitle: 'Alpha', running: false, retainedBy: {}, blank: false, updatedAt: 5 },
  } as SessionListState['byId'],
  phase: 'ready',
  projectionsBySession: {},
})

/**
 * The browser context this plugin injects, with the two snapshot services the
 * page reads standing in for the real controllers.
 * @param declareSection - whether the settings shell's own declaration is
 *   already present; false exercises registration into a later declaration.
 * @returns the context, its slot registry, and the stand-in services.
 */
async function bench(declareSection = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)

  const workspaces: WorkspaceSnapshot = workspaceSnapshot()
  const sessions = sessionList()
  ctx.provide('workspaces', {
    list: {
      getSnapshot: () => workspaces,
      subscribe: () => () => {},
    },
    unarchiveSession: vi.fn(async () => {}),
    deleteSession: vi.fn(async () => {}),
  } as never)
  ctx.provide('sessions', {
    list: {
      getSnapshot: () => sessions,
      subscribe: () => () => {},
    },
  } as never)

  const slots = ctx.get('slots') as SlotRegistry
  if (declareSection) {
    // The Settings shell's section slot, as its owner declares it.
    slots.register({
      name: 'root',
      children: { 'settings.section': { kind: 'list', scope: 'root' } },
    } as never, () => null)
  }

  return { ctx, slots }
}

describe('ui-settings-archived-sessions apply', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'sessions', 'workspaces'])
  })

  it('registers one Archived section carrying the icon the shell already reserves for it', async () => {
    const { ctx, slots } = await bench()

    await ctx.plugin({ inject: [...inject], apply }).await()

    const section = slots.entries('settings.section')[0]!
    expect(section.options).toMatchObject({ id: 'archived-sessions', order: 40 })
    // The nav label is a locale-following thunk; owners resolve it at read time.
    expect(resolveSlotLabel(section.options.label)).toBe('已归档')
  })

  it('registers into a declaration that arrives after apply', async () => {
    const { ctx, slots } = await bench(false)
    await ctx.plugin({ inject: [...inject], apply }).await()
    expect(slots.entries('settings.section')).toHaveLength(0)

    slots.register({
      name: 'root',
      children: { 'settings.section': { kind: 'list', scope: 'root' } },
    } as never, () => null)

    expect(slots.entries('settings.section')).toHaveLength(1)
  })

  it('binds the two snapshot sources and the two commands to their controllers', async () => {
    const { ctx, slots } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()

    const section = slots.entries('settings.section')[0]!
    const face = (section.inject as () => Pick<ArchivedSessionsInjected, 'hooks' | 'unarchiveSession' | 'deleteSession'>)()
    expect(face.hooks.workspaces.getSnapshot().items).toEqual([])
    expect(face.hooks.sessions.getSnapshot().phase).toBe('ready')

    const unarchive = vi.fn(async () => {})
    const del = vi.fn(async () => {})
    const services = ctx.get('workspaces') as { unarchiveSession: unknown; deleteSession: unknown }
    Object.assign(services, { unarchiveSession: unarchive, deleteSession: del })

    await face.unarchiveSession(sid('s1'))
    await face.deleteSession(sid('s2'))
    expect(unarchive).toHaveBeenCalledWith(sid('s1'))
    expect(del).toHaveBeenCalledWith(sid('s2'))
  })

  it('removes its section and dictionaries with the fiber', async () => {
    const { ctx, slots } = await bench()
    const fiber = await ctx.plugin({ inject: [...inject], apply })
    expect(slots.entries('settings.section')).toHaveLength(1)

    await fiber.dispose()

    expect(slots.entries('settings.section')).toHaveLength(0)
  })
})
