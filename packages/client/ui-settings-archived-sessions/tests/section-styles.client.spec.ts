/**
 * The Archived page's stylesheet as text. jsdom has no layout and no media
 * evaluation, so the properties that only a stylesheet can carry — whether a
 * device without hover can reach a row's commands, whether a narrow sheet
 * overflows, and whether the page names a colour or a font of its own — are
 * asserted against the declarations themselves.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (): string =>
  readFileSync(fileURLToPath(new URL('../src/client/ArchivedSessionsSection.module.css', import.meta.url)), 'utf8')

/**
 * Drop comments, so a rule is read from its declarations rather than from prose
 * that mentions the same selector.
 * @param source - stylesheet text.
 * @returns the source with every block comment replaced by a space.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, ' ')
}

/**
 * One rule's declarations, addressed by any one selector in its selector list.
 * @param source - stylesheet text, or one media block's body.
 * @param selector - a selector the rule's list contains.
 * @returns its `property: value` declarations in source order.
 * @throws if no rule lists the selector, so a renamed class fails rather than passes.
 */
function declarationsFrom(source: string, selector: string): string[] {
  for (const rule of stripComments(source).matchAll(/([^{}]+?)\s*\{([^{}]*)\}/gu)) {
    const list = (rule[1] ?? '').split(',').map(part => part.trim())
    if (!list.includes(selector)) continue
    return (rule[2] ?? '').split(';').map(part => part.trim()).filter(Boolean)
  }
  throw new Error(`no rule lists \`${selector}\``)
}

/**
 * One `@media` block's body.
 * @param source - stylesheet text.
 * @param condition - the media condition, e.g. `(hover: hover)`.
 * @returns the text between the block's braces, or an empty string when absent.
 * @throws if the block never closes, so a truncated stylesheet fails rather than passes.
 */
function mediaBlock(source: string, condition: string): string {
  const css = stripComments(source)
  const start = css.indexOf(`@media ${condition} {`)
  if (start === -1) return ''
  const open = css.indexOf('{', start)
  let depth = 0
  for (let index = open; index < css.length; index++) {
    if (css[index] === '{') depth++
    else if (css[index] === '}' && --depth === 0) return css.slice(open + 1, index)
  }
  throw new Error(`unterminated \`@media ${condition}\` block`)
}

/**
 * One container query's body.
 * @param source - stylesheet text.
 * @param condition - the container condition, e.g. `(max-width: 560px)`.
 * @returns the text between the block's braces, or an empty string when absent.
 * @throws if the block never closes, so a truncated stylesheet fails rather than passes.
 */
function containerBlock(source: string, condition: string): string {
  const css = stripComments(source)
  const start = css.indexOf(`@container ${condition} {`)
  if (start === -1) return ''
  const open = css.indexOf('{', start)
  let depth = 0
  for (let index = open; index < css.length; index++) {
    if (css[index] === '{') depth++
    else if (css[index] === '}' && --depth === 0) return css.slice(open + 1, index)
  }
  throw new Error(`unterminated \`@container ${condition}\` block`)
}

/**
 * How many times a declaration appears in a block of CSS.
 * @param source - stylesheet text.
 * @param declaration - the declaration text to count.
 * @returns the number of non-overlapping occurrences.
 */
function occurrences(source: string, declaration: string): number {
  return source.split(declaration).length - 1
}

