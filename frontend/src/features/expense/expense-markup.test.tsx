import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Line, Receipt } from '../../api/receipts'
import { publicFixture } from '../../api/recognition-test-support'
import type { Category, Page } from '../../api/types'
import { numbered } from '../../lib/text'
import { ReceiptHeader, ReceiptLines } from '../receipts/ReceiptContent'
import { ReceiptView } from '../receipts/ReceiptPage'
import type { BlockRequest } from '../receipts/ReceiptPage'
import { ReceiptList } from '../receipts/ReceiptsPage'
import { emptyDraft, messages, newLine, spendAsLine } from './expense-form'
import { serviceLine } from './line-draft'
import type { ExpenseDraft } from './expense-form'
import { ExpenseForm } from './ExpensePage'
import { DeleteSpend, ManualSpendActions } from './ManualSpendActions'

const noop = () => {}
const category = (id: number, name: string): Category => ({
  id, name, path: [{ id, name }], parent_id: null, depth: 0, children_count: 0, generic_products_count: 0, products_count: 0, products_total: 0,
})
const chips = [category(1, 'Еда'), category(2, 'Кафе'), category(3, 'Транспорт')]
const form = (draft: ExpenseDraft, extra: Partial<Parameters<typeof ExpenseForm>[0]> = {}) => renderToStaticMarkup(
  <ExpenseForm draft={draft} chips={chips} errors={{}} saving={false} onChange={noop} onSubmit={noop} {...extra} />)

const photo = publicFixture('receipt.json') as Receipt
const manual: Receipt = { ...photo, id: 90, source: 'manual', store: null, note: 'кофе с другом', origin: 'legacy/manual',
  receipt_images_count: 0, preview_image_url: null, purchased_on: '2026-10-01', total: '450.00', currency: 'KZT' }
const manualLine = { ...(publicFixture('lines.json') as Page<Line>).results[0], id: 900, name: 'Кафе', product: null,
  matching_status: 'unmatched', category: { id: 2, name: 'Кафе' }, amount: '450.00', paid_amount: '450.00' } as Line
const loaded = <T,>(data: T): BlockRequest<T> => ({ state: { kind: 'ok', data }, retry: noop })
const pageOf = <T,>(results: T[]): Page<T> => ({ count: results.length, page: 1, page_size: 50, pages: 1, results })

