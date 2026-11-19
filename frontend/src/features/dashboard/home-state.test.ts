import { describe, expect, it } from 'vitest'
import { attentionFixture, dashboardFixture, homeFixture } from '../../api/budget-test-support'
import type { Dashboard } from '../../api/budget'
import {
  attentionAmount, attentionBadge, attentionMeta, attentionMoreText, attentionRows, budgetShare, daysInMonth, firstDayText, goalsTile, hasPulse, legendOf, limitLine, limitState, paymentsTile,
  percentText, plansTile, pulseCaption, recentView, shareOf, tilesOf, todayIn, yesterdayOf,
} from './home-state'
import { phraseText } from './home-hero'

const nb = (text: string) => text.replaceAll(' ', '\u00a0')
const plain = (text: string) => text.replace(/[\u00a0\u202f]/g, ' ')

describe('the ring and its legend (home-state, pure)', () => {
  it('lists the categories with spends, four beside the ring, the rest as a count, and the remainder of the budget', () => {
    const data = homeFixture()
    const block = { ...data.currencies[0], categories: [...data.currencies[0].categories, { category_id: 14, name: 'Аптека', spent: '700.00', limit: null, limit_id: null }] }
    const legend = legendOf(block, data.budget)
    expect(legend.rows.map((row) => [row.name, row.tone])).toEqual([['Продукты', 3], ['Кафе', 2], ['Транспорт', 5], ['Не разобрано', 1]])
    expect(legend.more).toBe(1)
    // The ring draws every category with spends; «Дом» with nothing spent is not a segment.
    expect(legend.all.map((row) => row.name)).toEqual(['Продукты', 'Кафе', 'Транспорт', 'Не разобрано', 'Аптека'])
    expect(legend.remainder).toBe(90000000n - 28745000n)
    // Without a budget, or with one of another currency, there is no remainder; an overspent one is below zero.
    expect(legendOf(block, null).remainder).toBeNull()
    expect(legendOf(block, { amount: '100.00', currency: 'USD', spent: '0.00' }).remainder).toBeNull()
    expect(legendOf(block, { amount: '100000.00', currency: 'KZT', spent: '287450.00' }).remainder).toBe(10000000n - 28745000n)
  })
  it('says the share of the budget, rounded half up, and «за месяц» without one', () => {
    expect(budgetShare('287450.00', { amount: '900000.00', currency: 'KZT', spent: '287450.00' })).toBe(32)
    expect(budgetShare('1.00', { amount: '200.00', currency: 'KZT', spent: '1.00' })).toBe(1)
    expect(budgetShare('0.00', { amount: '200.00', currency: 'KZT', spent: '0.00' })).toBe(0)
    expect(budgetShare('410000.00', { amount: '400000.00', currency: 'KZT', spent: '410000.00' })).toBe(103)
    expect(budgetShare('1.00', null)).toBeNull()
    expect(budgetShare('1.00', { amount: '0.00', currency: 'KZT', spent: '1.00' })).toBeNull()
    expect(percentText(14)).toBe(nb('14 %'))
  })
})

describe('the pulse captions and the foot of the hero', () => {
  it('names the first and the last day, today and the average day', () => {
    const data = homeFixture()
    expect(firstDayText('2026-10')).toBe(nb('1 окт'))
    expect(daysInMonth('2026-02')).toBe(28)
    expect(daysInMonth('2026-10', data.by_day)).toBe(31)
    const caption = pulseCaption(data, 'KZT', '2026-10-26')
    expect(caption.start).toBe(nb('1 окт'))
    expect(plain(caption.middle.today ?? '')).toBe('сегодня 26')
    expect(plain(caption.middle.average ?? '')).toBe('средний день 2 610 ₸')
    expect(caption.end).toBe('31')
    // A past month has no today; a month without an average has no line of it.
    expect(pulseCaption(data, 'KZT', undefined).middle.today).toBeNull()
    expect(pulseCaption({ ...data, average_day: '0.00' }, 'KZT', '2026-10-26').middle.average).toBeNull()
    expect(todayIn('2026-10', '2026-10-26')).toBe('2026-10-26')
    expect(todayIn('2026-09', '2026-10-26')).toBeUndefined()
    expect(yesterdayOf('2026-10-01')).toBe('2026-09-30')
  })
  it('tells an older server from one with the pulse', () => {
    expect(hasPulse(dashboardFixture())).toBe(false)
    expect(hasPulse(homeFixture())).toBe(true)
    expect(hasPulse({ ...homeFixture(), by_day: [] })).toBe(false)
  })
  // The line under the main number (the budget, the days, «в день») is home-hero.ts: home-hero.test.ts.
})

