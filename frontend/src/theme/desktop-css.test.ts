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
    // The one allowed sticky: «Скажите словами» pinned beside the spend form (T5); never a header, never a bar.
    expect(rules(css).filter((item) => /position: sticky/.test(item.body)).map((item) => item.selector)).toEqual(['.expense-page > .expense-hint'])
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

describe('the page of a receipt at ≥ 960 (T4): the header beside the images, the lines across the page, pill actions', () => {
  const receipts = read('features/receipts/Receipts.css').replace(/\/\*[\s\S]*?\*\//g, '')
  const base = rules(receipts.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*\s*\}/g, ''))
  const manual = '.receipt-screen:not(:has(> #receipt-images)) > .receipt-hero'

  it('turns the page into two columns and lets every section span them unless a rule places it', () => {
    const screen = rule('.receipt-screen')
    expect(value(screen, 'max-width')).toBe('none')
    expect(value(screen, 'grid-template-columns').split(/\s+(?=minmax)/)).toHaveLength(2)
    expect(value(screen, 'align-items')).toBe('start')
    expect(rule('.receipt-screen > *')).toBe('grid-column: 1 / -1;')
    // The lines table always spans both columns (WRAP_ACCEPTANCE step 5): no rule may put it into one.
    expect(desktop.filter((item) => item.selector.includes('#receipt-lines'))).toEqual([])
  })

  it('places the header at the left of the images and the discounts at the left of the taxes', () => {
    expect(value(rule('.receipt-screen > .receipt-hero'), 'grid-column')).toBe('1')
    expect(value(rule('.receipt-screen > #receipt-images'), 'grid-column')).toBe('2')
    expect(value(rule('.receipt-screen > #receipt-discounts'), 'grid-column')).toBe('1')
    expect(value(rule('.receipt-screen > #receipt-taxes'), 'grid-column')).toBe('2')
    expect(value(rule('.receipt-screen #receipt-images .receipt-images'), 'grid-template-columns')).toBe('minmax(0, 1fr)')
  })

  it('keeps the header of a spend by hand (no images) across both columns at the cap of the narrower screen', () => {
    expect(value(rule(manual), 'grid-column')).toBe('1 / -1')
    expect(value(rule(manual), 'max-width')).toBe(value(rule('.receipt-screen', base), 'max-width'))
  })

  it('turns the action tiles into pills by repeating the selectors of Receipts.css, so order decides, not weight', () => {
    const toolbar = desktop.filter((item) => item.selector.startsWith('.receipt-toolbar'))
    expect(toolbar.length).toBeGreaterThan(0)
    const known = new Set(base.map((item) => item.selector))
    for (const item of toolbar) expect(known.has(item.selector), item.selector).toBe(true)
    const pill = rule('.receipt-toolbar > .receipt-actions > a')
    expect(pill).toBe(rule('.receipt-toolbar > .receipt-actions > button'))
    expect(value(pill, 'flex-direction')).toBe('row')
    expect(value(pill, 'min-height')).toBe('44px')
    expect(value(pill, 'flex')).toBe('0 1 auto')
    // The four-tile rule of a manual spend with «Скрыть» (two by two on a phone) is lifted: pills take their own width.
    expect(value(rule('.receipt-toolbar:has(.expense-repeat):has([data-receipt-hide]) > .receipt-actions > a'), 'flex-basis')).toBe('auto')
  })
})

