import { getLocalJson } from './local.ts'
import { isMonthCode } from './budget-schema.ts'
import { amount, array, currency, isISODate, nonNegativeInteger, nullable, object, record, text } from './schema.ts'
import type { Check, Guard } from './schema.ts'
import type { CurrencyCode, Decimal, ISODate, LocalApiResult, RequestOptions } from './types.ts'
import type { MonthCode } from './budget-types.ts'

/**
 * «Деньги» (`GET /api/money/?month=`, 2026-10-26): the month of the family as one answer — the income, the spends, what
 * was put aside on the goals, the flow of the money and the six tiles of the hub. Everything is in the base currency of
 * the family and counted by the server; the client only draws.
 *
 * The server (`backend/api/views/money.py`, docs/api-contract.md «Деньги») sends every field below; the guard requires
 * the ones of the contract and reads the blocks that may be null with `Object.hasOwn`, so a leaner server still renders.
 */
/** The strip of the month: what is spent, the open payments and plans ahead, and what is free (below zero — the
 * overspend; null — neither an income nor a budget to count it from). */
export type MoneyFlow = { spent: Decimal; payments_ahead: Decimal; plans_ahead: Decimal; free: Decimal | null }
/** The next open payment of the month: its name and in how many days it is due (0 — today, below zero — overdue). */
export type MoneyNextPayment = { name: string; due_date: ISODate; days: number }
export type MoneyPayments = { left: Decimal; paid: number; total: number; next: MoneyNextPayment | null }
/** The open plans of the month: `undated_count` — the plans without a date, in no month. */
export type MoneyPlans = { left: Decimal; count: number; undated_count: number }
/** The goals: `share` — the part saved of all of them, a whole per cent; `top` — the first goals by their share. */
export type MoneyGoals = { count: number; share: Decimal | number; saved: Decimal; currency: CurrencyCode; top: { name: string; share: Decimal | number }[] }
/** One of the last six months with its spends in the base currency, oldest first; the shown month is the last one. */
export type MoneyMonth = { month: MonthCode; spent: Decimal }
/** The last review of the month before: how the spends changed against the month before it (a per cent) and how many tips. */
export type MoneyReview = { month: MonthCode; change_previous: Decimal | null; tips: number }
export type Money = {
  month: MonthCode
  /** The base currency of the family: every sum of the answer is in it. */
  currency: CurrencyCode
  /** null — the income of the month is not entered yet. */
  income: Decimal | null
  spent: Decimal; set_aside: Decimal
  flow: MoneyFlow
  payments: MoneyPayments
  plans: MoneyPlans | null
  goals: MoneyGoals | null
  months: MoneyMonth[]
  review: MoneyReview | null
}

const optional = (value: unknown, key: string, check: Check) => !Object.hasOwn(value as object, key) || check((value as Record<string, unknown>)[key])
const share: Check = (value) => amount(value) || (typeof value === 'number' && Number.isFinite(value))
const flow = object<MoneyFlow>({ spent: amount, payments_ahead: amount, plans_ahead: amount, free: nullable(amount) })
const nextPayment = object<MoneyNextPayment>({ name: text, due_date: isISODate, days: (value) => Number.isSafeInteger(value) })
const paymentsShape = object<Omit<MoneyPayments, 'next'>>({ left: amount, paid: nonNegativeInteger, total: nonNegativeInteger })
const payments: Check = (value) => paymentsShape(value) && optional(value, 'next', nullable(nextPayment))
const plansShape = object<Omit<MoneyPlans, 'undated_count'>>({ left: amount, count: nonNegativeInteger })
const plans: Check = (value) => plansShape(value) && optional(value, 'undated_count', nonNegativeInteger)
const goalsShape = object<Omit<MoneyGoals, 'top'>>({ count: nonNegativeInteger, share, saved: amount, currency })
const goals: Check = (value) => goalsShape(value) && optional(value, 'top', array(object<MoneyGoals['top'][number]>({ name: text, share })))
const month = object<MoneyMonth>({ month: isMonthCode, spent: amount })
const review = object<MoneyReview>({ month: isMonthCode, change_previous: nullable(amount), tips: nonNegativeInteger })
const moneyShape = object<Pick<Money, 'month' | 'currency' | 'income' | 'spent' | 'set_aside' | 'flow' | 'payments'>>({
  month: isMonthCode, currency, income: nullable(amount), spent: amount, set_aside: amount, flow, payments,
})
export const isMoney: Guard<Money> = (value): value is Money => record(value) && moneyShape(value)
  && optional(value, 'plans', nullable(plans)) && optional(value, 'goals', nullable(goals))
  && optional(value, 'months', array(month)) && optional(value, 'review', nullable(review))

/** The fields a leaner server leaves out, filled in: the screen reads one shape. */
function settle(data: Money): Money {
  const raw = data as Record<string, unknown>
  return {
    ...data,
    payments: { ...data.payments, next: Object.hasOwn(data.payments, 'next') ? data.payments.next : null },
    plans: Object.hasOwn(raw, 'plans') && data.plans ? { ...data.plans, undated_count: data.plans.undated_count ?? 0 } : null,
    goals: Object.hasOwn(raw, 'goals') && data.goals ? { ...data.goals, top: data.goals.top ?? [] } : null,
    months: Object.hasOwn(raw, 'months') ? data.months : [],
    review: Object.hasOwn(raw, 'review') ? data.review : null,
  }
}

/** The month of «Деньги»; without `month` the server takes its current month. */
export async function getMoney(month?: MonthCode, options: RequestOptions = {}): Promise<LocalApiResult<Money>> {
  if (options.signal?.aborted) return { kind: 'aborted' }
  if (month !== undefined && !isMonthCode(month)) return { kind: 'error', reason: 'invalid_parameter', fields: ['month'] }
  const result = await getLocalJson('money/', { month }, isMoney, options)
  return result.kind === 'ok' ? { kind: 'ok', data: settle(result.data) } : result
}
