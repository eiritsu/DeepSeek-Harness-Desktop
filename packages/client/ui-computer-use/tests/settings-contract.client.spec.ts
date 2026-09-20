/** Browser-side settings contract: the literals must match the Host provider's own declaration. */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ENABLED, ENABLED_FIELD, SETTINGS_NAMESPACE,
} from '../src/settings-contract.ts'

describe('computer-use settings contract', () => {
  it('pins the namespace, field, and default the browser binds through settingsScope', () => {
    expect(SETTINGS_NAMESPACE).toBe('computer-use-cua-driver-native')
    expect(ENABLED_FIELD).toBe('enabled')
    expect(DEFAULT_ENABLED).toBe(true)
  })
})
