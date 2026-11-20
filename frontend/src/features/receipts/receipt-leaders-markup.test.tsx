import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Discount, Line, Receipt, Tax } from '../../api/receipts'
import type { ReceiptImage } from '../../api/recognition'
import { publicFixture } from '../../api/recognition-test-support'
import type { Page } from '../../api/types'
import { ReceiptLines } from './ReceiptContent'
import ReceiptFilters from './ReceiptFilters'
import { ReceiptView } from './ReceiptPage'
import type { BlockRequest, ReceiptViewProps } from './ReceiptPage'
import { slipFacts } from './line-facts'

const receipt = publicFixture('receipt.json') as Receipt
const page = publicFixture('lines.json') as Page<Line>
const milk = page.results[0]
const bread: Line = { ...milk, id: 102, position: 2, product: null, matching_status: 'unmatched', name: 'ХЛЕБ', quantity: '1.000', amount: '1.10', discount_amount: '0.00', paid_amount: '1.10' }
const deposit: Line = { ...bread, id: 103, position: 3, kind: 'deposit', parent_id: 101, name: 'PFAND', amount: '0.25', paid_amount: '0.25' }
const service: Line = { ...bread, id: 104, position: 4, kind: 'service', name: 'ДОСТАВКА', amount: '3.00', discount_amount: '0.50', paid_amount: '2.50' }
const returned: Line = { ...deposit, id: 105, position: 5, kind: 'deposit_return', parent_id: null, quantity: '-1.000', amount: '-0.25', paid_amount: '-0.25' }
const lines = [milk, bread, deposit, service, returned]

const slip = (rows: Line[], currency: string | undefined = 'EUR') => renderToStaticMarkup(<ReceiptLines lines={rows} currency={currency} />)
const text = (html: string) => html.replace(/<[^>]+>/g, '')
/** A line of the paper: its id, the words of each row (label → value) and its notes. */
const items = (html: string) => [...html.matchAll(/<li id="(receipt-line-\d+)" tabindex="-1" class="receipt-slip-item">([\s\S]*?)<span class="receipt-slip-notes">([\s\S]*?)<\/span><\/li>/g)]
  .map((match) => ({ id: match[1], body: match[2], notes: match[3],
    rows: [...match[2].matchAll(/<span class="receipt-slip-label">([\s\S]*?)<\/span><span class="receipt-slip-value"><span class="receipt-visually-hidden">: <\/span>([^<]*)<\/span>/g)]
      .map((row) => [text(row[1]), row[2]]) }))
const facts = (line: Partial<Line>) => slipFacts({ ...milk, ...line }).map((fact) => [fact.label, fact.value])