describe('«Добавить трату» form (Vitest/SSR, not browser visual acceptance)', () => {
  it('offers «＋ Обслуживание %» under the positions until there is one; its line has a percent, not a price', () => {
    const plainForm = form(emptyDraft('KZT', '2026-10-12'))
    expect(plainForm).toMatch(/<button type="button" class="ck-button-ghost expense-add-line expense-add-service"><svg[^>]*aria-hidden="true"[^>]*>.*?<\/svg>Обслуживание %<\/button>/)
    const served = form({ ...emptyDraft('KZT', '2026-10-12'), lines: [{ ...newLine(), name: 'Паста', amount: '3580' }, { ...serviceLine(null), amount: '358' }] })
    expect(served).not.toContain('expense-add-service')
    expect(served).toContain('<span class="expense-line-label">Процент</span>')
    expect(served.match(/expense-line-price-field/g)).toHaveLength(1)
  })
  it('turns the typed sum of a spend without positions into its first position', () => {
    expect(spendAsLine({ ...emptyDraft('KZT', '2026-10-12'), amount: '3 580', item: 'Ужин' })).toMatchObject({ name: 'Ужин', amount: '3580', price: '3580' })
    expect(spendAsLine({ ...emptyDraft('KZT', '2026-10-12'), amount: '1200+350' })).toMatchObject({ name: 'Счёт', amount: '1550' })
    expect(spendAsLine(emptyDraft('KZT', '2026-10-12'))).toBeUndefined()
  })
  it('opens on the hero amount on the paper, the currency pill, wrapping chips, today and the save bar', () => {
    const html = form(emptyDraft('KZT', '2026-10-12'))
    // Чекист 2.0: the amount is the hero of the focus screen — on the paper, not in a panel.
    expect(html).toContain('<section class="expense-amount"><label for="expense-amount" class="expense-label">Сумма</label>')
    expect(html).toContain('id="expense-amount" class="expense-amount-input" inputMode="decimal"')
    // «₸ KZT»: the sign is a picture, the field keeps the code and its name.
    expect(html).toContain('<label class="expense-currency expense-currency-signed"><span class="expense-currency-sign" aria-hidden="true">₸</span><span class="ck-visually-hidden">Валюта</span>')
    expect(html).toContain('value="KZT"')
    expect(html).toMatch(/<input id="expense-date" type="date"[^>]* value="2026-10-12"\/>/)
    // Three category chips of the system and the two date chips; the chips wrap (no scroller).
    expect(html.match(/class="ck-chip expense-chip"/g)).toHaveLength(3)
    expect(html.match(/class="ck-chip expense-day"/g)).toHaveLength(2)
    expect(html).toContain('<div class="expense-chips">')
    expect(html).not.toContain('ck-chip-scroller')
    // The dot carries the tone of the family (--ck-tone, the bricks of tokens.css).
    expect(html).toContain('class="expense-dot" style="--ck-tone:var(--ck-cat-2)" aria-hidden="true"></span><span class="expense-chip-name">Кафе</span></button>')
    expect(html).toContain('aria-pressed="false"')
    expect(html).toContain('class="expense-actions ck-action-bar"')
    // The one seal of the screen, across the width.
    expect(html).toContain('<button type="submit" class="ck-btn-block expense-save">Сохранить</button>')
    // The ✕ of the header closes the form: no «Отмена» of its own.
    expect(html).not.toContain('Отмена')
    expect(html).not.toContain('Удалить трату')
    expect(html).toContain('<span class="expense-row-label">Где</span><input id="expense-place" class="expense-row-input"')
    expect(html).toContain('placeholder="Без места"')
    expect(html).toContain('<textarea id="expense-note" class="expense-row-input" rows="1" placeholder="Необязательно"')
    expect(html).toMatch(/<button type="button" class="ck-button-ghost expense-add-line"><svg[^>]*aria-hidden="true"[^>]*>.*?<\/svg>Добавить<span class="ck-visually-hidden"> позицию<\/span><\/button>/)
    expect(html).not.toContain('<table')
  })
  it('names a nested category by itself, with its parent for a screen reader and the colour of its root', () => {
    const nested: Category = { ...category(5, 'Кафе'), parent_id: 1, depth: 1, path: [{ id: 1, name: 'Еда' }, { id: 5, name: 'Кафе' }] }
    const html = renderToStaticMarkup(<ExpenseForm draft={emptyDraft('KZT', '2026-10-12')} chips={[nested]} errors={{}} saving={false} onChange={noop} onSubmit={noop} />)
    expect(html).toContain('title="Еда › Кафе"><span class="expense-dot" style="--ck-tone:var(--ck-cat-1)" aria-hidden="true"></span>'
      + '<span class="ck-visually-hidden">Еда › </span><span class="expense-chip-name">Кафе</span></button>')
  })
  it('a code without a common sign is the pill alone', () => {
    const html = form(emptyDraft('UZS', '2026-10-12'))
    expect(html).toContain('<label class="expense-currency"><span class="ck-visually-hidden">Валюта</span>')
    expect(html).not.toContain('expense-currency-sign')
  })
  it('marks the chosen chip and shows errors at their fields', () => {
    const html = form({ ...emptyDraft('KZT', '2026-10-12'), category: 2 }, {
      errors: { amount: messages.amount, category: messages.category }, failure: 'Проверьте отмеченные поля.' })
    expect(html).toContain('aria-pressed="true" title="Кафе"><span class="expense-dot"')
    expect(html).toContain(`<p class="expense-error" id="expense-amount-error">${messages.amount}</p>`)
    expect(html).toContain('aria-describedby="expense-amount-error"')
    expect(html).toContain('<fieldset class="expense-card expense-categories" aria-describedby="expense-category-error">')
    // A failed save says why right above the button.
    expect(html).toContain('<div class="expense-actions ck-action-bar"><p class="expense-failure" role="alert">Проверьте отмеченные поля.</p><button type="submit"')
  })
  it('sums positions into a read-only amount and shows their errors by the sent index', () => {
    const draft = { ...emptyDraft('KZT', '2026-10-12'), lines: [{ ...newLine() }, { ...newLine(), name: 'Хлеб', amount: '250' }, { ...newLine(), name: 'Сок', amount: '100,5' }] }
    const html = form(draft, { errors: { 'lines.1.amount': messages.lineAmount } })
    expect(html).toContain('<label for="expense-amount" class="expense-label">Сумма позиций</label>')
    expect(html).toMatch(/readOnly=""[^>]* value="350.50"/)
    expect(html).toContain('Категория позиций без своей')
    expect(html.match(/expense-lines-1-amount-error/g)).toHaveLength(2)
    expect(html).toContain('aria-label="Убрать позицию 3"')
    expect(html).toContain('<span class="expense-line-label">Позиция 3</span>')
    // A position is a line of a receipt (2026-10-13): quantity, unit, price, discount, sum and category, all labelled.
    for (const label of ['Кол-во', 'Ед.', 'Цена за шт', 'Скидка', 'Сумма', 'Категория']) {
      expect(html).toContain(`<span class="expense-line-label">${label}</span>`)
    }
    expect(html).toContain('<option value="kg">кг</option>')
    // The exact sum stays in the field; the save button names it exactly by <Money>, kopecks when there are any.
    expect(html).toContain('<button type="submit" class="ck-btn-block expense-save">Сохранить · <span class="ck-money ck-money--inline">'
      + '<span class="ck-money-digits" aria-hidden="true"><span class="ck-money-int">350</span><span class="ck-money-frac">,50</span><span class="ck-money-cur">\u202f₸</span></span>'
      + '<span class="ck-visually-hidden">350,50\u202f₸</span></span></button>')
  })
  it('folds every line into a card on a phone and unfolds a line with a message', () => {
    const panini = { ...newLine(), name: 'Панини', quantity: '2', price: '1790', amount: '3580' }
    const draft = { ...emptyDraft('KZT', '2026-10-12'), lines: [panini, { ...newLine(), name: 'Сок', amount: 'x' }] }
    const html = form(draft, { narrow: true, errors: { 'lines.1.amount': messages.lineAmount } }).replace(/[\u00a0\u202f]/g, ' ')
    expect(html).toContain('<span class="expense-line-title">Панини</span><span class="expense-line-detail">2 шт × 1 790,00 ₸</span></span>'
      + '<span class="expense-line-sum"><span class="ck-money ck-money--row"><span class="ck-money-digits" aria-hidden="true"><span class="ck-money-int">3 580</span><span class="ck-money-cur"> ₸</span></span><span class="ck-visually-hidden">3 580 ₸</span></span></span>')
    expect(html).toMatch(/<button type="button" class="expense-line-summary" aria-expanded="false" aria-controls="expense-line-\d+-fields">/)
    expect(html).not.toContain(`id="expense-line-${panini.key}-name"`)
    // The line with a message is open, its field marked.
    expect(html).toMatch(/aria-expanded="true"/)
    expect(html).toMatch(/class="expense-line-input expense-line-amount"[^>]*aria-invalid="true"/)
  })
  it('keeps the photo beside a photo receipt and locks the method of a spend from a statement', () => {
    const photo = { ...emptyDraft('KZT', '2026-10-12'), source: 'photo' as const, place: 'Магнум',
      lines: [{ ...newLine(), id: 5, name: 'Молоко', amount: '900' }], extraDiscount: '50' }
    const html = form(photo, { receiptId: 7, media: { thumb: '/media/crops/7/thumb-400-v1.webp', image: '/media/crops/7/crop.png' } })
      .replace(/[\u00a0\u202f]/g, ' ')
    expect(html).toContain('<a class="expense-source-photo" href="/media/crops/7/crop.png" target="_blank" rel="noreferrer"><img src="/media/crops/7/thumb-400-v1.webp" alt="Фото чека"')
    expect(html).toMatch(/<a class="expense-source-link" href="\/receipts\/7">Открыть чек с фото<svg[^>]*aria-hidden="true"/)
    expect(html).toContain('Скидка на весь чек: −50 ₸, уже вычтена из итога.')
    expect(html).toMatch(/<option value=""[^>]*>Как у товара<\/option>/)
    expect(html).toContain('Сохранить · <span class="ck-money ck-money--inline"><span class="ck-money-digits" aria-hidden="true"><span class="ck-money-int">850</span><span class="ck-money-cur"> ₸</span></span><span class="ck-visually-hidden">850 ₸</span></span>')
    const statement = form({ ...emptyDraft('KZT', '2026-10-12'), amount: '1800', category: 1, method: 'kaspi_gold', statement: 'Выписка Kaspi Gold' })
    expect(statement).toMatch(/<p class="expense-source-mark" role="note"><svg[^>]*aria-hidden="true"[^>]*>.*?<\/svg>Из выписки: Kaspi Gold<\/p>/)
    expect(statement).toContain('<p class="expense-method-fixed">Kaspi Gold — банк выписки</p>')
  })
  it('names the exact amount on the save button, chooses the date by chips and keeps the calendar', () => {
    const html = form({ ...emptyDraft('KZT', '2026-10-11'), amount: '4500,40' }, { today: '2026-10-12' })
    expect(html).toContain('<button type="submit" class="ck-btn-block expense-save">Сохранить · <span class="ck-money ck-money--inline">'
      + '<span class="ck-money-digits" aria-hidden="true"><span class="ck-money-int">4\u202f500</span><span class="ck-money-frac">,40</span><span class="ck-money-cur">\u202f₸</span></span>'
      + '<span class="ck-visually-hidden">4\u202f500,40\u202f₸</span></span></button>')
    expect(html).toContain('<button type="button" class="ck-chip expense-day" aria-pressed="false">Сегодня</button>')
    expect(html).toContain('<button type="button" class="ck-chip expense-day" aria-pressed="true">Вчера</button>')
    expect(html).toContain('<div class="expense-row" role="group" aria-labelledby="expense-when-label"><span id="expense-when-label" class="expense-row-label">Когда</span>')
    expect(html).toMatch(/<label class="expense-date-pick"><svg[^>]*>.*?<\/svg><span class="ck-visually-hidden">Дата покупки<\/span><input id="expense-date" type="date"/)
    const other = form(emptyDraft('KZT', '2026-09-01'), { today: '2026-10-12' })
    expect(other).toContain('expense-date-pick expense-date-pick-chosen')
    expect(other).toContain('<time dateTime="2026-09-01">01.09</time>')
    expect(other).not.toContain('aria-pressed="true">Сегодня')
  })
  it('opens all categories with a search in a sheet', () => {
    const html = form(emptyDraft('KZT', '2026-10-12'))
    expect(html).toContain('<button type="button" class="ck-chip expense-chip expense-more" aria-haspopup="dialog" aria-expanded="false">Все категории…</button>')
    expect(html).not.toContain('ck-sheet')
    const open = form({ ...emptyDraft('KZT', '2026-10-12'), category: 2 }, { initialSheet: true })
    expect(open).toContain('Все категории</h2>')
    expect(open).toContain('<input id="expense-category-search" type="search"')
    expect(open).toMatch(/<button type="button" class="expense-tree-item" aria-pressed="true"><span class="expense-dot"[^>]*><\/span>Кафе<\/button>/)
    expect(open.match(/class="expense-tree-item"/g)).toHaveLength(3)
  })
  it('says who adds the spend when the page knows it', () => {
    expect(form(emptyDraft('KZT', '2026-10-12'), { byline: 'Добавит: Андрей · видна всей семье' }))
      .toContain('<p class="expense-byline">Добавит: Андрей · видна всей семье</p>')
    expect(form(emptyDraft('KZT', '2026-10-12'))).not.toContain('expense-byline')
  })
  it('ends an edit with a quiet «Удалить трату» before the save bar', () => {
    const html = form(emptyDraft('KZT', '2026-10-12'), { receiptId: 90, saving: true })
    expect(html).toMatch(/<div class="expense-delete"><button type="button" class="ck-button-danger expense-delete-button"><svg[^>]*aria-hidden="true"[^>]*>.*?<\/svg>Удалить трату<\/button><\/div>/)
    expect(html.indexOf('expense-delete-button')).toBeLessThan(html.indexOf('expense-actions'))
    expect(html).toContain('<button type="submit" class="ck-btn-block expense-save" disabled="">Сохраняем…</button>')
    expect(html).not.toContain('href="/receipts/90"')
  })
  it('asks before deleting from the form in the confirmation dialog, on every width', () => {
    // Чекист 2.0: deleting cannot be undone — the shared ConfirmDialog asks (an alertdialog, «Отмена» and the danger action).
    for (const narrow of [false, true]) {
      const asking = renderToStaticMarkup(<DeleteSpend receiptId={90} narrow={narrow} initial={{ kind: 'confirm' }} />)
      expect(asking).toContain('role="alertdialog"')
      expect(asking).toContain('Удалить трату?</h2>')
      expect(asking).toContain('Трата исчезнет из списка и сумм. Отменить удаление нельзя.')
      expect(asking).toContain('class="ck-confirm-action ck-confirm-danger">Удалить трату</button>')
      expect(asking).toContain('>Отмена</button>')
      // The button that opened it stays in its place under the dialog.
      expect(asking).toContain('expense-delete-button')
    }
    expect(renderToStaticMarkup(<DeleteSpend receiptId={90} />)).not.toContain('alertdialog')
    expect(renderToStaticMarkup(<DeleteSpend receiptId={90} income initial={{ kind: 'confirm' }} />)).toContain('Удалить доход?</h2>')
    expect(renderToStaticMarkup(<DeleteSpend receiptId={90} initial={{ kind: 'deleting' }} />)).toContain('>Удаляем…</button>')
    expect(renderToStaticMarkup(<DeleteSpend receiptId={90} initial={{ kind: 'failed', message: 'Сбой.' }} />)).toContain('role="alert">Сбой.</p>')
  })
})

