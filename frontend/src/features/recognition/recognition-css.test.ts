import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./Recognition.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** Flat rules: a media block of this stylesheet holds whole rules. */
const rules = (text: string) => [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .flatMap((match) => match[1].split(',').map((selector) => ({ selector: selector.trim().replace(/^@media[^{]*\{\s*/, ''), body: match[2].trim() })))
const all = rules(css)
const rule = (selector: string) => all.filter((item) => item.selector === selector).map((item) => item.body).join(' ')
const value = (body: string, property: string) => new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*([^;]+);`).exec(body)?.[1].trim()
const narrow = /@media \(max-width: 540px\) \{([\s\S]*?\})\s*\}/.exec(css)?.[1] ?? ''

describe('recognition stylesheet guards (text of the rules, not rendering)', () => {
  it('never splits a word and its number, on any width', () => {
    expect(value(rule('.ck-rec-pair'), 'white-space')).toBe('nowrap')
    expect(narrow).not.toBe('')
    expect(narrow).not.toMatch(/white-space/)
    expect(all.filter((item) => value(item.body, 'white-space') === 'normal')).toEqual([])
  })

  it('keeps free text wrapping: the file name and long names are not pinned to one line', () => {
    expect(value(rule('.ck-rec'), 'overflow-wrap')).toBe('anywhere')
    // Only the pair and the visually hidden legend are single-line.
    expect(all.filter((item) => value(item.body, 'white-space') === 'nowrap').map((item) => item.selector)).toEqual(['.ck-rec-pair', '.ck-review-hidden'])
  })

  it('lets every box of the form shrink to a narrow screen', () => {
    for (const selector of ['.ck-rec', '.ck-rec-panel', '.ck-rec-card', '.ck-rec-list > li', '.ck-review', '.ck-review-body', '.ck-review-group', '.ck-review-field', '.ck-review-store']) {
      expect(value(rule(selector), 'min-width'), selector).toBe('0')
    }
    const field = rule('.ck-rec input')
    expect(value(field, 'width')).toBe('100%'); expect(value(field, 'min-width')).toBe('0')
    expect(rule('.ck-rec select')).toBe(field)
    // A column is never wider than its grid: one column on a phone, several on a desktop.
    for (const selector of ['.ck-review-grid', '.ck-rec-facts']) {
      expect(value(rule(selector), 'grid-template-columns'), selector).toMatch(/^repeat\(auto-fit, minmax\(min\(100%, \d+px\), 1fr\)\)$/)
    }
  })

  it('limits the width of the correction form on the wide page and of nothing else', () => {
    expect(value(rule('.ck-review'), 'max-width')).toMatch(/^\d+px$/)
    const limited = all.filter((item) => value(item.body, 'max-width') !== undefined && value(item.body, 'max-width') !== '100%')
    expect(limited.map((item) => item.selector)).toEqual(['.ck-review'])
  })

  it('takes every size of the text from the scale of the theme and never changes it on a phone', () => {
    const sizes = all.flatMap((item) => value(item.body, 'font-size') ?? [])
    expect(sizes.length).toBeGreaterThan(0)
    for (const size of sizes) expect(size).toMatch(/^var\(--ck-text-(caption|label|body|field|title|heading)\)$/)
    expect(narrow).not.toMatch(/font-size/)
  })

  it('draws the blocks as panels of 2.0, the jobs as rows of their panel, states as chips in their tone', () => {
    // A panel: the surface, a line, the radius of a card, no shadow.
    expect(rule('.ck-rec-panel')).toContain('border: 1px solid var(--ck-line); border-radius: var(--ck-radius-card); background: var(--ck-surface);')
    expect(rule('.ck-rec-panel')).not.toContain('shadow')
    expect(rule('.ck-rec-card')).toContain('border-top: 1px solid var(--ck-line);')
    expect(rule('.ck-rec-status')).toContain('border-radius: var(--ck-radius-pill);')
    // Done — income, needs a check — over, failed — error; the words of the state are always in the chip.
    expect(rule('.ck-rec-status-succeeded')).toBe('background: var(--ck-income-soft); color: var(--ck-income);')
    expect(rule('.ck-rec-status-review')).toBe('background: var(--ck-over-soft); color: var(--ck-over);')
    expect(rule('.ck-rec-status-failed')).toBe('background: var(--ck-error-soft); color: var(--ck-error);')
    // «Отменить» is a quiet danger: an outline in the error colour while it can be pressed.
    expect(rule('.ck-rec-cancel:not(:disabled)')).toBe('border: 1px solid var(--ck-error); background: transparent; color: var(--ck-error);')
  })

  it('takes every colour from the 2.0 tokens', () => {
    expect(css.match(/#[0-9a-f]{3,8}\b|(?:rgb|hsl)a?\(/gi)).toBeNull()
    expect(css).not.toMatch(/--ck-(bg|text|text-muted|accent[a-z-]*|primary[a-z-]*|link[a-z-]*|border[a-z-]*|divider|neutral-[a-z]+|success-[a-z]+|warning-[a-z]+|disabled-[a-z]+|surface-raised|card-shadow|radius|radius-sm|font-figures|text-(xs|sm|base|lg|xl|hero|2xs))\)/)
  })
})
