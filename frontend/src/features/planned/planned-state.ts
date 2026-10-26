import type { AdviceKey, AdviceOption, PlannedAdvice, PlannedInput, PlannedMonthCard, PlannedSegment, PlannedSpend } from '../../api/planned'
import type { LocalApiFailure } from '../../api/types'
import { formatMoney } from '../../lib/money'
import { categoryTone } from '../../lib/category-tone'
import { glue } from '../../lib/text'
import { cents, dayAndMonth, inMonth, plural, shiftMonth } from '../dashboard/dashboard-state'
import { evaluateAmount, hasOperator } from '../expense/amount-calc'
import { amountText, emptyDraft } from '../expense/expense-form'
import type { ExpenseDraft } from '../expense/expense-form'
import type { Category } from '../../api/types'

/** The words and the geometry of «Планы»: the server counts the money, this file turns it into widths and sentences.
 * No network, no React. */

const nominative = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const dative = ['январю', 'февралю', 'марту', 'апрелю', 'маю', 'июню', 'июлю', 'августу', 'сентябрю', 'октябрю', 'ноябрю', 'декабрю']

/** «Октябрь», «Январь 2027» when the year is not the year of `today`. */
export function monthLabel(month: string, today: string): string {
  const name = nominative[Number(month.slice(5, 7)) - 1]
  return month.slice(0, 4) === today.slice(0, 4) ? name : glue(name, month.slice(0, 4))
}

/** «к апрелю» for a month, «к 1 февраля» for a day. */
export function byText(when: string): string {
  if (/^\d{4}-\d{2}$/.test(when)) return glue('к', dative[Number(when.slice(5, 7)) - 1])
  return glue('к', dayAndMonth(when))
}

export const isDone = (plan: Pick<PlannedSpend, 'receipt'>) => plan.receipt !== null

/** A part of the segmented bar: its colour (`--ck-cat-N`) and its share, as `flex` of the strip. */
export type Segment = { key: number; name: string; tone: number; done: boolean; flex: number }

/** The plans of a month as parts of one strip, in their order; nothing below zero takes room. */
export function segmentsOf(items: PlannedSegment[]): Segment[] {
  return items.map((item) => ({ key: item.id, name: item.name, tone: categoryTone(item.category_id), done: item.done, flex: Math.max(Number(cents(item.amount)) / 100, 0) }))
}

/** The widths of the rail under a plan, in per cent of the largest plan of its list: `plan` — the planned amount;
 * `saved` — put aside on a goal (on top of the plan); `fact` — what was spent; `over` — the spent amount when it is
 * more than the plan (drawn behind `fact`, which is then cut at the plan). */
export type Rail = { plan: number; saved: number; fact: number; over: number }

const percentOf = (value: bigint, largest: bigint) => largest <= 0n ? 0 : Math.min(100, Number((value * 100n + largest / 2n) / largest))

/** The largest amount (the plan or what was spent on it) of each currency of the list. */
export function largestOf(plans: PlannedSpend[]): Map<string, bigint> {
  const largest = new Map<string, bigint>()
  for (const plan of plans) {
    const value = plan.receipt && plan.receipt.currency === plan.currency && cents(plan.receipt.total) > cents(plan.amount) ? cents(plan.receipt.total) : cents(plan.amount)
    if (value > (largest.get(plan.currency) ?? 0n)) largest.set(plan.currency, value)
  }
  return largest
}

export function railOf(plan: PlannedSpend, largest: bigint): Rail {
  const planned = cents(plan.amount)
  if (plan.receipt) {
    // A spend in another currency is not compared by the eye: the rail shows the plan as done.
    const fact = plan.receipt.currency === plan.currency ? cents(plan.receipt.total) : planned
    return fact > planned
      ? { plan: 0, saved: 0, fact: percentOf(planned, largest), over: percentOf(fact, largest) }
      : { plan: 0, saved: 0, fact: percentOf(fact, largest), over: 0 }
  }
  const saved = plan.goal ? cents(plan.goal.saved) : 0n
  return { plan: percentOf(planned, largest), saved: saved > 0n ? percentOf(saved > planned ? planned : saved, largest) : 0, fact: 0, over: 0 }
}

export type Pill = { kind: 'over' | 'under' | 'ai-wait' | 'ai-drop'; text: string }

/** The pill at the end of the row: «+7 400 ₸» (spent more than planned), «−2 000 ₸» (less), «ИИ: подождать»,
 * «ИИ: отговаривает»; none for a plan spent to the tenge, a verdict «брать» or no verdict. */
