import type { Decimal } from '../api/types.ts'
import { NBSP, glue } from './text.ts'

/**
 * The one way the client shows a money amount: exact, as the server sends it (2026-10-15, the person: «это финансы,
 * округлять в большую сторону нельзя»). Kopecks show only when there are any: 9 821,47 · 10 · −0,40.
 * Not money in this sense: unit prices (`formatPrice`), indices, percentages, quantities, tax rates and chart axis ticks.
 *
 * String/BigInt only: a Decimal never becomes a Number.
 */

const missing = '—'
const groupDigits = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)

/** «9 821,47», «10», «-0,40»: grouped whole part, two decimals only when they are not zero. */
function exactText(negative: boolean, whole: string, fraction: string): string {
  const cents = fraction.padEnd(2, '0').slice(0, 2)
  const sign = negative && (/[1-9]/.test(whole) || cents !== '00') ? '-' : ''
  return `${sign}${groupDigits(whole.replace(/^0+(?=\d)/, ''))}${cents === '00' ? '' : `,${cents}`}`
}

/** «9 821,47» for "9821.47"; `—` for an absent or malformed value. */
export function formatMoneyNumber(value: Decimal | null | undefined): string {
  const match = typeof value === 'string' ? /^(-?)(\d+)(?:\.(\d+))?$/.exec(value) : null
  if (!match) return missing
  const fraction = match[3] ?? ''
  if (fraction.length <= 2) return exactText(match[1] === '-', match[2], fraction)
  // More than kopecks (not from the API, which sends two places): half away from zero, never cut silently.
  const units = BigInt(match[2] + fraction.slice(0, 2)) + (fraction[2] >= '5' ? 1n : 0n)
  return formatCentsNumber(match[1] === '-' ? -units : units)
}

/** «1 500,50» for 150050n cents. */
export function formatCentsNumber(cents: bigint): string {
  const absolute = cents < 0n ? -cents : cents
  return exactText(cents < 0n, (absolute / 100n).toString(), (absolute % 100n).toString().padStart(2, '0'))
}

const SYMBOLS: Record<string, string> = { KZT: '₸', RUB: '₽', USD: '$', EUR: '€', GBP: '£', CNY: '¥', TRY: '₺' }

/** «₸» for KZT: the sign people write after an amount; a code without a common sign stays a code (UZS, KGS, AED). */
export function currencySymbol(currency: string | null | undefined): string {
  return currency ? SYMBOLS[currency] ?? currency : ''
}

/** «9 821,47 ₸»: the number and its currency sign never break apart; without a currency only the number. */
export function formatMoney(value: Decimal | null | undefined, currency: string | null | undefined): string {
  const number = formatMoneyNumber(value)
  return number === missing ? missing : glue(number, currencySymbol(currency))
}

/** «1 500,50 ₸» for 150050n cents. */
export function formatCents(cents: bigint, currency: string | null | undefined): string {
  return glue(formatCentsNumber(cents), currencySymbol(currency))
}

/** «≈ 8 979 ₸»: an amount converted into the family's base currency at the rate of the National Bank on its day. */
export function formatApproxMoney(value: Decimal | null | undefined, currency: string | null | undefined): string {
  return glue('≈', formatMoney(value, currency))
}

/** The converted twin of an amount in another currency — «≈ 8 979 ₸» beside «20 $»; `null` for an amount in the base
 * currency itself, without a rate, or from an older server that sends no base currency. */
export function baseTwin(currency: string, baseTotal: Decimal | null | undefined, baseCurrency: string | null | undefined): string | null {
  if (!baseCurrency || currency === baseCurrency || baseTotal === null || baseTotal === undefined) return null
  return formatApproxMoney(baseTotal, baseCurrency)
}

/** «20 $ · ≈ 8 979 ₸» in one line; just «20 $» when there is no twin. */
export function formatMoneyWithBase(value: Decimal, currency: string, baseTotal: Decimal | null | undefined, baseCurrency: string | null | undefined): string {
  const twin = baseTwin(currency, baseTotal, baseCurrency)
  return twin ? `${formatMoney(value, currency)} · ${twin}` : formatMoney(value, currency)
}
