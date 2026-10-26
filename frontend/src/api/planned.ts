import { invalidIds } from './http.ts'
import { getLocalJson, mutate } from './local.ts'
import { isMonthCode } from './budget-schema.ts'
import { amount, array, bool, choice, currency, isId, isISODate, isISODateTime, nonNegativeInteger, nullable, object, text } from './schema.ts'
import type { Check, Guard } from './schema.ts'
import type { CurrencyCode, Decimal, ISODate, ISODateTime, LocalApiResult, RequestOptions } from './types.ts'
import { isPerson } from '../lib/people.ts'
import type { Person } from '../lib/people.ts'
import type { GoalKind } from './goals.ts'

/** «Планы» (`/api/planned/`): a one-off spend the family expects — a jacket by the 1st of February, tyres in October, a
 * trip without a date. Not a regular payment: it is closed by a real spend (`receipt`), the money for it may be put
 * aside on a goal (`goal`), and the model may have a verdict about it (`ai`). A plan without a date is not in any month
 * and not in «можно тратить в день». Everything is read from the server; the client only draws and sends. */
export type PlannedVerdict = 'keep' | 'wait' | 'drop'
export type PlannedCategory = { id: number; name: string; icon: string | null }
/** The spend that closed the plan; `store_name` null — a spend without a place. */
export type PlannedReceipt = { id: number; total: Decimal; currency: CurrencyCode; purchased_on: ISODate; store_name: string | null }
/** The goal where the money is put aside: `saved` — in the currency of the plan; `share` — the part of the plan it
 * covers, as the server counts it (the rail is drawn from `saved` and `amount`, not from it). */
export type PlannedGoal = { id: number; name: string; kind: GoalKind; saved: Decimal; share: Decimal | number }
export type PlannedAi = { verdict: PlannedVerdict; reason: string; at: ISODateTime | null }
export type PlannedSpend = {
  id: number; name: string; category: PlannedCategory | null; currency: CurrencyCode; amount: Decimal
  /** The day the money is needed by; `null` — no date. `due_exact` — «к 20 октября», else «в октябре» (`due` is the 1st). */
  due: ISODate | null; due_exact: boolean; note: string
  receipt: PlannedReceipt | null
  /** Missing from an older server. */
  goal?: PlannedGoal | null
  ai?: PlannedAi | null
  created_by: Person | null; created_at: ISODateTime
}
/** One plan as a part of the segmented bar of a month, in the base currency; `done` — closed by a spend (then `amount`
 * is what was spent). */
export type PlannedSegment = { id: number; name: string; category_id: number | null; amount: Decimal; done: boolean }
/** The month as one sum in the base currency of the family: all the plans, the closed ones, what is still waited for. */
export type PlannedBase = {
  expected: Decimal; done: Decimal; left: Decimal
  /** Plans without a rate into the base currency: left out of the sums. */
  excluded: number
  count: number; done_count: number; segments: PlannedSegment[]
}
/** A month ahead with plans (the server lists only the months that have any). */
export type PlannedMonthCard = { month: string; expected: Decimal; count: number; done_count: number; segments: PlannedSegment[] }
export type PlannedMonth = {
  month: string; today: ISODate
  /** The base currency of the family: the sums of `base` and of `months`. */
  currency: CurrencyCode
  /** The plans with a date in the month, the closed ones too. */
  rows: PlannedSpend[]
  /** The plans without a date: in no month. */
  undated: PlannedSpend[]
  base: PlannedBase; months: PlannedMonthCard[]
}
/** The body of a new plan and of a change (`PATCH` takes any part of it). `due` null — no date; `receipt_id` null —
 * the plan is open again; `goal_id` null — the money is not on a goal. */
export type PlannedInput = {
  name?: string; amount?: Decimal; currency?: CurrencyCode; due?: ISODate | null; due_exact?: boolean
  category_id?: number | null; note?: string; goal_id?: number | null; receipt_id?: number | null
}
/** «Как накопить»: the three ways to have the missing money by the date (the server's figures, `goals.forecast`). */
export type AdviceKey = 'lump_fixed' | 'monthly_flexible' | 'invest'
export type AdviceOption = {
  key: AdviceKey
  /** `false` — not for this plan (too soon, no date): `reason` says why, the figures are null. */
  available: boolean; reason: string | null
  /** What to put in: once (`lump_fixed`) or every month (`monthly_flexible`, `times` months). */
  amount: Decimal | null; times: number | null
  /** What the bank adds by the date at `rate` % a year. */
  gain: Decimal | null; rate: Decimal | number | null
  /** 1 — a term deposit, 2 — a flexible one, 3 — investments. */
  risk: number
  /** The money can be taken out any day. */
  liquid: boolean
  /** Without a date: the month the money is together by at `amount` a month (`YYYY-MM`). */
  until: string | null
}
export type PlannedAdvice = {
  need: Decimal; saved: Decimal; missing: Decimal; currency: CurrencyCode; due: ISODate | null
  /** Whole months to the date; null without one. */
  months: number | null
  options: AdviceOption[]
}

