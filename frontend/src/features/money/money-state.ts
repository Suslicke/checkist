import type { Money, MoneyMonth, MoneyReview } from '../../api/money'
import type { ThreadSummary } from '../../api/chat'
import type { LocalApiFailure } from '../../api/types'
import type { IconName } from '../../components/Icon'
import { formatCents, formatMoney } from '../../lib/money'
import { glue } from '../../lib/text'
import { cents, dayAndMonth, dashboardErrorMessage, inMonth, plural } from '../dashboard/dashboard-state'
import { centsOf, percentText, shareOf } from '../dashboard/home-state'
import { threadTitle } from '../chat/chat-state'

/** The words and the shares of «Деньги» (2026-10-26): the server counts the money, this file turns it into sentences
 * and widths. No network, no React. */

const nominative = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const nominativeLower = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
const dative = ['январю', 'февралю', 'марту', 'апрелю', 'маю', 'июню', 'июлю', 'августу', 'сентябрю', 'октябрю', 'ноябрю', 'декабрю']

/** «Октябрь» of the eyebrow; «Октябрь 2025» when the year is not the year of `today`. */
export function monthName(month: string, today?: string): string {
  const name = nominative[Number(month.slice(5, 7)) - 1]
  return today && today.slice(0, 4) !== month.slice(0, 4) ? glue(name, month.slice(0, 4)) : name
}
/** «за октябрь». */
export const forMonth = (month: string) => glue('за', nominativeLower[Number(month.slice(5, 7)) - 1])

export type Summary = { income: string | null; spent: string; setAside: string }

/** The three sums of the card of the month; the income may be not entered. */
export function summaryOf(data: Money): Summary {
  return {
    income: data.income === null ? null : formatMoney(data.income, data.currency),
    spent: formatMoney(data.spent, data.currency), setAside: formatMoney(data.set_aside, data.currency),
  }
}

export type FlowPart = { key: 'spent' | 'payments' | 'plans' | 'free'; flex: number }
export type Flow = {
  parts: FlowPart[]
  /** «потрачено · платежи впереди · планы · свободно 381 055 ₸»; the overspend in its own colour; nothing to count — the words only. */
  caption: { words: string; free: string | null; over: boolean }
}

/** The strip of the month: what is spent, the payments and the plans ahead, what is free. Below zero there is no free
 * part and the words say «перерасход»; null (neither an income nor a budget) — the three parts and no free sum. */
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
  return {
    parts: parts.filter((part) => part.flex > 0),
    caption: {
      words: 'потрачено · платежи впереди · планы',
      free: free === null ? null : over ? `перерасход ${formatCents(-free, data.currency)}` : `свободно ${formatCents(free, data.currency)}`,
      over,
    },
  }
}

export type HubTile = {
  key: 'incomes' | 'payments' | 'plans' | 'goals' | 'stats' | 'review'
  title: string
  icon: IconName
  /** The colour of the picture: a category tone (1–6), `success` for the income, `ai` for the review. */
  tone: 'success' | 'ai' | number
  to: string
  /** The big words of the tile; the statistics tile draws its columns instead. */
  value: string | null
  note: string
  /** What a screen reader hears for the whole tile. */
  label: string
}

/** «Доходы»: the income of the month, or that it is not entered. */
export function incomesTile(data: Money): HubTile {
  const entered = data.income !== null
  return {
    key: 'incomes', title: 'Доходы', icon: 'income', tone: 'success', to: `/incomes?month=${data.month}`,
    value: entered ? formatMoney(data.income as string, data.currency) : 'Не внесён',
    note: entered ? forMonth(data.month) : `${forMonth(data.month)} не внесён`,
    label: entered ? `Доходы: ${formatMoney(data.income as string, data.currency)} ${forMonth(data.month)}` : `Доходы ${forMonth(data.month)} не внесены`,
  }
}

/** «через 2 дня», «сегодня», «просрочен». */
export function dueWords(days: number): string {
  if (days === 0) return 'сегодня'
  if (days < 0) return 'просрочен'
  return glue('через', String(days), plural(days, 'день', 'дня', 'дней'))
}

/** «Платежи»: what still waits, paid of all and the nearest one. */
export function paymentsTile(data: Money): HubTile {
  const { payments } = data
  if (payments.total === 0) {
    return { key: 'payments', title: 'Платежи', icon: 'repeat', tone: 2, to: '/recurring', value: 'Нет', note: 'добавить регулярный', label: 'Платежи: регулярных платежей нет' }
  }
  const note = [`${payments.paid} из ${payments.total} оплачено`, payments.next ? `${payments.next.name} ${dueWords(payments.next.days)}` : null].filter(Boolean).join(' · ')
  const value = cents(payments.left) > 0n ? formatMoney(payments.left, data.currency) : 'Все оплачены'
  return { key: 'payments', title: 'Платежи', icon: 'repeat', tone: 2, to: '/recurring', value, note, label: `Платежи: ${value}, ${note}` }
}

