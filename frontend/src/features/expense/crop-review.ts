/**
 * A crop of a photo that needs a check, in the one spend form (2026-10-14, «фотка на весь экран — неудобно»): the
 * recognized receipt becomes a draft of the form, the draft goes back as the body of the crop confirmation
 * (`POST /api/recognition/receipt-images/{id}/confirm/`), so the server keeps every rule of the import and of
 * deduplication. Fields the form does not show (address, country, time, line kinds and tax rates) travel unchanged
 * from the recognition. Pure rules: no network, no React.
 */
import type { Line, ManualSpendInput } from '../../api/receipts'
import type { ReceiptImageDetail, ReviewConfirmInput } from '../../api/recognition'
import type { LocalApiFailure } from '../../api/types'
import { problemSummary } from '../recognition/mobile-state'
import { buildInput, createReview, fieldProblems, issueProblems } from '../recognition/review-state'
import type { ReviewDiscount, ReviewLine, ReviewState, SentKeys } from '../recognition/review-state'
import { draftBody, filledLines, itemizedTotal, spendAsLine } from './expense-form'
import type { ExpenseDraft, ExpenseErrors } from './expense-form'
import { decimalText, lineInput, moneyText, newLine, scaled, trimDecimal } from './line-draft'
import type { LineDraft } from './line-draft'

export type CropReview = { imageId: number; base: ReviewState }
export type CropSend = { input: ReviewConfirmInput; sent: SentKeys; state: ReviewState; rows: number[]; lines: LineDraft[] }

/** «1,000» of the recognition form as a person types it: «1». */
const plain = (text: string) => text.trim() ? trimDecimal(text.trim().replace(',', '.')) : ''
const money = (text: string) => scaled(text.trim() || '0', 2, true)
const sum = (discounts: ReviewDiscount[]) => discounts.reduce((total, discount) => total + (money(discount.amount) ?? 0n), 0n)

export function cropReview(image: ReceiptImageDetail): CropReview {
  return { imageId: image.id, base: createReview(image.normalized_result, image.issues) }
}

/** The recognized receipt as a draft: each line with the discounts tied to it, the rest as discounts of the whole receipt. */
export function draftFromCrop({ base }: CropReview, today: string, currency: string): ExpenseDraft {
  const { header, lines, discounts } = base
  const linked = (key: number) => sum(discounts.filter((discount) => discount.line === key))
  const extra = sum(discounts.filter((discount) => !lines.some((line) => line.key === discount.line)))
  return {
    amount: '', currency: header.currency || currency, category: null, date: header.purchasedOn || today, place: header.storeName,
    note: '', source: 'photo',
    lines: lines.map((line): LineDraft => {
      const amount = money(line.amount)
      const discount = linked(line.key)
      return {
        ...newLine(), reviewKey: line.key, name: line.name, quantity: plain(line.quantity) || '1', unit: line.unit || 'pcs', price: plain(line.unitPrice),
        discount: discount ? moneyText(discount) : '', amount: amount === undefined ? line.amount : moneyText(amount - discount),
        // A recognized price leads: a corrected weight or count recounts the sum (quantity × price − discount).
        lead: plain(line.unitPrice) ? 'price' : 'amount', signed: amount !== undefined && amount <= 0n,
      }
    }),
    ...(extra > 0n && { extraDiscount: decimalText(extra, 2) }),
  }
}

/** The body of the confirmation, or the messages of the form. Recognized taxes go only while no money of the lines
 * changed: a tax summary that no longer adds up would refuse the save, and the receipt is saved without it. */
