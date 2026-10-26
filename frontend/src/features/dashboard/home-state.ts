import type { Dashboard, DashboardAllowance, DashboardAttention, DashboardBudget, DashboardCurrency, DashboardGoalsTile, DashboardPaymentsTile, DashboardPlanned, DashboardRecent } from '../../api/budget-types'
import type { Decimal } from '../../api/types'
import type { IconName } from '../../components/Icon'
import { categoryTone } from '../../lib/category-tone'
import { NBSP, glue } from '../../lib/text'
import { allowanceView, cents, daysLeftText, deviceDate, formatMoney, formatNumber, plural } from './dashboard-state'

/** The words and the shares of the home of 2026-10-26 (the ring, the pulse, «Требует внимания», the tiles, «Сегодня и
 * вчера»): the server counts the money, this file turns it into legends and sentences. No network, no React. */

/** The fields of the home of 2026-10-26 are there: an older server sends none, and the hero is drawn without the pulse. */
export function hasPulse(data: Dashboard): boolean {
  return Object.hasOwn(data, 'by_day') && Array.isArray(data.by_day) && data.by_day.length > 0
}

/** How many legend rows the ring carries beside itself; the rest is «ещё N». */
export const LEGEND_ROWS = 4

export type LegendRow = { key: string; name: string; tone: number; amount: Decimal; categoryId: number | null }
export type Legend = {
  /** The rows beside the ring, biggest first (the order of the server). */
  rows: LegendRow[]
  /** Categories with spends that did not fit the rows. */
  more: number
  /** Every category with spends, for the ring itself. */
  all: LegendRow[]
  /** What is left of the budget in cents; null without a budget. Below zero — the budget is overspent. */
  remainder: bigint | null
}

/** The categories of the month with something spent, as rows of the legend and segments of the ring. */
export function legendOf(block: DashboardCurrency, budget: DashboardBudget | null | undefined): Legend {
  const all = block.categories.filter((category) => cents(category.spent) > 0n).map((category) => ({
    key: category.category_id === null ? `none-${category.name}` : String(category.category_id),
    name: category.name, tone: categoryTone(category.category_id), amount: category.spent, categoryId: category.category_id,
  }))
  const remainder = budget && budget.currency === block.currency && cents(budget.amount) > 0n ? cents(budget.amount) - cents(block.spent) : null
  return { rows: all.slice(0, LEGEND_ROWS), more: Math.max(0, all.length - LEGEND_ROWS), all, remainder }
}

/** Cents as a plain number for the geometry of a drawing (never shown as money). */
export const centsOf = (value: Decimal | bigint) => Number(typeof value === 'bigint' ? value : cents(value))

/** «14» of «14 % бюджета»: spent of the budget, rounded half up; null without a positive budget. */
export function budgetShare(spent: Decimal, budget: DashboardBudget | null | undefined): number | null {
  if (!budget) return null
  const total = cents(budget.amount)
  if (total <= 0n) return null
  const used = cents(spent)
  if (used <= 0n) return 0
  return Number((used * 200n + total) / (total * 2n))
}

/** «14 %» with a thin, unbreakable space. */
export const percentText = (value: number) => `${value}${NBSP}%`

const shortMonths = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

/** «1 окт» of the first day of the month. */
export function firstDayText(month: string): string {
  return glue('1', shortMonths[Number(month.slice(5, 7)) - 1])
}

/** The number of days of a month, from its days when the server sent them, else from the calendar. */
export function daysInMonth(month: string, days?: readonly { day: string }[]): number {
  if (days && days.length) return days.length
  return new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()
}

/** The captions under the pulse: «1 окт», «сегодня 26 · средний день 4 900 ₸» (a past month — only the average), «31». */
export function pulseCaption(data: Dashboard, currency: string, today: string | undefined): { start: string; middle: { today: string | null; average: string | null }; end: string } {
  const average = data.average_day && cents(data.average_day) > 0n ? `средний день ${formatMoney(data.average_day, currency)}` : null
  return {
    start: firstDayText(data.month),
    middle: { today: today ? glue('сегодня', String(Number(today.slice(8, 10)))) : null, average },
    end: String(daysInMonth(data.month, data.by_day)),
  }
}

/** The date of the device when it is inside the month shown; a past month has no today. */
export function todayIn(month: string, date: string = deviceDate()): string | undefined {
  return date.slice(0, 7) === month ? date : undefined
}