describe('«Требует внимания»', () => {
  it('gives each kind its picture and colour, and a plain one to a kind it does not know', () => {
    expect(attentionBadge('payment_due')).toEqual({ icon: 'repeat', tone: 'plain' })
    const row = attentionFixture()[0]
    expect(attentionMeta(row).replace(/\u00a0/g, ' ')).toBe('220 000 ₸ · Срок 5 ноября')
    expect(attentionMeta({ ...row, kind: 'limit_near', meta: 'Осталось до лимита', amount: '11500.00' }).replace(/\u00a0/g, ' ')).toBe('Осталось до лимита · 11 500 ₸')
    expect(attentionMeta({ ...row, kind: 'limit_over', meta: '120 % лимита', amount: '20000.00' }).replace(/\u00a0/g, ' ')).toBe('120 % лимита · 20 000 ₸')
    expect(attentionMeta({ ...row, amount: null, currency: null })).toBe('Срок 5 ноября')
    expect(attentionMeta({ kind: 'plans_question', title: 'x', meta: 'Старый сервер', href: '/recurring' })).toBe('Старый сервер')
    expect(attentionBadge('payment_overdue')).toEqual({ icon: 'repeat', tone: 'over' })
    expect(attentionBadge('income_missing')).toEqual({ icon: 'income', tone: 'income' })
    // From 80 % of a limit — the over tone (the words of the row say so); gold only for the verdict of the assistant.
    expect(attentionBadge('limit_near')).toEqual({ icon: 'stats', tone: 'over' })
    expect(attentionBadge('limit_over')).toEqual({ icon: 'stats', tone: 'over' })
    expect(attentionBadge('plan_verdict')).toEqual({ icon: 'insight', tone: 'ai' })
    expect(attentionBadge('plans_question')).toEqual({ icon: 'repeat', tone: 'plain' })
    expect(attentionBadge('something_new')).toEqual({ icon: 'more', tone: 'plain' })
    expect(attentionMoreText(2)).toBe(nb('ещё 2'))
    expect(attentionMoreText(0)).toBeNull()
    expect(attentionMoreText(undefined)).toBeNull()
    expect(attentionRows(dashboardFixture())).toEqual([])
    expect(attentionRows(homeFixture())).toHaveLength(3)
  })
  it('puts the sum of a row at the right, with the words of a limit under it', () => {
    const row = attentionFixture()[0]
    expect(attentionAmount(row)).toEqual({ money: '220000.00', currency: 'KZT', caption: null, over: false })
    expect(attentionAmount({ ...row, kind: 'limit_over', amount: '5700.00' })).toEqual({ money: '5700.00', currency: 'KZT', caption: 'сверх лимита', over: true })
    expect(attentionAmount({ ...row, kind: 'limit_near', amount: '6400.00' })).toEqual({ money: '6400.00', currency: 'KZT', caption: 'до лимита', over: false })
    expect(attentionAmount({ ...row, amount: null, currency: null })).toBeNull()
  })
})