describe('the lines of a receipt as its paper slip (Vitest/SSR, not browser visual acceptance)', () => {
  it('draws one list of the paper on every width: no table, no cards, no scroll region', () => {
    const html = slip(lines)
    expect(html).toContain('<ol class="receipt-slip-lines" aria-label="Строки чека">')
    expect(html).not.toContain('<table')
    expect(html).not.toContain('role="region"')
    expect(html.match(/class="receipt-slip-item"/g)).toHaveLength(lines.length)
    expect(items(html)).toHaveLength(lines.length)
  })

  it('puts the printed name first and «2 шт × 1,29 ……… 2,58», the discount and the paid amount under it, without the currency', () => {
    const [row] = items(slip([milk]))
    expect(row.body.startsWith('<a class="receipt-printed-name receipt-product-link" href="/catalog/products/61">MILCH 1 L')).toBe(true)
    expect(row.rows).toEqual([['2\u00a0шт × 1,29', '2,58'], ['Скидка', '−0,20'], ['Оплачено', '2,38']])
    // The slip names its currency once, at ИТОГО: no sign on a line.
    expect(text(row.body)).not.toContain('€')
  })

  it('names a matched line by its printed name as the link to its product, the product name for a screen reader', () => {
    const html = slip([milk])
    expect(html).toContain('<a class="receipt-printed-name receipt-product-link" href="/catalog/products/61">MILCH 1 L<span class="receipt-visually-hidden">, товар каталога: Молоко 1 л</span></a>')
    expect(html).not.toContain('Товар не сопоставлен')
  })

  it('stands a single piece on the line of its name and keeps the unmatched mark under it', () => {
    const [row] = items(slip([bread]))
    expect(row.rows).toEqual([['ХЛЕБ', '1,10']])
    expect(row.body).toContain('<div class="receipt-slip-row receipt-slip-named"><span class="receipt-slip-label"><span class="receipt-printed-name">ХЛЕБ</span></span>')
    expect(row.notes).toBe('<span class="receipt-warning">Товар не сопоставлен</span>')
  })

  it('says the kind of a line that is not a product, the category instead of the unmatched mark and the relations', () => {
    const html = slip(lines)
    const rows = items(html)
    expect(rows[0].notes).toBe('<span class="receipt-line-relation">Залог: <a href="#receipt-line-103">Строка\u00a03: PFAND</a></span>')
    expect(rows[2].notes).toContain('<span class="receipt-note">Залог</span>')
    expect(rows[2].notes).toContain('Залог к <a href="#receipt-line-101">Строка\u00a01: MILCH 1 L</a>')
    expect(rows[3].notes).toContain('<span class="receipt-note">Услуга</span>')
    expect(rows[4].notes).toContain('<span class="receipt-note">Возврат залога</span>')
    expect(html.match(/Товар не сопоставлен/g)).toHaveLength(4)
    const grocery = items(slip([{ ...bread, category: { id: 3, name: 'Продукты' } } as Line]))[0]
    expect(grocery.notes).toBe('<span class="receipt-note receipt-line-category">Категория: Продукты</span>')
  })

  it('makes each line the target of a line link: its id and tabindex, once per line', () => {
    const html = slip(lines)
    for (const line of lines) expect(html.match(new RegExp(` id="receipt-line-${line.id}"`, 'g'))).toHaveLength(1)
    expect(html.match(/tabindex="-1"/g)).toHaveLength(lines.length)
    // Every link of the list points at a line of the same list.
    for (const [, target] of html.matchAll(/href="#(receipt-line-\d+)"/g)) expect(html).toContain(`<li id="${target}" tabindex="-1" class="receipt-slip-item">`)
  })

  it('keeps the identity of a parent line that is on another page', () => {
    const html = slip([{ ...milk, kind: 'deposit', parent_id: 999 }])
    expect(html).toContain('Залог к <span>Строка\u00a0ID\u00a0999 (на другой странице строк)</span>')
    expect(html).not.toContain('href="#receipt-line-999"')
  })

  it('leaves out a zero discount, in any spelling of the source value', () => {
    for (const discount_amount of ['0.00', '0', '0.0', '0.000', '00.00', '-0.00']) {
      expect(facts({ discount_amount, paid_amount: '2.00' }).map(([label]) => label)).toEqual(['2\u00a0шт × 1,29', 'Оплачено'])
    }
    for (const discount_amount of ['0.01', '-0.20', '0.001']) expect(facts({ discount_amount }).map(([label]) => label)).toContain('Скидка')
    // A discount is printed as what it takes away.
    expect(facts({ discount_amount: '0.20' })[1]).toEqual(['Скидка', '−0,20'])
    expect(facts({ discount_amount: '-0.20' })[1]).toEqual(['Скидка', '0,20'])
  })

  it('leaves out the paid amount equal to the amount, comparing the source values and not the formatted text', () => {
    expect(facts({ amount: '2.58', paid_amount: '2.58' }).map(([label]) => label)).not.toContain('Оплачено')
    expect(facts({ amount: '2.5', paid_amount: '2.50' }).map(([label]) => label)).not.toContain('Оплачено')
    expect(facts({ amount: '-0.25', paid_amount: '-0.25' }).map(([label]) => label)).not.toContain('Оплачено')
    // Both read "2,58" (2.584 is shown to kopecks), but the values differ: the fact stays.
    expect(facts({ amount: '2.58', paid_amount: '2.584' }).filter(([label]) => label !== 'Скидка')).toEqual([['2\u00a0шт × 1,29', '2,58'], ['Оплачено', '2,58']])
    expect(facts({ amount: '0.25', paid_amount: '-0.25' }).map(([label]) => label)).toContain('Оплачено')
  })

  it('leaves out the quantity and the price of a single piece: the price is the amount itself', () => {
    for (const quantity of ['1', '1.000', '01.0']) {
      expect(facts({ quantity, amount: '1.29', discount_amount: '0.00', paid_amount: '1.29' }), quantity).toEqual([['Сумма', '1,29']])
    }
    expect(facts({ quantity: '0.532' })[0][0]).toBe('0,532\u00a0шт × 1,29')
  })

  it('shows a value that was not read instead of hiding it', () => {
    const unread = facts({ discount_amount: null as unknown as string, paid_amount: null as unknown as string })
    expect(unread.filter(([label]) => label === 'Скидка' || label === 'Оплачено')).toEqual([['Скидка', 'Не распознано'], ['Оплачено', 'Не распознано']])
    expect(facts({ amount: 'x', paid_amount: 'x' }).map(([, value]) => value)).toContain('Не распознано')
  })

  it('warns about the unknown currency above the paper while the receipt is not loaded', () => {
    const html = renderToStaticMarkup(<ReceiptLines lines={[milk]} />)
    expect(html).toContain('Валюта: Не распознано')
    expect(html.indexOf('Валюта: Не распознано')).toBeLessThan(html.indexOf('class="receipt-slip-lines"'))
  })

  it('shows a spend typed by hand as positions of a panel: no paper, no number of a line, no unmatched mark', () => {
    const coffee: Line = { ...bread, id: 201, position: 1, name: 'Капучино', quantity: '1.000', amount: '1500.00', paid_amount: '1500.00', category: { id: 2, name: 'Кафе' } } as Line
    const water: Line = { ...coffee, id: 202, position: 2, name: 'Вода', category: null, quantity: '2.000', unit_price: '300.00', amount: '600.00' }
    const html = renderToStaticMarkup(<ReceiptLines lines={[coffee, water]} currency="KZT" manual />)
    expect(html).not.toContain('receipt-slip')
    expect(html).not.toContain('Строка ')
    expect(html).not.toContain('Товар не сопоставлен')
    expect(html).toContain('<li id="receipt-line-201" tabindex="-1" class="receipt-position"><span class="receipt-position-badge" data-tone="2" aria-hidden="true"></span>')
    expect(html).toContain('<span class="receipt-printed-name">Капучино</span><span class="receipt-note">Кафе</span>')
    expect(html).toContain(`<span class="receipt-note">2\u00a0шт × 300,00\u00a0₸</span>`)
    // The amount of a position is a Money of 2.0, with its currency.
    expect(html).toContain('<span class="receipt-position-amount"><span class="receipt-visually-hidden">Сумма: </span><span class="ck-money ck-money--row"><span class="ck-money-digits" aria-hidden="true"><span class="ck-money-int">1\u202f500</span><span class="ck-money-cur">\u202f₸</span></span><span class="ck-visually-hidden">1\u202f500\u202f₸</span></span></span>')
  })

  it('has no date in a line: nothing of a date outside <time>', () => {
    const html = slip(lines)
    expect(html).not.toContain('<time')
    expect(text(html)).not.toMatch(/\d{2}\.\d{2}\.\d{4}/)
  })
})