export type HeroFoot = {
  /** «из 900 000 ₸ · ещё 6 дней» on the left; «Сверх бюджета на …» takes the overspend colour. */
  left: string[]; leftOver: boolean
  /** «в день 97 917 ₸» on the right with how it was counted as a title; «Перерасход …» in the overspend colour. */
  right: { label: string; amount: string; over: boolean; title: string | null } | null
}

/** The line of the hero: the budget, the days left and the day allowance (or the average day without a budget). */
export function heroFoot(data: Dashboard, block: DashboardCurrency, current: boolean): HeroFoot {
  const budget = data.budget && data.budget.currency === block.currency && cents(data.budget.amount) > 0n ? data.budget : null
  const left: string[] = []
  let leftOver = false
  if (budget) {
    const over = cents(block.spent) - cents(budget.amount)
    if (over > 0n) { left.push(`Сверх бюджета на ${formatMoney(over, budget.currency)}`); leftOver = true } else left.push(`из ${formatMoney(budget.amount, budget.currency)}`)
  }
  if (current && data.days_left > 0) left.push(daysLeftText(data.days_left))
  const allowance: DashboardAllowance | null | undefined = current ? data.allowance : null
  let right: HeroFoot['right'] = null
  if (allowance && allowance.currency === block.currency) {
    const view = allowanceView(allowance)
    right = { label: view.over ? 'Перерасход' : 'в день', amount: formatMoney(view.amount, allowance.currency), over: view.over, title: view.note }
  } else if (!budget && data.average_day && cents(data.average_day) > 0n) {
    right = { label: 'средний день', amount: formatMoney(data.average_day, block.currency), over: false, title: null }
  }
  return { left, leftOver, right }
}

export type AttentionBadge = { icon: IconName; tone: 'warn' | 'over' | 'success' | 'ai' | 'plain' }

/** The picture and the colour of a row of «Требует внимания» by its kind; a kind this client does not know — plain. */
export function attentionBadge(kind: DashboardAttention['kind']): AttentionBadge {
  switch (kind) {
    case 'payment_due': return { icon: 'repeat', tone: 'warn' }
    case 'payment_overdue': return { icon: 'repeat', tone: 'over' }
    case 'income_missing': return { icon: 'income', tone: 'success' }
    case 'limit_near': return { icon: 'stats', tone: 'warn' }
    case 'limit_over': return { icon: 'stats', tone: 'over' }
    case 'plan_verdict': case 'plans_question': return { icon: 'insight', tone: 'ai' }
    default: return { icon: 'more', tone: 'plain' }
  }
}

/** «ещё 2» of the rows that did not fit; nothing without them. */
export function attentionMoreText(count: number | undefined): string | null {
  return count && count > 0 ? glue('ещё', String(count)) : null
}

/** The second line of a row of «Требует внимания»: the server sends the words without the money and the money apart
 * (`amount`, `currency`), the client puts them together — the sum first («70 000 ₸ · Срок был 22 октября»), after the
 * words of a limit («Осталось до лимита · 11 500 ₸», «120 % лимита · 20 000 ₸»); no sum — the words alone. */
export function attentionMeta(row: DashboardAttention): string {
  const money = row.amount && row.currency ? formatMoney(row.amount, row.currency) : null
  if (!money) return row.meta
  const parts = row.kind === 'limit_over' || row.kind === 'limit_near' ? [row.meta, money] : [money, row.meta]
  return parts.filter(Boolean).join(' · ')
}

/** The rows of «Требует внимания»; none (or an older server) — no card. */
export function attentionRows(data: Dashboard): DashboardAttention[] {
  return Object.hasOwn(data, 'attention') && Array.isArray(data.attention) ? data.attention : []
}

export type TileView = {
  key: 'payments' | 'plans' | 'goals'
  title: string
  to: string
  /** The big words: «2 из 5», «185 000 ₸», «62 %». */
  value: string
  /** The small line under them. */
  note: string
  /** The parts of the mini bar: a share each (`flex`) and whether it is filled. `tone` — the colour (0 — the track). */
  bar: { key: string; flex: number; on: boolean; tone: number }[]
  /** What the drawing says to a screen reader. */
  label: string
}