export function pillOf(plan: PlannedSpend): Pill | null {
  if (plan.receipt) {
    if (plan.receipt.currency !== plan.currency) return null
    const delta = cents(plan.receipt.total) - cents(plan.amount)
    if (delta > 0n) return { kind: 'over', text: `+${formatMoney(decimalOf(delta), plan.currency)}` }
    if (delta < 0n) return { kind: 'under', text: `−${formatMoney(decimalOf(-delta), plan.currency)}` }
    return null
  }
  if (plan.ai?.verdict === 'wait') return { kind: 'ai-wait', text: 'ИИ: подождать' }
  if (plan.ai?.verdict === 'drop') return { kind: 'ai-drop', text: 'ИИ: отговаривает' }
  return null
}

/** Cents back as the decimal of the API: 740000n → "7400.00". */
export function decimalOf(value: bigint): string {
  const absolute = value < 0n ? -value : value
  return `${value < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`
}

/** «к 20 октября», «в октябре», «без срока». */
export function dueText(plan: Pick<PlannedSpend, 'due' | 'due_exact'>): string {
  if (plan.due === null) return 'без срока'
  return plan.due_exact ? glue('к', dayAndMonth(plan.due)) : inMonth(plan.due)
}

/** «24 октября · Technodom» of a closed plan. */
export function doneText(plan: PlannedSpend): string {
  if (!plan.receipt) return ''
  return [dayAndMonth(plan.receipt.purchased_on), plan.receipt.store_name].filter(Boolean).join(' · ')
}

/** «отложено 57 000 ₸ на депозите «Зима»», «ничего не отложено»; a goal just opened, still empty — «депозит «Зима» открыт,
 * пока пусто» so the row shows the tie before the first contribution. */
export function savedText(plan: PlannedSpend): string {
  if (!plan.goal) return 'ничего не отложено'
  if (cents(plan.goal.saved) <= 0n) return `${plan.goal.kind === 'deposit' ? 'депозит' : 'копилка'} «${plan.goal.name}» ${plan.goal.kind === 'deposit' ? 'открыт' : 'открыта'}, пока пусто`
  return `отложено ${formatMoney(plan.goal.saved, plan.currency)} ${plan.goal.kind === 'deposit' ? 'на депозите' : 'в копилке'} «${plan.goal.name}»`
}

/** The line under the name: the category, then the date (or the spend that closed it), then what is put aside. */
export function rowMeta(plan: PlannedSpend): string[] {
  const category = plan.category?.name ?? 'Без категории'
  if (plan.receipt) return [category, doneText(plan)]
  return [category, dueText(plan), savedText(plan)]
}

/** «5 планов», «1 план». */
export function plansText(count: number): string {
  return glue(String(count), plural(count, 'план', 'плана', 'планов'))
}

/** A card of the row of months: a listed month with its sum, or a gap («пока пусто») between listed ones. */
export type MonthCardView = { month: string; label: string; now: boolean; empty: boolean; sum: string | null; meta: string; segments: Segment[] }

/** The months from the shown one to the last one with plans, the gaps filled: a month without plans invites to add
 * one. The shown month is always first, even when the server lists none. */
export function monthsRow(months: PlannedMonthCard[], shown: string, today: string, currency: string): MonthCardView[] {
  const byMonth = new Map(months.map((item) => [item.month, item]))
  const last = months.reduce((max, item) => item.month > max ? item.month : max, shown)
  const result: MonthCardView[] = []
  for (let month = shown; month <= last && result.length < 24; month = shiftMonth(month, 1)) {
    const item = byMonth.get(month)
    const now = month === shown
    if (!item || item.count === 0) {
      result.push({ month, label: monthLabel(month, today), now, empty: true, sum: null, meta: '＋ добавить', segments: [] })
      continue
    }
    const meta = item.done_count > 0 ? `${plansText(item.count)} · ${item.done_count} сделано` : plansText(item.count)
    result.push({ month, label: monthLabel(month, today), now, empty: false, sum: formatMoney(item.expected, currency), meta, segments: segmentsOf(item.segments) })
  }
  return result
}

/** The form of a plan: what a person types, as text. `dueKind` — «без срока / в месяце / к дате». */
export type PlannedDraft = {
  name: string; amount: string; currency: string
  dueKind: 'none' | 'month' | 'date'; month: string; date: string
  category_id: number | null; note: string
}
export type DraftErrors = Partial<Record<'name' | 'amount' | 'currency' | 'month' | 'date', string>>

