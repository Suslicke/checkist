import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Private, { PrivateTextView, PrivateView } from '../components/Private'
import { formatApproxMoney, formatCents, formatMoney, formatMoneyNumber, formatMoneyWithBase } from '../lib/money'
import { formatPercent, formatPrice, formatQuantity } from '../lib/format'
import { amountParts, hideAmounts } from './privacy'

const H = 'сумма скрыта'

describe('hideAmounts: the amounts of a label while «Скрывать суммы» is on (pure)', () => {
  it('hides every amount lib/money.ts writes, with its sign, kopecks and currency', () => {
    expect(hideAmounts(formatMoney('9821.47', 'KZT'))).toBe(H)
    expect(hideAmounts(formatMoney('10', 'USD'))).toBe(H)
    expect(hideAmounts(formatMoney('-0.40', 'EUR'))).toBe(H)
    expect(hideAmounts(formatApproxMoney('8979', 'KZT'))).toBe(H)
    expect(hideAmounts(formatCents(150050n, 'KZT'))).toBe(H)
    expect(hideAmounts(formatMoney('20', 'UZS'))).toBe(H)
    expect(hideAmounts(`−${formatMoney('120', 'KZT')}`)).toBe(H)
    expect(hideAmounts(`+${formatMoney('650000', 'KZT')}`)).toBe(H)
    expect(hideAmounts(formatMoneyWithBase('20', 'USD', '8979', 'KZT'))).toBe(`${H} · ${H}`)
  })

  it('keeps the words of a sentence around its amounts', () => {
    expect(hideAmounts(`на ${formatMoney('34375.02', 'KZT')} меньше, чем в сентябре`)).toBe(`на ${H} меньше, чем в сентябре`)
    expect(hideAmounts(`Потрачено ${formatMoney('465162.41', 'KZT')}: Жильё ${formatMoney('187990', 'KZT')}, Авто ${formatMoney('30000', 'KZT')}`))
      .toBe(`Потрачено ${H}: Жильё ${H}, Авто ${H}`)
    expect(hideAmounts(`3 платежа к оплате (${formatMoney('58990', 'KZT')}), поровну на 11 дней`)).toBe(`3 платежа к оплате (${H}), поровну на 11 дней`)
  })

  it('hides a price per unit and an amount a model wrote with ordinary spaces', () => {
    expect(hideAmounts(`2 шт × ${formatPrice('1450', 'KZT')}`)).toBe(`2 шт × ${H}`)
    expect(hideAmounts(formatPrice('1053.21', 'KZT', 'kg'))).toBe(`${H}/кг`)
    expect(hideAmounts('Всего ушло 587 205 KZT, больше всего — на «Жильё»: 221 390 KZT.')).toBe(`Всего ушло ${H}, больше всего — на «Жильё»: ${H}.`)
  })

  it('hides a bare amount of formatMoneyNumber only beside one with a currency', () => {
    expect(hideAmounts(`${formatMoneyNumber('120000')} из ${formatMoney('500000', 'KZT')}`)).toBe(`${H} из ${H}`)
    expect(hideAmounts(`${formatPrice('667.67', 'KZT', 'pcs')} (мин. 620,00, макс. 756,00)`)).toBe(`${H}/шт (мин. ${H}, макс. ${H})`)
    // Alone a grouped number may be a count: left as it is.
    expect(hideAmounts('Подорожало: 1\u00a0200 товаров')).toBe('Подорожало: 1\u00a0200 товаров')
  })

  it('hides the price after «×» on the paper slip, where the currency is named once at its total', () => {
    expect(hideAmounts('2\u00a0шт × 1,29')).toBe(`2\u00a0шт × ${H}`)
    expect(hideAmounts('1,228\u00a0кг × 2\u00a0783,00')).toBe(`1,228\u00a0кг × ${H}`)
    expect(hideAmounts('2\u00a0шт × 3')).toBe('2\u00a0шт × 3')
  })

  it('takes every number but a percent and a quantity as an amount of a text about money', () => {
    expect(hideAmounts('лимит изменён: 120\u00a0000 → 150\u00a0000', true)).toBe(`лимит изменён: ${H} → ${H}`)
    expect(hideAmounts('лимит задан: 200', true)).toBe(`лимит задан: ${H}`)
    expect(hideAmounts('лимит задан: 200')).toBe('лимит задан: 200')
    expect(hideAmounts('июль 2026: лимит снят (был 120\u00a0000,40)', true)).toBe(`июль 2026: лимит снят (был ${H})`)
    expect(hideAmounts(`${formatPercent('12.5')}, ${formatQuantity('2', 'pcs')}`, true)).toBe('12,50\u00a0%, 2\u00a0шт')
  })

  it('leaves a text without amounts, percents, dates, numbers, years and quantities untouched', () => {
    for (const text of ['Траты по категориям', '73\u00a0%', formatPercent('10.16'), '20.11.2026', '№\u00a012', 'Сегодня 20 ноября 2026',
      '1 из 2 сделано', `${formatQuantity('1.228', 'kg')}`, 'Вертикальная ось: KZT.', 'PDF, 3 стр.', '']) {
      expect(hideAmounts(text)).toBe(text)
    }
    expect(hideAmounts(`${formatPercent('75')} лимита ${formatMoney('40000', 'KZT')}, ${formatQuantity('1.25', 'kg')}`))
      .toBe(`75,00\u00a0% лимита ${H}, 1,25\u00a0кг`)
  })

  it('cuts a text into words and amounts that join back into the same text', () => {
    const text = `Сохранить 7 трат · ${formatMoney('42690', 'KZT')}`
    expect(amountParts(text)).toEqual([{ text: 'Сохранить 7 трат · ', amount: false }, { text: formatMoney('42690', 'KZT'), amount: true }])
    expect(amountParts(text).map((part) => part.text).join('')).toBe(text)
    expect(amountParts('Без сумм')).toEqual([{ text: 'Без сумм', amount: false }])
  })
})