/** «Планы»: what still waits, «ждём · N без срока». */
export function plansTile(data: Money): HubTile {
  const { plans } = data
  const to = `/planned?month=${data.month}`
  if (!plans || (plans.count === 0 && plans.undated_count === 0)) {
    return { key: 'plans', title: 'Планы', icon: 'box', tone: 4, to, value: 'Пока без планов', note: 'добавить', label: 'Планы: пока без планов' }
  }
  const undated = plans.undated_count > 0 ? glue(String(plans.undated_count), 'без срока') : null
  const note = ['ждём', undated].filter(Boolean).join(' · ')
  const value = formatMoney(plans.left, data.currency)
  return { key: 'plans', title: 'Планы', icon: 'box', tone: 4, to, value, note, label: `Планы: ${value}, ${note}` }
}

/** «Цели»: the share saved and the two first goals with their shares. */
export function goalsTile(data: Money): HubTile {
  const { goals } = data
  if (!goals || goals.count === 0) {
    return { key: 'goals', title: 'Цели', icon: 'goal', tone: 3, to: '/goals', value: 'Нет целей', note: 'завести', label: 'Цели: целей нет' }
  }
  const value = percentText(shareOf(goals.share))
  const top = goals.top.slice(0, 2).map((goal) => `«${goal.name}» ${percentText(shareOf(goal.share))}`)
  const note = top.length ? top.join(' · ') : `${glue(String(goals.count), plural(goals.count, 'цель', 'цели', 'целей'))} · ${formatMoney(goals.saved, goals.currency)}`
  return { key: 'goals', title: 'Цели', icon: 'goal', tone: 3, to: '/goals', value, note, label: `Цели: накоплено ${value}, ${note}` }
}

export type Column = { month: string; height: number; now: boolean }

/** The six mini columns of «Статистика»: per cent of the biggest month, the shown month marked. */
export function columnsOf(months: MoneyMonth[], shown: string): Column[] {
  const largest = Math.max(0, ...months.map((item) => centsOf(item.spent)))
  return months.map((item) => ({
    month: item.month, now: item.month === shown,
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

/** «Статистика»: the columns of six months with the note under them. */
export function statsTile(data: Money, to: string, current: boolean): HubTile & { columns: Column[] } {
  const note = statsNote(data.months, data.month, current)
  return { key: 'stats', title: 'Статистика', icon: 'stats', tone: 1, to, value: null, note, label: `Статистика: ${note}`, columns: columnsOf(data.months, data.month) }
}

/** «+12 % к августу · 3 совета» of the last review. */
export function reviewNote(review: MoneyReview): string {
  const parts: string[] = []
  if (review.change_previous !== null) {
    const number = Number(review.change_previous)
    const text = Number.isFinite(number) ? `${number > 0 ? '+' : number < 0 ? '−' : ''}${percentText(Math.abs(Math.round(number)))}` : review.change_previous
    parts.push(`${text} к ${dative[Number(review.month.slice(5, 7)) - 1 === 0 ? 11 : Number(review.month.slice(5, 7)) - 2]}`)
  }
  parts.push(glue(String(review.tips), plural(review.tips, 'совет', 'совета', 'советов')))
  return parts.join(' · ')
}

/** «Разбор»: the last review of the month before, or the invitation to ask for one. */
export function reviewTile(data: Money): HubTile {
  const { review } = data
  if (!review) {
    return { key: 'review', title: 'Разбор', icon: 'insight', tone: 'ai', to: '/review', value: 'Запросить разбор', note: `${forMonth(data.month)} и раньше`, label: 'Разбор месяца: запросить' }
  }
  const value = monthName(review.month)
  const note = reviewNote(review)
  return { key: 'review', title: 'Разбор', icon: 'insight', tone: 'ai', to: `/review?month=${review.month}`, value, note, label: `Разбор ${inMonth(review.month)}: ${note}` }
}

/** The six tiles of the hub in the order of the mockup. `statsHref` — the remembered address of «Статистика». */
export function hubTiles(data: Money, statsHref: string, current: boolean): (HubTile | (HubTile & { columns: Column[] }))[] {
  return [incomesTile(data), paymentsTile(data), plansTile(data), goalsTile(data), statsTile(data, statsHref, current), reviewTile(data)]
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
