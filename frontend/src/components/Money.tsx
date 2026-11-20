import type { Decimal } from '../api/types'
import { currencySymbol } from '../lib/money'
import { usePrivacy } from '../theme/privacy'
import { THIN_NBSP, moneyParts } from './money-parts'
import type { MoneySign, MoneySize } from './money-parts'

const NBSP = '\u00a0'

export type MoneyProps = {
  /** The decimal string of the API: «312418.40», «-120». */
  value: Decimal | null | undefined
  /** ISO code; drawn as its sign (₸, $ …) after the number. Without it — the number alone. */
  currency?: string | null
  /** The type style: `hero` — the one main number of a screen, `display`, `title`, `row` — the amount of a row,
   * `inline` — the size of the text around it. */
  size?: MoneySize
  /** `auto` — «−» for a negative amount only; `plus` — «+» before a positive one (an income); `minus` — «−» always
   * (a spend shown as an outflow). */
  sign?: MoneySign
  /** «≈ 8 979 ₸»: an amount converted into the base currency. */
  approx?: boolean
  /** `in` — an income in its colour; `over` — over the limit (the words «сверх лимита» stand beside it). */
  tone?: 'in' | 'over'
  className?: string
}

type MoneyViewProps = MoneyProps & {
  /** «Скрывать суммы»: the digits are blurred by CSS and hidden from a screen reader, which hears «сумма скрыта». */
  hidden: boolean
}

/** The markup of an amount without the store of privacy: `Money` passes `hidden` from `usePrivacy()`. */
export function MoneyView({ value, currency, size = 'inline', sign = 'auto', approx = false, tone, className, hidden }: MoneyViewProps) {
  const parts = moneyParts(value, sign)
  const classes = ['ck-money', `ck-money--${size}`, tone && `ck-money--${tone}`, !parts && 'ck-money--missing', className].filter(Boolean).join(' ')
  if (!parts) return <span className={classes}>—</span>
  const symbol = currencySymbol(currency)
  const digits = <>
    {approx && <span className="ck-money-approx">≈{NBSP}</span>}
    {parts.sign && <span className="ck-money-sign">{parts.sign}</span>}
    <span className="ck-money-int">{parts.int}</span>
    {parts.frac && <span className="ck-money-frac">{parts.frac}</span>}
    {symbol && <span className="ck-money-cur">{THIN_NBSP}{symbol}</span>}
  </>
  // A screen reader hears the amount as one phrase: the styled parts (whole, kopecks, sign) would be three stops of
  // TalkBack and VoiceOver (seen in the Android tree of Chrome, 2026-11-20), so they are hidden from it and one plain string
  // stands beside them — the digits, or «сумма скрыта» while sums are hidden.
  const spoken = hidden ? 'сумма скрыта' : `${approx ? `≈${NBSP}` : ''}${parts.sign}${parts.int}${parts.frac}${symbol ? `${THIN_NBSP}${symbol}` : ''}`
  return <span className={classes}><span className="ck-money-digits" aria-hidden="true">{digits}</span><span className="ck-visually-hidden">{spoken}</span></span>
}

/**
 * An amount on a screen (Чекист 2.0): the whole part carries the weight, kopecks at 70 % in `ink-2`, the currency sign in
 * `ink-2`, tabular digits that never break (App.css, `.ck-money`). Words and `aria-label` keep `formatMoney`
 * (lib/money.ts). While «Скрывать суммы» is on (theme/privacy.ts) the digits are blurred and read as «сумма скрыта».
 */
export default function Money(props: MoneyProps) {
  return <MoneyView {...props} hidden={usePrivacy()} />
}
