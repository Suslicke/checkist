import type { Money } from '../../api/money'
import type { Dashboard, DashboardBudget, DashboardCurrency } from '../../api/budget-types'
import type { Decimal } from '../../api/types'
import { glue } from '../../lib/text'
import { HOME_FIGURES } from './home-figure'
import type { HomeFigure } from './home-figure'
import { allowanceView, cents, compareMonths, daysLeftText, formatMoney, inMonth, plural } from './dashboard-state'

/** The one main number of «Главная» (Чекист 2.0) and the line under it. Every sum comes from the server as it is; the
 * client only subtracts two of them («Осталось» = the budget minus what was spent) in cents, never through a Number.
 * No network, no React: the screen draws what these functions return. */

/** A piece of a sentence: words, or a sum drawn by `Money` (a sentence read aloud takes `formatMoney`). */
export type Part = string | { money: Decimal; currency: string; over?: boolean }
/** A sentence of parts; the hero joins several of them with « · ». */
export type Phrase = Part[]

/** «Свободно» comes from `GET /api/money/` (`flow.free`), asked only while it is the chosen number. */
export type FreeState = { kind: 'loading' } | { kind: 'error' } | { kind: 'ok'; data: Money }

export type HeroView = {
  /** The number actually shown: the chosen one, or «Потрачено» when the chosen one cannot be shown for this month. */
  shown: HomeFigure
  label: string
  /** null — still loading («Свободно» before its answer). */
  value: Decimal | null
  currency: string
  /** Beyond the budget or the income: the over tone, and the label says so in words. */
  over: boolean
  sub: Phrase[]
  /** Why the chosen number is not the one shown («Осталось — бюджет месяца не задан»); none when it is. */
  note: string | null
  /** How the day allowance was counted, as a sentence (a tooltip of the line under the number); none without it. */
  title?: string
}

const accusative = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
/** «на ноябрь». */
export const forMonth = (month: string) => glue('на', accusative[Number(month.slice(5, 7)) - 1])

/** A decimal string of cents: the client never writes a sum through a Number. */
export function decimalOf(value: bigint): Decimal {
  const negative = value < 0n
  const absolute = negative ? -value : value
  return `${negative ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`
}

/** The month budget in the currency of the block, when there is a positive one. */
export function budgetOf(data: Dashboard, block: DashboardCurrency): DashboardBudget | null {
  return data.budget && data.budget.currency === block.currency && cents(data.budget.amount) > 0n ? data.budget : null
}

/** Why an option of «Главное число» cannot be shown in this month, in the words of the setting; none — it can. */
export function figureReasons(data: Dashboard, block: DashboardCurrency | undefined, current: boolean, free?: FreeState): Partial<Record<HomeFigure, string>> {
  const reasons: Partial<Record<HomeFigure, string>> = {}
  if (!block || !budgetOf(data, block)) reasons.left = 'Бюджет месяца не задан'
  if (free?.kind === 'error') reasons.free = 'Не удалось загрузить — повторите позже'
  else if (free?.kind === 'ok' && free.data.flow.free === null) reasons.free = 'Нет дохода и бюджета месяца'
  if (!current) reasons.daily = 'Только для текущего месяца'
  else if (!block || !data.allowance || data.allowance.currency !== block.currency) reasons.daily = 'Нет бюджета и дохода месяца'
  return reasons
}

const labelOf = (figure: HomeFigure) => HOME_FIGURES.find((option) => option.value === figure)?.label ?? ''

const money = (value: Decimal, currency: string, over = false): Part => over ? { money: value, currency, over } : { money: value, currency }

/** The line under «Потрачено»: the budget (or the overspend), the days left and the day allowance of the current month;
 * a past month compares itself with the month before; without a budget — the average day. */
function spentSub(data: Dashboard, block: DashboardCurrency, current: boolean): Phrase[] {
  const budget = budgetOf(data, block)
  const sub: Phrase[] = []
  if (budget) {
    const over = cents(block.spent) - cents(budget.amount)
    sub.push(over > 0n ? ['сверх бюджета на ', money(decimalOf(over), budget.currency, true)] : ['из ', money(budget.amount, budget.currency), ' бюджета'])
  }
  if (current) {
    if (data.days_left > 0) sub.push([daysLeftText(data.days_left)])
    const allowance = data.allowance
    if (allowance && allowance.currency === block.currency && allowance.per_day !== null) sub.push([money(allowance.per_day, allowance.currency), ' в день'])
    else if (!budget && data.average_day && cents(data.average_day) > 0n) sub.push(['средний день ', money(data.average_day, block.currency)])
  } else {
    const comparison = compareMonths(block.spent, block.previous_spent, data.previous_month)
    if (comparison) sub.push([comparison.text])
  }
  return sub
}

