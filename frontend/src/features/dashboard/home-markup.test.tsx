import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { attentionFixture, dashboardFixture, homeFixture } from '../../api/budget-test-support'
import type { Dashboard } from '../../api/budget'
import { DashboardView } from './DashboardPage'
import type { DashboardViewProps } from './DashboardPage'

const view = (data: Dashboard = homeFixture(), today = '2026-10', date = '2026-10-26', extra: Partial<DashboardViewProps> = {}) =>
  renderToStaticMarkup(<DashboardView data={data} today={today} date={date} {...extra} />)
const between = (html: string, start: string, end: string) => html.slice(html.indexOf(start), html.indexOf(end, html.indexOf(start)))
const noIcons = (html: string) => html.replace(/<svg\b.*?<\/svg>/g, '')
/** What a person reads: no tags, one kind of space. */
const words = (html: string) => noIcons(html).replace(/<[^>]+>/g, ' ').replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim()
const money = (int: string, frac = '') => `<span class="ck-money-int">${int.replaceAll(' ', '\u202f')}</span>${frac ? `<span class="ck-money-frac">${frac}</span>` : ''}<span class="ck-money-cur">\u202f₸</span>`

describe('«Главная» of Чекист 2.0 (Vitest/SSR, not browser visual acceptance)', () => {
  it('puts the month as the heading, the round steps after it («›» only while a later month is past), «Скрыть суммы» on the current month and the family', () => {
    const html = noIcons(view())
    expect(html).toContain('<span class="dash-month-steps"><a class="ck-round dash-month-step" aria-label="Предыдущий месяц" href="/?month=2026-09"></a></span>')
    expect(html).not.toContain('Следующий месяц')
    expect(html).toContain('<button type="button" class="ck-icon-button ck-privacy-toggle dash-privacy" aria-label="Скрыть суммы" aria-pressed="false"')
    const past = noIcons(view(homeFixture(), '2026-11'))
    expect(past).toContain('aria-label="Следующий месяц" href="/?month=2026-11"></a></span>')
    // The eye belongs to the month of today; a past month is read, not shown to others.
    expect(past).not.toContain('dash-privacy')
    expect(html).toContain('<ul class="dash-family" aria-label="Семья">')
    expect(html).toContain('<li class="dash-avatar ck-tone-1" title="andrey"><span aria-hidden="true">A</span><span class="ck-visually-hidden">andrey</span></li>')
    expect(html).not.toMatch(/<h[12][^>]*>Октябрь/)
    const source = readFileSync(new URL('./DashboardPage.tsx', import.meta.url), 'utf8')
    expect(source).toContain('<HeaderSlot side="end">')
    expect(source).not.toContain('<HeaderSlot side="start">')
  })

  it('leads with one main number: «Потрачено» by default, its label the button of «Главное число», the line under it', () => {
    const hero = between(noIcons(view()), '<section class="dash-hero', '</section>')
    expect(hero).toContain('<section class="dash-hero is-spent" aria-labelledby="dash-hero-label">')
    expect(hero).toContain('<button type="button" class="dash-hero-pick" aria-haspopup="dialog" aria-expanded="false" aria-describedby="dash-hero-pick-hint"><span id="dash-hero-label" class="dash-hero-label">Потрачено в\u00a0октябре</span></button>')
    expect(hero).toContain('<span id="dash-hero-pick-hint" class="ck-visually-hidden">Выбрать главное число</span>')
    expect(hero).toContain(`<p class="dash-hero-figure"><span class="ck-money ck-money--hero">${money('287 450')}</span></p>`)
    const sub = between(hero, '<p class="dash-hero-sub"', '</p>')
    expect(words(sub)).toBe('из 900 000 ₸ бюджета · ещё 6 дней · 97 925 ₸ в день')
    // How «в день» was counted, for a mouse.
    expect(sub.replace(/\u00a0/g, ' ')).toContain('title="Бюджет месяца 900 000 ₸ минус траты и 1 платёж к оплате (25 000 ₸), поровну на 6 дней"')
    // One hero number on the screen; the sheet of the choice is closed until the label is pressed.
    const html = view()
    expect(html.match(/ck-money--hero/g)).toHaveLength(1)
    expect(html).not.toContain('role="dialog"')
  })

  it('shows the chosen number of the device instead, and falls back to «Потрачено» with the reason when it cannot', () => {
    const left = between(view(homeFixture(), '2026-10', '2026-10-26', { figure: 'left' }), '<section class="dash-hero', '</section>')
    expect(left).toContain('<section class="dash-hero is-left"')
    expect(words(left)).toContain('Осталось на октябрь')
    expect(left).toContain(`<span class="ck-money ck-money--hero">${money('612 550')}</span>`)
    const daily = between(view(homeFixture(), '2026-10', '2026-10-26', { figure: 'daily' }), '<section class="dash-hero', '</section>')
    expect(words(daily)).toContain('Можно тратить в день')
    expect(daily).toContain(`<span class="ck-money ck-money--hero">${money('97 925')}</span>`)
    // «Свободно» waits for «Деньги»: a still block of the size of the number, busy for a screen reader.
    const waiting = between(view(homeFixture(), '2026-10', '2026-10-26', { figure: 'free', free: { kind: 'loading' } }), '<section class="dash-hero', '</section>')
    expect(waiting).toContain('<p class="dash-hero-figure" aria-busy="true"><span class="dash-hero-wait" aria-hidden="true"></span><span class="ck-visually-hidden">Загружаем</span></p>')
    // A past month has no «В день»: «Потрачено» with a quiet note why.
    const past = between(view(homeFixture(), '2026-11', '2026-11-03', { figure: 'daily' }), '<section class="dash-hero', '</section>')
    expect(past).toContain('<section class="dash-hero is-spent"')
    expect(past).toContain('<p class="dash-hero-note">В день: только для текущего месяца</p>')
    // Beyond the budget: the label says so and the number takes the over tone.
    const data = homeFixture()
    const over = between(view({ ...data, budget: { amount: '200000.00', currency: 'KZT', spent: '287450.00' } }, '2026-10', '2026-10-26', { figure: 'left' }), '<section class="dash-hero', '</section>')
    expect(over).toContain('<span id="dash-hero-label" class="dash-hero-label is-over">Сверх бюджета в\u00a0октябре</span>')
    expect(over).toContain('<span class="ck-money ck-money--hero ck-money--over">')
  })

  it('draws the bar of the budget: spent, the payments ahead hatched, today, the words of the state for a screen reader', () => {
    const pace = between(view(), '<div class="dash-pace', '</section>')
    expect(pace).toContain('<div class="dash-pace is-calm"><div class="dash-pace-bar" role="img" aria-label="Потрачено 32\u00a0% бюджета, платежи и планы впереди 3\u00a0%, прошло 84\u00a0% месяца">')
    expect(pace).toContain('<span class="dash-pace-spent" style="--w:31.93%"></span><span class="dash-pace-ahead" style="--w:2.77%"></span>')
    expect(pace).toContain('<span class="dash-pace-today" style="--x:83.87%"></span>')
    expect(words(between(pace, 'dash-pace-legend', '</p>'))).toBe('dash-pace-legend" aria-hidden="true"> Потрачено 32 % Платежи и планы 25 000 ₸ Сегодня')
    const data = homeFixture()
    const over = between(view({ ...data, budget: { amount: '200000.00', currency: 'KZT', spent: '287450.00' } }), '<div class="dash-pace', '</section>')
    expect(over).toContain('<div class="dash-pace is-over"><div class="dash-pace-bar" role="img" aria-label="Потрачено 144\u00a0% бюджета, прошло 84\u00a0% месяца, сверх бюджета">')
    expect(over).toContain('<span class="dash-pace-words">, сверх бюджета</span>')
    expect(view({ ...data, budget: null })).not.toContain('dash-pace')
  })

  it('draws the ring of the categories with the remainder of the budget as the gap, the share of the budget in its middle', () => {
    const card = between(view(), 'dash-where"', '</section>')
    expect(card).toContain('<h2 id="dash-where-heading">Куда ушли деньги</h2>')
    const ring = between(card, '<div class="ck-ring"', '</svg>')
    expect(ring).toContain('<circle class="ck-ring-track" cx="66" cy="66" r="59" stroke-width="14">')
    expect(ring.match(/ck-ring-segment ck-ring-tone-(\d)/g)).toEqual(['ck-ring-segment ck-ring-tone-3', 'ck-ring-segment ck-ring-tone-2', 'ck-ring-segment ck-ring-tone-5', 'ck-ring-segment ck-ring-tone-1'])
    const first = /stroke-dasharray="([\d.]+) ([\d.]+)" stroke-dashoffset="0"/.exec(ring)
    expect(first).not.toBeNull()
    expect(Number(first![1]) / Number(first![2])).toBeCloseTo(9230000 / (16930050 + 61255000), 3)
    expect(ring).toContain('role="img" aria-label="Потрачено 287')
    expect(card).toContain('<div class="ck-ring-centre"><span class="dash-ring-value">32\u00a0%</span><span class="dash-ring-label">бюджета</span></div>')
    // Without a budget the middle counts the categories.
    expect(between(view({ ...homeFixture(), budget: null }), 'dash-where"', '</section>')).toContain('<span class="dash-ring-value">4</span><span class="dash-ring-label">категории</span>')
  })

  it('lists up to four categories beside the ring, «ещё N» and the remainder of the budget', () => {
    const data = homeFixture()
    data.currencies[0].categories.push({ category_id: 14, name: 'Аптека', spent: '700.00', limit: null, limit_id: null })
    const legend = noIcons(between(view(data), '<ul class="dash-legend"', '</ul>'))
    expect(legend).toContain(`<li class="dash-legend-row ck-tone-3"><i class="dash-legend-swatch" aria-hidden="true"></i><a class="dash-legend-name" href="/spends/category/3?month=2026-10">Продукты</a><span class="ck-money ck-money--inline dash-legend-amount">${money('92 300')}</span></li>`)
    expect(legend.match(/dash-legend-row ck-tone-/g)).toHaveLength(4)
    expect(legend).not.toContain('Аптека')
    expect(legend).toContain('<a class="dash-legend-name" href="/stats">ещё 1</a>')
    expect(legend).toContain(`<span class="dash-legend-name">Остаток бюджета</span><span class="ck-money ck-money--inline dash-legend-amount">${money('612 550')}</span>`)
    const over = noIcons(between(view({ ...data, budget: { amount: '200000.00', currency: 'KZT', spent: '287450.00' } }), '<ul class="dash-legend"', '</ul>'))
    expect(over).toContain(`<span class="dash-legend-name">Сверх бюджета</span><span class="ck-money ck-money--inline ck-money--over dash-legend-amount">${money('87 450')}</span>`)
  })

  it('draws the pulse: a bar a day, the days with spends, today, the days ahead flat, the dashed average day', () => {
    const card = between(view(), 'dash-where"', '</section>')
    const bars = card.match(/<i class="dash-pulse-day dash-pulse-[a-z]+"[^>]*>/g) ?? []
    expect(bars).toHaveLength(31)
    expect(bars[0]).toBe('<i class="dash-pulse-day dash-pulse-on" style="height:15%">')
    expect(bars[1]).toBe('<i class="dash-pulse-day dash-pulse-off" style="height:4%">')
    expect(bars[25]).toBe('<i class="dash-pulse-day dash-pulse-today" style="height:100%">')
    expect(bars[26]).toBe('<i class="dash-pulse-day dash-pulse-future">')
    expect(bars.filter((bar) => bar.includes('future'))).toHaveLength(5)
    expect(card).toContain('<span class="dash-pulse-average" style="bottom:22%" aria-hidden="true"></span>')
    expect(card).toContain('<p class="dash-pulse-x" aria-hidden="true"><span>1\u00a0окт</span><span class="dash-pulse-x-middle"><span class="dash-pulse-now">сегодня\u00a026</span><span> · средний день 2\u00a0610\u00a0₸</span></span><span>31</span></p>')
    expect(card).toContain('role="img" aria-label="Траты по дням в\u00a0октябре"')
    const past = between(view(homeFixture(), '2026-11', '2026-11-03'), 'dash-where"', '</section>')
    expect(past).not.toContain('dash-pulse-today')
    expect(past).not.toContain('dash-pulse-future')
  })

  it('shows «Требует внимания» with a tile per kind, the sum at the right, «ещё N»; no rows — no card', () => {
    const card = noIcons(between(view(), 'dash-attention"', '</section>'))
    expect(card).toContain('<div class="ck-panel-head"><h2 id="dash-attention-heading">Требует внимания</h2><a class="dash-card-link" href="/money">ещё\u00a02</a></div>')
    const rows = card.match(/<a class="ck-row dash-attention-row"[^>]*><span class="ck-row-badge dash-attention-badge is-[a-z]+"/g) ?? []
    expect(rows).toHaveLength(3)
    expect(rows[0]).toContain('data-kind="payment_due"')
    expect(rows[0]).toContain('href="/recurring"')
    expect(rows[0]).toContain('is-plain"')
    expect(rows[1]).toContain('href="/receipts/new?kind=income"')
    expect(rows[1]).toContain('is-income"')
    expect(rows[2]).toContain('href="/chat"')
    // Gold only for the verdict of the assistant.
    expect(rows[2]).toContain('is-ai"')
    expect(card).toContain(`<span class="ck-row-title">Аренда квартиры через 2 дня</span><span class="ck-row-meta">Срок 5 ноября</span></span><span class="ck-row-amount dash-attention-amount"><span class="ck-money ck-money--row">${money('220 000')}</span></span>`)
    // The whole line in words for a mouse: the sum and the words together.
    expect(rows[0]).toContain('title="220\u00a0000\u00a0₸ · Срок 5 ноября"')
    // A limit: the over tone with its words, the overrun at the right with «сверх лимита» under it.
    const kinds = attentionFixture().map((row, index) => ({ ...row, kind: ['payment_overdue', 'limit_over', 'limit_near', 'brand_new'][index] ?? 'plans_question' }))
    const more = noIcons(between(view({ ...homeFixture(), attention: [...kinds, { ...kinds[0], kind: 'plans_question' }], attention_more: 0 }), 'dash-attention"', '</section>'))
    expect(more.match(/dash-attention-badge is-(plain|over|income|ai)"/g)).toEqual(['dash-attention-badge is-over"', 'dash-attention-badge is-over"', 'dash-attention-badge is-over"', 'dash-attention-badge is-plain"'])
    expect(more).toContain('<span class="ck-row-meta is-over">')
    expect(more).toContain('<span class="dash-amount-caption is-over">сверх лимита</span>')
    expect(more).toContain('<span class="ck-money ck-money--row ck-money--over">')
    expect(more).not.toContain('ещё')
    expect(view({ ...homeFixture(), attention: [] })).not.toContain('dash-attention')
    // The rows behind the first three come with the answer: «ещё N» is a button that opens them in place.
    const rest = between(view({ ...homeFixture(), attention_more: 1, attention_rest: [attentionFixture()[0]] }), 'dash-attention"', '</section>')
    expect(rest).toContain('<button type="button" class="dash-card-link dash-card-more" aria-expanded="false">ещё\u00a01</button>')
    expect(rest).not.toContain('href="/money"')
    expect(view(dashboardFixture())).not.toContain('Требует внимания')
  })

  it('draws the three tiles as links with a mini bar each, the sums by Money', () => {
    const tiles = between(view(), '<ul class="dash-tiles"', '</ul>')
    expect(tiles).toContain('<ul class="dash-tiles" aria-label="Платежи, планы и цели">')
    expect(tiles).toContain('<li><a class="dash-tile dash-tile-payments" href="/recurring"><span class="dash-tile-title">Платежи</span><span class="dash-tile-value"><span class="dash-phrase">2 из 5</span></span>')
    expect(tiles).toContain(`<span class="dash-tile-note"><span class="dash-phrase">ждут <span class="ck-money ck-money--inline">${money('356 445')}</span></span></span><span class="dash-mini" role="img" aria-label="Оплачено 2 из 5"><i class="dash-mini-part is-on" style="flex:1"></i><i class="dash-mini-part is-on" style="flex:1"></i><i class="dash-mini-part" style="flex:1"></i>`)
    expect(tiles).toContain(`<a class="dash-tile dash-tile-plans" href="/planned?month=2026-10"><span class="dash-tile-title">Планы</span><span class="dash-tile-value"><span class="dash-phrase"><span class="ck-money ck-money--inline">${money('185 000')}</span></span></span><span class="dash-tile-note"><span class="dash-phrase">ждём · 1 из 3</span></span>`)
    expect(tiles).toContain('<i class="dash-mini-part is-on" style="flex:9200000"></i>')
    expect(tiles).toContain('<a class="dash-tile dash-tile-goals" href="/goals"><span class="dash-tile-title">Цели</span><span class="dash-tile-value"><span class="dash-phrase">62\u00a0%</span></span>')
    expect(tiles).toContain('<span class="dash-mini" role="img" aria-label="Накоплено 62\u00a0% по всем целям"><i class="dash-mini-part is-on" style="flex:62"></i><i class="dash-mini-part" style="flex:38"></i></span>')
    // Every goal reached: the milestone, in words.
    const data = homeFixture()
    expect(view({ ...data, tiles: { ...data.tiles!, goals: { ...data.tiles!.goals!, share: 100 } } })).toContain('<a class="dash-tile dash-tile-goals is-reached" href="/goals">')
    expect(view({ ...data, tiles: { ...data.tiles!, plans: null } })).toContain('<span class="dash-tile-value"><span class="dash-phrase">Нет</span></span><span class="dash-tile-note"><span class="dash-phrase">без планов</span></span></a>')
    expect(view(dashboardFixture())).not.toContain('dash-tiles')
  })

  it('lists the spends of today and yesterday with the stamp of their source, «Сегодня трат нет» otherwise, the last three of a past month', () => {
    const recent = noIcons(between(view(homeFixture(), '2026-10', '2026-10-12'), 'dash-recent"', '</section>'))
    expect(recent).toContain('<div class="ck-panel-head"><h2 id="dash-recent-heading">Сегодня и вчера</h2><a class="dash-card-link" href="/receipts">Все траты</a></div>')
    expect(recent.match(/href="\/receipts\/(\d+)"/g)).toEqual(['href="/receipts/12"', 'href="/receipts/13"'])
    expect(recent).toContain(`<span class="ck-row-meta dash-recent-meta"><span class="ck-stamp">Фото</span><span class="dash-recent-meta-text">liza · сегодня · 23\u00a0позиции</span></span>`)
    expect(recent).toContain('<span class="ck-stamp">Вручную</span><span class="dash-recent-meta-text">andrey · вчера</span>')
    expect(recent).toContain(`<span class="ck-row-amount dash-recent-amount"><span class="ck-money ck-money--row">${money('18 940')}</span></span>`)
    const empty = between(view(), 'dash-recent"', '</section>')
    expect(empty).toContain('<p class="dash-note">Сегодня трат нет.</p>')
    expect(empty).toContain('href="/receipts">Все траты</a>')
    const past = between(view(homeFixture(), '2026-11', '2026-11-03'), 'dash-recent"', '</section>')
    expect(past).toContain('<h2 id="dash-recent-heading">Последние траты</h2>')
    expect(past.match(/href="\/receipts\/(\d+)"/g)).toHaveLength(3)
  })

  it('keeps the limits compact: the name with «spent из limit», the bar with today, the share and its words under it', () => {
    const limits = noIcons(between(view(), 'dash-limits"', '</section>'))
    expect(limits).toContain(`<li class="dash-limit ck-tone-3"><a class="dash-limit-head dash-limit-link" href="/spends/category/3?month=2026-10"><i class="dash-limit-dot" aria-hidden="true"></i><span class="dash-limit-name">Продукты</span><span class="dash-limit-value"><span class="ck-money ck-money--inline">${money('92 300')}</span> из <span class="ck-money ck-money--inline">${money('120 000')}</span></span></a><div class="ck-bar dash-bar" role="progressbar" aria-label="Продукты: потрачено 76% лимита" aria-valuemin="0" aria-valuemax="100" aria-valuenow="76"><span style="width:76%"></span><i class="dash-bar-today" style="left:83.87%" aria-hidden="true"></i></div><p class="dash-limit-note" aria-hidden="true">77\u00a0%</p>`)
    // Over the limit: the over bar and «… сверх лимита» in words, said to a screen reader too.
    expect(limits).toContain('<div class="ck-bar dash-bar is-over" role="progressbar" aria-label="Кафе: потрачено 100% лимита, сверх лимита"')
    expect(limits).toContain(`<p class="dash-limit-note is-over" aria-hidden="true"><span class="ck-money ck-money--inline">${money('4 300')}</span> сверх лимита</p>`)
    expect(limits).not.toContain('Транспорт')
    expect(limits).not.toContain('Задать лимиты')
    // A past month has no mark of today.
    expect(between(view(homeFixture(), '2026-11', '2026-11-03'), 'dash-limits"', '</section>')).not.toContain('dash-bar-today')
    const data = homeFixture()
    const none = view({ ...data, currencies: [{ ...data.currencies[0], limit_total: null, categories: data.currencies[0].categories.map((category) => ({ ...category, limit: null, limit_id: null })) }] })
    expect(noIcons(none)).toContain('<a class="ck-panel dash-card dash-limits dash-limits-empty" aria-label="Лимиты: задать лимиты" href="/budget/limits"><span class="ck-row-badge dash-limits-empty-badge" aria-hidden="true"></span><span class="dash-limits-empty-text"><span class="dash-limits-empty-title">Лимиты</span><span class="dash-limits-empty-note">Задать лимиты</span></span></a>')
    expect(none).not.toContain('dash-limit-list')
  })

  it('renders an older server without the pulse, the attention and the tiles, and without the removed cards', () => {
    const html = view(dashboardFixture(), '2026-10', '2026-10-12')
    expect(html).toContain('dash-hero')
    expect(html).toContain('dash-where')
    for (const part of ['dash-pulse', 'dash-attention', 'dash-tiles', 'dash-actions', 'inc-summary', 'rec-due', 'pl-dash', 'Загрузить чек', 'Снять чек', 'Добавить</a>', 'dash-pace']) {
      expect(html, part).not.toContain(part)
    }
    // The old cards of the income, the payments and the plans are not imported any more.
    const source = readFileSync(new URL('./DashboardPage.tsx', import.meta.url), 'utf8')
    for (const name of ['IncomeSummary', 'RecurringDue', 'PlannedCard', 'useQuickShot']) expect(source).not.toContain(name)
    // The line under the number keeps the days of the current month; there is no budget and no «в день».
    expect(words(between(html, '<p class="dash-hero-sub"', '</p>'))).toBe('ещё 19 дней')
  })

  it('puts the number, the attention, the spends and the ring in one column, the tiles and the limits in the other', () => {
    const html = view()
    const main = html.indexOf('<div class="dash-column dash-column-main">')
    const side = html.indexOf('<div class="dash-column dash-column-side">')
    expect(html.indexOf('dash-hero')).toBeGreaterThan(main)
    expect(html.indexOf('dash-attention"')).toBeGreaterThan(html.indexOf('dash-hero'))
    expect(html.indexOf('dash-recent"')).toBeGreaterThan(html.indexOf('dash-attention"'))
    expect(html.indexOf('dash-where"')).toBeGreaterThan(html.indexOf('dash-recent"'))
    expect(html.indexOf('dash-where"')).toBeLessThan(side)
    expect(html.indexOf('dash-tiles')).toBeGreaterThan(side)
    expect(html.indexOf('dash-limits"')).toBeGreaterThan(html.indexOf('dash-tiles'))
    expect(html).not.toContain('<table')
  })
})
