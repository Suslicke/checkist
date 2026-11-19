import type { Money, MoneyMonth, MoneyReview } from '../../api/money'
import type { ThreadSummary } from '../../api/chat'
import type { LocalApiFailure } from '../../api/types'
import type { IconName } from '../../components/Icon'
import { formatMoney } from '../../lib/money'
import { glue } from '../../lib/text'
import { cents, dayAndMonth, dashboardErrorMessage, inMonth, plural, shiftMonth } from '../dashboard/dashboard-state'
import { centsOf, percentText, shareOf } from '../dashboard/home-state'
import { threadTitle } from '../chat/chat-state'

/** The words and the shares of «Деньги» (2026-10-26, Чекист 2.0 2026-11-20): the server counts the money, this file turns it into sentences
 * and widths. No network, no React. */

const nominative = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const nominativeLower = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
const shortMonths = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

/** «Октябрь» of the eyebrow; «Октябрь 2025» when the year is not the year of `today`. */
export function monthName(month: string, today?: string): string {
  const name = nominative[Number(month.slice(5, 7)) - 1]
  return today && today.slice(0, 4) !== month.slice(0, 4) ? glue(name, month.slice(0, 4)) : name
}
/** «за октябрь». */
export const forMonth = (month: string) => glue('за', nominativeLower[Number(month.slice(5, 7)) - 1])

/** One line of the flow of the month under the strip: its key (the swatch of the strip), its words and its amount.
 * `amount` null — not entered (the income), the words say so. */
export type FlowRow = {
  key: 'income' | 'spent' | 'payments' | 'plans' | 'aside'
  label: string
  amount: string | null
  /** The income in its colour with «+»; the rest in ink. */
  income?: boolean
}

/** The lines of the card of the month: what came in, what went out, what is still ahead, what was put aside. */
export function flowRows(data: Money): FlowRow[] {
  return [
    { key: 'income', label: 'Доход', amount: data.income, income: true },
    { key: 'spent', label: 'Потрачено', amount: data.spent },
    { key: 'payments', label: 'Платежи впереди', amount: data.flow.payments_ahead },
    { key: 'plans', label: 'Планы впереди', amount: data.flow.plans_ahead },
    { key: 'aside', label: 'Отложено в цели', amount: data.set_aside },
  ]
}

export type FlowPart = { key: 'spent' | 'payments' | 'plans' | 'free'; flex: number }
export type Flow = {
  parts: FlowPart[]
  /** The main figure of the card: «Свободно» (the free sum), «Перерасход» (below zero, the sum without its minus, in the
   * colour of an overspend with words) or «Потрачено» when there is nothing to count the free sum from. */
  figure: { label: string; amount: string; over: boolean; note: string | null }
  /** What a screen reader hears for the strip. */
  label: string
}

/** The amount without its minus: «-2500.00» → «2500.00». */
const unsigned = (value: string) => value.replace(/^-/, '')

/** The strip of the month: what is spent, the payments and the plans ahead, what is free. Below zero there is no free
 * part and the figure says «Перерасход»; null (neither an income nor a budget) — the three parts and «Потрачено». */
export function flowOf(data: Money): Flow {
  const { flow } = data
  const free = flow.free === null ? null : cents(flow.free)
  const parts: FlowPart[] = [
    { key: 'spent', flex: Math.max(0, centsOf(flow.spent)) },
    { key: 'payments', flex: Math.max(0, centsOf(flow.payments_ahead)) },
    { key: 'plans', flex: Math.max(0, centsOf(flow.plans_ahead)) },
  ]
  if (free !== null && free > 0n) parts.push({ key: 'free', flex: Number(free) })
  const over = free !== null && free < 0n
  const money = (value: string) => formatMoney(value, data.currency)
  const words = [`потрачено ${money(flow.spent)}`, `платежи впереди ${money(flow.payments_ahead)}`, `планы впереди ${money(flow.plans_ahead)}`]
  if (free !== null) words.push(over ? `перерасход ${money(unsigned(flow.free as string))}` : `свободно ${money(flow.free as string)}`)
  return {
    parts: parts.filter((part) => part.flex > 0),
    figure: free === null
      ? { label: 'Потрачено', amount: flow.spent, over: false, note: 'Внесите доход месяца или задайте бюджет — посчитаю, сколько свободно.' }
      : over
        ? { label: 'Перерасход', amount: unsigned(flow.free as string), over: true, note: 'Траты, платежи и планы больше дохода месяца.' }
        : { label: 'Свободно', amount: flow.free as string, over: false, note: null },
    label: `Поток месяца: ${words.join(', ')}`,
  }
}

