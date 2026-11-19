import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { moneyFixture } from '../../api/money-test-support'
import type { Money } from '../../api/money'
import type { ThreadSummary } from '../../api/chat'
import { buildRoute, parseRoute } from '../../navigation'
import { MoneyView } from './MoneyPage'
import { columnsLabel, columnsOf, dueWords, flowOf, flowRows, goalsTile, hubTiles, incomesTile, lastThread, monthName, paymentsTile, plansTile, reviewNote, reviewRow, statsNote } from './money-state'

const nb = (text: string) => text.replaceAll(' ', '\u00a0')
const plain = (text: string) => text.replace(/[\u00a0\u202f]/g, ' ')
const view = (data: Money = moneyFixture(), threads?: ThreadSummary[], today = '2026-10') => renderToStaticMarkup(<MoneyView data={data} today={today} threads={threads} statsHref="/stats/trends?months=12" />)
const noIcons = (html: string) => html.replace(/<svg\b.*?<\/svg>/g, '')
const thread = (patch: Partial<ThreadSummary> = {}): ThreadSummary => ({ id: 7, kind: 'plans', title: 'Планы', updated_at: '2026-10-25T10:00:00Z', last_answer_preview: 'Куртку лучше отложить, шины брать: срок 20 октября…', ...patch })

