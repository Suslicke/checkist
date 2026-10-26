import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { attentionFixture, dashboardFixture, homeFixture } from '../../api/budget-test-support'
import type { Dashboard } from '../../api/budget'
import { DashboardView } from './DashboardPage'

const nb = (text: string) => text.replaceAll(' ', '\u00a0')
const view = (data: Dashboard = homeFixture(), today = '2026-10', date = '2026-10-26') => renderToStaticMarkup(<DashboardView data={data} today={today} date={date} />)
const between = (html: string, start: string, end: string) => html.slice(html.indexOf(start), html.indexOf(end, html.indexOf(start)))
const noIcons = (html: string) => html.replace(/<svg\b.*?<\/svg>/g, '')
const words = (html: string) => noIcons(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/[\u00a0\u202f]/g, ' ').trim()

describe('«Главная» of 2026-10-26 (Vitest/SSR, not browser visual acceptance)', () => {
  it('puts the month as the heading and the two round steps after it, «›» only while a later month is past', () => {
    const html = noIcons(view())
    expect(html).toContain('<span class="dash-month-steps"><a class="ck-round dash-month-step" aria-label="Предыдущий месяц" href="/?month=2026-09"></a></span>')
    expect(html).not.toContain('Следующий месяц')
    expect(noIcons(view(homeFixture(), '2026-11'))).toContain('aria-label="Следующий месяц" href="/?month=2026-11"></a></span>')
    expect(html).toContain('<ul class="dash-family" aria-label="Семья">')
    expect(html).not.toMatch(/<h[12][^>]*>Октябрь/)
    const source = readFileSync(new URL('./DashboardPage.tsx', import.meta.url), 'utf8')
    expect(source).toContain('<HeaderSlot side="end">')
    expect(source).not.toContain('<HeaderSlot side="start">')
  })

  it('draws the ring of the categories with the remainder of the budget as the gap, and the words in its middle', () => {
    const hero = between(view(), 'dash-hero', '</section>')
    const ring = between(hero, '<div class="ck-ring"', '</svg>')
    expect(ring).toContain('<circle class="ck-ring-track" cx="66" cy="66" r="59" stroke-width="14">')
    // Four categories with spends: four segments in the colours of the categories, in the order of the server.
    expect(ring.match(/ck-ring-segment ck-ring-tone-(\d)/g)).toEqual(['ck-ring-segment ck-ring-tone-3', 'ck-ring-segment ck-ring-tone-2', 'ck-ring-segment ck-ring-tone-5', 'ck-ring-segment ck-ring-tone-1'])
    // The first segment: 92 300 of the categories (169 300,50) and the remainder of the budget (900 000 − 287 450).
    const first = /stroke-dasharray="([\d.]+) ([\d.]+)" stroke-dashoffset="0"/.exec(ring)
    expect(first).not.toBeNull()
    expect(Number(first![1]) / Number(first![2])).toBeCloseTo(9230000 / (16930050 + 61255000), 3)
    expect(ring).toContain('role="img" aria-label="Потрачено 287')
    expect(hero).toContain(`<div class="ck-ring-centre"><span class="dash-ring-label">Потрачено семьёй</span><span class="dash-ring-value ck-figures">${nb('287 450 ₸')}</span><span class="dash-ring-label">${nb('32 %')} бюджета</span></div>`)
    // One big figure on the screen: the value in the ring; the old hero figure is gone.
    expect(hero).not.toContain('ck-hero-figure')
    expect(hero.match(/dash-ring-value/g)).toHaveLength(1)
  })

  it('lists up to four categories beside the ring, «ещё N» and the remainder of the budget', () => {
    const data = homeFixture()
    data.currencies[0].categories.push({ category_id: 14, name: 'Аптека', spent: '700.00', limit: null, limit_id: null })
    const legend = noIcons(between(view(data), '<ul class="dash-legend"', '</ul>'))
    expect(legend).toContain(`<li class="dash-legend-row dash-cat-3"><i class="dash-legend-swatch" aria-hidden="true"></i><a class="dash-legend-name" href="/spends/category/3?month=2026-10">Продукты</a><b class="dash-legend-amount ck-figures">${nb('92 300 ₸')}</b></li>`)
    expect(legend.match(/dash-legend-row dash-cat-/g)).toHaveLength(4)
    expect(legend).not.toContain('Аптека')
    expect(legend).toContain(`<a class="dash-legend-name" href="/stats">ещё 1</a>`)
    expect(legend).toContain(`<span class="dash-legend-name">Остаток бюджета</span><b class="dash-legend-amount ck-figures">${nb('612 550 ₸')}</b>`)
    // Overspent: the last row says by how much, in the overspend colour.
    const over = noIcons(between(view({ ...data, budget: { amount: '200000.00', currency: 'KZT', spent: '287450.00' } }), '<ul class="dash-legend"', '</ul>'))
    expect(over).toContain(`<span class="dash-legend-name">Сверх бюджета</span><b class="dash-legend-amount ck-figures dash-over">${nb('87 450 ₸')}</b>`)
  })

  it('draws the pulse: a bar a day, the days with spends, today, the days ahead flat, the dashed average day', () => {
    const hero = between(view(), 'dash-hero', '</section>')
    const bars = hero.match(/<i class="dash-pulse-day dash-pulse-[a-z]+"[^>]*>/g) ?? []
    expect(bars).toHaveLength(31)
    expect(bars[0]).toBe('<i class="dash-pulse-day dash-pulse-on" style="height:15%">')
    expect(bars[1]).toBe('<i class="dash-pulse-day dash-pulse-off" style="height:4%">')
    expect(bars[25]).toBe('<i class="dash-pulse-day dash-pulse-today" style="height:100%">')
    expect(bars[26]).toBe('<i class="dash-pulse-day dash-pulse-future">')
    expect(bars.filter((bar) => bar.includes('future'))).toHaveLength(5)
    expect(hero).toContain('<span class="dash-pulse-average" style="bottom:22%" aria-hidden="true"></span>')
    expect(hero).toContain(`<p class="dash-pulse-x" aria-hidden="true"><span>${nb('1 окт')}</span><span class="dash-pulse-x-middle"><span class="dash-pulse-today">${nb('сегодня 26')}</span><span> · средний день ${nb('2 610 ₸')}</span></span><span>31</span></p>`)
    expect(hero).toContain('role="img" aria-label="Траты по дням в\u00a0октябре"')
    // A past month: no today, no future, the average alone in the middle.
    const past = between(view(homeFixture(), '2026-11', '2026-11-03'), 'dash-hero', '</section>')
    expect(past).not.toContain('dash-pulse-today')
    expect(past).not.toContain('dash-pulse-future')
    expect(past).toContain(`<span class="dash-pulse-x-middle"><span>средний день ${nb('2 610 ₸')}</span></span>`)
  })

  it('ends the hero with the budget, the days left and «в день», the way it was counted as a title', () => {
    const hero = between(view(), 'dash-hero', '</section>')
    expect(hero).toContain(`<div class="dash-hero-foot"><span class="dash-hero-budget">из ${nb('900 000 ₸')} · ${nb('ещё 6 дней')}</span><span class="dash-hero-day" title="Бюджет месяца ${nb('900 000 ₸')} минус траты и ${nb('1 платёж к оплате')} (${nb('25 000 ₸')}), поровну на ${nb('6 дней')}">в день <b class="ck-figures">${nb('97 925 ₸')}</b>`)
    // Without a budget: the days and the average day; the ring says «за месяц».
    const noBudget = between(view({ ...homeFixture(), budget: null, allowance: null }), 'dash-hero', '</section>')
    expect(noBudget).toContain(`<span class="dash-hero-budget">${nb('ещё 6 дней')}</span><span class="dash-hero-day">средний день <b class="ck-figures">${nb('2 610 ₸')}</b></span>`)
    expect(noBudget).toContain('<span class="dash-ring-label">за месяц</span>')
    expect(noBudget).not.toContain('Остаток бюджета')
    // Overspent: both in the overspend colour.
    const data = homeFixture()
    const over = between(view({ ...data, budget: { amount: '200000.00', currency: 'KZT', spent: '287450.00' }, allowance: { ...data.allowance!, per_day: null, overspent: '112450.00' } }), 'dash-hero', '</section>')
    expect(over).toContain(`<span class="dash-hero-budget dash-over">Сверх бюджета на ${nb('87 450 ₸')} · ${nb('ещё 6 дней')}</span><span class="dash-hero-day dash-over"`)
    expect(over).toContain(`Перерасход <b class="ck-figures">${nb('112 450 ₸')}</b>`)
    expect(over).toContain(`<span class="dash-ring-label dash-over">${nb('144 %')} бюджета</span>`)
  })

  it('shows «Требует внимания» with a badge per kind, each row a link, «ещё N» to «Деньги»; no rows — no card', () => {
    const html = view()
    const card = between(html, 'dash-attention"', '</section>')
    expect(card).toContain('<div class="ck-panel-head"><h2 id="dash-attention-heading">Требует внимания</h2><a class="dash-card-link" href="/money">ещё\u00a02</a></div>')
    const rows = card.match(/<a class="ck-row dash-attention-row"[^>]*><span class="ck-row-badge dash-attention-badge dash-attention-[a-z]+"/g) ?? []
    expect(rows).toHaveLength(3)
    expect(rows[0]).toContain('data-kind="payment_due"')
    expect(rows[0]).toContain('href="/recurring"')
    expect(rows[0]).toContain('dash-attention-warn"')
    expect(rows[1]).toContain('href="/receipts/new?kind=income"')
    expect(rows[1]).toContain('dash-attention-success"')
    expect(rows[2]).toContain('href="/chat"')
    expect(rows[2]).toContain('dash-attention-ai"')
    expect(card).toContain('<span class="ck-row-title">Аренда квартиры через 2 дня</span><span class="ck-row-meta">220 000 ₸ · 5 ноября · Оплатил?</span>')
    // The other kinds and an unknown one.
    const kinds = attentionFixture().map((row, index) => ({ ...row, kind: ['payment_overdue', 'limit_over', 'limit_near', 'brand_new'][index] ?? 'plans_question' }))
    const more = between(view({ ...homeFixture(), attention: [...kinds, { ...kinds[0], kind: 'plans_question' }], attention_more: 0 }), 'dash-attention"', '</section>')
    expect(more.match(/dash-attention-(warn|over|success|ai|plain)"/g)).toEqual(['dash-attention-over"', 'dash-attention-over"', 'dash-attention-warn"', 'dash-attention-ai"'])
    expect(more).not.toContain('ещё')
    expect(view({ ...homeFixture(), attention: [] })).not.toContain('dash-attention')
    expect(view(dashboardFixture())).not.toContain('Требует внимания')
  })

  it('draws the three tiles as links with a mini bar each', () => {
    const tiles = between(view(), '<ul class="dash-tiles"', '</ul>')
    expect(tiles).toContain('<ul class="dash-tiles" aria-label="Платежи, планы и цели">')
    expect(tiles).toContain('<li><a class="dash-tile dash-tile-payments" href="/recurring"><span class="dash-tile-title">Платежи</span><span class="dash-tile-value ck-figures">2 из 5</span>')
    expect(tiles).toContain(`<span class="dash-tile-note">ждут ${nb('356 445 ₸')}</span><span class="dash-mini" role="img" aria-label="Оплачено 2 из 5"><i class="dash-mini-part dash-cat-2 dash-mini-on" style="flex:1"></i><i class="dash-mini-part dash-cat-2 dash-mini-on" style="flex:1"></i><i class="dash-mini-part dash-cat-2" style="flex:1"></i>`)
    expect(tiles).toContain(`<a class="dash-tile dash-tile-plans" href="/planned?month=2026-10"><span class="dash-tile-title">Планы</span><span class="dash-tile-value ck-figures">${nb('185 000 ₸')}</span><span class="dash-tile-note">ждём · 1 из 3</span>`)
    expect(tiles).toContain('<i class="dash-mini-part dash-cat-4 dash-mini-on" style="flex:9200000"></i>')
    expect(tiles).toContain(`<a class="dash-tile dash-tile-goals" href="/goals"><span class="dash-tile-title">Цели</span><span class="dash-tile-value ck-figures">${nb('62 %')}</span><span class="dash-tile-note">${nb('3 цели')} · ${nb('305 000 ₸')}</span><span class="dash-mini" role="img" aria-label="Накоплено ${nb('62 %')} по всем целям"><i class="dash-mini-part dash-cat-3 dash-mini-on" style="flex:62"></i><i class="dash-mini-part dash-cat-0" style="flex:38"></i></span></a>`)
    // Without plans the tile invites; an older server has no tiles.
    const data = homeFixture()
    expect(view({ ...data, tiles: { ...data.tiles!, plans: null } })).toContain('<span class="dash-tile-value ck-figures">Пока без планов</span><span class="dash-tile-note">добавить</span></a>')
    expect(view(dashboardFixture())).not.toContain('dash-tiles')
  })

  it('lists the spends of today and yesterday, «Сегодня трат нет» with «Все траты» otherwise, the last three of a past month', () => {
    const recent = between(view(homeFixture(), '2026-10', '2026-10-12'), 'dash-recent"', '</section>')
    expect(recent).toContain('<div class="ck-panel-head"><h2 id="dash-recent-heading">Сегодня и вчера</h2><a class="dash-card-link" href="/receipts">Все траты</a></div>')
    expect(recent.match(/href="\/receipts\/(\d+)"/g)).toEqual(['href="/receipts/12"', 'href="/receipts/13"'])
    expect(recent).toContain(`liza · сегодня · ${nb('23 позиции')}`)
    expect(recent).toContain('andrey · вчера · вручную')
    const empty = between(view(), 'dash-recent"', '</section>')
    expect(empty).toContain('<p class="dash-note">Сегодня трат нет.</p>')
    expect(empty).toContain('href="/receipts">Все траты</a>')
    const past = between(view(homeFixture(), '2026-11', '2026-11-03'), 'dash-recent"', '</section>')
    expect(past).toContain('<h2 id="dash-recent-heading">Последние траты</h2>')
    expect(past.match(/href="\/receipts\/(\d+)"/g)).toHaveLength(3)
  })

  it('keeps the limits compact: the name, «N % · spent из limit», a bar; one row-link without any limit', () => {
    const limits = noIcons(between(view(), 'dash-limits"', '</section>'))
    expect(limits).toContain(`<li class="dash-limit dash-cat-3"><a class="dash-limit-head dash-limit-link" href="/spends/category/3?month=2026-10"><span class="dash-limit-name">Продукты</span><span class="dash-limit-value ck-figures">${nb('77 %')} · ${nb('92 300')} из ${nb('120 000 ₸')}</span></a><div class="dash-bar" role="progressbar" aria-label="Продукты: потрачено 76% лимита"`)
    expect(limits).toContain(`<span class="dash-limit-value dash-limit-spent-over ck-figures">${nb('109 %')} · ${nb('54 300')} из ${nb('50 000 ₸')}</span></a><div class="dash-bar dash-bar-over"`)
    expect(limits).not.toContain('dash-dot')
    expect(limits).not.toContain('Без лимита')
    expect(limits).not.toContain('Транспорт')
    expect(limits).not.toContain('Задать лимиты')
    const data = homeFixture()
    const none = view({ ...data, currencies: [{ ...data.currencies[0], limit_total: null, categories: data.currencies[0].categories.map((category) => ({ ...category, limit: null, limit_id: null })) }] })
    expect(noIcons(none)).toContain('<a class="ck-panel dash-card dash-limits dash-limits-empty" aria-label="Лимиты: задать лимиты" href="/budget/limits"><span class="dash-limits-empty-title">Лимиты</span><span class="dash-limits-empty-note">Задать лимиты</span></a>')
    expect(none).not.toContain('dash-limit-list')
  })

  it('renders an older server without the pulse, the attention and the tiles, and without the removed cards', () => {
    const html = view(dashboardFixture(), '2026-10', '2026-10-12')
    expect(html).toContain('dash-hero')
    expect(html).toContain('<span class="dash-ring-label">за месяц</span>')
    for (const part of ['dash-pulse', 'dash-attention', 'dash-tiles', 'dash-actions', 'inc-summary', 'rec-due', 'pl-dash', 'Загрузить чек', 'Снять чек', 'Добавить</a>']) {
      expect(html, part).not.toContain(part)
    }
    // The old cards of the income, the payments and the plans are not imported any more.
    const source = readFileSync(new URL('./DashboardPage.tsx', import.meta.url), 'utf8')
    for (const name of ['IncomeSummary', 'RecurringDue', 'PlannedCard', 'useQuickShot']) expect(source).not.toContain(name)
    // The foot keeps the days of the current month; there is no budget and no «в день».
    expect(words(between(html, 'dash-hero-foot', '</div>'))).toBe('dash-hero-foot"> ещё 19 дней')
  })

  it('puts the ring, the attention and the spends in one column, the tiles and the limits in the other', () => {
    const html = view()
    const main = html.indexOf('<div class="dash-column dash-column-main">')
    const side = html.indexOf('<div class="dash-column dash-column-side">')
    expect(html.indexOf('dash-hero')).toBeGreaterThan(main)
    expect(html.indexOf('dash-attention"')).toBeGreaterThan(html.indexOf('dash-hero'))
    expect(html.indexOf('dash-recent"')).toBeGreaterThan(html.indexOf('dash-attention"'))
    expect(html.indexOf('dash-recent"')).toBeLessThan(side)
    expect(html.indexOf('dash-tiles')).toBeGreaterThan(side)
    expect(html.indexOf('dash-limits"')).toBeGreaterThan(html.indexOf('dash-tiles'))
    expect(html).not.toContain('<table')
  })
})