export function cropInput({ base }: CropReview, draft: ExpenseDraft): CropSend | { errors: ExpenseErrors } {
  let lines = filledLines(draft.lines)
  if (!lines.length) {
    // A photo receipt is kept by lines: one typed amount becomes its one line.
    const single = spendAsLine(draft)
    if (!single) return { errors: { amount: 'Введите сумму либо позиции чека.' } }
    lines = [single]
  }
  const sending = { ...draft, lines }
  const checked = draftBody(sending)
  if ('errors' in checked) return checked
  let nextKey = base.nextKey
  const byKey = new Map(base.lines.map((line) => [line.key, line]))
  const used = new Set<number>()
  const rows: number[] = []
  const reviewLines: ReviewLine[] = []
  const discounts: ReviewDiscount[] = []
  let changed = false
  for (const line of lines) {
    const checkedLine = lineInput(line)
    if ('errors' in checkedLine) return { errors: { form: 'Проверьте позиции.' } }
    const body = checkedLine.input
    const original = line.reviewKey !== undefined && !used.has(line.reviewKey) ? byKey.get(line.reviewKey) : undefined
    const key = original?.key ?? nextKey++
    if (original) used.add(original.key)
    reviewLines.push({
      ...(original ?? { source: null, kind: 'product', parent: null, taxKind: '', taxRate: '', taxCode: '' }),
      key, name: body.name, quantity: body.quantity ?? '1', unit: body.unit ?? 'pcs', unitPrice: body.unit_price ?? '', amount: body.amount,
    })
    rows.push(key)
    const discount = money(body.discount_amount ?? '0') ?? 0n
    const before = original ? base.discounts.filter((item) => item.line === original.key) : []
    if (!original || money(original.amount) !== money(body.amount) || discount !== sum(before)) changed = true
    if (discount > 0n) {
      discounts.push(...(original && discount === sum(before) ? before
        : [{ key: nextKey++, line: key, name: before[0]?.name || 'Скидка', amount: decimalText(discount, 2) }]))
    }
  }
  if (used.size !== base.lines.length) changed = true
  const whole = base.discounts.filter((discount) => !base.lines.some((line) => line.key === discount.line))
  const extra = draft.extraDiscount ? money(draft.extraDiscount) ?? 0n : 0n
  if (extra !== sum(whole)) changed = true
  if (extra > 0n) discounts.push(...(extra === sum(whole) ? whole : [{ key: nextKey++, line: null, name: whole[0]?.name || 'Скидка', amount: decimalText(extra, 2) }]))
  const place = draft.place.trim()
  const state: ReviewState = {
    ...base, nextKey, lines: reviewLines, discounts, taxes: changed ? [] : base.taxes,
    header: {
      ...base.header, storeName: place, store: place === base.header.storeName.trim() ? base.header.store : null,
      purchasedOn: draft.date, currency: draft.currency.trim().toUpperCase(), total: itemizedTotal(sending) ?? '',
    },
  }
  return { ...buildInput(state), state, rows, lines }
}

const placeFields = new Set(['store', 'store_name', 'address', 'country'])
const lineFields: Record<string, string> = { name: 'name', quantity: 'quantity', unit: 'quantity', unit_price: 'price', amount: 'amount' }

/**
 * A refused confirmation as messages of the form: a cause of a field of the form is shown at that field, every other
 * one is named by its place («Итого — Сумма строк не совпадает с итогом») in the message above the save button.
 */
export function cropErrors(error: LocalApiFailure, send: CropSend): ExpenseErrors {
  const problems = error.reason === 'review_invalid' ? issueProblems(error.issues ?? [], send.sent)
    : error.reason === 'invalid_parameter' ? fieldProblems(error.fields ?? [], send.sent) : {}
  const errors: ExpenseErrors = {}
  const rest: string[] = []
  const add = (name: string, text: string) => { errors[name] = errors[name] ? `${errors[name]} ${text}` : text }
  for (const entry of problemSummary({ ...send.state, problems })) {
    const text = [...new Set(entry.texts)].join(' ')
    const [list, key, ...field] = entry.id.split('.')
    const row = list === 'lines' && key !== undefined ? send.rows.indexOf(Number(key))
      : list === 'discounts' && key !== undefined ? send.rows.indexOf(send.state.discounts.find((item) => String(item.key) === key)?.line ?? -1) : -1
    if (list === 'receipt' && key === 'purchased_on') add('date', text)
    else if (list === 'receipt' && key === 'currency') add('currency', text)
    else if (list === 'receipt' && key !== undefined && placeFields.has(key)) add('place', text)
    else if (row >= 0) add(`lines.${row}.${list === 'discounts' ? 'discount' : lineFields[field.join('.')] ?? 'amount'}`, text)
    else rest.push(`${entry.title} — ${text}`)
  }
  if (rest.length) errors.form = rest.join('\n')
  return errors
}

/** What the confirmation cannot carry, saved right after it by `PATCH /api/receipts/{id}/`: the note, the payment method
 * and the categories chosen for lines. `undefined` — nothing to add. `saved` — the lines of the new receipt in order. */
export function afterConfirm(draft: ExpenseDraft, send: CropSend, saved: Line[] | null): ManualSpendInput | undefined {
  const body: Partial<ManualSpendInput> = {}
  if (draft.note.trim()) body.note = draft.note.trim()
  if (draft.method) body.payment_method = draft.method
  if (saved && saved.length === send.lines.length && send.lines.some((line) => line.category !== null)) {
    body.lines = saved.map((line, index) => ({
      id: line.id, name: line.name, quantity: line.quantity, unit: line.unit, unit_price: line.unit_price, amount: line.amount,
      discount_amount: line.discount_amount, category: send.lines[index].category ?? line.category?.id ?? null,
    }))
  }
  return Object.keys(body).length ? body as ManualSpendInput : undefined
}

/** What the recognition could not settle, before any edit: «Итого — Сумма строк не совпадает с итогом». */
export function cropCauses({ base }: CropReview): string[] {
  const sentKeys = { lines: base.lines.map((row) => row.key), discounts: base.discounts.map((row) => row.key), taxes: base.taxes.map((row) => row.key) }
  return problemSummary({ ...base, problems: issueProblems(base.issues, sentKeys) }).map((entry) => `${entry.title} — ${[...new Set(entry.texts)].join(' ')}`)
}
