import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/ModelSelect.module.css', import.meta.url)), 'utf8')
const declarationText = css.replace(/\/\*[\s\S]*?\*\//g, ' ')

describe('ModelSelect.module.css catalog scroller', () => {
  it('scrolls long catalogs vertically without exposing inline overflow', () => {
    const rule = /\.groups\s*\{([^{}]*)\}/.exec(declarationText)
    expect(rule).not.toBeNull()
    const declarations = new Map((rule?.[1] ?? '').split(';').flatMap((part) => {
      const colon = part.indexOf(':')
      return colon === -1 ? [] : [[part.slice(0, colon).trim(), part.slice(colon + 1).trim()]]
    }))
    expect(declarations.get('overflow-x')).toBe('hidden')
    expect(declarations.get('overflow-y')).toBe('auto')
  })
})
