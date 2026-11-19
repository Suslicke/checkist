import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ReceiptListItem } from '../../api/receipts'
import { publicFixture } from '../../api/recognition-test-support'
import type { Page } from '../../api/types'
import { ReceiptsView, ReviewBanner } from './ReceiptsPage'
import { OwnerChips, SpendDays } from './SpendDays'
import { ownerChips } from './spends'
import { setListIcons } from '../../lib/list-icons'

const NBSP = '\u00a0'
const noop = () => {}
// The rows of these tests name their categories themselves: the public example's own list is dropped.
const base: ReceiptListItem = { ...(publicFixture('receipts.json') as Page<ReceiptListItem>).results[0], categories: undefined }
const rows: ReceiptListItem[] = [
  { ...base, id: 1, purchased_on: '2026-10-12', currency: 'KZT', total: '18940.00', owner: 'liza', owner_name: 'Лиза', lines_count: 23,
    store: { ...base.store!, name: 'Magnum' }, category: { id: 3, name: 'Продукты' } },
  { ...base, id: 2, source: 'manual', store: null, preview_image_url: null, purchased_on: '2026-10-12', currency: 'KZT', total: '1060.00',
    owner: 'andrey', owner_name: 'Андрей', lines_count: 1, first_line: 'Такси', category: { id: 8, name: 'Транспорт' } },
  { ...base, id: 3, purchased_on: '2026-10-11', currency: 'EUR', total: '2.38', owner: 'andrey', owner_name: 'Андрей', category: null },
]
/** The words of the meta line of every row, without the markup of its flags. */
const metas = (html: string) => [...html.matchAll(/<span class="spends-row-meta"><span class="ck-stamp spends-stamp"[^>]*>[^<]*<\/span>([\s\S]*?)<\/span><\/span><span class="spends-row-amount/g)]
  .map((match) => match[1].replace(/<[^>]+>/g, ''))
/** The provenance stamps of the rows, in order. */
const stamps = (html: string) => [...html.matchAll(/<span class="ck-stamp spends-stamp" data-source="([a-z]+)">([^<]*)<\/span>/g)].map((match) => `${match[1]}: ${match[2]}`)
const THIN = '\u202f'
/** The markup of `<Money>` (components/Money.tsx) of an amount, as a row of the list or the size of the text. */
const money = (int: string, frac: string, sign: string, size = 'inline') =>
  `<span class="ck-money ck-money--${size}"><span class="ck-money-int">${int}</span>${frac ? `<span class="ck-money-frac">${frac}</span>` : ''}<span class="ck-money-cur">${THIN}${sign}</span></span>`
const page = (results: ReceiptListItem[]): Page<ReceiptListItem> => ({ count: results.length, page: 1, page_size: 50, pages: 1, results })
const family = ownerChips({ kind: 'user', mode: 'accounts', user: { id: 1, username: 'andrey', is_staff: false },
  household: { id: 4, name: 'Семья', members: ['andrey', 'liza'],
    people: [{ username: 'andrey', display_name: 'Андрей' }, { username: 'liza', display_name: 'Лиза' }] }, permissions: { moderate_catalog: false } }, 'liza')

describe('«Траты» on a phone (Vitest/SSR, not browser visual acceptance)', () => {
  it('shows days with their totals per currency and one linked row per receipt', () => {
    const html = renderToStaticMarkup(<SpendDays receipts={rows} today="2026-10-12" showOwner />)
    expect(html.match(/<h3>[^]*?<\/h3>/g)).toEqual([
      '<h3><time dateTime="2026-10-12">Сегодня</time></h3>', `<h3><time dateTime="2026-10-11">Вчера, 11${NBSP}окт</time></h3>`])
    // The totals of a day and the amounts of the rows are Money of 2.0: exact, the currency as its sign.
    expect(html).toContain(`<span class="spends-day-sum">${money(`20${THIN}000`, '', '₸')}</span>`)
    expect(html).toContain(`<span class="spends-day-sum">${money('2', ',38', '€')}</span>`)
    expect(html.match(/<a class="spends-row" href="\/receipts\/\d+">/g)).toHaveLength(3)
    // One panel per day.
    expect(html.match(/<ul class="spends-rows">/g)).toHaveLength(2)
    // The place, then the provenance stamp and who and on what; the amount in ink at the right.
    expect(html).toContain('<span class="spends-row-title">Magnum</span><span class="spends-row-meta"><span class="ck-stamp spends-stamp" data-source="photo">Фото</span>')
    expect(metas(html)[0]).toBe(`Лиза · Продукты · 23${NBSP}позиции`)
    expect(html).toContain(`<span class="spends-row-amount">${money(`18${THIN}940`, '', '₸', 'row')}</span>`)
    // A spend without a place is titled by its first line; its stamp says it was typed by hand.
    expect(html).toContain('<span class="spends-row-title">Такси</span><span class="spends-row-meta"><span class="ck-stamp spends-stamp" data-source="manual">Вручную</span>')
    expect(stamps(html)).toEqual(['photo: Фото', 'manual: Вручную', 'photo: Фото'])
  })

  it('tints the badge by the category colour and leaves it neutral without one; the category picture or a slip, a pencil or a card', () => {
    const statement = { ...rows[1], id: 4, note: 'Steam · Выписка Kaspi Gold', category: null }
    const receipts = [{ ...rows[0], category: { id: 3, name: 'Продукты', icon: 'cart' } }, rows[1], rows[2], statement]
    const render = () => renderToStaticMarkup(<SpendDays receipts={receipts} today="2026-10-12" showOwner={false} />)
    const html = render()
    const badges = html.match(/<span class="spends-badge"[^>]*>/g)
    // The category by default: its picture (the server sends it inherited), none — the tag.
    expect(badges).toEqual([
      '<span class="spends-badge" data-tone="3" data-icon="cart" aria-hidden="true">',
      '<span class="spends-badge" data-tone="2" data-icon="tag" aria-hidden="true">',
      '<span class="spends-badge" data-icon="tag" aria-hidden="true">',
      '<span class="spends-badge" data-icon="tag" aria-hidden="true">',
    ])
    expect(html).toMatch(/<span class="spends-badge" data-tone="3" data-icon="cart" aria-hidden="true"><svg class="ck-icon" viewBox="0 0 24 24" width="20" height="20"[^>]*>.*?<\/svg><\/span>/)
    // The only category of the lines gives its own picture, several — the one of their common root.
    const leaf = { ...rows[0], category: { id: 3, name: 'Продукты', icon: 'cart' }, categories: [{ id: 31, name: 'Молочное', icon: 'heart' }] }
    expect(renderToStaticMarkup(<SpendDays receipts={[leaf]} today="2026-10-12" showOwner={false} />)).toContain('data-icon="heart"')
    const two = { ...leaf, categories: [...leaf.categories, { id: 32, name: 'Хлеб', icon: 'cart' }] }
    expect(renderToStaticMarkup(<SpendDays receipts={[two]} today="2026-10-12" showOwner={false} />)).toContain('data-icon="cart"')
    // How the spend came in by the choice of the device; the colour stays the category's. The statement is of the same
    // day as the first two rows.
    setListIcons('source')
    try {
      expect(render().match(/data-icon="[a-z]+"/g)).toEqual(['data-icon="receipt"', 'data-icon="pencil"', 'data-icon="card"', 'data-icon="receipt"'])
      expect(render()).toContain('<span class="spends-badge" data-tone="3" data-icon="receipt" aria-hidden="true">')
    } finally {
      setListIcons('category')
    }
    // The stamp of a statement names its bank; the meta line does not repeat it.
    expect(stamps(html)).toContain('statement: Выписка Kaspi Gold')
    expect(metas(html)[2]).toBe('')
    expect(html).not.toContain('liza')
  })

  it('marks a hidden payment on its row', () => {
    const html = renderToStaticMarkup(<SpendDays receipts={[{ ...rows[1], hidden: true }]} today="2026-10-12" showOwner={false} />)
    expect(html).toContain('<a class="spends-row" data-hidden="" href="/receipts/2">')
    // The word of a hidden payment in the colour of a warning, the rest quiet.
    expect(html).toContain('<span class="spends-row-meta"><span class="ck-stamp spends-stamp" data-source="manual">Вручную</span><span class="spends-row-flag">скрыто</span><span> · Транспорт</span></span>')
    const review = renderToStaticMarkup(<SpendDays receipts={[{ ...rows[0], review_required: true }]} today="2026-10-12" showOwner={false} />)
    expect(review).toContain('<span class="spends-row-flag">требует проверки</span>')
  })

  it('escapes names coming from the server', () => {
    const html = renderToStaticMarkup(<SpendDays receipts={[{ ...rows[1], first_line: '<b>x</b>', owner: '<i>o</i>' }]} today="2026-10-12" showOwner />)
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(html).not.toContain('<b>x</b>')
    expect(html).not.toContain('<i>o</i>')
  })

  it('shows the days of rows on every width', () => {
    const wide = renderToStaticMarkup(<ReceiptsView query={{ page: 1 }} state={{ kind: 'ok', data: page(rows) }} retry={noop} today="2026-10-12" />)
    expect(wide).toContain('class="spends-days"')
    expect(wide).not.toContain('class="receipt-list"')
    const phone = renderToStaticMarkup(<ReceiptsView query={{ page: 1 }} state={{ kind: 'ok', data: page(rows) }} retry={noop} narrow today="2026-10-12" />)
    expect(phone).toContain('class="spends-days"')
    expect(phone).not.toContain('class="receipt-list"')
    // Nothing of a family without one.
    expect(phone).not.toContain('spends-chips')
    expect(phone).not.toContain('spends-review')
  })
})

describe('family chips and the review banner', () => {
  it('links every chip to the list of its member, keeps the filters and marks the current one', () => {
    const html = renderToStaticMarkup(<OwnerChips chips={family} query={{ page: 2, q: 'MILCH', owner: 'liza' }} />)
    expect(html).toContain('<div class="spends-chips"><div class="ck-chip-scroller"><div class="ck-chip-scroller-track" role="region" aria-label="Кто добавил" tabindex="0"><ul>')
    expect(html.match(/<a [^>]*>[^<]*<\/a>/g)).toEqual([
      '<a class="ck-chip" href="/receipts?q=MILCH">Вся семья</a>',
      '<a class="ck-chip" href="/receipts?q=MILCH&amp;owner=andrey">Андрей</a>',
      '<a class="ck-chip" aria-current="true" href="/receipts?q=MILCH&amp;owner=liza">Лиза</a>',
    ])
    expect(renderToStaticMarkup(<OwnerChips chips={[]} query={{ page: 1 }} />)).toBe('')
  })

  it('shows the banner only with photos waiting and links it to the jobs that wait', () => {
    expect(renderToStaticMarkup(<ReviewBanner count={undefined} />)).toBe('')
    expect(renderToStaticMarkup(<ReviewBanner count={0} />)).toBe('')
    expect(renderToStaticMarkup(<ReviewBanner count={3} />))
      .toMatch(new RegExp('^<p class="spends-review"><a href="/recognition/jobs\\?needs_review=1"><span class="spends-review-badge" aria-hidden="true"><svg[^>]*>.*?</svg></span>'
        + `<span class="spends-review-text">3${NBSP}фото ждут проверки</span><span class="spends-review-action" aria-hidden="true">Проверить</span></a></p>$`))
  })

  it('puts chips and the banner above the list and offers to reset an owner filter on an empty page', () => {
    const html = renderToStaticMarkup(<ReceiptsView narrow query={{ page: 1, owner: 'liza' }} state={{ kind: 'ok', data: page([]) }} retry={noop} chips={family} review={2} />)
    expect(html.indexOf('spends-chips')).toBeLessThan(html.indexOf('spends-review'))
    expect(html.indexOf('spends-review')).toBeLessThan(html.indexOf('Список трат'))
    expect(html).toContain('По выбранным фильтрам трат нет.')
    // No big «Загрузить фото» / «Добавить трату» above the list: the «＋» of the navigation adds a spend.
    expect(html).not.toContain('receipt-primary')
    // «Обработка» stays as a quiet link at the end.
    expect(html).toMatch(/<p class="spends-jobs"><a href="\/recognition\/jobs">Обработка фото<svg[^>]*>.*?<\/svg><\/a><\/p><\/div>$/)
  })

  it('keeps the heading of the list for a screen reader only: the days are the cards', () => {
    const phone = renderToStaticMarkup(<ReceiptsView narrow query={{ page: 1 }} state={{ kind: 'ok', data: page(rows) }} retry={noop} today="2026-10-12" />)
    expect(phone).toMatch(/<section class="receipt-bare" aria-labelledby="[^"]+" aria-busy="false"><h2 id="[^"]+" data-request-focus-target="true" tabindex="-1" class="receipt-visually-hidden">Список трат<\/h2>/)
    expect(phone).toContain(`<p class="receipt-note spends-count" role="status">3${NBSP}траты · Страница 1 из 1</p>`)
    const wide = renderToStaticMarkup(<ReceiptsView query={{ page: 1 }} state={{ kind: 'ok', data: page(rows) }} retry={noop} />)
    expect(wide).toMatch(/<section class="receipt-bare" [^>]*><h2 [^>]*class="receipt-visually-hidden">Список трат<\/h2>/)
  })

  it('hides the filters behind a round «Фильтры (N)» at the end of the chips on a phone and keeps the form on a wide screen', () => {
    // The words of the search line (2026-10-13) are on the screen anyway: only the date is behind the funnel.
    const query = { page: 1, q: 'MILCH', date_from: '2026-10-01', owner: 'liza' }
    const phone = renderToStaticMarkup(<ReceiptsView narrow query={query} state={{ kind: 'ok', data: page([]) }} retry={noop} chips={family} />)
    expect(phone).toMatch(/<div class="spends-toolbar"><div class="spends-chips">[\s\S]*<\/div><button type="button" class="ck-icon-button spends-filters-toggle" aria-haspopup="dialog" aria-expanded="false" aria-label="Фильтры \(1\)"><svg [^>]*>[\s\S]*?<\/svg><span class="spends-filters-count" aria-hidden="true">1<\/span><\/button><\/div>/)
    // The search and the chips are one head that stays at the top of a phone.
    expect(phone).toMatch(/<div class="spends-head"><form role="search" class="spends-search"[\s\S]*<div class="spends-toolbar">/)
    expect(phone).not.toContain('Применить')
    // Nothing filtered: the funnel alone.
    const plain = renderToStaticMarkup(<ReceiptsView narrow query={{ page: 1 }} state={{ kind: 'ok', data: page([]) }} retry={noop} chips={family} />)
    expect(plain).toContain('aria-label="Фильтры"')
    expect(plain).not.toContain('spends-filters-count')
    const wide = renderToStaticMarkup(<ReceiptsView query={query} state={{ kind: 'ok', data: page([]) }} retry={noop} chips={family} />)
    expect(wide).not.toContain('spends-filters-toggle')
    expect(wide).toContain('>Применить</button>')
  })

  it('puts «Показать скрытые» of the head among the filters and counts it there', () => {
    const wide = renderToStaticMarkup(<ReceiptsView head query={{ page: 1, hidden: 1 }} state={{ kind: 'ok', data: page([]) }} retry={noop} chips={family} />)
    expect(wide.indexOf('data-hidden-chip')).toBeLessThan(wide.indexOf('>Фильтры<'))
    expect(wide).toContain('aria-current="true"')
    const phone = renderToStaticMarkup(<ReceiptsView narrow head query={{ page: 1, hidden: 1 }} state={{ kind: 'ok', data: page([]) }} retry={noop} chips={family} />)
    // The sheet is closed: the chip waits in it, the button counts it.
    expect(phone).not.toContain('data-hidden-chip')
    expect(phone).toContain('aria-label="Фильтры (1)"')
    expect(renderToStaticMarkup(<ReceiptsView query={{ page: 1 }} state={{ kind: 'ok', data: page([]) }} retry={noop} />)).not.toContain('Показать скрытые')
  })
})

describe('styles of «Траты» (text of the rules, not rendering)', () => {
  const css = readFileSync(new URL('./Receipts.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const rule = (selector: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((match) => match[1].trim() === selector)?.[2].trim() ?? ''

  it('draws a day as a quiet line over one panel of 2.0: the surface, a line frame, no shadow', () => {
    expect(rule('.spends-day-head')).toContain('color: var(--ck-ink-2);')
    expect(rule('.spends-day-head')).not.toContain('position')
    expect(rule('.spends-rows')).toContain('border: 1px solid var(--ck-line); border-radius: var(--ck-radius-card); background: var(--ck-surface);')
    expect(rule('.receipt-panel')).toContain('border: 1px solid var(--ck-line); border-radius: var(--ck-radius-card); background: var(--ck-surface);')
    expect(css).not.toContain('box-shadow: var(--ck-card-shadow)')
    expect(rule('.ck-sheet .receipt-panel')).toBe('padding: 0; border: 0; background: none;')
  })

  it('cuts a long place or meta of a row with an ellipsis on one line and keeps the amount whole', () => {
    for (const selector of ['.spends-row-title', '.spends-row-meta']) {
      expect(rule(selector), selector).toContain('overflow: hidden;')
      expect(rule(selector), selector).toContain('text-overflow: ellipsis; white-space: nowrap;')
    }
    expect(rule('.spends-row-main')).toContain('min-width: 0;')
    expect(rule('.spends-row-amount')).toContain('flex: none;')
  })

  it('sets every font size of the screen with the scale of 2.0', () => {
    const sizes = [...css.matchAll(/font-size\s*:\s*([^;]+);/g)].map((match) => match[1].trim())
    expect(sizes.length).toBeGreaterThan(10)
    for (const size of sizes) expect(size).toMatch(/^var\(--ck-text-(caption|label|body|field|title|heading)\)$/)
  })

  it('never wraps an amount or a day total, and keeps touch targets at least a tap', () => {
    for (const selector of ['.spends-row-amount', '.spends-day-sum']) expect(rule(selector), selector).toContain('white-space: nowrap')
    expect(Number(/min-height: (\d+)px/.exec(rule('.spends-review a'))?.[1])).toBeGreaterThanOrEqual(48)
    expect(rule('.spends-row')).toContain('min-height: 64px')
    expect(rule('.spends-search-field input')).toContain('min-height: var(--ck-tap)')
    expect(rule('.spends-ask')).toContain('min-height: var(--ck-tap)')
  })

  it('takes every colour from a 2.0 token and gives each of the six category tones its colour and tint', () => {
    const spends = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((match) => match[1].includes('.spends-'))
    expect(spends.length).toBeGreaterThan(10)
    for (const [, selector, body] of spends) expect(body, selector).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i)
    for (let tone = 1; tone <= 6; tone += 1) {
      expect(rule(`.spends-badge[data-tone="${tone}"]`)).toBe(`background: var(--ck-cat-${tone}-tint); color: var(--ck-cat-${tone});`)
    }
    // Spending is ink, never red; the assistant speaks in gold.
    expect(rule('.spends-row')).toContain('color: var(--ck-ink);')
    expect(rule('.spends-ask')).toContain('background: var(--ck-gold-soft); color: var(--ck-gold-ink);')
  })

  it('defines the category tokens in both themes', () => {
    const tokens = readFileSync(new URL('../../theme/tokens.css', import.meta.url), 'utf8')
    const block = (selector: string) => { const start = tokens.indexOf(`\n${selector} {`); return tokens.slice(start, tokens.indexOf('\n}', start)) }
    for (const theme of [block(':root'), block(':root[data-theme="light"]')]) {
      for (let tone = 1; tone <= 6; tone += 1) {
        expect(theme).toMatch(new RegExp(`--ck-cat-${tone}: #[0-9a-f]{6};`))
        expect(theme).toMatch(new RegExp(`--ck-cat-${tone}-tint: #[0-9a-f]{6};`))
      }
    }
  })
})