/** «Платежи»: paid of all, what is still waited for, a part of the bar per payment. */
export function paymentsTile(tile: DashboardPaymentsTile | null): TileView {
  if (!tile || tile.total === 0) {
    return { key: 'payments', title: 'Платежи', to: '/recurring', value: 'Нет', note: 'добавить', bar: [], label: 'Регулярных платежей в месяце нет' }
  }
  const bar = tile.segments.map((segment, index) => ({ key: String(index), flex: 1, on: segment.paid, tone: 2 }))
  const note = cents(tile.left) > 0n ? `ждут ${formatMoney(tile.left, tile.currency)}` : 'все оплачены'
  return { key: 'payments', title: 'Платежи', to: '/recurring', value: `${tile.paid} из ${tile.total}`, note, bar, label: `Оплачено ${tile.paid} из ${tile.total}` }
}

/** «Планы»: what is still waited for, done of all, the plans of the month as parts of the bar (the done ones filled). */
export function plansTile(plans: DashboardPlanned | null, currency: string, month: string): TileView {
  const to = `/planned?month=${month}`
  if (!plans || plans.count === 0) {
    return { key: 'plans', title: 'Планы', to, value: 'Нет', note: 'без планов', bar: [], label: 'Планов на месяц нет' }
  }
  const bar = plans.segments.map((segment) => ({ key: String(segment.id), flex: Math.max(centsOf(segment.amount), 0), on: segment.done, tone: categoryTone(segment.category_id) || 4 }))
  return {
    key: 'plans', title: 'Планы', to, value: formatMoney(plans.left, currency),
    note: `ждём · ${plans.done_count} из ${plans.count}`, bar, label: `План месяца по пунктам, сделано ${plans.done_count} из ${plans.count}`,
  }
}

/** «Цели»: the share saved of every goal, how many and how much. */
export function goalsTile(tile: DashboardGoalsTile | null): TileView {
  if (!tile || tile.count === 0) {
    return { key: 'goals', title: 'Цели', to: '/goals', value: 'Нет целей', note: 'завести', bar: [], label: 'Целей нет' }
  }
  const share = shareOf(tile.share)
  return {
    key: 'goals', title: 'Цели', to: '/goals', value: percentText(share),
    note: `${glue(String(tile.count), plural(tile.count, 'цель', 'цели', 'целей'))} · ${formatMoney(tile.saved, tile.currency)}`,
    bar: [{ key: 'saved', flex: share, on: true, tone: 3 }, { key: 'left', flex: Math.max(0, 100 - share), on: false, tone: 0 }],
    label: `Накоплено ${percentText(share)} по всем целям`,
  }
}

/** A share of 0–100 from a decimal string or a number, rounded to a whole, kept inside the range. */
export function shareOf(value: Decimal | number): number {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return 0
  return Math.min(100, Math.max(0, Math.round(number)))
}

/** The three tiles; none without the field of the server (an older one). */
export function tilesOf(data: Dashboard, currency: string): TileView[] | null {
  if (!Object.hasOwn(data, 'tiles') || !data.tiles) return null
  return [paymentsTile(data.tiles.payments), plansTile(data.tiles.plans, currency, data.month), goalsTile(data.tiles.goals)]
}

/** The day before `date`, as the device counts calendar days. */
export function yesterdayOf(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  return deviceDate(new Date(year, month - 1, day - 1))
}

export type RecentView = { title: string; items: DashboardRecent[]; empty: boolean }

/** «Сегодня и вчера» of the current month: the latest spends of today and yesterday; a past month — its last three. */
export function recentView(recent: DashboardRecent[], month: string, date: string = deviceDate()): RecentView {
  if (date.slice(0, 7) !== month) {
    const items = recent.slice(0, 3)
    return { title: 'Последние траты', items, empty: items.length === 0 }
  }
  const days = new Set([date, yesterdayOf(date)])
  const items = recent.filter((item) => days.has(item.purchased_on))
  return { title: 'Сегодня и вчера', items, empty: items.length === 0 }
}

/** «92 % · 112 000 из 120 000» of a limit row; without a limit — what was spent. */
export function limitLine(spent: Decimal, limit: Decimal | null, currency: string): { text: string; over: boolean } {
  if (limit === null || cents(limit) <= 0n) return { text: formatMoney(spent, currency), over: false }
  const total = cents(limit)
  const used = cents(spent)
  const percent = used <= 0n ? 0 : Number((used * 200n + total) / (total * 2n))
  return { text: `${percentText(percent)} · ${formatNumber(spent)} из ${formatMoney(limit, currency)}`, over: used > total }
}
