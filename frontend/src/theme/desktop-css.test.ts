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
