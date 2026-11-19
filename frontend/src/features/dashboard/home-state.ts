import type { Dashboard, DashboardAttention, DashboardBudget, DashboardCurrency, DashboardGoalsTile, DashboardPaymentsTile, DashboardPlanned, DashboardRecent } from '../../api/budget-types'
import type { Decimal } from '../../api/types'
import type { IconName } from '../../components/Icon'
import { categoryTone } from '../../lib/category-tone'
import { NBSP, glue } from '../../lib/text'
import { cents, deviceDate, formatMoney, formatNumber, plural } from './dashboard-state'
import type { Phrase } from './home-hero'

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

export type AttentionBadge = { icon: IconName; tone: 'over' | 'income' | 'ai' | 'plain' }

/** The picture and the tone of a row of «Требует внимания» by its kind (Чекист 2.0): a payment overdue and a limit at
 * 80 % or beyond — the over tone (the words of the row say so); a missing income — the income tone; the verdict of the
 * assistant on a plan — gold; everything else, and a kind this client does not know — plain. */
export function attentionBadge(kind: DashboardAttention['kind']): AttentionBadge {
  switch (kind) {
    case 'payment_due': return { icon: 'repeat', tone: 'plain' }
    case 'payment_overdue': return { icon: 'repeat', tone: 'over' }
    case 'income_missing': return { icon: 'income', tone: 'income' }
    case 'limit_near': return { icon: 'stats', tone: 'over' }
    case 'limit_over': return { icon: 'stats', tone: 'over' }
    case 'plan_verdict': return { icon: 'insight', tone: 'ai' }
    case 'plans_question': return { icon: 'repeat', tone: 'plain' }
    default: return { icon: 'more', tone: 'plain' }
  }
}

/** «ещё 2» of the rows that did not fit; nothing without them. */
export function attentionMoreText(count: number | undefined): string | null {
  return count && count > 0 ? glue('ещё', String(count)) : null
}

/** The sum of a row of «Требует внимания» and the words under it: the overrun of a limit is «сверх лимита», what is
 * left of a limit — «до лимита»; a payment or a plan is its own sum. No sum — nothing. */
export function attentionAmount(row: DashboardAttention): { money: Decimal; currency: string; caption: string | null; over: boolean } | null {
  if (!row.amount || !row.currency) return null
  if (row.kind === 'limit_over') return { money: row.amount, currency: row.currency, caption: 'сверх лимита', over: true }
  if (row.kind === 'limit_near') return { money: row.amount, currency: row.currency, caption: 'до лимита', over: false }
  return { money: row.amount, currency: row.currency, caption: null, over: false }
}

/** The second line of a row of «Требует внимания» as one sentence (a title, a screen reader): the server sends the words
 * without the money and the money apart (`amount`, `currency`), the client puts them together — the sum first
 * («70 000 ₸ · Срок был 22 октября»), after the words of a limit («Осталось до лимита · 11 500 ₸»); no sum — the words alone. */
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
  /** The big words: «2 из 5», a sum, «62 %». */
  value: Phrase
  /** The small line under them. */
  note: Phrase
  /** The parts of the mini bar: a share each (`flex`) and whether it is filled (ink; a reached goal — gold). */
  bar: { key: string; flex: number; on: boolean }[]
  /** What the drawing says to a screen reader. */
  label: string
  /** Every goal is saved up: a milestone, in gold with the words of the note. */
  reached?: boolean
}

/** «Платежи»: paid of all, what is still waited for, a part of the bar per payment. */
export function paymentsTile(tile: DashboardPaymentsTile | null): TileView {
  if (!tile || tile.total === 0) {
    return { key: 'payments', title: 'Платежи', to: '/recurring', value: ['Нет'], note: ['добавить'], bar: [], label: 'Регулярных платежей в месяце нет' }
  }
  const bar = tile.segments.map((segment, index) => ({ key: String(index), flex: 1, on: segment.paid }))
  const note: Phrase = cents(tile.left) > 0n ? ['ждут ', { money: tile.left, currency: tile.currency }] : ['все оплачены']
  return { key: 'payments', title: 'Платежи', to: '/recurring', value: [`${tile.paid} из ${tile.total}`], note, bar, label: `Оплачено ${tile.paid} из ${tile.total}` }
}

/** «Планы»: what is still waited for, done of all, the plans of the month as parts of the bar (the done ones filled). */
export function plansTile(plans: DashboardPlanned | null, currency: string, month: string): TileView {
  const to = `/planned?month=${month}`
  if (!plans || plans.count === 0) {
    return { key: 'plans', title: 'Планы', to, value: ['Нет'], note: ['без планов'], bar: [], label: 'Планов на месяц нет' }
  }
  const bar = plans.segments.map((segment) => ({ key: String(segment.id), flex: Math.max(centsOf(segment.amount), 0), on: segment.done }))
  return {
    key: 'plans', title: 'Планы', to, value: [{ money: plans.left, currency }],
    note: [`ждём · ${plans.done_count} из ${plans.count}`], bar, label: `План месяца по пунктам, сделано ${plans.done_count} из ${plans.count}`,
  }
}

/** «Цели»: the share saved of every goal, how many and how much. */
export function goalsTile(tile: DashboardGoalsTile | null): TileView {
  if (!tile || tile.count === 0) {
    return { key: 'goals', title: 'Цели', to: '/goals', value: ['Нет целей'], note: ['завести'], bar: [], label: 'Целей нет' }
  }
  const share = shareOf(tile.share)
  const reached = share >= 100
  return {
    key: 'goals', title: 'Цели', to: '/goals', value: [percentText(share)],
    note: reached ? [tile.count === 1 ? 'цель достигнута' : 'все цели достигнуты'] : [`${glue(String(tile.count), plural(tile.count, 'цель', 'цели', 'целей'))} · `, { money: tile.saved, currency: tile.currency }],
    bar: [{ key: 'saved', flex: share, on: true }, { key: 'left', flex: Math.max(0, 100 - share), on: false }],
    label: `Накоплено ${percentText(share)} по всем целям`, reached,
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

/** The words under the bar of a limit (Чекист 2.0, LimitBar): the share, rounded half up, and from 80 % the state in
 * words — «почти лимит», «лимит исчерпан» exactly at it, «сверх лимита»; the over tone goes with the words, never alone. No limit — none. */
export function limitState(spent: Decimal, limit: Decimal | null): { percent: number; state: 'calm' | 'near' | 'over'; words: string } | null {
  if (limit === null || cents(limit) <= 0n) return null
  const total = cents(limit)
  const used = cents(spent)
  const percent = used <= 0n ? 0 : Number((used * 200n + total) / (total * 2n))
  const state = used > total ? 'over' : percent >= 80 ? 'near' : 'calm'
  return { percent, state, words: state === 'over' ? 'сверх лимита' : used === total ? 'лимит исчерпан' : state === 'near' ? 'почти лимит' : '' }
}

/** «92 % · 112 000 из 120 000» of a limit row as one sentence (a title, a screen reader); without a limit — what was spent. */
export function limitLine(spent: Decimal, limit: Decimal | null, currency: string): { text: string; over: boolean } {
  if (limit === null || cents(limit) <= 0n) return { text: formatMoney(spent, currency), over: false }
  const total = cents(limit)
  const used = cents(spent)
  const percent = used <= 0n ? 0 : Number((used * 200n + total) / (total * 2n))
  return { text: `${percentText(percent)} · ${formatNumber(spent)} из ${formatMoney(limit, currency)}`, over: used > total }
}