describe('the tiles «Платежи · Планы · Цели»', () => {
  it('says paid of all and what waits, a part of the bar per payment', () => {
    const tile = paymentsTile(homeFixture().tiles!.payments)
    expect(tile.value).toEqual(['2 из 5'])
    expect(plain(phraseText(tile.note))).toBe('ждут 356 445 ₸')
    expect(tile.note).toEqual(['ждут ', { money: '356445.00', currency: 'KZT' }])
    expect(tile.bar.map((part) => part.on)).toEqual([true, true, false, false, false])
    expect(tile.to).toBe('/recurring')
    expect(paymentsTile({ paid: 3, total: 3, left: '0.00', currency: 'KZT', segments: [] }).note).toEqual(['все оплачены'])
    expect(paymentsTile(null)).toMatchObject({ value: ['Нет'], note: ['добавить'], bar: [] })
  })
  it('says what the plans still wait for, done of all, the plans as parts by their sums', () => {
    const tile = plansTile(homeFixture().tiles!.plans, 'KZT', '2026-10')
    expect(plain(phraseText(tile.value))).toBe('185 000 ₸')
    expect(tile.note).toEqual(['ждём · 1 из 3'])
    expect(tile.to).toBe('/planned?month=2026-10')
    expect(tile.bar.map((part) => [part.flex, part.on])).toEqual([[6500000, false], [9200000, true], [12000000, false]])
    expect(plansTile(null, 'KZT', '2026-10')).toMatchObject({ value: ['Нет'], note: ['без планов'], bar: [] })
  })
  it('says the share of the goals and the bar of it', () => {
    const tile = goalsTile(homeFixture().tiles!.goals)
    expect(tile.value).toEqual([nb('62 %')])
    expect(plain(phraseText(tile.note))).toBe('3 цели · 305 000 ₸')
    expect(tile.bar).toEqual([{ key: 'saved', flex: 62, on: true }, { key: 'left', flex: 38, on: false }])
    expect(tile.reached).toBe(false)
    // Every goal saved up: the one milestone of the screen, said in words.
    const reached = goalsTile({ ...homeFixture().tiles!.goals!, share: 100 })
    expect(reached).toMatchObject({ reached: true, note: ['все цели достигнуты'] })
    expect(shareOf('62.49')).toBe(62)
    expect(shareOf(120)).toBe(100)
    expect(shareOf('x')).toBe(0)
    expect(goalsTile(null).value).toEqual(['Нет целей'])
  })
  it('has no tiles from an older server', () => {
    expect(tilesOf(dashboardFixture(), 'KZT')).toBeNull()
    expect(tilesOf(homeFixture(), 'KZT')!.map((tile) => tile.key)).toEqual(['payments', 'plans', 'goals'])
  })
})

describe('«Сегодня и вчера» and the limit line', () => {
  const data: Dashboard = homeFixture()
  it('keeps the spends of today and yesterday of the current month, the last three of a past one', () => {
    const now = recentView(data.recent, '2026-10', '2026-10-12')
    expect(now.title).toBe('Сегодня и вчера')
    expect(now.items.map((item) => item.id)).toEqual([12, 13])
    expect(recentView(data.recent, '2026-10', '2026-10-20')).toEqual({ title: 'Сегодня и вчера', items: [], empty: true })
    const past = recentView(data.recent, '2026-10', '2026-11-03')
    expect(past.title).toBe('Последние траты')
    expect(past.items).toHaveLength(3)
  })
  it('says «N % · spent из limit» and the overspend, what was spent without a limit', () => {
    expect(plain(limitLine('92300.00', '120000.00', 'KZT').text)).toBe('77 % · 92 300 из 120 000 ₸')
    expect(limitLine('92300.00', '120000.00', 'KZT').over).toBe(false)
    expect(limitLine('54300.00', '50000.00', 'KZT')).toEqual({ text: expect.stringContaining('109'), over: true })
    expect(plain(limitLine('21500.50', null, 'KZT').text)).toBe('21 500,50 ₸')
    expect(limitLine('1.00', '0.00', 'KZT').over).toBe(false)
  })
  it('says the state of a limit in words from 80 %, never by the colour alone', () => {
    expect(limitState('92300.00', '120000.00')).toEqual({ percent: 77, state: 'calm', words: '' })
    expect(limitState('63600.00', '70000.00')).toEqual({ percent: 91, state: 'near', words: 'почти лимит' })
    expect(limitState('80000.00', '100000.00')).toEqual({ percent: 80, state: 'near', words: 'почти лимит' })
    expect(limitState('20700.00', '15000.00')).toEqual({ percent: 138, state: 'over', words: 'сверх лимита' })
    expect(limitState('70000.00', '70000.00')).toEqual({ percent: 100, state: 'near', words: 'лимит исчерпан' })
    expect(limitState('100.00', null)).toBeNull()
    expect(limitState('100.00', '0.00')).toBeNull()
  })
})
