import { useSyncExternalStore } from 'react'

/**
 * «Скрывать суммы» (Чекист 2.0, docs/plans/2026-11-20-design-2.md §2): `localStorage['checkist.privacy'] = '1'` puts
 * `data-privacy` on `<html>`, and every `.ck-money` is blurred (App.css) while a screen reader hears «сумма скрыта»
 * (components/Money.tsx). The inline script of index.html sets the attribute before the first paint; this module keeps it
 * in step afterwards. Storage and the document are optional: blocked storage keeps the choice for the open page only.
 */
export const privacyStorageKey = 'checkist.privacy'
export const privacyAttribute = 'data-privacy'

const listeners = new Set<() => void>()
/** The choice made in this page; `null` until the person (or another tab) chooses: the storage decides then. */
let chosen: boolean | null = null
let stopListening: (() => void) | undefined

function stored(): boolean {
  try {
    return globalThis.localStorage?.getItem(privacyStorageKey) === '1'
  } catch {
    return false
  }
}

/** Puts the attribute on `<html>` or takes it off; a missing document is no error. */
export function applyPrivacyToDocument(on: boolean) {
  try {
    const root = globalThis.document?.documentElement
    if (!root) return
    if (on) root.setAttribute(privacyAttribute, '')
    else root.removeAttribute(privacyAttribute)
  } catch {
    // No document (a server render, a test): nothing to show.
  }
}

export function isPrivate(): boolean {
  return chosen ?? stored()
}

/** The value the listeners saw last: a change of another tab is told only when it differs. */
let announced = false

function notify() {
  announced = isPrivate()
  for (const listener of [...listeners]) listener()
}

export function setPrivate(on: boolean) {
  const changed = isPrivate() !== on
  chosen = on
  try {
    if (on) globalThis.localStorage?.setItem(privacyStorageKey, '1')
    else globalThis.localStorage?.removeItem(privacyStorageKey)
  } catch {
    // Blocked storage: the choice lives in this page only.
  }
  applyPrivacyToDocument(on)
  if (changed) notify()
}

export function togglePrivacy() {
  setPrivate(!isPrivate())
}

/** Another tab changed the choice: follow it. */
function listen(): (() => void) | undefined {
  try {
    const target = globalThis.window
    if (!target?.addEventListener) return undefined
    // The storage already holds the new value when the event comes: compare with what the listeners saw last.
    announced = isPrivate()
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== privacyStorageKey) return
      const next = stored()
      chosen = next
      if (next === announced) return
      applyPrivacyToDocument(next)
      notify()
    }
    target.addEventListener('storage', onStorage)
    return () => target.removeEventListener('storage', onStorage)
  } catch {
    return undefined
  }
}

export function subscribePrivacy(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1) stopListening = listen()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      stopListening?.()
      stopListening = undefined
    }
  }
}

/** `true` while sums are hidden. A server render sees them shown: the attribute of the inline script blurs them anyway. */
export function usePrivacy(): boolean {
  return useSyncExternalStore(subscribePrivacy, isPrivate, () => false)
}

/** What a screen reader hears in place of an amount while «Скрывать суммы» is on. */
export const HIDDEN_AMOUNT = 'сумма скрыта'

const GROUP = '[\\u00a0\\u202f ]'
const TIGHT = '[\\u00a0\\u202f]'
/** A currency sign of `currencySymbol` (lib/money.ts) or a code without a common sign (UZS, KGS, KZT in a model's text). */
const CURRENCY = '(?:[₸₽$€£¥₺]|[A-Z]{3}(?![A-Za-z]))'
/** An amount with its currency, as `formatMoney`, `formatApproxMoney`, `formatCents` and `formatPrice` write it — «9 821,47 ₸»,
 * «≈ 8 979 ₸», «−0,40 €», «+650 000 ₸», «1 450,00 ₸» — and as a model writes it in a sentence («587 205 KZT»). */
