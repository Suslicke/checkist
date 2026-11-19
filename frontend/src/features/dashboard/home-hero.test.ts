import { describe, expect, it } from 'vitest'
import { dashboardFixture, homeFixture } from '../../api/budget-test-support'
import type { Money } from '../../api/money'
import { decimalOf, figureReasons, forMonth, heroOf, monthDone, paceLabel, paceOf, phraseText } from './home-hero'
import type { HeroView } from './home-hero'
import { rollAt } from './rolled'

const plain = (text: string) => text.replace(/[\u00a0\u202f]/g, ' ')
const sub = (view: HeroView) => view.sub.map((phrase) => plain(phraseText(phrase)))
const money = (flow: Partial<Money['flow']> = {}, income: string | null = '1050000.00'): Money => ({
  month: '2026-10', currency: 'KZT', income, spent: '287450.00', set_aside: '0.00',
  flow: { spent: '287450.00', payments_ahead: '25000.00', plans_ahead: '0.00', free: '737550.00', ...flow },
  payments: { left: '25000.00', paid: 2, total: 3, next: null }, plans: null, goals: null, months: [], review: null,
})

describe('the main number of «Главная» (home-hero, pure)', () => {
  const data = homeFixture()
  const block = data.currencies[0]

  it('is «Потрачено» by default: the budget, the days left and «в день» under it', () => {
    const view = heroOf({ data, block, figure: 'spent', current: true })
    expect(view).toMatchObject({ shown: 'spent', label: 'Потрачено в\u00a0октябре', value: '287450.00', currency: 'KZT', over: false, note: null })
    expect(sub(view)).toEqual(['из 900 000 ₸ бюджета', 'ещё 6 дней', '97 925 ₸ в день'])
    // Overspent: the words say by how much, in the over tone.
    const over = heroOf({ data: { ...data, budget: { amount: '200000.00', currency: 'KZT', spent: '287450.00' }, allowance: { ...data.allowance!, per_day: null, overspent: '87450.00' } }, block, figure: 'spent', current: true })
    expect(sub(over)).toEqual(['сверх бюджета на 87 450 ₸', 'ещё 6 дней'])
    expect(over.sub[0][1]).toEqual({ money: '87450.00', currency: 'KZT', over: true })
    // Without a budget: the days and the average day.
    expect(sub(heroOf({ data: { ...data, budget: null, allowance: null }, block, figure: 'spent', current: true }))).toEqual(['ещё 6 дней', 'средний день 2 610 ₸'])
  })

  it('compares a past month with the month before it, from the fields of the server only', () => {
    const view = heroOf({ data: { ...data, budget: null }, block: { ...block, previous_spent: '300000.00' }, figure: 'spent', current: false })
    expect(sub(view)).toEqual(['на 4 % меньше, чем в сентябре'])
    expect(sub(heroOf({ data: { ...data, budget: null }, block: { ...block, previous_spent: '0.00' }, figure: 'spent', current: false }))).toEqual(['в сентябре трат не было'])
  })

  it('«Осталось» is the budget minus what was spent, beyond it — «Сверх бюджета» in the over tone', () => {
    const view = heroOf({ data, block, figure: 'left', current: true })
    expect(view).toMatchObject({ shown: 'left', label: 'Осталось на\u00a0октябрь', value: '612550.00', over: false })
    expect(sub(view)).toEqual(['потрачено 287 450 ₸ из 900 000 ₸', 'ещё 6 дней'])
    const over = heroOf({ data: { ...data, budget: { amount: '200000.50', currency: 'KZT', spent: '287450.00' } }, block, figure: 'left', current: true })
    expect(over).toMatchObject({ label: 'Сверх бюджета в\u00a0октябре', value: '87449.50', over: true })
    expect(forMonth('2026-05')).toBe('на\u00a0май')
  })

  it('«Свободно» waits for «Деньги», then shows its free money; below zero — «Не хватает»', () => {
    expect(heroOf({ data, block, figure: 'free', current: true, free: { kind: 'loading' } })).toMatchObject({ shown: 'free', value: null, label: 'Свободно в\u00a0октябре' })
    const view = heroOf({ data, block, figure: 'free', current: true, free: { kind: 'ok', data: money() } })
    expect(view).toMatchObject({ shown: 'free', value: '737550.00', over: false })
    expect(sub(view)).toEqual(['доход 1 050 000 ₸ минус траты, платежи и планы', 'ещё 6 дней'])
    const short = heroOf({ data, block, figure: 'free', current: false, free: { kind: 'ok', data: money({ free: '-1200.40' }, null) } })
    expect(short).toMatchObject({ label: 'Не хватает в\u00a0октябре', value: '1200.40', over: true })
    expect(sub(short)).toEqual(['бюджет минус траты, платежи и планы'])
  })

  it('«В день» is the allowance of the current month; gone below zero — «Перерасход»', () => {
    const view = heroOf({ data, block, figure: 'daily', current: true })
    expect(view).toMatchObject({ shown: 'daily', label: 'Можно тратить в день', value: '97925.00', over: false })
    expect(sub(view)).toEqual(['бюджет 900 000 ₸ минус траты, платежи и планы, поровну на 6 дней'])
    const over = heroOf({ data: { ...data, allowance: { ...data.allowance!, per_day: null, overspent: '51437.63' } }, block, figure: 'daily', current: true })
    expect(over).toMatchObject({ label: 'Перерасход', value: '51437.63', over: true })
  })

  it('falls back to «Потрачено» and says why when the chosen number cannot be shown for this month', () => {
    const noBudget = { ...data, budget: null, allowance: null }
    expect(heroOf({ data: noBudget, block, figure: 'left', current: true })).toMatchObject({ shown: 'spent', note: 'Осталось: бюджет месяца не задан' })
    expect(heroOf({ data, block, figure: 'daily', current: false })).toMatchObject({ shown: 'spent', note: 'В день: только для текущего месяца' })
    expect(heroOf({ data: noBudget, block, figure: 'daily', current: true })).toMatchObject({ shown: 'spent', note: 'В день: нет бюджета и дохода месяца' })
    expect(heroOf({ data, block, figure: 'free', current: true, free: { kind: 'error' } })).toMatchObject({ shown: 'spent', note: 'Свободно: не удалось загрузить — повторите позже' })
    expect(heroOf({ data, block, figure: 'free', current: true, free: { kind: 'ok', data: money({ free: null }) } })).toMatchObject({ shown: 'spent', note: 'Свободно: нет дохода и бюджета месяца' })
    expect(figureReasons(data, block, true)).toEqual({})
    expect(figureReasons(dashboardFixture(), dashboardFixture().currencies[0], false)).toEqual({ left: 'Бюджет месяца не задан', daily: 'Только для текущего месяца' })
  })
})

