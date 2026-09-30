/**
 * Archived sessions settings section, browser half: the Settings navigation
 * entry and the page it opens. The page reads the Workspace Controller's
 * snapshot for the archive set and the Session Controller's list for titles and
 * timestamps, and issues that same service's archive, restore, and deletion
 * commands — it holds no archive state of its own, so the sidebar and this page
 * can never disagree about what is archived.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: the Session Controller's Context merge (ctx.sessions).
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: the Workspace Controller's Context merge (ctx.workspaces).
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
// Type-only: the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the renderer plugin that draws the entry.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the settings shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { ArchivedSessionsSection } from './ArchivedSessionsSection.tsx'
import type { ArchivedSessionsInjected } from './ArchivedSessionsSection.tsx'
import { en, zh } from './locales.ts'

export type { ArchivedSessionsInjected, ArchivedSessionsSectionProps } from './ArchivedSessionsSection.tsx'
export type { ArchivedSessionRow, ArchivedSort, ArchivedWorkspaceFilter } from './archived-view.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.archivedSessions'

/** Required services: the two snapshot authorities, the slot registry, and dictionaries. */
export const inject = ['slots', 'locale', 'sessions', 'workspaces']

/**
 * Mount the Archived sessions settings section.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-archived-sessions: dictionaries')

  const sectionInjected = (): ArchivedSessionsInjected => ({
    hooks: {
      workspaces: ctx.workspaces.list,
      sessions: ctx.sessions.list,
    },
    unarchiveSession: sessionId => ctx.workspaces.unarchiveSession(sessionId),
    deleteSession: sessionId => ctx.workspaces.deleteSession(sessionId),
  })

  // The page carries no children: every archived Session is a row of the page
  // itself, so there is nothing for a feature plugin to contribute here.
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'archived-sessions',
    order: 40,
    label: () => t('nav'),
    locale: NS,
    inject: sectionInjected,
  }, ArchivedSessionsSection))
}
