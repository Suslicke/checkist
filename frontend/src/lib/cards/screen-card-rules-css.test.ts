import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const css = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, '')
const receipts = css('../../features/receipts/Receipts.css')
const recognition = css('../../features/recognition/Recognition.css')

/** Flat rules: a media block of these stylesheets holds whole rules. */
const rules = (text: string) => [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .flatMap((match) => match[1].split(',').map((selector) => ({ selector: selector.trim().replace(/^@media[^{]*\{\s*/, ''), body: match[2].trim() })))
const rule = (text: string, selector: string) => rules(text).filter((item) => item.selector === selector).map((item) => item.body).join(' ')
const value = (body: string, property: string) => new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*([^;]+)`).exec(body)?.[1].trim()
const outside = (text: string) => text.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*\s*\}/g, '')

describe('screen rules that follow a row heading into its card (text of the rules, not rendering)', () => {
  it('keeps the unmatched mark of a receipt line a direct note of the line (the paper slip of Чекист 2.0 has no table and no cards)', () => {
    expect(rule(outside(receipts), '.receipt-slip-notes > .receipt-warning')).not.toBe('')
    expect(read('../../features/receipts/ReceiptContent.tsx')).toContain('<span className="receipt-warning">Товар не сопоставлен</span>')
  })

  it('keeps the other parts of a receipt line styled by their own classes on the paper', () => {
    for (const selector of ['.receipt-note', '.receipt-printed-name', '.receipt-slip .receipt-product-link', '.receipt-line-relation']) {
      expect(rule(outside(receipts), selector), selector).not.toBe('')
    }
  })

  it('puts the note of the confirm button 12px under its buttons on any width', () => {
    // Чекист 2.0: the gaps are spacing tokens — the form 16 px (space-4), the note pulled up by 4 px (space-1): 12 px.
    expect(value(rule(recognition, '.ck-review'), 'gap')).toBe('var(--ck-space-4)')
    const selector = '.ck-review > .ck-rec-action-block + .ck-rec-note'
    // Three classes outweigh `.ck-review p { margin: 0; }`; the rule stands outside the media blocks.
    expect(rule(outside(recognition), selector)).toBe('margin-top: calc(-1 * var(--ck-space-1));')
    expect(rule(recognition, '.ck-review p')).toBe('margin: 0;')
    expect(rules(recognition).filter((item) => item.selector === selector)).toHaveLength(1)
  })

  it('matches the markup of the form: the note is the next sibling of the button block, a child of the form', () => {
    const form = read('../../features/recognition/ReviewForm.tsx')
    expect(form).toMatch(/<div className="ck-rec-action-block ck-action-bar">\s*<div className="ck-rec-actions">[\s\S]*?<\/div>\s*<\/div>\s*<p id=\{dom\('confirm-note'\)\} className="ck-rec-note">/)
    expect(form).toMatch(/<section[^>]*className="ck-review"/)
  })
})