describe('the bar of the budget under the main number', () => {
  const data = homeFixture()
  const block = data.currencies[0]

  it('fills what was spent, hatches the payments and plans ahead and marks today', () => {
    const pace = paceOf(data, block, true, '2026-10-26')!
    expect(pace).toEqual({ spent: 31.93, ahead: 2.77, aheadAmount: '25000.00', today: 83.87, state: 'calm', percent: 32 })
    expect(plain(paceLabel(pace))).toBe('Потрачено 32 % бюджета, платежи и планы впереди 3 %, прошло 84 % месяца')
    // A past month: no payments ahead and no today.
    expect(paceOf(data, block, false, '2026-11-03')).toMatchObject({ ahead: 0, aheadAmount: null, today: null })
    expect(paceOf({ ...data, budget: null }, block, true, '2026-10-26')).toBeNull()
  })

  it('is near from 80 % and over beyond the budget, never past the end of the bar', () => {
    expect(paceOf({ ...data, budget: { amount: '350000.00', currency: 'KZT', spent: '287450.00' } }, block, true, '2026-10-26')).toMatchObject({ state: 'near', percent: 82 })
    const over = paceOf({ ...data, budget: { amount: '200000.00', currency: 'KZT', spent: '287450.00' } }, block, true, '2026-10-26')!
    expect(over).toMatchObject({ state: 'over', spent: 100, ahead: 0, percent: 144 })
  })

  it('counts the part of the month gone only in the current month', () => {
    expect(monthDone('2026-10', '2026-10-26', true)).toBe(83.87)
    expect(monthDone('2026-02', '2026-02-14', true)).toBe(50)
    expect(monthDone('2026-10', '2026-11-01', true)).toBeNull()
    expect(monthDone('2026-10', '2026-10-26', false)).toBeNull()
  })
})

describe('sums as strings of cents', () => {
  it('writes cents back as a decimal string', () => {
    expect(decimalOf(61255000n)).toBe('612550.00')
    expect(decimalOf(-5n)).toBe('-0.05')
    expect(decimalOf(0n)).toBe('0.00')
  })
  it('rolls from one sum to another in whole cents, ending exactly on the new one', () => {
    expect(rollAt('100.00', '200.00', 0)).toBe('100.00')
    expect(rollAt('100.00', '200.00', 1)).toBe('200.00')
    expect(rollAt('100.00', '200.00', 0.5)).toBe('187.50')
    expect(rollAt('200.00', '100.00', 2)).toBe('100.00')
  })
})