/** A field an older server leaves out: missing passes, anything else must pass `check`. */
const optional = (value: unknown, key: string, check: Check) => !Object.hasOwn(value as object, key) || check((value as Record<string, unknown>)[key])
const numberOrDecimal: Check = (value) => (typeof value === 'number' && Number.isFinite(value)) || amount(value)
const isCategory = object<PlannedCategory>({ id: isId, name: text, icon: nullable(text) })
const isReceipt = object<PlannedReceipt>({ id: isId, total: amount, currency, purchased_on: isISODate, store_name: nullable(text) })
const isGoal = object<PlannedGoal>({ id: isId, name: text, kind: choice('saving', 'deposit'), saved: amount, share: numberOrDecimal })
const isAi = object<PlannedAi>({ verdict: choice('keep', 'wait', 'drop'), reason: text, at: nullable(isISODateTime) })
const planShape = object<Omit<PlannedSpend, 'goal' | 'ai'>>({
  id: isId, name: text, category: nullable(isCategory), currency, amount, due: nullable(isISODate), due_exact: bool, note: text,
  receipt: nullable(isReceipt), created_by: nullable(isPerson), created_at: isISODateTime,
})
/** A plan without a date never says «к 20 октября». */
export const isPlannedSpend: Guard<PlannedSpend> = (value): value is PlannedSpend => planShape(value)
  && optional(value, 'goal', nullable(isGoal)) && optional(value, 'ai', nullable(isAi)) && (value.due !== null || !value.due_exact)
const isSegment = object<PlannedSegment>({ id: isId, name: text, category_id: nullable(isId), amount, done: bool })
const isBase = object<PlannedBase>({
  expected: amount, done: amount, left: amount, excluded: nonNegativeInteger, count: nonNegativeInteger, done_count: nonNegativeInteger,
  segments: array(isSegment),
})
const isMonthCard = object<PlannedMonthCard>({ month: isMonthCode, expected: amount, count: nonNegativeInteger, done_count: nonNegativeInteger, segments: array(isSegment) })
export const isPlannedMonth = object<PlannedMonth>({
  month: isMonthCode, today: isISODate, currency, rows: array(isPlannedSpend), undated: array(isPlannedSpend), base: isBase, months: array(isMonthCard),
})
const risk: Check = (value) => Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= 3
const isOption = object<AdviceOption>({
  key: choice('lump_fixed', 'monthly_flexible', 'invest'), available: bool, reason: nullable(text), amount: nullable(amount),
  times: nullable(nonNegativeInteger), gain: nullable(amount), rate: nullable(numberOrDecimal), risk, liquid: bool, until: nullable(text),
})
export const isPlannedAdvice = object<PlannedAdvice>({
  need: amount, saved: amount, missing: amount, currency, due: nullable(isISODate), months: nullable(nonNegativeInteger), options: array(isOption),
})
const isEmpty = (value: unknown): value is null => value === null

const send = <T>(path: string, body: unknown, guard: Guard<T>, options: RequestOptions, method: 'POST' | 'PATCH' | 'DELETE' = 'POST') =>
  mutate(path, body === undefined ? '' : JSON.stringify(body), guard, options, false, undefined, { method })

/** The plans of a month with the months ahead; without `month` — the server's current one. */
export async function getPlannedMonth(month?: string, options: RequestOptions = {}): Promise<LocalApiResult<PlannedMonth>> {
  if (options.signal?.aborted) return { kind: 'aborted' }
  if (month !== undefined && !isMonthCode(month)) return { kind: 'error', reason: 'invalid_parameter', fields: ['month'] }
  return getLocalJson('planned/', { month }, isPlannedMonth, options)
}
export async function getPlanned(id: number, options: RequestOptions = {}): Promise<LocalApiResult<PlannedSpend>> {
  return invalidIds({ id }, options.signal) ?? getLocalJson(`planned/${id}/`, {}, isPlannedSpend, options)
}
/** Without `currency` the plan takes the base currency of the family. */
export function createPlanned(input: PlannedInput, options: RequestOptions = {}): Promise<LocalApiResult<PlannedSpend>> {
  return send('planned/', input, isPlannedSpend, options)
}
/** `receipt_id` closes the plan with a spend (409 `receipt_taken` when it closes another one), null opens it again. */
export async function updatePlanned(id: number, patch: PlannedInput, options: RequestOptions = {}): Promise<LocalApiResult<PlannedSpend>> {
  return invalidIds({ id }, options.signal) ?? send(`planned/${id}/`, patch, isPlannedSpend, options, 'PATCH')
}
/** The spend that closed it and the goal stay. */
export async function deletePlanned(id: number, options: RequestOptions = {}): Promise<LocalApiResult<null>> {
  return invalidIds({ id }, options.signal) ?? send(`planned/${id}/`, undefined, isEmpty, options, 'DELETE')
}
/** «Как накопить»: counted at every read, never kept in memory. */
export async function getPlannedAdvice(id: number, options: RequestOptions = {}): Promise<LocalApiResult<PlannedAdvice>> {
  return invalidIds({ id }, options.signal) ?? getLocalJson(`planned/${id}/advice/`, {}, isPlannedAdvice, options)
}
/** «Открыть депозит на …»: a deposit goal of the family for the missing money at the rate of the option, tied to the
 * plan. The answer is the plan with its goal. */
export async function openPlannedDeposit(id: number, option: AdviceKey, options: RequestOptions = {}): Promise<LocalApiResult<PlannedSpend>> {
  return invalidIds({ id }, options.signal) ?? send(`planned/${id}/deposit/`, { option }, isPlannedSpend, options)
}