describe('«Новая трата» at ≥ 960 (T5): the form at the left, «Скажите словами» pinned at the right', () => {
  const expense = read('features/expense/Expense.css').replace(/\/\*[\s\S]*?\*\//g, '')
  const base = rules(expense.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*\s*\}/g, ''))
  const alone = '.expense-page:not(:has(> .expense-hint))'

  it('turns the page into two columns, two thirds for the form, and lifts the cap of the narrower screens', () => {
    const page = rule('.expense-page')
    expect(value(page, 'display')).toBe('grid')
    expect(value(page, 'grid-template-columns').split(/\s+(?=minmax)/)).toEqual(['minmax(0, 2fr)', 'minmax(0, 1fr)'])
    expect(value(page, 'align-items')).toBe('start')
    expect(value(page, 'max-width')).toBe('none')
    // The form is not split: no desktop rule reaches inside it, so its reading and tab order stay.
    expect(desktop.filter((item) => /\.expense-form\s*[>\s]\s*\S/.test(item.selector))).toEqual([])
  })

  it('keeps the kind switch and the form at the left and pins the hint at the right across both rows', () => {
    expect(value(rule('.expense-page > .expense-kind'), 'grid-column')).toBe('1')
    expect(value(rule('.expense-page > .expense-form'), 'grid-column')).toBe('1')
    const hint = rule('.expense-page > .expense-hint')
    expect(value(hint, 'grid-column')).toBe('2')
    expect(value(hint, 'grid-row')).toBe('1 / span 2')
    expect(value(hint, 'position')).toBe('sticky')
    expect(value(hint, 'top')).toMatch(/^\d+px$/)
  })

  it('gives a page without the hint (editing) one column no wider than the receipt page, heavier than the two-column rule', () => {
    const one = rule(alone)
    expect(value(one, 'grid-template-columns')).toBe('minmax(0, 1fr)')
    expect(value(one, 'max-width')).toBe('760px')
    // The base cap of Expense.css (600 px) stays below 960: this sheet overrides it only inside the block.
    expect(value(rule('.expense-page', base), 'max-width')).toBe('600px')
    expect(rules(outside).filter((item) => item.selector.startsWith('.expense'))).toEqual([])
  })
})