/** An amount of a tile: drawn by `Money`, the income in its colour with «+». */
export type TileAmount = { value: string; currency: string; income?: boolean }

export type HubTile = {
  key: 'incomes' | 'payments' | 'plans' | 'goals'
  title: string
  icon: IconName
  /** The tone of the picture: a category tone (1–6) or `in` for the income. */
  tone: 'in' | number
  to: string
  /** The figure of the tile: an amount, or words when there is none («Не внесён», «52 %», «Все оплачены»). */
  amount: TileAmount | null
  value: string | null
  note: string
  /** The words of the note that need the colour of an overspend («просрочен на 3 дня»): drawn after the note. */
  alert?: string
  /** The share saved of all the goals, as the width of the bar under the figure. */
  bar?: number
}

/** «Доходы»: the income of the month, or that it is not entered (the figure says so, the note names the month). */
export function incomesTile(data: Money): HubTile {
  const entered = data.income !== null
  return {
    key: 'incomes', title: 'Доходы', icon: 'income', tone: 'in', to: `/incomes?month=${data.month}`,
    amount: entered ? { value: data.income as string, currency: data.currency, income: true } : null,
    value: entered ? null : 'Не внесён', note: forMonth(data.month),
  }
}

/** «через 2 дня», «сегодня», «просрочен на 3 дня». */
export function dueWords(days: number): string {
  if (days === 0) return 'сегодня'
  if (days < 0) return glue('просрочен на', String(-days), plural(-days, 'день', 'дня', 'дней'))
  return glue('через', String(days), plural(days, 'день', 'дня', 'дней'))
}

/** «Платежи»: what still waits, paid of all and the nearest one; an overdue one in the colour of an overspend. */
export function paymentsTile(data: Money): HubTile {
  const { payments } = data
  const base = { key: 'payments', title: 'Платежи', icon: 'repeat', tone: 2, to: '/recurring' } as const
  if (payments.total === 0) return { ...base, amount: null, value: 'Нет', note: 'добавить регулярный' }
  const count = `${payments.paid} из ${payments.total} оплачено`
  const next = payments.next
  const left = cents(payments.left) > 0n
  const amount = left ? { value: payments.left, currency: data.currency } : null
  if (next && next.days < 0) return { ...base, amount, value: left ? null : 'Все оплачены', note: count, alert: `${next.name} ${dueWords(next.days)}` }
  return { ...base, amount, value: left ? null : 'Все оплачены', note: [count, next ? `${next.name} ${dueWords(next.days)}` : null].filter(Boolean).join(' · ') }
}

/** «Планы»: what still waits, «ждём · N без срока». */
export function plansTile(data: Money): HubTile {
  const { plans } = data
  const base = { key: 'plans', title: 'Планы', icon: 'box', tone: 4, to: `/planned?month=${data.month}` } as const
  if (!plans || (plans.count === 0 && plans.undated_count === 0)) return { ...base, amount: null, value: 'Нет', note: 'пока без планов' }
  const undated = plans.undated_count > 0 ? glue(String(plans.undated_count), 'без срока') : null
  return { ...base, amount: { value: plans.left, currency: data.currency }, value: null, note: ['ждём', undated].filter(Boolean).join(' · ') }
}

/** «Цели»: the share saved with its bar and the two first goals with their shares. */
export function goalsTile(data: Money): HubTile {
  const { goals } = data
  const base = { key: 'goals', title: 'Цели', icon: 'goal', tone: 3, to: '/goals' } as const
  if (!goals || goals.count === 0) return { ...base, amount: null, value: 'Нет целей', note: 'завести' }
  const share = shareOf(goals.share)
  const top = goals.top.slice(0, 2).map((goal) => `«${goal.name}» ${percentText(shareOf(goal.share))}`)
  const note = top.length ? top.join(' · ') : `${glue(String(goals.count), plural(goals.count, 'цель', 'цели', 'целей'))} · ${formatMoney(goals.saved, goals.currency)}`
  return { ...base, amount: null, value: percentText(share), note, bar: Math.max(0, Math.min(100, share)) }
}

