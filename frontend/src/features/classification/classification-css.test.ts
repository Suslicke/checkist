import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./Classification.css', import.meta.url), 'utf8')

/** Flat rules only: enough for this stylesheet, where a media block holds whole rules. */
const rules = (text: string) => [...text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((match) => ({ selector: match[1].trim(), body: match[2].trim() }))
const rule = (selector: string) => rules(css).filter((item) => item.selector === selector).map((item) => item.body).join(' ')
const colored = (body: string) => /(^|[;\s])color\s*:/.test(body)

describe('classification stylesheet guards (text of the rules, not rendering)', () => {
  it('draws the current filter link as a selected chip (ink, paper text), apart from the other links', () => {
    // A choice is ink in 2.0: the selected chip is filled with ink, its text is paper — a contrast pair in both themes.
    const current = rule('.ck-class-filter ul a[aria-current]')
    expect(current).toMatch(/(^|[;\s])color: var\(--ck-paper\);/)
    expect(current).toMatch(/(^|[;\s])background: var\(--ck-ink\);/)
    const other = rule('.ck-class-filter ul a')
    expect(other).toMatch(/(^|[;\s])color: var\(--ck-ink\);/)
    expect(other).toMatch(/(^|[;\s])background: var\(--ck-surface\);/)
  })
  it('takes every colour from the theme tokens', () => {
    const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(text.match(/#[0-9a-f]{3,8}|(?:rgb|hsl)a?\(/gi)).toBeNull()
  })
  it('keeps the general link colour of the screen away from current links', () => {
    // `.ck-class a…` is as specific as `.ck-class-filter a[aria-current]` and comes later: it must leave current links alone.
    const general = rules(css).flatMap((item) => item.selector.split(',').map((selector) => ({ selector: selector.trim(), body: item.body })))
      .filter((item) => /^\.ck-class\s+a(?![\w-])/.test(item.selector) && colored(item.body))
    expect(general.map((item) => item.selector)).toEqual(['.ck-class a:not(.action-link):not([aria-current])'])
    expect(general[0].body).toMatch(/(^|[;\s])color: var\(--ck-seal-ink\);/)
  })
  it('keeps marks and dates whole', () => {
    // The screen breaks free text anywhere; a mark wraps between its words only and a short pill not at all.
    expect(rule('.ck-class-new')).toMatch(/(^|[;\s])white-space: nowrap;/)
    expect(rule('.ck-class-state')).toMatch(/(^|[;\s])overflow-wrap: normal;/)
    expect(rule('.ck-class-badge a, .ck-class-badge span')).toMatch(/(^|[;\s])overflow-wrap: normal;/)
    // Dates stay whole by the rule of the shell for <time>: no rule of this screen may undo it.
    expect(rules(css).filter((item) => /white-space\s*:\s*(normal|pre-wrap|pre-line)/.test(item.body)).map((item) => item.selector)).toEqual([])
  })
  it('gives the gold of the assistant to what the model suggested and does, never to an action', () => {
    expect(rule('.ck-class-group')).toContain('box-shadow: inset 3px 0 0 var(--ck-gold);')
    expect(rule('.ck-class-run')).toContain('color: var(--ck-gold-ink);')
    const gold = rules(css).filter((item) => /--ck-gold/.test(item.body)).map((item) => item.selector)
    expect(gold.filter((selector) => /secondary|actions|button/.test(selector))).toEqual([])
  })
  it('takes every size of the text from the scale of the theme', () => {
    const sizes = [...css.matchAll(/font-size\s*:\s*([^;]+);/g)].map((match) => match[1].trim())
    expect(sizes.length).toBeGreaterThan(5)
    for (const size of sizes) expect(size).toMatch(/^var\(--ck-text-(caption|label|body|field|title|heading)\)$/)
  })
  it('draws the blocks as panels of 2.0 and never lets a child widen the screen', () => {
    expect(rule('.ck-class-panel')).toContain('border: 1px solid var(--ck-line); border-radius: var(--ck-radius-card); background: var(--ck-surface);')
    expect(rule('.ck-class-panel')).not.toContain('box-shadow')
    expect(rule('.ck-class > *')).toBe('min-width: 0;')
    expect(rule('.ck-class-state')).toContain('border-radius: var(--ck-radius-pill);')
  })
})
