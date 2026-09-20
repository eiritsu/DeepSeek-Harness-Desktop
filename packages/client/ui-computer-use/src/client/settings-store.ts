/**
 * Computer Use section slot store: a mirror of the provider's settings-scope
 * snapshot. The plugin's apply-world scope subscription is the only writer; the
 * section component reads via props.useStore.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import { DEFAULT_ENABLED, ENABLED_FIELD, type RuntimeSettings } from '../settings-contract.ts'

/** Store state mirrored from the provider settings scope. */
export interface ComputerUseState {
  /** Whether the Host currently serves the provider's settings namespace. */
  available: boolean
  /** Whether the Host document accepts writes. */
  writable: boolean
  /** Whether the native runtime is mounted. */
  enabled: boolean
}

/** Declared action shape giving the exported factory a stable return type. */
type ComputerUseActions = {
  sync: (
    draft: ComputerUseState,
    section: RuntimeSettings | undefined,
    available: boolean,
    writable: boolean,
  ) => void
}

/**
 * Declares the Computer Use section state and write surface.
 * @returns the store handle.
 */
export function createComputerUseStore(): EngineStoreHandle<ComputerUseState, ComputerUseActions> {
  return defineStore({
    init: (): ComputerUseState => ({ available: false, writable: false, enabled: DEFAULT_ENABLED }),
    actions: {
      sync: (d, section, available, writable) => {
        d.enabled = section?.[ENABLED_FIELD] ?? DEFAULT_ENABLED
        d.available = available
        d.writable = writable
      },
    },
  })
}