export function draftOf(plan: PlannedSpend | null, currency: string, month: string): PlannedDraft {
  if (!plan) return { name: '', amount: '', currency, dueKind: 'month', month, date: '', category_id: null, note: '' }
  return {
    name: plan.name, amount: plan.amount.replace(/\.00$/, ''), currency: plan.currency,
    dueKind: plan.due === null ? 'none' : plan.due_exact ? 'date' : 'month',
    month: plan.due ? plan.due.slice(0, 7) : month, date: plan.due && plan.due_exact ? plan.due : '',
    category_id: plan.category?.id ?? null, note: plan.note,
  }
}

/** «6 700,50» → «6700.50», «1200+350» → «1550» (the calculator of the spend form); `null` — not an amount above zero. */
export function amountValue(input: string): string | null {
  if (hasOperator(input)) return evaluateAmount(input) ?? null
  const text = input.replace(/\s/g, '').replace(',', '.')
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(text) || !/[1-9]/.test(text)) return null
  return text
}

export function draftErrors(draft: PlannedDraft): DraftErrors {
  const errors: DraftErrors = {}
  if (!draft.name.trim()) errors.name = 'Назовите план.'
  if (amountValue(draft.amount) === null) errors.amount = 'Сумма больше нуля.'
  if (!/^[A-Za-z]{3}$/.test(draft.currency.trim())) errors.currency = 'Код валюты — три буквы.'
  if (draft.dueKind === 'month' && !/^\d{4}-(0[1-9]|1[0-2])$/.test(draft.month)) errors.month = 'Выберите месяц.'
  if (draft.dueKind === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) errors.date = 'Выберите день.'
  return errors
}

/** The date of the form: a day, the 1st of the month, or none. */
export function dueOf(draft: Pick<PlannedDraft, 'dueKind' | 'month' | 'date'>): Pick<PlannedInput, 'due' | 'due_exact'> {
  if (draft.dueKind === 'none') return { due: null, due_exact: false }
  if (draft.dueKind === 'date') return { due: draft.date, due_exact: true }
  return { due: `${draft.month}-01`, due_exact: false }
}

/** The body of the form; call after `draftErrors` came back empty. */
export function draftBody(draft: PlannedDraft): PlannedInput {
  return {
    name: draft.name.trim(), amount: amountValue(draft.amount) as string, currency: draft.currency.trim().toUpperCase(), ...dueOf(draft),
    category_id: draft.category_id, note: draft.note.trim(),
  }
}

/** The form of a spend started from a plan (`/receipts/new?planned=`): its name as «Что купили», the category (when the
 * form offers it), the amount and the currency, the note; the date is today. */
export function draftFromPlanned(plan: PlannedSpend, categories: Category[], today: string): ExpenseDraft {
  const category = plan.category && categories.some((item) => item.id === plan.category?.id) ? plan.category.id : null
  return { ...emptyDraft(plan.currency, today), amount: amountText(plan.amount), category, item: plan.name, note: plan.note }
}

/** Where to go once the spend closed the plan: the month of the plan, or the current one for a plan without a date. */
export function plannedHref(plan: Pick<PlannedSpend, 'due'>): string {
  return plan.due ? `/planned?month=${plan.due.slice(0, 7)}` : '/planned'
}

/** A line under an action: what happened. */
export type Notice = { text: string; receiptId?: number | null }

/** Local texts of a refusal; the server's own message never reaches the screen. */
export function plannedFailure(failure: Pick<LocalApiFailure, 'reason' | 'status' | 'fields'>): string {
  if (failure.status === 409) return 'Эта трата уже закрывает другой план.'
  switch (failure.reason) {
    case 'not_found': return 'План не найден — возможно, его уже удалили. Обновили список.'
    case 'invalid_parameter': return 'Проверьте поля формы.'
    case 'timeout': return 'Сервер не ответил вовремя. Повторите попытку.'
    case 'network': return 'Не удалось связаться с сервером. Проверьте соединение и повторите попытку.'
    case 'csrf_failed': return 'Сессия устарела. Повторите действие.'
    case 'database_unavailable': return 'Данные временно недоступны. Повторите попытку позже.'
    default: return 'Не получилось. Повторите попытку.'
  }
}