export type Column = { month: string; height: number; now: boolean; label: string; spent: string }

/** The six mini columns of «Статистика»: per cent of the biggest month, the shown month marked. */
export function columnsOf(months: MoneyMonth[], shown: string): Column[] {
  const largest = Math.max(0, ...months.map((item) => centsOf(item.spent)))
  return months.map((item) => ({
    month: item.month, now: item.month === shown, label: shortMonths[Number(item.month.slice(5, 7)) - 1], spent: item.spent,
    height: largest > 0 ? Math.max(centsOf(item.spent) > 0 ? 4 : 2, Math.round((Math.max(0, centsOf(item.spent)) / largest) * 100)) : 2,
  }))
}

/** «октябрь пока ниже среднего» of the shown month against the average of the months before it; «первый месяц» when
 * there is nothing to compare with. A past month says «ниже среднего» without «пока». */
export function statsNote(months: MoneyMonth[], shown: string, current: boolean): string {
  const name = nominativeLower[Number(shown.slice(5, 7)) - 1]
  const own = months.find((item) => item.month === shown)
  const before = months.filter((item) => item.month < shown && cents(item.spent) > 0n)
  if (!own || !before.length) return before.length ? name : 'первый месяц'
  const average = before.reduce((sum, item) => sum + cents(item.spent), 0n) / BigInt(before.length)
  const spent = cents(own.spent)
  const word = spent < average ? 'ниже среднего' : spent > average ? 'выше среднего' : 'как в среднем'
  return `${name} ${current ? 'пока ' : ''}${word}`
}

/** What a screen reader hears for the six columns: «Траты по месяцам: июнь 572 793,76 ₸, …». */
export function columnsLabel(columns: Column[], currency: string): string {
  return `Траты по месяцам: ${columns.map((column) => `${nominativeLower[Number(column.month.slice(5, 7)) - 1]} ${formatMoney(column.spent, currency)}`).join(', ')}`
}

/** «на 34 375,02 ₸ меньше, чем в сентябре · 2 совета» of the last review: `change_previous` is the difference of the
 * spends of its month against the month before, an amount in the base currency (docs/api-contract.md «Деньги»). */
export function reviewNote(review: MoneyReview, currency: string): string {
  const parts: string[] = []
  if (review.change_previous !== null) {
    const change = cents(review.change_previous)
    const before = inMonth(shiftMonth(review.month, -1))
    parts.push(change === 0n ? `как ${before}`
      : `на ${formatMoney(review.change_previous.replace(/^-/, ''), currency)} ${change < 0n ? 'меньше' : 'больше'}, чем ${before}`)
  }
  parts.push(glue(String(review.tips), plural(review.tips, 'совет', 'совета', 'советов')))
  return parts.join(' · ')
}

export type ReviewRow = { to: string; title: string; note: string }

/** «Разбор за октябрь»: the last review of the month before, or the invitation to ask for one. */
export function reviewRow(data: Money): ReviewRow {
  const { review } = data
  if (!review) {
    const before = shiftMonth(data.month, -1)
    return { to: `/review?month=${before}`, title: `Разбор ${forMonth(before)}`, note: 'запросить — итоги месяца и советы' }
  }
  return { to: `/review?month=${review.month}`, title: `Разбор ${forMonth(review.month)}`, note: reviewNote(review, data.currency) }
}

/** The four tiles of the hub: incomes, payments, plans, goals. */
export function hubTiles(data: Money): HubTile[] {
  return [incomesTile(data), paymentsTile(data), plansTile(data), goalsTile(data)]
}

/** The last thread of the chat for the card: its name and the start of the model's last answer. */
export function lastThread(threads: ThreadSummary[]): { id: number; title: string; preview: string } | null {
  const [thread] = threads
  if (!thread) return null
  return { id: thread.id, title: threadTitle(thread), preview: thread.last_answer_preview?.trim() || 'Пока без ответа' }
}

/** «12 октября» of a day. */
export { dayAndMonth }

/** Local texts only: a server message never reaches the screen. */
export function moneyErrorMessage(failure: Pick<LocalApiFailure, 'reason'>): string {
  return dashboardErrorMessage(failure).replace('траты месяца', 'деньги месяца')
}
