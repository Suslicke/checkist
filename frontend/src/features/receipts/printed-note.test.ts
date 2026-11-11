import { describe, expect, it } from 'vitest'
import type { Line } from '../../api/receipts'
import { isLine } from '../../api/receipts-schema'
import { printedNote } from './line-facts'

const line: Line = {
  id: 1, position: 1, kind: 'service', parent_id: null, name: 'Электр. энергия', name_i18n: {}, store_item_code: '', barcode: '',
  quantity: '121.000', unit: 'kwh', unit_price: '38.0852', amount: '4608.31', discount_amount: '0.00', paid_amount: '4608.31',
  product: null, category: null, matching_status: 'unmatched', tax_rate: null, tax_code: '', tax_amount: null,
  is_excise: false, is_marked: false,
}
const plain = (text: string | null) => text?.replace(/\s/g, ' ')

describe('«В чеке: …» under a line whose amount was kept as the fact', () => {
  it('says nothing when nothing was replaced, also for an answer of an older server', () => {
    expect(printedNote(line, 'KZT')).toBeNull()
    expect(printedNote({ ...line, printed: null }, 'KZT')).toBeNull()
    expect(isLine(line)).toBe(true)
  })

  it('shows the printed price next to the recalculated one', () => {
    const printed = { quantity: null, unit: null, unit_price: '34.2800' }
    expect(isLine({ ...line, printed })).toBe(true)
    expect(plain(printedNote({ ...line, printed }, 'KZT'))).toBe('В чеке: цена 34,28 ₸')
  })

  it('shows the printed unit and quantity of a line that became one piece', () => {
    const one: Line = { ...line, quantity: '1.000', unit: 'pcs', unit_price: '339.7900', amount: '339.79', paid_amount: '339.79' }
    expect(plain(printedNote({ ...one, printed: { quantity: null, unit: 'm3', unit_price: '679.2300' } }, 'KZT')))
      .toBe('В чеке: единица м³ · цена 679,23 ₸')
    expect(plain(printedNote({ ...one, printed: { quantity: '10.760', unit: 'm3', unit_price: null } }, 'KZT')))
      .toBe('В чеке: 10,76 м³')
  })

  it('refuses a malformed printed object', () => {
    expect(isLine({ ...line, printed: { quantity: 1, unit: 'm3', unit_price: null } })).toBe(false)
  })
})
