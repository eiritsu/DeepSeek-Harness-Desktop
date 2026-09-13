import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const writeBundle = vi.hoisted(() => vi.fn())
const typertPlugin = vi.hoisted(() => vi.fn(() => ({ writeBundle })))

vi.mock('../packages/typert/generator/src/tsdown-plugin.ts', () => ({ typertPlugin }))

const { bootstrapHostTypert } = await import('./bootstrap-typert.ts')

describe('bootstrapHostTypert', () => {
  it('emits every Host contribution before the TypeScript build', () => {
    bootstrapHostTypert('/workspace')

    expect(typertPlugin).toHaveBeenCalledWith({ mode: 'workspace', faces: ['host'] })
    expect(writeBundle).toHaveBeenCalledWith({ dir: resolve('/workspace', 'lib') })
  })
})