describe('markup of an amount written as text (components/Private.tsx)', () => {
  it('blurs the text and gives the screen reader «сумма скрыта», as Money does', () => {
    expect(renderToStaticMarkup(<PrivateView hidden>{formatMoney('18555.38', 'KZT')}</PrivateView>))
      .toBe(`<span class="ck-private" aria-hidden="true">18\u00a0555,38\u00a0₸</span><span class="ck-visually-hidden">${H}</span>`)
    expect(renderToStaticMarkup(<PrivateView hidden className="ck-twin">≈ 1 ₸</PrivateView>))
      .toBe(`<span class="ck-private ck-twin" aria-hidden="true">≈ 1 ₸</span><span class="ck-visually-hidden">${H}</span>`)
  })

  it('is the text as it was while the sums are shown, and on a server', () => {
    expect(renderToStaticMarkup(<PrivateView hidden={false} className="ck-twin">≈ 1 ₸</PrivateView>)).toBe('<span class="ck-twin">≈ 1 ₸</span>')
    expect(renderToStaticMarkup(<PrivateView hidden={false}>2,58</PrivateView>)).toBe('2,58')
    expect(renderToStaticMarkup(<Private>{formatMoney('1', 'KZT')}</Private>)).not.toContain(H)
  })

  it('blurs only the amounts of a sentence, the words stay readable', () => {
    const text = `на ${formatMoney('34375.02', 'KZT')} меньше`
    expect(renderToStaticMarkup(<PrivateTextView hidden>{text}</PrivateTextView>))
      .toBe(`на <span class="ck-private" aria-hidden="true">34\u00a0375,02\u00a0₸</span><span class="ck-visually-hidden">${H}</span> меньше`)
    expect(renderToStaticMarkup(<PrivateTextView hidden={false}>{text}</PrivateTextView>)).toBe(text)
    expect(renderToStaticMarkup(<PrivateTextView hidden>Без сумм</PrivateTextView>)).toBe('Без сумм')
  })
})
