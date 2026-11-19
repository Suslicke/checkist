/** Pure helpers of the lines of a receipt: the facts of a line of the paper slip and the categories of the header. */
import type { Line } from '../../api/receipts'
import type { NamedObject } from '../../api/types'
import { formatQuantity, formatUnit } from '../../lib/format'
import { formatMoneyNumber } from '../../lib/money'
import { price, recognizedValue } from './state'

/** A Decimal of the server as a comparable string: "2.50" and "2.5" are one value. Never a Number. */
export function canonical(value: string | null): string | null {
  const match = value === null ? null : /^(-?)(\d+)(?:\.(\d+))?$/.exec(value)
  if (!match) return null
  const whole = match[2].replace(/^0+(?=\d)/, '')
  const fraction = (match[3] ?? '').replace(/0+$/, '')
  const number = fraction ? `${whole}.${fraction}` : whole
  return number === '0' ? '0' : `${match[1]}${number}`
}

/** A number of the paper slip: the digits of an amount without its currency (the slip names it once, at the total),
 * the minus of an amount U+2212. An unreadable value is said. */
export function slipNumber(value: string | null): string {
  return recognizedValue(formatMoneyNumber(value)).replace(/^-/, '\u2212')
}

/** One line of the paper under the printed name: «2 шт × 1,29 ……… 2,58», then «Скидка ……… −0,20» and «Оплачено ……… 2,38»
 * only when they say something. `quiet` — the label is read by a screen reader only. */
export type SlipFact = { key: 'amount' | 'discount' | 'paid'; label: string; value: string; quiet?: boolean }

/**
 * The facts of a line of the slip, in the order of the former table columns. The first one is the amount: its label is
 * «2 шт × 1,29» when the quantity is not one, otherwise the price is the amount itself and the label «Сумма» is only
 * read by a screen reader; a zero discount and a paid amount equal to the amount are left out. The source values are
 * compared, not the formatted text; an unreadable value is shown.
 */
export function slipFacts(line: Line): SlipFact[] {
  const amount = canonical(line.amount)
  const quantity = canonical(line.quantity)
  const discount = canonical(line.discount_amount)
  const facts: (SlipFact | null)[] = [
    quantity === '1' ? { key: 'amount', label: 'Сумма', quiet: true, value: slipNumber(line.amount) }
      : { key: 'amount', label: `${recognizedValue(formatQuantity(line.quantity, line.unit))} × ${price(line.unit_price)}`, value: slipNumber(line.amount) },
    discount === '0' ? null : { key: 'discount', label: 'Скидка',
      value: discount === null ? slipNumber(line.discount_amount) : slipNumber(discount.startsWith('-') ? discount.slice(1) : `-${discount}`) },
    amount !== null && canonical(line.paid_amount) === amount ? null : { key: 'paid', label: 'Оплачено', value: slipNumber(line.paid_amount) },
  ]
  return facts.filter((fact): fact is SlipFact => fact !== null)
}

/**
 * «В чеке: 121 кВт·ч · цена 34,28 ₸» — what the paper said where the import kept the amount of the line as the fact
 * and recalculated the price (or made the line one piece). Null when nothing was replaced. The client only shows the
 * printed values; it calculates nothing.
 */
export function printedNote(line: Line, currency: string | undefined): string | null {
  const printed = line.printed
  if (!printed) return null
  const parts = [
    printed.quantity !== null ? formatQuantity(printed.quantity, printed.unit ?? line.unit)
      : printed.unit !== null ? `единица ${formatUnit(printed.unit)}` : null,
    printed.unit_price !== null ? `цена ${price(printed.unit_price, currency)}` : null,
  ].filter((part): part is string => part !== null)
  return parts.length ? `В чеке: ${parts.join(' · ')}` : null
}

/** The categories of the lines of a page, once each, in the order of the lines: the chips of the header. */
export function lineCategories(lines: Line[]): NamedObject[] {
  const seen = new Map<number, NamedObject>()
  for (const line of lines) if (line.category && !seen.has(line.category.id)) seen.set(line.category.id, line.category)
  return [...seen.values()]
}

