import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { moneyFixture } from '../../api/money-test-support'
import type { Money } from '../../api/money'
import type { ThreadSummary } from '../../api/chat'
import { buildRoute, parseRoute } from '../../navigation'
import { MoneyView } from './MoneyPage'
import { columnsOf, dueWords, flowOf, goalsTile, hubTiles, incomesTile, lastThread, monthName, paymentsTile, plansTile, reviewNote, reviewTile, statsNote, summaryOf } from './money-state'

const nb = (text: string) => text.replaceAll(' ', '\u00a0')
const plain = (text: string) => text.replace(/[\u00a0\u202f]/g, ' ')
const view = (data: Money = moneyFixture(), threads?: ThreadSummary[], today = '2026-10') => renderToStaticMarkup(<MoneyView data={data} today={today} threads={threads} statsHref="/stats/trends?months=12" />)
const noIcons = (html: string) => html.replace(/<svg\b.*?<\/svg>/g, '')
const thread = (patch: Partial<ThreadSummary> = {}): ThreadSummary => ({ id: 7, kind: 'plans', title: 'Планы', updated_at: '2026-10-25T10:00:00Z', last_answer_preview: 'Куртку лучше отложить, шины брать: срок 20 октября…', ...patch })

describe('«Деньги» (money-state, pure)', () => {
  it('names the month, the three sums and the strip of the flow', () => {
    expect(monthName('2026-10', '2026-10')).toBe('Октябрь')
    expect(monthName('2025-12', '2026-10')).toBe(nb('Декабрь 2025'))
    const summary = summaryOf(moneyFixture())
    expect([summary.income, summary.spent, summary.setAside].map((part) => plain(part ?? ''))).toEqual(['1 050 000 ₸', '127 500 ₸', '305 000 ₸'])
    expect(summaryOf({ ...moneyFixture(), income: null }).income).toBeNull()
    const flow = flowOf(moneyFixture())
    expect(flow.parts).toEqual([{ key: 'spent', flex: 12750000 }, { key: 'payments', flex: 35644500 }, { key: 'plans', flex: 18500000 }, { key: 'free', flex: 38105500 }])
    expect(plain(flow.caption.free ?? '')).toBe('свободно 381 055 ₸')
    expect(flow.caption.over).toBe(false)
    // Below zero: no free part, «перерасход» in its colour; null — the words without a free sum.
    const over = flowOf({ ...moneyFixture(), flow: { ...moneyFixture().flow, free: '-1000.00' } })
    expect(over.parts.map((part) => part.key)).toEqual(['spent', 'payments', 'plans'])
    expect(plain(over.caption.free ?? '')).toBe('перерасход 1 000 ₸')
    expect(over.caption.over).toBe(true)
    expect(flowOf({ ...moneyFixture(), flow: { ...moneyFixture().flow, free: null } }).caption).toEqual({ words: 'потрачено · платежи впереди · планы', free: null, over: false })
  })

  it('fills the six tiles from the answer', () => {
    const data = moneyFixture()
    expect(incomesTile(data)).toMatchObject({ to: '/incomes?month=2026-10', note: nb('за октябрь') })
    expect(plain(incomesTile(data).value ?? '')).toBe('1 050 000 ₸')
    expect(incomesTile({ ...data, income: null })).toMatchObject({ value: 'Не внесён', note: `${nb('за октябрь')} не внесён` })
    expect(dueWords(2)).toBe(nb('через 2 дня'))
    expect(dueWords(0)).toBe('сегодня')
    expect(dueWords(-3)).toBe('просрочен')
    const payments = paymentsTile(data)
    expect(plain(payments.value ?? '')).toBe('356 445 ₸')
    expect(plain(payments.note)).toBe('2 из 5 оплачено · Аренда через 2 дня')
    expect(paymentsTile({ ...data, payments: { ...data.payments, next: null } }).note).toBe('2 из 5 оплачено')
    expect(paymentsTile({ ...data, payments: { left: '0.00', paid: 0, total: 0, next: null } })).toMatchObject({ value: 'Нет', note: 'добавить регулярный' })
    const plans = plansTile(data)
    expect(plain(plans.value ?? '')).toBe('185 000 ₸')
    expect(plain(plans.note)).toBe('ждём · 2 без срока')
    expect(plans.to).toBe('/planned?month=2026-10')
    expect(plansTile({ ...data, plans: { left: '1.00', count: 1, undated_count: 0 } }).note).toBe('ждём')
    expect(plansTile({ ...data, plans: null })).toMatchObject({ value: 'Пока без планов' })
    const goals = goalsTile(data)
    expect(goals.value).toBe(nb('62 %'))
    expect(plain(goals.note)).toBe('«Зима» 38 % · «Отпуск» 83 %')
    expect(plain(goalsTile({ ...data, goals: { ...data.goals!, top: [] } }).note)).toBe('3 цели · 305 000 ₸')
    expect(goalsTile({ ...data, goals: null })).toMatchObject({ value: 'Нет целей' })
    expect(hubTiles(data, '/stats', true).map((tile) => tile.key)).toEqual(['incomes', 'payments', 'plans', 'goals', 'stats', 'review'])
  })

  it('draws the six columns and says whether the month is below or above the average of the months before', () => {
    const data = moneyFixture()
    expect(columnsOf(data.months, '2026-10').map((column) => [column.height, column.now])).toEqual([[44, false], [78, false], [61, false], [100, false], [67, false], [24, true]])
    expect(statsNote(data.months, '2026-10', true)).toBe('октябрь пока ниже среднего')
    expect(statsNote(data.months, '2026-10', false)).toBe('октябрь ниже среднего')
    expect(statsNote([{ month: '2026-09', spent: '1.00' }, { month: '2026-10', spent: '5.00' }], '2026-10', true)).toBe('октябрь пока выше среднего')
    expect(statsNote([{ month: '2026-10', spent: '5.00' }], '2026-10', true)).toBe('первый месяц')
    expect(statsNote([], '2026-10', true)).toBe('первый месяц')
    expect(columnsOf([], '2026-10')).toEqual([])
  })

  it('names the last review with its change and tips, or invites to ask for one', () => {
    expect(plain(reviewNote({ month: '2026-09', change_previous: '12.00', tips: 3 }))).toBe('+12 % к августу · 3 совета')
    expect(plain(reviewNote({ month: '2026-01', change_previous: '-4.60', tips: 1 }))).toBe('−5 % к декабрю · 1 совет')
    expect(plain(reviewNote({ month: '2026-09', change_previous: null, tips: 0 }))).toBe('0 советов')
    const tile = reviewTile(moneyFixture())
    expect(tile).toMatchObject({ value: 'Сентябрь', to: '/review?month=2026-09' })
    expect(reviewTile({ ...moneyFixture(), review: null })).toMatchObject({ value: 'Запросить разбор', to: '/review' })
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

describe('«Деньги» markup (Vitest/SSR, not browser visual acceptance)', () => {
  it('draws the card of the month: the eyebrow, the three sums, the strip and its words', () => {
    const html = view()
    const card = html.slice(html.indexOf('money-summary"'), html.indexOf('</section>'))
    expect(card).toContain('<h2 id="money-summary-heading" class="money-eyebrow">Октябрь</h2>')
    expect(card).toContain(`<dl class="money-sums"><div><dt>Доход</dt><dd class="ck-figures">${nb('1 050 000 ₸')}</dd></div><div><dt>Потрачено</dt><dd class="ck-figures">${nb('127 500 ₸')}</dd></div><div><dt>Отложено</dt><dd class="ck-figures">${nb('305 000 ₸')}</dd></div></dl>`)
    expect(card).toContain('<div class="money-flow" role="img" aria-label="Поток месяца: потрачено · платежи впереди · планы, свободно')
    expect(card).toContain('<i class="money-flow-spent" style="flex:12750000"></i><i class="money-flow-payments" style="flex:35644500"></i><i class="money-flow-plans" style="flex:18500000"></i><i class="money-flow-free" style="flex:38105500"></i>')
    expect(card).toContain(`<p class="money-caption">потрачено · платежи впереди · планы · <b>свободно ${nb('381 055 ₸')}</b></p>`)
    const over = view({ ...moneyFixture(), income: null, flow: { ...moneyFixture().flow, free: '-2500.00' } })
    expect(over).toContain('<dd class="ck-figures">не внесён</dd>')
    expect(over).toContain(`<b class="money-over">перерасход ${nb('2 500 ₸')}</b>`)
    expect(over).not.toContain('money-flow-free')
  })

  it('draws the six tiles as links in the order of the mockup, the statistics with its columns', () => {
    const html = noIcons(view())
    const hub = html.slice(html.indexOf('<ul class="money-hub"'), html.indexOf('</ul>'))
    expect([...hub.matchAll(/<a class="money-tile money-tile-([a-z]+)"[^>]*href="([^"]+)"/g)].map((match) => [match[1], match[2]])).toEqual([
      ['incomes', '/incomes?month=2026-10'], ['payments', '/recurring'], ['plans', '/planned?month=2026-10'], ['goals', '/goals'],
      ['stats', '/stats/trends?months=12'], ['review', '/review?month=2026-09'],
    ])
    expect(hub).toContain(`<span class="money-tile-head"><i class="money-tile-icon money-tone-success" aria-hidden="true"></i>Доходы</span><span class="money-tile-value ck-figures">${nb('1 050 000 ₸')}</span><span class="money-tile-note">${nb('за октябрь')}</span>`)
    expect(hub).toContain(`<i class="money-tile-icon money-tone-2" aria-hidden="true"></i>Платежи</span><span class="money-tile-value ck-figures">${nb('356 445 ₸')}</span><span class="money-tile-note">2 из 5 оплачено · Аренда ${nb('через 2 дня')}</span>`)
    expect(hub).toContain(`<i class="money-tile-icon money-tone-3" aria-hidden="true"></i>Цели</span><span class="money-tile-value ck-figures">${nb('62 %')}</span><span class="money-tile-note">«Зима» ${nb('38 %')} · «Отпуск» ${nb('83 %')}</span>`)
    expect(hub).toContain('<span class="money-columns" aria-hidden="true"><i style="height:44%"></i><i style="height:78%"></i><i style="height:61%"></i><i style="height:100%"></i><i style="height:67%"></i><i class="money-column-now" style="height:24%"></i></span><span class="money-tile-note">октябрь пока ниже среднего</span>')
    expect(hub).toContain(`<i class="money-tile-icon money-tone-ai" aria-hidden="true"></i>Разбор</span><span class="money-tile-value ck-figures">Сентябрь</span><span class="money-tile-note">+${nb('12 %')} к августу · ${nb('3 совета')}</span>`)
    expect(hub).toContain('aria-label="Статистика: октябрь пока ниже среднего"')
  })

  it('shows the last thread of the chat with «Все беседы», the invitation without threads, a note while they load', () => {
    const withThread = noIcons(view(moneyFixture(), [thread()]))
    expect(withThread).toContain('<div class="ck-panel-head"><h2 id="money-chat-heading">Чат с ИИ</h2><a class="dash-card-link" href="/chat">Все беседы</a></div>')
    expect(withThread).toContain('<a class="money-chat-row" href="/chat/7"><span class="money-chat-mark" aria-hidden="true"></span><span class="ck-row-main"><span class="ck-row-title">Планы</span><span class="ck-row-meta money-chat-preview">Куртку лучше отложить, шины брать: срок 20 октября…</span></span>')
    expect(noIcons(view(moneyFixture(), []))).toContain('<a class="money-chat-row" href="/chat"><span class="money-chat-mark" aria-hidden="true"></span><span class="ck-row-main"><span class="ck-row-title">Спросить о тратах</span>')
    expect(view()).toContain('Открываем беседы…')
  })

  it('puts the month and the chat in one wrapper, the hub in the other; the stylesheet orders a phone month · hub · chat', () => {
    const html = view()
    expect(html).toMatch(/^<div class="money-page"><div class="money-main"><section class="ck-panel money-summary".*<\/section><section class="ck-panel money-chat".*<\/section><\/div><div class="money-side"><ul class="money-hub"/)
    const css = readFileSync(new URL('./Money.css', import.meta.url), 'utf8')
    expect(css).toContain('.money-main, .money-side { display: contents; }')
    expect(css).toContain('.money-side > * { order: 1; }')
    expect(css).toContain('.money-chat { order: 2; }')
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i)
    for (const [, size] of css.matchAll(/font-size:\s*([^;]+);/g)) expect(size.trim()).toMatch(/^var\(--ck-text-(2xs|xs|sm|base|lg|xl|hero)\)$/)
    expect(css).not.toMatch(/animation|transition|@keyframes|\(min-width/)
    // The desktop columns live in theme/desktop.css only.
    const desktop = readFileSync(new URL('../../theme/desktop.css', import.meta.url), 'utf8')
    expect(desktop).toContain('.money-page { grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); align-items: start; max-width: none; }')
    expect(desktop).toContain('.money-main { grid-column: 1; }')
    expect(desktop).toContain('.money-side { grid-column: 2; }')
    expect(html).not.toContain('<table')
  })
})