describe('the catalog at ≥ 960 (T6): a 280 px rail at the left, the products a table at the right', () => {
  const catalog = read('features/catalog/Catalog.css').replace(/\/\*[\s\S]*?\*\//g, '')
  const base = rules(catalog.slice(0, catalog.indexOf('@media')))

  it('dissolves the wrappers below the line and places them as rail and main above it', () => {
    expect(rule('.ck-catalog-side', rules(outside))).toBe('display: contents;')
    expect(rule('.ck-catalog-main', rules(outside))).toBe('display: contents;')
    expect(value(rule('.ck-catalog'), 'grid-template-columns')).toBe('280px minmax(0, 1fr)')
    expect(value(rule('.ck-catalog'), 'align-items')).toBe('start')
    expect(value(rule('.ck-catalog-side'), 'grid-column')).toBe('1')
    expect(value(rule('.ck-catalog-main'), 'grid-column')).toBe('2')
    // The category page: the rail follows the head and spans the rows of the head and the products.
    expect(value(rule('.ck-catalog-main ~ .ck-catalog-side'), 'grid-row')).toBe('1 / span 2')
    // Before the category loads (or on an error) the head alone takes the whole width: no empty rail beside it.
    expect(value(rule('.ck-catalog > .ck-catalog-main:only-child'), 'grid-column')).toBe('1 / -1')
    expect(value(rule('.ck-catalog-side .ck-catalog-search-controls'), 'grid-template-columns')).toBe('minmax(0, 1fr)')
  })

  it('lays the table out with fixed columns that add up to the whole width, so a long name wraps instead of scrolling', () => {
    const table = rule('.ck-catalog-table')
    expect(value(table, 'width')).toBe('100%')
    expect(value(table, 'table-layout')).toBe('fixed')
    const widths = ['name', 'generic', 'last'].map((column) => Number(value(rule(`.ck-catalog-col-${column}`), 'width').replace('%', '')))
    expect(widths.every((width) => width > 0)).toBe(true)
    expect(widths.reduce((sum, width) => sum + width, 0)).toBe(100)
    // The headers fit on one line in the narrowest main (584 px at 960): «Обобщённый продукт» ≈ 141 px in Manrope
    // 700 / 13 px needs ≥ 30 % (175 − 32 of padding), «Последняя покупка» ≈ 127 px needs ≥ 28 % (163 − 32).
    expect(widths[1]).toBeGreaterThanOrEqual(30)
    expect(widths[2]).toBeGreaterThanOrEqual(28)
    // A header a pixel wider than its cell wraps its second word; pinned nowrap would run it into the next heading.
    expect(value(rule('.ck-catalog-table thead th'), 'white-space')).toBe('')
    // The price stays whole through the base rule of Catalog.css; the desktop sheet does not touch it.
    expect(value(rule('.ck-catalog-price', base), 'white-space')).toBe('nowrap')
    expect(desktop.filter((item) => item.selector.includes('.ck-catalog-price'))).toEqual([])
  })

  it('hides the caption of the table by position and clip in a base rule of Catalog.css, outside any media block', () => {
    const caption = rule('.ck-catalog-visually-hidden', base)
    expect(caption).toContain('position: absolute;')
    expect(caption).toContain('clip-path: inset(50%);')
    expect(caption).not.toMatch(/display\s*:|visibility\s*:|overflow/)
    expect(desktop.filter((item) => item.selector.includes('.ck-catalog-visually-hidden'))).toEqual([])
  })
})

describe('«Платежи» at ≥ 960 (T8): questions, suggestions and the month at the left, income and the off ones at the right', () => {
  const recurring = read('features/recurring/Recurring.css').replace(/\/\*[\s\S]*?\*\//g, '')
  const base = rules(recurring.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*\s*\}/g, ''))

  it('dissolves the two wrappers below the line, so the phone keeps today\'s one column in today\'s DOM order', () => {
    expect(rule('.rec-main', rules(outside))).toBe('display: contents;')
    expect(rule('.rec-side', rules(outside))).toBe('display: contents;')
    // No order rules: the wrappers hold contiguous groups, the DOM order is the visual order.
    expect(rules(outside).filter((item) => item.selector.startsWith('.rec') && item.body.startsWith('order'))).toEqual([])
  })

  it('turns the page into three fifths and two fifths, the intro across both at the cap of the narrower screens', () => {
    const page = rule('.rec-page')
    expect(value(page, 'grid-template-columns').split(/\s+(?=minmax)/)).toEqual(['minmax(0, 3fr)', 'minmax(0, 2fr)'])
    expect(value(page, 'align-items')).toBe('start')
    expect(value(page, 'max-width')).toBe('none')
    const intro = rule('.rec-page > .rec-intro')
    expect(value(intro, 'grid-column')).toBe('1 / -1')
    expect(value(intro, 'max-width')).toBe('760px')
    // The base of Recurring.css stays one column at 760 px below 960: this sheet overrides it only inside the block.
    expect(value(rule('.rec-page', base), 'max-width')).toBe('760px')
    expect(value(rule('.rec-page', base), 'grid-template-columns')).toBe('minmax(0, 1fr)')
  })

  it('makes each wrapper a column of cards with the gap of the page, and reaches no card, row or form of the screen', () => {
    for (const wrapper of ['.rec-main', '.rec-side']) {
      const body = rule(wrapper)
      expect(value(body, 'display'), wrapper).toBe('grid')
      expect(value(body, 'gap'), wrapper).toBe(value(rule('.rec-page', base), 'gap'))
      expect(value(body, 'min-width'), wrapper).toBe('0')
    }
    expect(value(rule('.rec-main'), 'grid-column')).toBe('1')
    expect(value(rule('.rec-side'), 'grid-column')).toBe('2')
    // Recurring.css, the cards and the sheet forms are not touched: only the page root, the intro and the wrappers.
    expect([...new Set(desktop.filter((item) => /\.rec-/.test(item.selector)).map((item) => item.selector))].sort())
      .toEqual(['.rec-main', '.rec-page', '.rec-page > .rec-intro', '.rec-side'])
  })
})

