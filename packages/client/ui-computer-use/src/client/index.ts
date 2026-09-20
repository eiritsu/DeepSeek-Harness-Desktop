/**
 * Computer Use settings section: the top-level `settings.section` page that
 * toggles the native Cua Driver provider's Host runtime through its durable
 * settings namespace. The section is contributed only while the Host serves
 * that namespace, so a composition without the provider shows neither the page
 * nor its navigation entry, and a namespace that appears or disappears on a
 * later reconnect adds or retracts the entry.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the ctx.settingsScope Context merge and the scope snapshot.
// Cross-plugin collaboration goes through the service, never a value import
// (client bundle purity gate).
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { ComputerUseInjected } from './ComputerUseSection.tsx'
import { ComputerUseSection } from './ComputerUseSection.tsx'
import { createComputerUseStore } from './settings-store.ts'
import { en, zh, type ComputerUseKey } from './locales.ts'
import { ENABLED_FIELD, SETTINGS_NAMESPACE, type RuntimeSettings } from '../settings-contract.ts'

export type { ComputerUseInjected, ComputerUseSectionProps } from './ComputerUseSection.tsx'
export type { ComputerUseState } from './settings-store.ts'

/** Locale namespace owning this feature's section copy. */
const SECTION_LOCALE_NAMESPACE = 'settings.computerUse'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Computer Use settings section's copy. */
    'settings.computerUse': ComputerUseKey
  }
}

/**
 * Required services: slots and locale for the section, plus `settingsScope` for
 * the provider namespace's reads and writes.
 */
export const inject = ['slots', 'locale', 'settingsScope']

/** Navigation position after the General and Models sections. */
const SECTION_ORDER = 20

/**
 * Bind the provider settings scope and contribute the runtime toggle section
 * while the Host serves the provider's namespace.
 * @param ctx - client cordis context.
 */
export function apply(ctx: ClientContext): void {
  const scope = ctx.settingsScope.bind<RuntimeSettings>({ namespace: SETTINGS_NAMESPACE })
  const store = createComputerUseStore()
  const t = ctx.locale.bind(SECTION_LOCALE_NAMESPACE)
  let bound: BoundActions<typeof store> | undefined
  const sync = (snapshot: SettingsScopeSnapshot<RuntimeSettings>): void => {
    bound?.sync(snapshot.value, snapshot.status === 'ready', snapshot.writable)
  }
  const injected = (actions: BoundActions<typeof store>): ComputerUseInjected => {
    bound = actions
    // Re-sync from the getter so no scope change is lost between registration
    // and first render.
    sync(scope.getSnapshot())
    return {
      setEnabled: (enabled) => {
        void scope.set(ENABLED_FIELD, enabled).catch((error: unknown) => { ctx.logger.error(error) })
      },
    }
  }
  ctx.effect(() => ctx.locale.register(SECTION_LOCALE_NAMESPACE, { zh, en }), 'computer-use: section dictionary')
  ctx.slots.inject('settings.section', () => {
    let registration: (() => void) | undefined
    const reconcile = (): void => {
      const available = scope.getSnapshot().status === 'ready'
      if (available === (registration !== undefined)) return
      if (available) {
        registration = ctx.slots.register({
          name: 'settings.section',
          id: 'computer-use',
          order: SECTION_ORDER,
          label: () => t('computerUse.nav'),
          locale: SECTION_LOCALE_NAMESPACE,
          store,
          inject: injected,
        }, ComputerUseSection)
      } else {
        registration?.()
        registration = undefined
      }
    }
    const unsubscribe = scope.subscribe(() => { sync(scope.getSnapshot()); reconcile() })
    sync(scope.getSnapshot())
    reconcile()
    return () => {
      unsubscribe()
      registration?.()
      registration = undefined
    }
  })
}
