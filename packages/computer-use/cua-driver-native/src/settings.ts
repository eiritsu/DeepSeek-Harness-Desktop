/**
 * Settings contract shared by the Host provider and its browser row: the
 * durable namespace, the field that controls the runtime, and the default
 * mount state. Both compiler faces compile this module, so neither restates
 * the join key.
 */

/** Settings namespace owned by the native Cua Driver provider. */
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