describe('«Цели», «Доходы», «Магазины» at ≥ 960 (T9): two columns by CSS only, the page of one goal untouched', () => {
  const base = (path: string) => rules(read(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*\s*\}/g, ''))
  const goals = base('features/goals/Goals.css')
  const incomes = base('features/incomes/Incomes.css')
  const stores = base('features/stores/Stores.css')
  const tokens = base('theme/tokens.css')
  const list = '.goals:has(> .goal-add)'
  const tracks = (body: string) => value(body, 'grid-template-columns').split(/\s+(?=minmax)/)

  it('puts the groups of goals side by side only on the list (the root with «Новая цель»), one group alone at the cap', () => {
    const page = rule(list)
    expect(value(page, 'display')).toBe('grid')
    expect(tracks(page)).toEqual(['minmax(0, 1fr)', 'minmax(0, 1fr)'])
    expect(value(page, 'gap')).toBe(value(rule(':where(.ck-stack)', tokens), 'gap'))
    expect(value(page, 'align-items')).toBe('start')
    expect(value(page, 'max-width')).toBe('none')
    for (const alone of [`${list} > .goal-empty`, `${list} > section:only-of-type`]) {
      expect(value(rule(alone), 'grid-column'), alone).toBe('1 / -1')
      expect(value(rule(alone), 'max-width'), alone).toBe(value(rule('.goals', goals), 'max-width'))
    }
    const add = rule(`${list} > .goal-add`)
    expect(value(add, 'grid-column')).toBe('1 / -1')
    expect(value(add, 'width')).toBe('auto')
    expect(value(add, 'min-width')).toMatch(/^\d+px$/)
    expect(value(add, 'justify-self')).toBe('start')
    // Goals.css keeps the 720 px cap and the page-wide button below 960; /goals/{id} shares .goals and has no .goal-add,
    // so every desktop rule of the screen is scoped by :has(> .goal-add) and nothing about goals sits outside the block.
    expect(value(rule('.goals', goals), 'max-width')).toBe('720px')
    expect(value(rule('.goal-add', goals), 'width')).toBe('100%')
    for (const item of desktop.filter((item) => /\.goal/.test(item.selector))) expect(item.selector).toMatch(/^\.goals:has\(> \.goal-add\)/)
    expect(rules(outside).filter((item) => /\.goal|\.inc-|\.stores-/.test(item.selector))).toEqual([])
  })

  it('puts the month of incomes at the left (three fifths) and the categories at the right, the notice across both', () => {
    const page = rule('.inc-page')
    expect(value(page, 'display')).toBe('grid')
    expect(tracks(page)).toEqual(['minmax(0, 3fr)', 'minmax(0, 2fr)'])
    expect(value(page, 'gap')).toBe(value(rule(':where(.ck-stack)', tokens), 'gap'))
    expect(value(page, 'align-items')).toBe('start')
    expect(value(page, 'max-width')).toBe('none')
    expect(value(rule('.inc-page > .inc-notice'), 'grid-column')).toBe('1 / -1')
    expect(value(rule('.inc-page', incomes), 'max-width')).toBe('760px')
    expect([...new Set(desktop.filter((item) => /\.inc-/.test(item.selector)).map((item) => item.selector))].sort())
      .toEqual(['.inc-page', '.inc-page > .inc-notice'])
  })

  it('puts all the places at the left and the suggestions at the right of the same row, the intro, notices and the bar across', () => {
    const page = rule('.stores-page')
    expect(value(page, 'display')).toBe('grid')
    expect(tracks(page)).toEqual(['minmax(0, 3fr)', 'minmax(0, 2fr)'])
    expect(value(page, 'grid-auto-flow')).toBe('row dense')
    expect(value(page, 'gap')).toBe(value(rule('.stores-page', stores), 'gap'))
    expect(value(page, 'align-items')).toBe('start')
    expect(value(page, 'max-width')).toBe('none')
    for (const across of ['.stores-page > .stores-intro', '.stores-page > .stores-notice', '.stores-page > .stores-failure', '.stores-page > .stores-actions']) {
      expect(value(rule(across), 'grid-column'), across).toBe('1 / -1')
    }
    expect(value(rule('.stores-page > .stores-intro'), 'max-width')).toBe('760px')
    expect(value(rule('.stores-page > .stores-suggestions'), 'grid-column')).toBe('2')
    expect(value(rule('.stores-page > .ck-panel:not(.stores-suggestions)'), 'grid-column')).toBe('1')
    // Stores.css keeps the flex column at 720 px below 960 (its 540 block and the action bar pinning are untouched).
    expect(value(rule('.stores-page', stores), 'display')).toBe('flex')
    expect(value(rule('.stores-page', stores), 'max-width')).toBe('720px')
    expect([...new Set(desktop.filter((item) => /\.stores-|\.ck-panel:not/.test(item.selector)).map((item) => item.selector))].sort())
      .toEqual(['.stores-page', '.stores-page > .ck-panel:not(.stores-suggestions)', '.stores-page > .stores-actions', '.stores-page > .stores-failure',
        '.stores-page > .stores-intro', '.stores-page > .stores-notice', '.stores-page > .stores-suggestions'])
  })
})
