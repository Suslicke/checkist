import { Fragment } from 'react'
import { HIDDEN_AMOUNT, amountParts, usePrivacy } from '../theme/privacy'

type PrivateProps = { children: string; className?: string }

/** The markup of a secret text without the store of privacy (`Private` passes `hidden` from `usePrivacy()`): blurred by
 * CSS (`.ck-private`, App.css) and hidden from a screen reader, which hears «сумма скрыта» — as `MoneyView` does. Shown,
 * it is the text as it was: in a span of its `className`, or bare without one (the markup of a screen does not change). */
export function PrivateView({ children, className, hidden }: PrivateProps & { hidden: boolean }) {
  if (!hidden) return className ? <span className={className}>{children}</span> : <>{children}</>
  return <><span className={className ? `ck-private ${className}` : 'ck-private'} aria-hidden="true">{children}</span>
    <span className="ck-visually-hidden">{HIDDEN_AMOUNT}</span></>
}

/**
 * An amount written as text, where `<Money>` does not fit — a line of the paper receipt in its mono type, «≈ 10 061 ₸»
 * beside a spend: `<Private>{formatMoney(…)}</Private>`. While «Скрывать суммы» is on (theme/privacy.ts) it is blurred
 * and read as «сумма скрыта»; otherwise it is the text as it was.
 */
export default function Private(props: PrivateProps) {
  return <PrivateView {...props} hidden={usePrivacy()} />
}

type PrivateTextProps = {
  children: string
  /** The text is about money though it names no currency («лимит изменён: 120 000 → 150 000»): its numbers are amounts. */
  numbers?: boolean
}

/** A sentence with amounts inside, without the store of privacy (`PrivateText` passes `hidden`). */
export function PrivateTextView({ children, numbers = false, hidden }: PrivateTextProps & { hidden: boolean }) {
  if (!hidden) return <>{children}</>
  return <>{amountParts(children, numbers).map((part, index) => part.amount
    ? <PrivateView key={index} hidden>{part.text}</PrivateView>
    : <Fragment key={index}>{part.text}</Fragment>)}</>
}

/**
 * A sentence built as one string with amounts inside («на 34 375,02 ₸ меньше, чем в сентябре», the text of a model): while
 * «Скрывать суммы» is on only its amounts are blurred (`amountParts`, theme/privacy.ts), the words stay readable. A
 * sentence without amounts is drawn as it is.
 */
export function PrivateText({ children, numbers }: PrivateTextProps) {
  return <PrivateTextView numbers={numbers} hidden={usePrivacy()}>{children}</PrivateTextView>
}