/** The main number of the month for the chosen figure; a figure this month cannot show falls back to «Потрачено». */
export function heroOf({ data, block, figure, current, free }: {
  data: Dashboard; block: DashboardCurrency; figure: HomeFigure; current: boolean; free?: FreeState
}): HeroView {
  const reasons = figureReasons(data, block, current, free)
  const reason = reasons[figure]
  const allowance = current && data.allowance && data.allowance.currency === block.currency ? data.allowance : null
  const title = allowance ? allowanceView(allowance).note : undefined
  const spent: HeroView = {
    shown: 'spent', label: `Потрачено ${inMonth(data.month)}`, value: block.spent, currency: block.currency, over: false,
    sub: spentSub(data, block, current), note: null, ...(allowance && allowance.per_day !== null ? { title } : {}),
  }
  if (figure === 'spent') return spent
  if (reason) return { ...spent, note: `${labelOf(figure)}: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}` }
  const days: Phrase[] = current && data.days_left > 0 ? [[daysLeftText(data.days_left)]] : []
  if (figure === 'left') {
    const budget = budgetOf(data, block) as DashboardBudget
    const rest = cents(budget.amount) - cents(block.spent)
    const over = rest < 0n
    return {
      shown: 'left', label: over ? `Сверх бюджета ${inMonth(data.month)}` : `Осталось ${forMonth(data.month)}`,
      value: decimalOf(over ? -rest : rest), currency: block.currency, over,
      sub: [['потрачено ', money(block.spent, block.currency), ' из ', money(budget.amount, budget.currency)], ...days], note: null,
    }
  }
  if (figure === 'free') {
    if (!free || free.kind !== 'ok') return { shown: 'free', label: `Свободно ${inMonth(data.month)}`, value: null, currency: block.currency, over: false, sub: [], note: null }
    const answer = free.data
    const value = answer.flow.free as Decimal
    const over = cents(value) < 0n
    const basis: Phrase = answer.income !== null && cents(answer.income) > 0n ? ['доход ', money(answer.income, answer.currency), ' минус траты, платежи и планы'] : ['бюджет минус траты, платежи и планы']
    return {
      shown: 'free', label: over ? `Не хватает ${inMonth(data.month)}` : `Свободно ${inMonth(data.month)}`,
      value: decimalOf(over ? -cents(value) : cents(value)), currency: answer.currency, over, sub: [basis, ...days], note: null,
    }
  }
  const day = allowance!
  const basis = day.basis === 'income' ? 'доход' : 'бюджет'
  if (day.per_day === null) {
    return {
      shown: 'daily', label: 'Перерасход', value: day.overspent ?? '0.00', currency: day.currency, over: true,
      sub: [[`траты, платежи и планы больше, чем ${basis} `, money(day.amount, day.currency)], ...days], note: null, title,
    }
  }
  return {
    shown: 'daily', label: 'Можно тратить в день', value: day.per_day, currency: day.currency, over: false,
    sub: [[`${basis} `, money(day.amount, day.currency), ` минус траты, платежи и планы, поровну на ${glue(String(day.days_left), plural(day.days_left, 'день', 'дня', 'дней'))}`]],
    note: null, title,
  }
}

/** The part of the month gone at the end of `date`, 0–100 (the mark of today on a bar); null — not the current month. */
export function monthDone(month: string, date: string, current: boolean): number | null {
  if (!current || date.slice(0, 7) !== month) return null
  const days = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()
  return Math.round((Number(date.slice(8, 10)) / days) * 10000) / 100
}

export type Pace = {
  /** 0–100: spent of the budget, a full bar beyond it. */
  spent: number
  /** 0–100: the open payments and plans of the month, after what was spent (never past the end of the bar). */
  ahead: number
  /** The open payments and plans in money; null — none or not the current month. */
  aheadAmount: Decimal | null
  /** 0–100: the part of the month gone, at the end of today; null — a past month. */
  today: number | null
  state: 'calm' | 'near' | 'over'
  /** The share of the budget spent, a whole per cent, rounded half up. */
  percent: number
}

/** The bar of the budget under the main number: what was spent, the payments and plans ahead, where today is. */
export function paceOf(data: Dashboard, block: DashboardCurrency, current: boolean, date: string): Pace | null {
  const budget = budgetOf(data, block)
  if (!budget) return null
  const total = cents(budget.amount)
  const used = cents(block.spent) > 0n ? cents(block.spent) : 0n
  const percent = Number((used * 200n + total) / (total * 2n))
  const spent = Math.min(100, Number((used * 10000n) / total) / 100)
  const allowance = current && data.allowance && data.allowance.currency === block.currency ? data.allowance : null
  const ahead = allowance ? cents(allowance.unpaid) + (allowance.planned ? cents(allowance.planned) : 0n) : 0n
  const aheadShare = ahead > 0n ? Math.min(100 - spent, Number((ahead * 10000n) / total) / 100) : 0
  const today = monthDone(data.month, date, current)
  return {
    spent, ahead: aheadShare, aheadAmount: ahead > 0n ? decimalOf(ahead) : null, today,
    state: used > total ? 'over' : percent >= 80 ? 'near' : 'calm', percent,
  }
}

/** What the bar says to a screen reader: «Потрачено 73 % бюджета, платежи и планы впереди 22 %, прошло 67 % месяца». */
export function paceLabel(pace: Pace): string {
  const round = (value: number) => Math.round(value)
  return [
    `Потрачено ${pace.percent}\u00a0% бюджета`,
    pace.ahead > 0 ? `платежи и планы впереди ${round(pace.ahead)}\u00a0%` : null,
    pace.today !== null ? `прошло ${round(pace.today)}\u00a0% месяца` : null,
  ].filter(Boolean).join(', ')
}

/** A phrase as one string, for a title or a screen reader: the sums as `formatMoney` writes them. */
export function phraseText(phrase: Phrase): string {
  return phrase.map((part) => typeof part === 'string' ? part : formatMoney(part.money, part.currency)).join('')
}
