import { describe, expect, it } from 'vitest'
import { formatCents, formatCentsNumber, formatMoney, formatMoneyNumber, currencySymbol } from './money'

const n = '\u00a0'

describe('money is shown exactly, kopecks only when there are any', () => {
  it.each([
    ['9821.47', `9${n}821,47`], ['11692.55', `11${n}692,55`], ['0.01', '0,01'], ['10.00', '10'], ['10', '10'],
    ['10.5', '10,50'], ['0', '0'], ['0.00', '0'], ['-0.00', '0'], ['-0.40', '-0,40'], ['-12.25', '-12,25'],
    ['-5.00', '-5'], ['2.584', '2,58'], ['999.995', `1${n}000`], ['-0.005', '-0,01'], ['1234567.89', `1${n}234${n}567,89`], ['007.10', '7,10'],
    ['99999999999999999999.01', `99${n}999${n}999${n}999${n}999${n}999${n}999,01`],
  ])('%s → %s', (value, expected) => {
    expect(formatMoneyNumber(value)).toBe(expected)
  })

  it('glues the currency and keeps an absent or malformed value as a dash', () => {
    expect(formatMoney('4500', 'KZT')).toBe(`4${n}500${n}₸`)
    expect(formatMoney('4500', 'UZS')).toBe(`4${n}500${n}UZS`)
    expect(currencySymbol('USD')).toBe('$')
    expect(formatMoney('4499.10', '₸')).toBe(`4${n}499,10${n}₸`)
    expect(formatMoney('12.3', '')).toBe('12,30')
    expect(formatMoney('12.3', undefined)).toBe('12,30')
    for (const value of [null, undefined, '', 'abc', '1e3', '1,5', ' 1', '.5', '+1']) {
      expect(formatMoney(value as string | null, 'RUB')).toBe('—')
    }
  })

  it('shows exact cents the same way', () => {
    expect(formatCentsNumber(0n)).toBe('0')
    expect(formatCentsNumber(1n)).toBe('0,01')
    expect(formatCentsNumber(100n)).toBe('1')
    expect(formatCentsNumber(28745000n)).toBe(`287${n}450`)
    expect(formatCentsNumber(150050n)).toBe(`1${n}500,50`)
    expect(formatCents(-40n, 'KZT')).toBe(`-0,40${n}₸`)
  })
})
