import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  fileURLToPath(new URL('../src/client/SkillLibraryOverlay.module.css', import.meta.url)),
  'utf8',
)

function declarations(selector: string): Map<string, string> | undefined {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, ' ')
  for (const [, selectorList = '', body = ''] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectorList.split(',').map(value => value.trim()).includes(selector)) continue
    const found = new Map<string, string>()
    for (const part of body.split(';')) {
      const colon = part.indexOf(':')
      if (colon === -1) continue
      found.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim().replace(/\s+/g, ' '))
    }
    return found
  }
  return undefined
}

describe('SkillLibraryOverlay.module.css', () => {
  it('keeps the installed toolbar fixed above a bounded scrolling list', () => {
    const installed = declarations('.installed')
    const viewport = declarations('.installedViewport')
    expect(installed?.get('height')).toBe('100%')
    expect(installed?.get('min-height')).toBe('0')
    expect(viewport?.get('flex')).toBe('1')
    expect(viewport?.get('min-height')).toBe('0')
    expect(viewport?.get('overflow-y')).toBe('auto')
    expect(viewport?.get('scrollbar-gutter')).toBe('stable')
  })
})
