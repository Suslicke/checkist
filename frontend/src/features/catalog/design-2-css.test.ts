import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** The stylesheets of the «Данные» screens (catalog, product, duplicates, categories, stores, statements, export). */
const sheets = [
  'catalog/Catalog.css', 'product/Product.css', 'merges/Merges.css', 'classification/Classification.css',
  'stores/Stores.css', 'statements/Statements.css', 'export/Export.css',
].map((path) => ({ path, css: readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '') }))

/** Names of 1.x that tokens.css keeps only as aliases while the screens move to 2.0 (docs/plans/2026-11-20-design-2.md §1). */
const legacy = /var\(--ck-(?:bg|text|text-muted|surface-raised|nav-bg|brand[\w-]*|primary[\w-]*|on-primary|on-brand|accent[\w-]*|on-accent|link[\w-]*|border[\w-]*|divider|popover-[\w-]+|(?:error|success|warning|info|neutral|over|disabled)-(?:text|bg|border)|card-shadow|fab-shadow|panel-shadow|header-[\w-]+|chip-selected-[\w-]+|toast-[\w-]+|swipe-[\w-]+|font-body|font-figures|font-display-figures|text-(?:2xs|xs|sm|base|lg|xl|hero)|radius|radius-sm|radius-md)\)/g

describe('the «Данные» screens speak Чекист 2.0 (text of the stylesheets, not rendering)', () => {
  it.each(sheets)('$path reads only 2.0 names of the tokens', ({ css }) => {
    expect(css.match(legacy)).toBeNull()
  })

  it.each(sheets)('$path takes colours from the tokens and sizes of the text from the 2.0 scale', ({ css }) => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|\b(?:rgb|hsl)a?\(/i)
    for (const [, size] of css.matchAll(/font-size\s*:\s*([^;]+);/g)) {
      expect(size.trim()).toMatch(/^var\(--ck-text-(caption|label|body|field|title|heading|money-display|title-large|money-hero)\)$/)
    }
  })

  it.each(sheets)('$path draws panels flat: no shadow but the floating ones of a pinned bar or a result', ({ path, css }) => {
    const shadows = [...css.matchAll(/([^{}]+)\{([^{}]*box-shadow\s*:[^{}]*)\}/g)]
      .filter((match) => !/box-shadow\s*:\s*(none|inset\b)/.test(match[2]))
      .map((match) => match[1].trim())
    for (const selector of shadows) expect(selector, path).toMatch(/actions|result-bar/)
  })
})