describe('«Деньги» (money-state, pure)', () => {
  it('names the month, the lines of the flow and the figure of the card', () => {
    expect(monthName('2026-10', '2026-10')).toBe('Октябрь')
    expect(monthName('2025-12', '2026-10')).toBe(nb('Декабрь 2025'))
    expect(flowRows(moneyFixture()).map((row) => [row.key, row.label, row.amount])).toEqual([
      ['income', 'Доход', '1050000.00'], ['spent', 'Потрачено', '127500.00'], ['payments', 'Платежи впереди', '356445.00'],
      ['plans', 'Планы впереди', '185000.00'], ['aside', 'Отложено в цели', '305000.00'],
    ])
    expect(flowRows({ ...moneyFixture(), income: null })[0].amount).toBeNull()
    const flow = flowOf(moneyFixture())
    expect(flow.parts).toEqual([{ key: 'spent', flex: 12750000 }, { key: 'payments', flex: 35644500 }, { key: 'plans', flex: 18500000 }, { key: 'free', flex: 38105500 }])
    expect(flow.figure).toEqual({ label: 'Свободно', amount: '381055.00', over: false, note: null })
    expect(plain(flow.label)).toBe('Поток месяца: потрачено 127 500 ₸, платежи впереди 356 445 ₸, планы впереди 185 000 ₸, свободно 381 055 ₸')
    // Below zero: no free part, «Перерасход» without the minus in its colour with words; null — «Потрачено» and a request.
    const over = flowOf({ ...moneyFixture(), flow: { ...moneyFixture().flow, free: '-1000.00' } })
    expect(over.parts.map((part) => part.key)).toEqual(['spent', 'payments', 'plans'])
    expect(over.figure).toMatchObject({ label: 'Перерасход', amount: '1000.00', over: true })
    expect(over.figure.note).toContain('больше дохода')
    expect(plain(over.label)).toContain('перерасход 1 000 ₸')
    const none = flowOf({ ...moneyFixture(), flow: { ...moneyFixture().flow, free: null } })
    expect(none.figure).toMatchObject({ label: 'Потрачено', amount: '127500.00', over: false })
    expect(none.label).not.toContain('свободно')
  })

  it('fills the four tiles from the answer', () => {
    const data = moneyFixture()
    expect(incomesTile(data)).toMatchObject({ to: '/incomes?month=2026-10', note: nb('за октябрь'), amount: { value: '1050000.00', currency: 'KZT', income: true } })
    expect(incomesTile({ ...data, income: null })).toMatchObject({ amount: null, value: 'Не внесён', note: nb('за октябрь') })
    expect(dueWords(2)).toBe(nb('через 2 дня'))
    expect(dueWords(0)).toBe('сегодня')
    expect(plain(dueWords(-3))).toBe('просрочен на 3 дня')
    const payments = paymentsTile(data)
    expect(payments.amount).toEqual({ value: '356445.00', currency: 'KZT' })
    expect(plain(payments.note)).toBe('2 из 5 оплачено · Аренда через 2 дня')
    expect(payments.alert).toBeUndefined()
    // An overdue one: its words apart, in the colour of an overspend.
    const late = paymentsTile({ ...data, payments: { ...data.payments, next: { name: 'Аренда', due_date: '2026-10-05', days: -5 } } })
    expect([plain(late.note), plain(late.alert ?? '')]).toEqual(['2 из 5 оплачено', 'Аренда просрочен на 5 дней'])
    expect(paymentsTile({ ...data, payments: { ...data.payments, next: null } }).note).toBe('2 из 5 оплачено')
    expect(paymentsTile({ ...data, payments: { ...data.payments, left: '0.00', paid: 5, next: null } })).toMatchObject({ amount: null, value: 'Все оплачены' })
    expect(paymentsTile({ ...data, payments: { left: '0.00', paid: 0, total: 0, next: null } })).toMatchObject({ value: 'Нет', note: 'добавить регулярный' })
    const plans = plansTile(data)
    expect(plans.amount).toEqual({ value: '185000.00', currency: 'KZT' })
    expect(plain(plans.note)).toBe('ждём · 2 без срока')
    expect(plans.to).toBe('/planned?month=2026-10')
    expect(plansTile({ ...data, plans: { left: '1.00', count: 1, undated_count: 0 } }).note).toBe('ждём')
    expect(plansTile({ ...data, plans: null })).toMatchObject({ amount: null, value: 'Нет', note: 'пока без планов' })
    const goals = goalsTile(data)
    expect([goals.value, goals.bar]).toEqual([nb('62 %'), 62])
    expect(plain(goals.note)).toBe('«Зима» 38 % · «Отпуск» 83 %')
    expect(plain(goalsTile({ ...data, goals: { ...data.goals!, top: [] } }).note)).toBe('3 цели · 305 000 ₸')
    expect(goalsTile({ ...data, goals: null })).toMatchObject({ value: 'Нет целей' })
    expect(hubTiles(data).map((tile) => tile.key)).toEqual(['incomes', 'payments', 'plans', 'goals'])
  })

  it('draws the six columns and says whether the month is below or above the average of the months before', () => {
    const data = moneyFixture()
    const columns = columnsOf(data.months, '2026-10')
    expect(columns.map((column) => [column.height, column.now, column.label])).toEqual([[44, false, 'май'], [78, false, 'июн'], [61, false, 'июл'], [100, false, 'авг'], [67, false, 'сен'], [24, true, 'окт']])
    expect(plain(columnsLabel(columns, 'KZT'))).toBe('Траты по месяцам: май 240 000 ₸, июнь 420 000 ₸, июль 330 000 ₸, август 540 000 ₸, сентябрь 360 000 ₸, октябрь 127 500 ₸')
    expect(statsNote(data.months, '2026-10', true)).toBe('октябрь пока ниже среднего')
    expect(statsNote(data.months, '2026-10', false)).toBe('октябрь ниже среднего')
    expect(statsNote([{ month: '2026-09', spent: '1.00' }, { month: '2026-10', spent: '5.00' }], '2026-10', true)).toBe('октябрь пока выше среднего')
    expect(statsNote([{ month: '2026-10', spent: '5.00' }], '2026-10', true)).toBe('первый месяц')
    expect(statsNote([], '2026-10', true)).toBe('первый месяц')
    expect(columnsOf([], '2026-10')).toEqual([])
  })

  it('names the last review by the change of its spends (an amount) and its tips, or invites to ask for one', () => {
    expect(plain(reviewNote({ month: '2026-09', change_previous: '12000.00', tips: 3 }, 'KZT'))).toBe('на 12 000 ₸ больше, чем в августе · 3 совета')
    expect(plain(reviewNote({ month: '2026-01', change_previous: '-34375.02', tips: 1 }, 'KZT'))).toBe('на 34 375,02 ₸ меньше, чем в декабре · 1 совет')
    expect(plain(reviewNote({ month: '2026-09', change_previous: '0.00', tips: 2 }, 'KZT'))).toBe('как в августе · 2 совета')
    expect(plain(reviewNote({ month: '2026-09', change_previous: null, tips: 0 }, 'KZT'))).toBe('0 советов')
    expect(plain(reviewRow(moneyFixture()).title)).toBe('Разбор за сентябрь')
    expect(reviewRow(moneyFixture()).to).toBe('/review?month=2026-09')
    expect(reviewRow({ ...moneyFixture(), review: null })).toMatchObject({ note: 'запросить — итоги месяца и советы', to: '/review?month=2026-09' })
  })

  it('takes the newest thread of the chat', () => {
    expect(lastThread([thread(), thread({ id: 2, title: 'Старая' })])).toEqual({ id: 7, title: 'Планы', preview: 'Куртку лучше отложить, шины брать: срок 20 октября…' })
    expect(lastThread([thread({ title: '', kind: 'month', last_answer_preview: null })])).toEqual({ id: 7, title: 'О месяце', preview: 'Пока без ответа' })
    expect(lastThread([])).toBeNull()
  })

  it('opens at /money', () => {
    expect(parseRoute(new URL('/money', 'http://checkist.invalid'))).toEqual({ kind: 'money' })
    expect(buildRoute({ kind: 'money' })).toBe('/money')
  })
})

