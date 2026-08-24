import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/AttachmentRail.module.css', import.meta.url)), 'utf8')
const declarationText = css.replace(/\/\*[\s\S]*?\*\//g, ' ')

describe('AttachmentRail.module.css file card', () => {
  it('includes padding and border in the rail-owned card dimensions', () => {
    const rule = /\.fileCard\s*\{([^{}]*)\}/.exec(declarationText)
    expect(rule).not.toBeNull()
    const declarations = new Map((rule?.[1] ?? '').split(';').flatMap((part) => {
      const colon = part.indexOf(':')
      return colon === -1 ? [] : [[part.slice(0, colon).trim(), part.slice(colon + 1).trim()]]
    }))
    expect(declarations.get('box-sizing')).toBe('border-box')
    expect(declarations.get('width')).toBe('180px')
    expect(declarations.get('height')).toBe('64px')
  })
})