const WITH_CURRENCY = `(?<![\\d.,])(?:≈[\\u00a0 ])?[-−+]?(?:\\d{1,3}(?:${GROUP}\\d{3})+|\\d+)(?:,\\d{1,4})?${GROUP}?${CURRENCY}`
/** A bare amount of `formatMoneyNumber` beside one with a currency: «120 000 из 500 000 ₸», «(мин. 620,00, макс. 756,00)».
 * Only digit groups of the helpers (U+00A0, U+202F) or exactly two kopecks; never a percent («73 %»), a quantity with its
 * unit («1,25 кг»), a date («20.11.2026»), a year or a count («№ 12», «3 платежа»). */
const BARE = `(?<![\\d.,])[-−+]?(?:\\d{1,3}(?:${TIGHT}\\d{3})+(?:,\\d{2})?|\\d+,\\d{2})(?!\\d|,\\d)(?!${GROUP}?(?:%|(?:шт|кг|г|мл|л|м|кВт·ч|м³|Гкал)(?![а-яё])))`
/** A price after «×» on the paper of a receipt, where the slip names the currency once at its total: «2 шт × 1 450,00». */
const PRICE = `(?<=×[\\u00a0 ])[-−]?(?:\\d{1,3}(?:${TIGHT}\\d{3})+|\\d+),\\d{2,4}(?!\\d)`
/** Any formatted number but a percent or a quantity: the amounts of a text a screen knows to be about money though it
 * names no currency («лимит изменён: 120 000 → 150 000»). A formatted amount from 1 000 up is grouped, so an ungrouped
 * «2026» is a year and stays. */
const NUMBER = `(?<![\\d.,])[-−+]?\\d{1,3}(?:${TIGHT}\\d{3})*(?:,\\d{1,4})?(?!\\d|,\\d)(?!${GROUP}?(?:%|(?:шт|кг|г|мл|л|м|кВт·ч|м³|Гкал)(?![а-яё])))`
const withCurrency = new RegExp(WITH_CURRENCY, 'u')
const numbers = new RegExp(`${WITH_CURRENCY}|${NUMBER}`, 'gu')
const anyAmount = new RegExp(`${WITH_CURRENCY}|${PRICE}|${BARE}`, 'gu')
const currencyAmounts = new RegExp(`${WITH_CURRENCY}|${PRICE}`, 'gu')

/** A piece of a text: words, or an amount that «Скрывать суммы» hides. */
export type TextPart = { text: string; amount: boolean }

/**
 * A text cut into words and amounts (pure). An amount is one with a currency sign or code, or a price after «×»; a bare
 * formatted number counts as an amount only in a text that already holds one with a currency (`BARE`) — or, with
 * `numbers`, in a text the screen knows to be about money (every number but a percent and a quantity). Used by
 * `hideAmounts` for a label and by `<PrivateText>` (components/Private.tsx) for a sentence on a screen: only its amounts
 * are blurred.
 */
export function amountParts(text: string, numbersAreAmounts = false): TextPart[] {
  const pattern = numbersAreAmounts ? numbers : withCurrency.test(text) ? anyAmount : currencyAmounts
  const parts: TextPart[] = []
  let at = 0
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0
    if (start > at) parts.push({ text: text.slice(at, start), amount: false })
    parts.push({ text: match[0], amount: true })
    at = start + match[0].length
  }
  if (at < text.length) parts.push({ text: text.slice(at), amount: false })
  return parts
}

/** `true` for a text with an amount in it («1 450,00 ₸/кг»): the axis of a chart of such values hides its numbers. */
export function hasAmount(text: string): boolean {
  return withCurrency.test(text)
}

/** «Потрачено 465 162,41 ₸: Жильё 187 990 ₸» → «Потрачено сумма скрыта: Жильё сумма скрыта»: the text of an `aria-label` while
 * «Скрывать суммы» is on (pure). A text without amounts comes back as it is. */
export function hideAmounts(text: string, numbersAreAmounts = false): string {
  return amountParts(text, numbersAreAmounts).map((part) => part.amount ? HIDDEN_AMOUNT : part.text).join('')
}
