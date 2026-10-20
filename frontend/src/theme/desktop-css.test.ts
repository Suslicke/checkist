import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = new URL('../', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, source), 'utf8')
const css = read('theme/desktop.css').replace(/\/\*[\s\S]*?\*\//g, '')
const styles = read('styles.ts')
/** Flat rules: the media block of this stylesheet holds whole rules, nothing nested. */
const rules = (text: string) => [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .flatMap((match) => match[1].split(',').map((selector) => ({ selector: selector.trim(), body: match[2].trim() })))
const media = /@media\s*\(min-width:\s*960px\)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/
const outside = css.replace(media, '')
const desktop = rules(media.exec(css)?.[1] ?? '')
/** The bodies of one selector inside the 960 block, joined. */
const rule = (selector: string, items = desktop) => items.filter((item) => item.selector === selector).map((item) => item.body).join(' ')
/** The value of one declaration of a body; '' when the body does not declare it. */
const value = (body: string, property: string) => new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*([^;]+);`).exec(body)?.[1].trim() ?? ''

describe('desktop stylesheet (src/theme/desktop.css, text of the rules, not rendering)', () => {
  it('is listed after every screen stylesheet and right before the skeletons', () => {
    const listed = [...styles.matchAll(/^import '\.\/([^']+\.css)'$/gm)].map((match) => match[1])
    const at = listed.indexOf('theme/desktop.css')
    expect(at).toBeGreaterThan(-1)
    expect(listed.slice(at).filter((path) => path.startsWith('features/'))).toEqual([])
    expect(listed[at + 1]).toBe('components/Skeleton.css')
  })

  it('holds one media block: the desktop threshold of the project', () => {
    expect([...css.matchAll(/@media ([^{]+)\{/g)].map((match) => match[1].trim())).toEqual(['(min-width: 960px)'])
    expect(media.test(css)).toBe(true)
  })

  it('keeps nothing outside the block but boxless column wrappers and their order', () => {
    expect(outside).not.toContain('@media')
    for (const item of rules(outside)) expect(item.body, item.selector).toMatch(/^(display: contents;|order: -?\d+;)$/)
  })

  it('adds no colour, no text size outside the scale, no layer, no motion, no fixed position, no scroll, no own look of a field, no ring taken off', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|\b(?:rgb|hsl|hwb|lab|lch|oklab|oklch)a?\(/i)
    for (const [, size] of css.matchAll(/font-size:\s*([^;]+);/g)) expect(size.trim()).toMatch(/^var\(--ck-text-(xs|sm|base|lg|xl|hero)\)$/)
    expect(css).not.toMatch(/z-index|position: fixed|transition|animation|@keyframes|!important|scroll-padding|\(max-width|overflow|@import|appearance|outline:\s*(none|0)/)
    expect(rules(css).filter((item) => /position: sticky/.test(item.body)).map((item) => item.selector)).toEqual([])
  })
})

describe('«Траты» at ≥ 960 (T3): the rules of the screen and the skeleton that mirrors them', () => {
  const skeleton = read('components/Skeleton.css').replace(/\/\*[\s\S]*?\*\//g, '')
  // The desktop rules of the skeleton live in its SECOND 960 block (after the 541 block), so the last match is the one.
  const blocks = [...skeleton.matchAll(new RegExp(media.source, 'g'))]
  const skel = rules(blocks[blocks.length - 1]?.[1] ?? '')
  const form = '.spends-toolbar > .receipt-panel > form'

  it('draws a row as a grid of the height the skeleton row has', () => {
    const row = rule('.spends-row')
    expect(row).toContain('display: grid;')
    expect(value(row, 'min-height')).toMatch(/^\d+px$/)
    expect(value(row, 'min-height')).toBe(value(rule('.ck-skel-spends .ck-skel-row', skel), 'min-height'))
  })

  it('lays the filters out as one line with the tracks and the gap of the skeleton filters', () => {
    const live = rule(form)
    const mirror = rule('.ck-skel-filters', skel)
    expect(value(live, 'grid-template-columns')).toMatch(/\bauto$/)
    expect(value(live, 'grid-template-columns')).toBe(value(mirror, 'grid-template-columns'))
    expect(value(live, 'gap')).not.toBe('')
    expect(value(live, 'gap')).toBe(value(mirror, 'gap'))
    // Fields align at the top (a field error must not push the other labels down); only the buttons sit at the bottom.
    expect(value(live, 'align-items')).toBe('start')
    expect(value(rule(`${form} > .receipt-actions`), 'align-self')).toBe('end')
    expect(value(rule('.ck-skel-filters > .ck-skel-button', skel), 'align-self')).toBe('end')
  })

  it('dissolves only the wrappers of the fields and of a row, with nothing else in those rules', () => {
    expect(rule(`${form} > .receipt-filter-grid`)).toBe('display: contents;')
    expect(rule('.spends-row-main')).toBe('display: contents;')
  })

  it('hides the heading of the filters by position and clip, keeping it rendered for aria-labelledby', () => {
    const heading = rule('.spends-toolbar > .receipt-panel > h2')
    expect(heading).toContain('clip-path: inset(50%)')
    expect(heading).toContain('position: absolute')
    expect(heading).not.toMatch(/display\s*:|visibility\s*:/)
    // Out of flow: the panel has one in-flow item, so a gap there would be dead.
    expect(value(rule('.spends-toolbar > .receipt-panel'), 'gap')).toBe('')
  })
})
