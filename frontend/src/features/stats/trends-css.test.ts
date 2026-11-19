import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const sheets = { trends: read('./Trends.css'), columns: read('../../lib/charts/Columns.css') }
const rules = (css: string) => [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((match) => ({ selector: match[1].trim(), body: match[2].trim() }))
const rule = (css: string, selector: string) => rules(css).filter((item) => item.selector === selector).map((item) => item.body).join(' ')

describe('«Динамика» stylesheets (text of the rules, not rendering)', () => {
  it.each(Object.entries(sheets))('%s: colours are theme tokens only, no rule by the width of the window', (_, css) => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(css).not.toMatch(/\brgba?\(|\bhsla?\(/)
    // The layout is fluid; the only condition is the hover of a mouse.
    for (const [, query] of css.matchAll(/@media ([^{]+)\{/g)) expect(query.trim()).toBe('(hover: hover)')
  })
  it('gives every category its own colour, the same number as on «Главная»', () => {
    for (let tone = 1; tone <= 6; tone += 1) {
      expect(rule(sheets.columns, `.ck-columns-tone-${tone}`)).toBe(`--ck-col: var(--ck-cat-${tone});`)
      expect(rule(sheets.trends, `.trends-cat-${tone}`)).toBe(`--trends-cat: var(--ck-cat-${tone});`)
    }
  })
  it('never tears a value, keeps a change calm and marks a limit from 80 % in the over tone', () => {
    for (const selector of ['.trends-big', '.trends-value', '.trends-badge', '.trends-number', '.trends-cell-month']) {
      expect(rule(sheets.trends, selector)).toContain('white-space: nowrap')
    }
    // Calm money (Чекист 2.0): more spent or dearer is not red and less is not green — the arrow, the sign and the words
    // say it, in ink; the over tone belongs to a limit only.
    expect(rule(sheets.trends, '.trends-badge-up, .trends-badge-down')).toBe('color: var(--ck-ink);')
    expect(rule(sheets.trends, '.trends-change-up, .trends-change-down')).toBe('color: var(--ck-ink-2);')
    expect(sheets.trends).not.toMatch(/var\(--ck-(income|over-text|success-text|error)\)/)
    expect(rule(sheets.trends, '.trends-cell-bar span')).toContain('background: var(--ck-ink)')
    expect(rule(sheets.trends, '.trends-cell-over .trends-cell-bar span, .trends-cell-near .trends-cell-bar span')).toBe('background: var(--ck-over-bar);')
    expect(rule(sheets.trends, '.trends-cell-over .trends-cell-percent, .trends-cell-near .trends-cell-percent, .trends-cell-word')).toContain('color: var(--ck-over)')
  })
  it('sets every text size from the 2.0 scale', () => {
    for (const [, size] of sheets.trends.matchAll(/font-size:\s*([^;]+);/g)) {
      expect(size).toMatch(/^var\(--ck-text-(caption|label|body|field|title|heading|money-display|title-large|money-hero)\)$/)
    }
  })
  it('keeps the hidden words of a change inside the frame of the wide table', () => {
    expect(rule(sheets.trends, '.trends-table-scroll')).toContain('position: relative')
    expect(rule(sheets.trends, '.trends-table-scroll')).toContain('overflow-x: auto')
  })
  it('lets the page scroll under a finger on the columns and gives a column the whole slot as its target', () => {
    expect(rule(sheets.columns, '.ck-columns-plot')).toContain('touch-action: pan-y pinch-zoom')
    expect(rule(sheets.columns, '.ck-columns-hit')).toContain('pointer-events: auto')
  })
})
