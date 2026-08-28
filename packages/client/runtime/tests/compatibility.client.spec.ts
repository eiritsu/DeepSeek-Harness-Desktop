import { describe, expect, it } from 'vitest'
import { createSnapshotStore, shallowEqual } from '../src/client/index.ts'

describe('legacy Client Runtime compatibility exports', () => {
  it('forwards the current snapshot-store implementation', () => {
    const store = createSnapshotStore({ count: 1 })
    const snapshots: number[] = []
    const dispose = store.subscribe(() => snapshots.push(store.getSnapshot().count))

    store.update((draft) => { draft.count += 1 })
    dispose()

    expect(snapshots).toEqual([2])
    expect(shallowEqual(store.getSnapshot(), { count: 2 })).toBe(true)
  })
})
