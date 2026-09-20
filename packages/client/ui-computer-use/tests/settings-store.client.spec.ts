/** Computer Use section store: snapshot-mirror action and default state. */
import { describe, expect, it } from 'vitest'
import { createComputerUseStore } from '../src/client/settings-store.ts'

describe('createComputerUseStore', () => {
  it('init shape: unavailable, read-only, and enabled by default', () => {
    const store = createComputerUseStore().create()
    expect(store.getSnapshot()).toEqual({ available: false, writable: false, enabled: true })
  })

  it('sync mirrors a resolved section and the availability flags', () => {
    const store = createComputerUseStore().create()
    store.actions.sync({ enabled: false }, true, true)
    expect(store.getSnapshot()).toEqual({ available: true, writable: true, enabled: false })
  })

  it('sync falls back to the default before the namespace resolves', () => {
    const store = createComputerUseStore().create()
    store.actions.sync(undefined, false, false)
    expect(store.getSnapshot()).toEqual({ available: false, writable: false, enabled: true })
  })
})
