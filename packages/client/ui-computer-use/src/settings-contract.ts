/**
 * Browser-side copy of the native Cua Driver provider's settings namespace.
 *
 * The provider owns the durable namespace on the Host; a browser half cannot
 * value-import another plugin's module, so this package restates the namespace,
 * field, and default it binds through `ctx.settingsScope`. The literals are
 * pinned by `tests/settings-contract.client.spec.ts`, and the provider's own
 * Host tests pin the Host declaration to the same values.
 */

/** Durable settings namespace owned by the native Cua Driver provider. */
export const SETTINGS_NAMESPACE = 'computer-use-cua-driver-native'

/** Field controlling whether the native runtime is mounted. */
export const ENABLED_FIELD = 'enabled'

/** Mount state when neither the composition nor the user document chooses one. */
export const DEFAULT_ENABLED = true

/** Durable settings section owned by the native Cua Driver provider. */
export interface RuntimeSettings {
  /** Whether the native runtime and its model-facing tools are mounted. */
  enabled: boolean
}
