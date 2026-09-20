/** Host-half plugin body: an inert loader entry for the browser section. */
import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

describe('computer-use section host half', () => {
  it('is an inert plugin body', () => {
    expect(() => { apply() }).not.toThrow()
  })
})