/** The text of an amount drawn by `Money`: «1 050 000 ₸» with ordinary spaces. */
const money = (html: string) => plain(html.replace(/<[^>]+>/g, '').replace(/\u202f/g, ' '))

describe('«Деньги» markup (Vitest/SSR, not browser visual acceptance)', () => {
  it('draws the card of the month: the figure «Свободно», the strip and the lines that name it', () => {
    const html = view()
    const card = html.slice(html.indexOf('money-month"'), html.indexOf('</section>'))
    expect(card).toContain('<h2 id="money-month-heading" class="money-figure-label">Свободно в\u00a0октябре</h2>')
    expect(card.match(/ck-money--display/g)).toHaveLength(1)
    expect(money(card.slice(card.indexOf('ck-money--display'), card.indexOf('money-flow')))).toContain('381 055 ₸')
    expect(card).toContain('<div class="money-flow" role="img" aria-label="Поток месяца: потрачено')
    expect(card).toContain('<i class="money-flow-spent" style="flex:12750000"></i><i class="money-flow-payments" style="flex:35644500"></i><i class="money-flow-plans" style="flex:18500000"></i><i class="money-flow-free" style="flex:38105500"></i>')
    expect(card).toContain('<div class="money-line money-line-income"><dt><i class="money-key money-key-income" aria-hidden="true"></i>Доход</dt><dd><span class="ck-money ck-money--row ck-money--in"><span class="ck-money-sign">+</span>')
    expect(card).toContain('<dt><i class="money-key money-key-aside" aria-hidden="true"></i>Отложено в цели</dt>')
    const over = view({ ...moneyFixture(), income: null, flow: { ...moneyFixture().flow, free: '-2500.00' } })
    expect(over).toContain('<div class="money-figure is-over"><h2 id="money-month-heading" class="money-figure-label">Перерасход в\u00a0октябре</h2><span class="ck-money ck-money--display ck-money--over">')
    expect(over).toContain('<span class="money-line-missing">не внесён</span>')
    expect(over).not.toContain('money-flow-free')
  })

  it('draws the four tiles as links with their figures, the goals with a bar', () => {
    const html = noIcons(view())
    const hub = html.slice(html.indexOf('<ul class="money-hub"'), html.indexOf('</ul>', html.indexOf('<ul class="money-hub"')))
    expect([...hub.matchAll(/<a class="money-tile money-tile-([a-z]+)" href="([^"]+)"/g)].map((match) => [match[1], match[2]])).toEqual([
      ['incomes', '/incomes?month=2026-10'], ['payments', '/recurring'], ['plans', '/planned?month=2026-10'], ['goals', '/goals'],
    ])
    expect(hub).toContain('<span class="ck-row-badge money-tile-icon money-tone-in" aria-hidden="true"></span><span class="money-tile-title">Доходы</span>')
    expect(hub).toContain('<span class="money-tile-value"><span class="ck-money ck-money--title ck-money--in"><span class="ck-money-sign">+</span>')
    expect(hub).toContain(`<span class="money-tile-note">2 из 5 оплачено · Аренда ${nb('через 2 дня')}</span>`)
    expect(hub).toContain(`<span class="money-tile-value">${nb('62 %')}</span><span class="ck-bar money-tile-bar" aria-hidden="true"><span style="width:62%"></span></span>`)
    expect(hub).toContain(`<span class="money-tile-note">«Зима» ${nb('38 %')} · «Отпуск» ${nb('83 %')}</span>`)
    const late = plain(noIcons(view({ ...moneyFixture(), payments: { ...moneyFixture().payments, next: { name: 'Аренда', due_date: '2026-10-05', days: -5 } } })))
    expect(late).toContain('<span class="money-tile-note">2 из 5 оплачено · <b class="money-tile-alert">Аренда просрочен на 5 дней</b></span>')
  })

  it('draws six months of spends with their names and words, «Статистика» where it was left', () => {
    const html = view()
    expect(html).toContain('<h2 id="money-months-heading">Траты за полгода</h2><a class="money-link" href="/stats/trends?months=12">Статистика</a>')
    expect(html).toContain('<div class="money-columns" role="img" aria-label="Траты по месяцам: май')
    expect(html).toContain('<span class="money-column is-now"><i style="--money-column:24%"></i><span class="money-column-label">окт</span></span>')
    expect(html).toContain('<p class="money-months-note">Октябрь пока ниже среднего</p>')
  })

  it('shows the assistant: the review and the last thread of the chat, the invitation without threads, a note while they load', () => {
    const withThread = plain(noIcons(view(moneyFixture(), [thread()])))
    expect(withThread).toContain('<h2 id="money-ai-heading" class="money-ai-who">Ассистент</h2><a class="money-link" href="/chat">Все беседы</a>')
    expect(withThread).toContain(`<a class="ck-row money-ai-row" href="/review?month=2026-09"><span class="ck-row-badge money-ai-badge" aria-hidden="true"></span><span class="ck-row-main"><span class="ck-row-title">Разбор за сентябрь</span>`)
    expect(withThread).toContain('<a class="ck-row money-ai-row" href="/chat/7"><span class="ck-row-badge money-ai-badge" aria-hidden="true"></span><span class="ck-row-main"><span class="ck-row-title">Планы</span><span class="ck-row-meta money-ai-meta">Куртку лучше отложить, шины брать: срок 20 октября…</span></span>')
    expect(noIcons(view(moneyFixture(), []))).toContain('<a class="ck-row money-ai-row" href="/chat"><span class="ck-row-badge money-ai-badge" aria-hidden="true"></span><span class="ck-row-main"><span class="ck-row-title">Спросить о тратах</span>')
    expect(view()).toContain('Открываем беседы…')
  })

  it('puts the month and the six months in one wrapper, the tiles and the assistant in the other; the stylesheet orders a phone', () => {
    const html = view()
    expect(html).toMatch(/^<div class="money-page"><div class="money-main"><section class="ck-panel money-month".*<\/section><section class="ck-panel money-months".*<\/section><\/div><div class="money-side"><ul class="money-hub".*<\/ul><section class="ck-panel money-ai"/)
    const css = readFileSync(new URL('./Money.css', import.meta.url), 'utf8')
    expect(css).toContain('.money-main, .money-side { display: contents; }')
    expect(css).toContain('.money-hub { order: 1; }')
    expect(css).toContain('.money-months { order: 2; }')
    expect(css).toContain('.money-ai { order: 3; }')
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i)
    for (const [, size] of css.matchAll(/font-size:\s*([^;]+);/g)) expect(size.trim()).toMatch(/^var\(--ck-text-(caption|label|body|field|title|heading|money-display|title-large|money-hero)\)$/)
    // Only 2.0 names of the tokens.
    for (const [, name] of css.matchAll(/var\((--ck-[a-z0-9-]+)/g)) expect(name).not.toMatch(/^--ck-(bg|text(?!-(caption|label|body|field|title|heading|money-display|title-large|money-hero))|accent|primary|link|border|divider|success|warning|info|neutral|disabled|radius$|radius-sm|radius-md|card-shadow|surface-raised)/)
    expect(css).not.toMatch(/animation|transition|@keyframes|\(min-width/)
    // The desktop columns live in theme/desktop.css only.
    const desktop = readFileSync(new URL('../../theme/desktop.css', import.meta.url), 'utf8')
    expect(desktop).toContain('.money-page { grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); align-items: start; max-width: none; }')
    expect(desktop).toContain('.money-main { grid-column: 1; }')
    expect(desktop).toContain('.money-side { grid-column: 2; }')
    expect(html).not.toContain('<table')
  })
})