describe('a manual spend on the receipt screens', () => {
  it('is listed without a place, with the mark and its note', () => {
    const html = renderToStaticMarkup(<ReceiptList receipts={[manual, photo]} />)
    expect(html).toContain(`Без места · ${numbered('трата', 90)}`)
    expect(html).toContain('<span class="receipt-source-mark">вручную</span>')
    expect(html).toContain('кофе с другом')
    expect(html.match(/receipt-source-mark/g)).toHaveLength(1)
  })
  it('shows its date, note, category line and actions; no photo, discounts or taxes', () => {
    const html = renderToStaticMarkup(<ReceiptView receiptId={90} header={loaded(manual)} lines={loaded(pageOf([manualLine]))}
      images={loaded(pageOf([]))} discounts={loaded(pageOf([]))} taxes={loaded(pageOf([]))}
      pages={{ images: 1, lines: 1, discounts: 1, taxes: 1 }} onPage={noop} notice="Трата сохранена." />)
    expect(html).toContain('<p class="expense-notice" role="status">Трата сохранена.</p>')
    expect(html).toContain(`>${numbered('Трата', 90)}</h2>`)
    expect(html).not.toContain('Сумма скидок')
    expect(html).not.toContain('Налог в ценах')
    expect(html).toContain('<dt>Дата покупки</dt><dd><time dateTime="2026-10-01">')
    expect(html).toContain('<dt>Комментарий</dt><dd>кофе с другом</dd>')
    expect(html).not.toContain('<dt>Адрес</dt>')
    expect(html).toContain('href="/receipts/90/edit">Изменить</a>')
    expect(html).toContain('>Удалить</button>')
    expect(html).toContain('Позиции траты')
    expect(html).not.toContain('Изображения чека')
    expect(html).not.toContain('Скидки')
    expect(html).not.toContain('Налоги')
  })
  it('names the category of a line without a product instead of a warning', () => {
    const html = renderToStaticMarkup(<ReceiptLines lines={[manualLine]} currency="KZT" />)
    expect(html).toContain('Категория: Кафе')
    expect(html).not.toContain('Товар не сопоставлен')
  })
  it('keeps a photo receipt as it was', () => {
    const html = renderToStaticMarkup(<ReceiptHeader receipt={photo} />)
    expect(html).toContain('<dt>Адрес</dt>')
    expect(html).not.toContain('вручную')
  })
  it('asks in the confirmation dialog before deleting, without a browser dialog', () => {
    const html = renderToStaticMarkup(<ManualSpendActions receiptId={90} initial={{ kind: 'confirm' }} />)
    expect(html).toContain('role="alertdialog"')
    expect(html).toContain('Трата исчезнет из списка и сумм. Отменить удаление нельзя.')
    expect(html).toContain('>Удалить трату</button>')
    expect(html).toContain('>Отмена</button>')
    expect(renderToStaticMarkup(<ManualSpendActions receiptId={90} initial={{ kind: 'failed', message: 'Сбой.' }} />)).toContain('role="alert">Сбой.</p>')
  })
  it('keeps its row of actions under the dialog on a phone, a row of the page and not a pinned bar', () => {
    const html = renderToStaticMarkup(<ManualSpendActions receiptId={90} narrow initial={{ kind: 'confirm' }} />)
    expect(html.startsWith('<div class="receipt-actions expense-manual-actions">')).toBe(true)
    // The tiles stand in the toolbar of the page (Receipts.css, display: contents): the class of a pinned bar would lift
    // the FAB of Android over an empty place (shell.css, :has(main .ck-action-bar)).
    expect(html).not.toContain('ck-action-bar')
    expect(html).toContain('href="/receipts/90/edit">Изменить</a>')
    expect(html).toContain('Удалить трату?</h2>')
    expect(renderToStaticMarkup(<ManualSpendActions receiptId={90} narrow />)).not.toContain('alertdialog')
  })
})
