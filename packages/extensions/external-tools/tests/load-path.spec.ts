import { describe, expect, it } from 'vitest'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import * as externalTools from '../src/index.ts'

describe('external-tools loader export', () => {
  it('keeps the namespace metadata used to inject host services', () => {
    expect('default' in externalTools).toBe(false)
    expect(externalTools.name).toBe('external-tools')
    expect(externalTools.inject).toEqual(['tools', 'credentials'])

    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(externalTools) as Record<string, unknown>
    expect(unwrapped).toBe(externalTools)
    expect(unwrapped.name).toBe('external-tools')
    expect(unwrapped.inject).toEqual(['tools', 'credentials'])
    expect(typeof unwrapped.apply).toBe('function')
  })
})
