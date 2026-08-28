/**
 * Compatibility exports for browser plugins built against the pre-split Client Runtime.
 * New code imports each API from its current owning package.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'

export { createSnapshotStore, defineStore, shallowEqual } from '@deepseek-ai/dsh-client-store'
export type {
  EngineStoreHandle, EngineStoreInstance, ObservableSnapshot, SnapshotStore,
} from '@deepseek-ai/dsh-client-store'
export type {
  SettingsScope, SettingsScopeSnapshot, SettingsScopeSpec,
} from '@deepseek-ai/dsh-client-ui-settings/client'

/** Client-side Cordis context retained for source compatibility. */
export type ClientContext = Context & { slots: SlotRegistry }

/** Client plugin body; current owners provide every forwarded implementation. */
export function apply(): void {}