/** The names of the ways to save, by the key of the server. */
export const optionNames: Record<AdviceKey, string> = {
  lump_fixed: 'Сразу на срочный депозит', monthly_flexible: 'Понемногу каждый месяц', invest: 'Инвестиции или крипта',
}

/** «17 % годовых» for "17.00" or 17. */
export function rateText(rate: AdviceOption['rate']): string | null {
  if (rate === null) return null
  const text = typeof rate === 'number' ? String(rate) : rate.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
  return glue(text.replace('.', ','), '%', 'годовых')
}

/** «Нужно 150 000 ₸ к 1 февраля · отложено 57 000 ₸ · не хватает 93 000 ₸». */
export function adviceSub(advice: PlannedAdvice): string {
  const need = `Нужно ${formatMoney(advice.need, advice.currency)}${advice.due ? ` ${byText(advice.due)}` : ' без срока'}`
  return `${need} · отложено ${formatMoney(advice.saved, advice.currency)} · не хватает ${formatMoney(advice.missing, advice.currency)}`
}

/** «3 месяца» between today and the date. */
export function monthsText(months: number): string {
  return months === 0 ? 'меньше месяца' : glue(String(months), plural(months, 'месяц', 'месяца', 'месяцев'))
}

export type OptionView = {
  key: AdviceKey; name: string; available: boolean
  /** The big figure: what to put in, or «—». */
  sum: string
  /** Under the figure: «сегодня, один раз», «в месяц × 3», the reason when not available. */
  under: string
  /** The shares of the bar: the money put in and what the bank adds, as `flex`. */
  bar: { in: number; gain: number } | null
  /** The small words: «вложить 89 200 ₸», «банк добавит ≈ 3 800 ₸ · 17 % годовых», «без снятия до 1 февраля». */
  meta: string[]
  risk: number
}

/** One way to save as the screen shows it. */
export function optionView(option: AdviceOption, advice: PlannedAdvice): OptionView {
  const name = optionNames[option.key]
  if (!option.available || option.amount === null) {
    // The short «not for …» under the dash; the server's reason once, as the small print (never beside the sum: it would not fit).
    return { key: option.key, name, available: false, sum: '—', under: advice.months === null ? 'не для плана без срока' : advice.months === 0 ? 'срок меньше месяца' : `не для ${glue(String(advice.months), plural(advice.months, 'месяца', 'месяцев', 'месяцев'))}`, bar: null, meta: option.reason ? [option.reason] : [], risk: option.risk }
  }
  const money = (value: string) => formatMoney(value, advice.currency)
  const times = option.times ?? 1
  const under = option.key === 'lump_fixed' || times <= 1 ? 'сегодня, один раз' : option.until ? `в месяц, хватит ${byText(option.until)}` : `в месяц × ${times}`
  const put = times > 1 ? `взносы ${money(decimalOf(cents(option.amount) * BigInt(times)))}` : `вложить ${money(option.amount)}`
  const gain = option.gain ? `банк добавит ≈ ${money(option.gain)}${rateText(option.rate) ? ` · ${rateText(option.rate)}` : ''}` : rateText(option.rate)
  const liquid = option.liquid ? 'снять можно в любой день' : advice.due ? `без снятия до ${dayAndMonth(advice.due)}` : 'без снятия до срока'
  return {
    key: option.key, name, available: true, sum: money(option.amount), under,
    bar: { in: Math.max(Number(cents(option.amount) * BigInt(times)) / 100, 0), gain: Math.max(Number(cents(option.gain ?? '0')) / 100, 0) },
    meta: [put, gain, liquid].filter((item): item is string => Boolean(item)), risk: option.risk,
  }
}

/** The option offered first: the first available one. */
export function bestOption(advice: PlannedAdvice): AdviceKey | null {
  return advice.options.find((option) => option.available)?.key ?? null
}

/** The available option after `current`, round the list. */
export function nextOption(advice: PlannedAdvice, current: AdviceKey | null): AdviceKey | null {
  const available = advice.options.filter((option) => option.available).map((option) => option.key)
  if (!available.length) return null
  const at = current ? available.indexOf(current) : -1
  return available[(at + 1) % available.length]
}

/** The amount «Открыть депозит на …» opens with: the sum of the option (the monthly one — its first contribution). */
export function depositAmount(advice: PlannedAdvice, key: AdviceKey | null): string | null {
  const option = advice.options.find((item) => item.key === key)
  return option?.available && option.amount ? formatMoney(option.amount, advice.currency) : null
}