describe('the paper of a receipt on its page (Vitest/SSR)', () => {
  const noop = () => {}
  const loaded = <T,>(data: T): BlockRequest<T> => ({ state: { kind: 'ok', data }, retry: noop })
  const emptyPage = <T,>(): Page<T> => ({ count: 0, page: 1, page_size: 50, pages: 0, results: [] })
  const images = publicFixture('receipt-images.json') as Page<ReceiptImage>
  const view: ReceiptViewProps = {
    receiptId: 71, header: loaded(receipt), lines: loaded(page), images: loaded({ ...images, results: images.results.filter((image) => image.receipt_id === 71) }),
    discounts: loaded(publicFixture('discounts.json') as Page<Discount>), taxes: loaded(publicFixture('taxes.json') as Page<Tax>),
    pages: { images: 1, lines: 1, discounts: 1, taxes: 1 }, onPage: noop,
  }

  it('prints the head, the lines, the discounts, the taxes and ИТОГО with its currency on one paper with a torn edge', () => {
    const html = renderToStaticMarkup(<ReceiptView {...view} />)
    const paper = html.slice(html.indexOf('<div class="receipt-slip ck-tape">'), html.indexOf('<section id="receipt-images"'))
    expect(html).toContain('<div class="receipt-slip-wrap"><div class="receipt-slot" aria-hidden="true"></div><div class="receipt-slip ck-tape">')
    expect(paper).toContain('<p class="receipt-slip-store">Тестовый магазин</p><p>Teststrasse 12, Berlin</p>')
    expect(paper.indexOf('id="receipt-lines"')).toBeLessThan(paper.indexOf('id="receipt-discounts"'))
    expect(paper.indexOf('id="receipt-discounts"')).toBeLessThan(paper.indexOf('id="receipt-taxes"'))
    expect(paper).toContain('<div class="receipt-slip-row receipt-slip-grand"><span class="receipt-slip-label">Итого</span><span class="receipt-slip-value"><span class="receipt-visually-hidden">: </span>2,38\u00a0€</span></div>')
    expect(paper).toContain('<p class="receipt-slip-tax">Налог включён в цены</p>')
    // The heading of the lines is for a screen reader; the parts after them are named by a line of the paper.
    expect(paper).toMatch(/<h2 id="[^"]+" data-request-focus-target="true" tabindex="-1" class="receipt-visually-hidden">Строки чека<\/h2>/)
    expect(paper).toMatch(/<h2 id="[^"]+" data-request-focus-target="true" tabindex="-1">Скидки<\/h2>/)
  })

  it('leads the link of a discount to the line of the paper', () => {
    const html = renderToStaticMarkup(<ReceiptView {...view} />)
    expect(html).toContain('Скидка к <a href="#receipt-line-101">')
    expect(html.match(/ id="receipt-line-101"/g)).toHaveLength(1)
    expect(html).toContain('<li id="receipt-line-101" tabindex="-1" class="receipt-slip-item">')
  })

  it('prints no empty part: a paper without separate discounts or taxes has none', () => {
    const html = renderToStaticMarkup(<ReceiptView {...view} discounts={loaded(emptyPage())} taxes={loaded(emptyPage())} />)
    expect(html).not.toContain('id="receipt-discounts"')
    expect(html).not.toContain('id="receipt-taxes"')
    expect(html).toContain('id="receipt-lines"')
  })

  it('stamps «Проверено» on a receipt a person confirmed, and only on it', () => {
    expect(renderToStaticMarkup(<ReceiptView {...view} />)).not.toContain('receipt-stamp')
    const confirmed = loaded({ ...images, results: [{ ...images.results[0], receipt_id: 71, confirmed_at: '2026-10-04T12:35:00Z' }] })
    const html = renderToStaticMarkup(<ReceiptView {...view} images={confirmed} />)
    expect(html).toContain('<div class="receipt-slip ck-tape receipt-slip-stamped">')
    expect(html).toContain('<p class="receipt-stamp">Проверено</p>')
  })

  it('prints the slip out of its slot only when asked (a receipt just recognised)', () => {
    expect(renderToStaticMarkup(<ReceiptView {...view} />)).toContain('<div class="receipt-slip-wrap">')
    expect(renderToStaticMarkup(<ReceiptView {...view} printing />)).toContain('<div class="receipt-slip-wrap" data-printing="">')
  })

  it.each([
    ['loading', { state: { kind: 'loading' as const }, retry: noop }, 'request-state-loading'],
    ['an error', { state: { kind: 'error' as const, reason: 'network' as const }, retry: noop }, 'data-request-retry'],
    ['an empty page', loaded(emptyPage<Line>()), 'В этом чеке нет строк.'],
  ])('keeps the paper and its other parts while the lines show %s', (_name, lines, mark) => {
    const html = renderToStaticMarkup(<ReceiptView {...view} lines={lines as BlockRequest<Page<Line>>} />)
    expect(html).toContain(mark)
    expect(html).not.toContain('receipt-slip-item')
    expect(html).toContain('receipt-slip-grand')
    expect(html).toContain('Rabatt MILCH')
  })
})

describe('receipt filters action bar (Vitest/SSR)', () => {
  // The words of a search live in the line above the list (SpendSearch, 2026-10-13): the form shows the dates.
  const failure = { kind: 'error' as const, reason: 'invalid_parameter' as const, status: 400, fields: ['date_from'] }
  const html = renderToStaticMarkup(<ReceiptFilters query={{ page: 1, date_from: '2026-10-01' }} failure={failure} />)

  it('adds the pinned bar as the second class of the former wrapper', () => {
    expect(html.match(/ck-action-bar/g)).toHaveLength(1)
    expect(html).toContain('<div class="receipt-actions ck-action-bar"><button type="submit">Применить</button><button type="button" class="receipt-secondary">Сбросить</button></div></form>')
  })

  it('keeps the explanation and the refusal outside the bar, before it', () => {
    const [before, bar] = html.split('<div class="receipt-actions ck-action-bar">')
    expect(before).toContain('Обе даты включительно, по дате покупки в магазине.')
    expect(before).toContain('<p class="receipt-field-error" role="alert">Исправьте поля фильтров.</p>')
    expect(bar).not.toContain('<p')
    expect(text(bar)).toBe('ПрименитьСбросить')
  })
})
