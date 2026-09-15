/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { anthropicApiRoot } from '../src/anthropic-endpoint.ts'

describe('anthropicApiRoot', () => {
  it('removes trailing slashes', () => {
    expect(anthropicApiRoot('https://api.anthropic.com/')).toBe('https://api.anthropic.com')
    expect(anthropicApiRoot('https://api.anthropic.com///')).toBe('https://api.anthropic.com')
  })

  it('removes /v1 suffix', () => {
    expect(anthropicApiRoot('https://api.anthropic.com/v1')).toBe('https://api.anthropic.com')
    expect(anthropicApiRoot('https://api.anthropic.com/v1/')).toBe('https://api.anthropic.com')
  })

  it('preserves root without /v1', () => {
    expect(anthropicApiRoot('https://api.anthropic.com')).toBe('https://api.anthropic.com')
  })

  it('handles gateway URLs', () => {
    expect(anthropicApiRoot('https://gateway.example.com/v1')).toBe('https://gateway.example.com')
    expect(anthropicApiRoot('https://api.a6api.com/v1')).toBe('https://api.a6api.com')
  })

  it('handles URLs without /v1 suffix', () => {
    expect(anthropicApiRoot('https://gateway.example.com')).toBe('https://gateway.example.com')
  })
})
