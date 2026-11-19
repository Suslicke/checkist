import type { Decimal } from '../api/types'
import { formatMoneyNumber } from '../lib/money'

/** U+202F: groups of digits and the currency sign (Чекист 2.0, docs/design-system/README.md «Деньги»). */
export const THIN_NBSP = '\u202f'
/** U+2212: the minus of an amount, never a hyphen. */
export const MINUS = '\u2212'
const NBSP = '\u00a0'

export type MoneySize = 'hero' | 'display' | 'title' | 'row' | 'inline'
export type MoneySign = 'auto' | 'plus' | 'minus'

export type MoneyParts = {
  /** The sign drawn before the number: `−`, `+` or nothing. */
  sign: string
  /** «312 418» with U+202F between the groups. */
  int: string
  /** «,40», or '' when the amount has no kopecks. */
  frac: string
}

/**
 * The parts of an amount, exactly as the server sent it (strings only, never a Number): the rounding, the kopecks shown
 * only when there are any and the absent value are those of `formatMoneyNumber` (lib/money.ts). `null` for an absent or
 * malformed value. `sign`: `auto` — «−» for a negative amount only; `plus` — «+» before a non-negative one; `minus` —
 * «−» always.
 */
export function moneyParts(value: Decimal | null | undefined, sign: MoneySign = 'auto'): MoneyParts | null {
  const text = formatMoneyNumber(value)
  if (text === '—') return null
  const negative = text.startsWith('-')
  const [whole, fraction] = (negative ? text.slice(1) : text).split(',')
  const shown = sign === 'minus' || negative ? MINUS : sign === 'plus' ? '+' : ''
  return { sign: shown, int: whole.replaceAll(NBSP, THIN_NBSP), frac: fraction === undefined ? '' : `,${fraction}` }
}
