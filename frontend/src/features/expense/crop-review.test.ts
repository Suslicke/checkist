import { describe, expect, it } from 'vitest'
import { readError } from '../../api/http'
import type { NormalizedLine, ReceiptImageDetail } from '../../api/recognition'
import { isReceiptImageDetail } from '../../api/recognition-schema'
import { publicFixture } from '../../api/recognition-test-support'
import { afterConfirm, cropErrors, cropInput, cropReview, draftFromCrop } from './crop-review'
import type { CropSend } from './crop-review'
import { editLine, newLine } from './line-draft'

const line = (position: number, patch: Partial<NormalizedLine> = {}): NormalizedLine => ({
  position, parent_position: null, kind: 'product', name: `ТОВАР ${position}`, unit: 'pcs', quantity: '1.000', unit_price: '100.0000', amount: '100.00',
  discount_amount: null, tax_amount: null, store_item_code: null, barcode: null, tax_code: 'A', is_excise: null, is_marked: null, tax_rate: { kind: 'vat', rate: '16.00' }, ...patch,
})
function image(): ReceiptImageDetail {
  const value = publicFixture('receipt-image.json')
  if (!isReceiptImageDetail(value)) throw new Error('Invalid fixture')
  const result = value.normalized_result!
  return { ...value, normalized_result: {
    ...result, proposed_receipt: { ...result.proposed_receipt, currency: 'KZT', total: '190.00' },
    lines: [line(1), line(2, { name: 'САХАР', quantity: '2.000', unit_price: '50.0000' })],
    discounts: [{ position: 1, line_position: 1, name: 'Скидка карты', amount: '10.00' }],
    taxes: [{ tax_rate: { kind: 'vat', rate: '16.00' }, tax_code: 'A', net: '163.79', tax: '26.21', gross: '190.00' }],
  } } as ReceiptImageDetail
}
const sent = (result: ReturnType<typeof cropInput>): CropSend => { if ('errors' in result) throw new Error(JSON.stringify(result.errors)); return result }

describe('a crop in the one spend form', () => {
  it('fills the draft: place, date, currency, lines with their own discounts', () => {
    const draft = draftFromCrop(cropReview(image()), '2026-10-14', 'USD')
    expect(draft).toMatchObject({ place: 'Тестовый магазин', date: '2026-10-04', currency: 'KZT', source: 'photo' })
    expect(draft.lines.map((row) => [row.name, row.quantity, row.price, row.discount, row.amount])).toEqual([
      ['ТОВАР 1', '1', '100', '10', '90'], ['САХАР', '2', '50', '', '100']])
  })
  it('counts the sum of a recognized line from a corrected weight or count', () => {
    const [first, second] = draftFromCrop(cropReview(image()), '2026-10-14', 'USD').lines
    expect(editLine(second, 'quantity', '0,486')).toMatchObject({ price: '50', amount: '24.30' })
    // The line's own discount stays taken off: 3 × 100 − 10.
    expect(editLine(first, 'quantity', '3')).toMatchObject({ price: '100', amount: '290' })
  })
  it('sends the recognized receipt back unchanged: kinds, tax rates, the discount and the taxes stay', () => {
    const crop = cropReview(image())
    const { input } = sent(cropInput(crop, draftFromCrop(crop, '2026-10-14', 'KZT')))
    expect(input.receipt).toMatchObject({ store_name: 'Тестовый магазин', address: 'Teststrasse 12', country: 'DE', currency: 'KZT', total: '190.00', purchased_on: '2026-10-04' })
    expect(input.lines.map((row) => [row.source_position, row.kind, row.amount, row.tax_rate])).toEqual([
      [1, 'product', '100.00', { kind: 'vat', rate: '16.00' }], [2, 'product', '100.00', { kind: 'vat', rate: '16.00' }]])
    expect(input.discounts).toEqual([{ position: 1, line_position: 1, name: 'Скидка карты', amount: '10.00' }])
    expect(input.taxes).toHaveLength(1)
  })
  it('drops the taxes once money changed, and a new line is a product of its own', () => {
    const crop = cropReview(image())
    const draft = draftFromCrop(crop, '2026-10-14', 'KZT')
    const changed = { ...draft, lines: [{ ...draft.lines[0], amount: '80' }, draft.lines[1], { ...newLine(), name: 'ПАКЕТ', amount: '15', price: '15' }] }
    const { input, rows } = sent(cropInput(crop, changed))
    expect(input.taxes).toEqual([])
    expect(input.receipt.total).toBe('195.00')
    expect(input.lines[2]).toMatchObject({ source_position: null, kind: 'product', name: 'ПАКЕТ', amount: '15.00' })
    expect(rows).toHaveLength(3)
  })
  it('needs the place of a photo receipt before any request', () => {
    const crop = cropReview(image())
    expect(cropInput(crop, { ...draftFromCrop(crop, '2026-10-14', 'KZT'), place: ' ' })).toEqual({ errors: { place: expect.any(String) } })
  })
  it('names a refusal without a field of the form by its place, above the button', () => {
    const crop = cropReview(image())
    const send = sent(cropInput(crop, draftFromCrop(crop, '2026-10-14', 'KZT')))
    const errors = cropErrors(readError(409, publicFixture('review-invalid.json'), true), send)
    expect(errors.form).toMatch(/^Итого — /)
  })
  it('adds the note and the method after the confirmation, and line categories by the saved lines', () => {
    const crop = cropReview(image())
    const draft = { ...draftFromCrop(crop, '2026-10-14', 'KZT'), note: 'к ужину', method: 'cash' as const }
    const send = sent(cropInput(crop, { ...draft, lines: [{ ...draft.lines[0], category: 5 }, draft.lines[1]] }))
    const saved = [11, 12].map((id) => ({ id, name: 'x', quantity: '1.000', unit: 'pcs', unit_price: '1.0000', amount: '1.00', discount_amount: '0.00', category: null }))
    expect(afterConfirm(draft, send, saved as never)).toMatchObject({ note: 'к ужину', payment_method: 'cash',
      lines: [{ id: 11, category: 5 }, { id: 12, category: null }] })
    expect(afterConfirm({ ...draft, note: '', method: '' }, sent(cropInput(crop, draft)), null)).toBeUndefined()
  })
})