describe('Archived section stylesheet', () => {
  it('leaves a row\'s commands reachable where no hover can reveal them', () => {
    const hover = mediaBlock(read(), '(hover: hover)')

    expect(declarationsFrom(hover, '.rowActions')).toContain('opacity: 0')
    for (const reveal of ['.row:hover .rowActions', '.row:focus-within .rowActions']) {
      expect(declarationsFrom(hover, reveal)).toContain('opacity: 1')
    }

    // The resting rule lays the commands out and never hides them: opacity
    // leaves them focusable, and a device outside the hover block keeps them.
    const resting = declarationsFrom(read(), '.rowActions')
    expect(resting).toEqual(expect.arrayContaining(['display: inline-flex', 'flex: none']))
    expect(resting).not.toContain('visibility: hidden')
    // Every `opacity: 0` in the file is one of the hover block's, so no other
    // rule can strand the commands a device with no hover still needs.
    const css = stripComments(read())
    expect(occurrences(css, 'opacity: 0')).toBe(occurrences(hover, 'opacity: 0'))
  })

  it('gives a narrow sheet a two-line row instead of a squeezed one', () => {
    const css = read()
    const narrow = mediaBlock(css, '(max-width: 560px)')

    expect(declarationsFrom(narrow, '.row')).toEqual(expect.arrayContaining([
      'flex-wrap: wrap',
      'height: auto',
      'min-height: 32px',
    ]))
    // The title takes the first line whole; the date and the commands share the
    // second, so neither is pushed out of the row.
    expect(declarationsFrom(narrow, '.rowName')).toContain('flex: 1 1 100%')
    expect(declarationsFrom(narrow, '.rowTime')).toContain('margin-inline-end: auto')

    // A row wide enough for one line keeps it, and its title is still the only
    // cell that gives way.
    expect(declarationsFrom(css, '.row')).toEqual(expect.arrayContaining(['height: 32px', 'min-width: 0']))
    expect(declarationsFrom(css, '.rowName')).toEqual(expect.arrayContaining([
      'min-width: 0',
      'overflow: hidden',
      'text-overflow: ellipsis',
    ]))
    expect(declarationsFrom(css, '.rowActions')).toEqual(expect.arrayContaining([
      'display: inline-flex',
      'flex: none',
    ]))
    expect(declarationsFrom(css, '.rowAction')).toContain('width: 24px')
    expect(declarationsFrom(css, '.rowDanger')).toContain('width: 24px')
  })

  it('keeps all toolbar controls on one row until the Settings container is narrow', () => {
    const css = stripComments(read())

    expect(declarationsFrom(css, '.section')).toEqual(expect.arrayContaining([
      'width: 100%',
      'min-width: 0',
      'max-width: 760px',
      'container-type: inline-size',
    ]))
    expect(declarationsFrom(css, '.toolbar')).toEqual(expect.arrayContaining([
      'display: grid',
      'grid-template-columns: minmax(120px, 0.8fr) minmax(145px, 1fr) minmax(165px, 1.15fr)',
      'gap: 8px',
    ]))
    expect(declarationsFrom(css, '.search')).toContain('min-width: 0')
    expect(declarationsFrom(css, '.select')).toEqual(expect.arrayContaining(['min-width: 0', 'width: 100%']))

    // At a 510px Settings content width, search takes its own row and the two
    // selectors share the next; very narrow panels stack all three controls.
    const narrow = containerBlock(css, '(max-width: 560px)')
    expect(declarationsFrom(narrow, '.toolbar')).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))')
    expect(declarationsFrom(narrow, '.search')).toContain('grid-column: 1 / -1')
    const veryNarrow = containerBlock(css, '(max-width: 390px)')
    expect(declarationsFrom(veryNarrow, '.toolbar')).toContain('grid-template-columns: minmax(0, 1fr)')

    expect(declarationsFrom(css, '.selectText')).toEqual(expect.arrayContaining([
      'min-width: 0',
      'overflow: hidden',
      'text-overflow: ellipsis',
      'white-space: nowrap',
    ]))
  })

  it('gives the two selects the search box they sit beside', () => {
    // The Input primitive's box: 32px tall, 8px inline padding, the medium
    // radius, and its 14px/22px type.
    expect(declarationsFrom(read(), '.select')).toEqual(expect.arrayContaining([
      'height: 32px',
      'padding: 0 8px',
      'border-radius: var(--dsw-radius-md)',
      'font: inherit',
      'font-size: 14px',
      'line-height: 22px',
    ]))
  })

  it('keeps the bulk delete visibly button-shaped and lets its meta row wrap', () => {
    const css = stripComments(read())
    expect(declarationsFrom(css, '.bulkDelete')).toEqual(expect.arrayContaining([
      'border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 55%, var(--dsw-alias-border-l3))',
      'background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent)',
      'color: var(--dsw-alias-state-error-primary)',
      'white-space: normal',
    ]))
    expect(declarationsFrom(css, '.bulkDelete:hover:not(:disabled)'))
      .toContain('background: var(--dsw-alias-interactive-bg-hover-danger)')
    expect(declarationsFrom(css, '.bulkDelete:focus-visible')).toContain('outline-offset: 2px')
    expect(declarationsFrom(css, '.bulkDelete:disabled')).toContain('background: transparent')

    const narrow = mediaBlock(css, '(max-width: 560px)')
    expect(declarationsFrom(narrow, '.meta')).toContain('flex-wrap: wrap')
    expect(declarationsFrom(narrow, '.metaCount')).toContain('flex: 1 1 100%')
    expect(declarationsFrom(narrow, '.bulkDelete')).toContain('max-width: 100%')
  })

  it('names no colour and no font of its own', () => {
    const css = stripComments(read())

    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/iu)
    expect(css).not.toMatch(/\b(?:rgb|rgba|hsl|hsla)\(/u)
    expect(css).not.toMatch(/font-family/u)
    for (const [, value] of css.matchAll(/(?:^|[;{\s])color:\s*([^;}]+)/gu)) {
      expect(value).toMatch(/^var\(--dsw-[a-z0-9-]+\)$/u)
    }
  })
})
