import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = new URL('../../', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, source), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const app = read('App.css')
const receipts = read('features/receipts/Receipts.css')
const tokens = readFileSync(new URL('theme/tokens.css', source), 'utf8')

/** Flat rules: a media block of these stylesheets holds whole rules. */
const rules = (text: string) => [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .flatMap((match) => match[1].split(',').map((selector) => ({ selector: selector.trim(), body: match[2].trim() })))
const rule = (selector: string, text: string) => rules(text).filter((item) => item.selector === selector).map((item) => item.body).join(' ')
const declares = (body: string, property: string) => new RegExp(`(^|[;\\s])${property}\\s*:`).test(body)
const value = (body: string, property: string) => new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*([^;]+)`).exec(body)?.[1].trim()

/** Classes, attributes and pseudo-classes of a selector; whatever stands inside :where() weighs nothing. */
const weight = (selector: string) => {
  let text = selector
  for (let start = text.indexOf(':where('); start >= 0; start = text.indexOf(':where(')) {
    let end = start + 7
    for (let depth = 1; depth > 0 && end < text.length; end += 1) depth += text[end] === '(' ? 1 : text[end] === ')' ? -1 : 0
    text = text.slice(0, start) + text.slice(end)
  }
  return (text.replace(/::[\w-]+/g, '').replace(/:not\(|\)/g, ' ').match(/\.[\w-]+|\[[^\]]*\]|:[\w-]+/g) ?? []).length
}

/** The names of 2.0 (theme/tokens.css before the LEGACY block): a screen reads only these. */
const canonical = new Set([...tokens.slice(0, tokens.indexOf('LEGACY')).matchAll(/^\s*(--ck-[a-z0-9-]+):/gm)].map((match) => match[1]))

describe('tonal actions of the receipt screens (text of the rules, not rendering)', () => {
  it('keeps the hover and the press of .action-link in the shell as weak as the class', () => {
    const shell = rules(app).filter((item) => /^\.action-link(?![\w.-])/.test(item.selector))
    expect(shell.map((item) => item.selector)).toContain('.action-link')
    for (const item of shell) expect(weight(item.selector), item.selector).toBe(1)
  })

  it('gives no .action-link modifier a colour of its own: «Изменить» is the tonal link of the shell, its hover and press too', () => {
    const modifiers = rules(receipts).filter((item) => /^\.action-link\.[\w-]+/.test(item.selector))
    expect(modifiers.filter((item) => ['color', 'background', 'border-color'].some((property) => declares(item.body, property))).map((item) => item.selector)).toEqual([])
  })

  it('draws the hover (only under a pointer that hovers) and the press of its own tonal buttons and tiles', () => {
    const hover = /@media \(hover: hover\) \{([\s\S]*?)\n\}/.exec(receipts)?.[1] ?? ''
    expect(hover).toContain('.receipt-secondary:hover:not(:disabled):not(:active)')
    expect(hover).toContain('.receipt-toolbar > .receipt-actions > button:hover:not(:disabled):not(:active)')
    expect(receipts.replace(/@media \(hover: hover\) \{[\s\S]*?\n\}/, '')).not.toMatch(/:hover/)
    // The press outweighs the tile it presses (the tile sets its own background).
    expect(weight('.receipt-toolbar > .receipt-actions > button:active:not(:disabled)')).toBeGreaterThan(weight('.receipt-toolbar > .receipt-actions > button'))
  })
})

/** Rules that stand inside `@media (max-width: …)` blocks, with the width of their block. */
const media = /@media\s*\(max-width:\s*(\d+)px\)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g
const narrow = [...receipts.matchAll(media)].flatMap((match) => rules(match[2]).map((item) => ({ ...item, width: Number(match[1]) })))
const outside = receipts.replace(media, '')

describe('whole values, 2.0 tokens and the paper slip (text of the rules, not rendering)', () => {
  it('never wraps a number, a sum, a total or a number of the paper', () => {
    for (const selector of ['.receipt-number', '.receipt-total', '.receipt-slip-value', '.spends-row-amount', '.spends-day-sum', '.receipt-position-amount']) {
      expect(value(rule(selector, outside), 'white-space'), selector).toBe('nowrap')
    }
  })

  it('does not give the wrap back on a narrow screen', () => {
    expect(narrow.map((item) => item.width)).toEqual(narrow.map(() => 540))
    expect(narrow.length).toBeGreaterThan(0)
    const touched = narrow.filter((item) => ['white-space', 'overflow-wrap', 'word-break'].some((property) => declares(item.body, property)))
    expect(touched.map((item) => `${item.width} ${item.selector}`)).toEqual([])
  })

  it('does not make any text of the screen smaller on a narrow screen', () => {
    expect(narrow.filter((item) => declares(item.body, 'font-size') || declares(item.body, 'font')).map((item) => item.selector)).toEqual([])
  })

  it('writes no colour of its own and reads only the names of 2.0', () => {
    expect(receipts).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i)
    const used = [...new Set([...receipts.matchAll(/var\((--ck-[a-z0-9-]+)/g)].map((match) => match[1]))]
    expect(used.filter((name) => !canonical.has(name))).toEqual([])
  })

  it('sizes every text by the 2.0 scale and uses the type of the paper only on the paper', () => {
    for (const [, size] of receipts.matchAll(/font-size:\s*([^;]+);/g)) expect(size.trim()).toMatch(/^var\(--ck-text-(caption|label|body|field|title|heading)\)$/)
    const slipFont = rules(receipts).filter((item) => /var\(--ck-font-slip\)/.test(item.body)).map((item) => item.selector)
    expect(slipFont.length).toBeGreaterThan(0)
    for (const selector of slipFont) expect(selector, selector).toMatch(/receipt-slip/)
  })

  it('keeps the paper paper in both themes: its ground, its inks and the stamp are the slip tokens', () => {
    const slip = rule('.receipt-slip', outside)
    expect(value(slip, 'background')).toBe('var(--ck-slip)')
    expect(value(slip, 'color')).toBe('var(--ck-slip-ink)')
    const stamp = rule('.receipt-stamp', outside)
    expect(value(stamp, 'color')).toBe('var(--ck-stamp)')
    expect(stamp).toContain('border: 2px solid var(--ck-stamp)')
    // Inside the paper no colour of the page: only the slip tokens (a link and the target highlight mix them).
    const paper = rules(outside).filter((item) => /^\.receipt-slip/.test(item.selector))
    for (const item of paper) {
      for (const [, name] of item.body.matchAll(/var\((--ck-[a-z0-9-]+)\)/g)) {
        if (/^--ck-(text|font|space|radius|tap|tape|ease|dur)/.test(name)) continue
        expect(name, item.selector).toMatch(/^--ck-(slip|slip-ink|slip-ink-2|stamp|bezel|line)$/)
      }
    }
  })

  it('moves the paper only once and only when motion is allowed: the print of 1,3 s and the stamp of 0,5 s', () => {
    const motion = '@media (prefers-reduced-motion: no-preference) {'
    expect(receipts.split(motion)).toHaveLength(2)
    expect(receipts.slice(0, receipts.indexOf(motion))).not.toMatch(/animation|transition|@keyframes/)
    const block = receipts.slice(receipts.indexOf(motion))
    expect(block).toContain('.receipt-slip-wrap[data-printing] .receipt-slip { animation: receipt-print 1.3s')
    expect(block).toContain('.receipt-slip-wrap[data-printing] .receipt-stamp { animation: receipt-stamp 0.5s 1.3s')
  })

  it('draws the focus ring of a spend row inside the panel that clips it', () => {
    expect(rule('.spends-rows', receipts)).toContain('overflow: hidden;')
    expect(rule('.spends-row:focus-visible', receipts)).toBe('outline-offset: -3px;')
  })

  it('keeps the search and the chips at the top of a phone under the bar of the shell, on the layer of the action bars', () => {
    const head = narrow.find((item) => item.selector === '.spends-head')?.body ?? ''
    expect(value(head, 'position')).toBe('sticky')
    expect(value(head, 'top')).toBe('var(--ck-top-bar-height)')
    expect(value(head, 'z-index')).toBe('var(--ck-z-action-bar)')
    expect(value(head, 'background')).toBe('var(--ck-paper)')
  })
})
