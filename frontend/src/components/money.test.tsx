import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Money, { MoneyView } from './Money'
import { MINUS, THIN_NBSP, moneyParts } from './money-parts'

const T = THIN_NBSP

describe('parts of an amount (pure, strings only)', () => {
  it('groups the whole part by U+202F and keeps kopecks only when there are any', () => {
    expect(moneyParts('312418.40')).toEqual({ sign: '', int: `312${T}418`, frac: ',40' })
    expect(moneyParts('110000')).toEqual({ sign: '', int: `110${T}000`, frac: '' })
    expect(moneyParts('110000.00')).toEqual({ sign: '', int: `110${T}000`, frac: '' })
    expect(moneyParts('8760.98')).toEqual({ sign: '', int: `8${T}760`, frac: ',98' })
    expect(moneyParts('0.4')).toEqual({ sign: '', int: '0', frac: ',40' })
  })

  it('draws the minus as U+2212, never a hyphen, and never a minus before zero', () => {
    expect(moneyParts('-120')).toEqual({ sign: MINUS, int: '120', frac: '' })
    expect(moneyParts('-0.00')).toEqual({ sign: '', int: '0', frac: '' })
    expect(MINUS).toBe('−')
  })

  it('puts «+» before an income and «−» before an outflow on request', () => {
    expect(moneyParts('650000', 'plus')?.sign).toBe('+')
    expect(moneyParts('-650000', 'plus')?.sign).toBe(MINUS)
    expect(moneyParts('3400', 'minus')).toEqual({ sign: MINUS, int: `3${T}400`, frac: '' })
  })

  it('reads a long decimal as the rest of the client does: half away from zero, never as a Number', () => {
    expect(moneyParts('1.005')).toEqual({ sign: '', int: '1', frac: ',01' })
    // Beyond the safe integers of a Number: exact.
    expect(moneyParts('90071992547409931.17')?.int).toBe(`90${T}071${T}992${T}547${T}409${T}931`)
  })

  it('gives nothing for an absent or malformed value', () => {
    for (const value of [null, undefined, '', 'abc', '1e3', '12,5']) expect(moneyParts(value)).toBeNull()
  })
})

describe('markup of a sum (Node server render)', () => {
  it('draws 312 418,40 ₸ as the whole part, the kopecks and the currency sign', () => {
    expect(renderToStaticMarkup(<Money value="312418.40" currency="KZT" size="hero" />)).toBe(
      `<span class="ck-money ck-money--hero"><span class="ck-money-int">312${T}418</span><span class="ck-money-frac">,40</span>`
      + `<span class="ck-money-cur">${T}₸</span></span>`,
    )
  })

  it('draws a round amount without kopecks, inline by default', () => {
    expect(renderToStaticMarkup(<Money value="110000" currency="KZT" />))
      .toBe(`<span class="ck-money ck-money--inline"><span class="ck-money-int">110${T}000</span><span class="ck-money-cur">${T}₸</span></span>`)
  })

  it('draws a negative amount with U+2212 and an amount without a currency as the number alone', () => {
    expect(renderToStaticMarkup(<Money value="-120" currency="KZT" size="row" />)).toBe(
      `<span class="ck-money ck-money--row"><span class="ck-money-sign">${MINUS}</span><span class="ck-money-int">120</span><span class="ck-money-cur">${T}₸</span></span>`,
    )
    expect(renderToStaticMarkup(<Money value="15.5" />)).toBe('<span class="ck-money ck-money--inline"><span class="ck-money-int">15</span><span class="ck-money-frac">,50</span></span>')
  })

  it('draws a dash for an absent value', () => {
    expect(renderToStaticMarkup(<Money value={null} currency="KZT" size="title" />)).toBe('<span class="ck-money ck-money--title ck-money--missing">—</span>')
    expect(renderToStaticMarkup(<Money value={undefined} />)).toBe('<span class="ck-money ck-money--inline ck-money--missing">—</span>')
  })

  it('marks a converted amount with «≈ » and an income with «+» in its tone', () => {
    expect(renderToStaticMarkup(<Money value="8979" currency="KZT" approx className="ck-twin" />)).toBe(
      `<span class="ck-money ck-money--inline ck-twin"><span class="ck-money-approx">≈\u00a0</span><span class="ck-money-int">8${T}979</span><span class="ck-money-cur">${T}₸</span></span>`,
    )
    expect(renderToStaticMarkup(<Money value="650000" currency="KZT" sign="plus" tone="in" size="display" />)).toBe(
      `<span class="ck-money ck-money--display ck-money--in"><span class="ck-money-sign">+</span><span class="ck-money-int">650${T}000</span><span class="ck-money-cur">${T}₸</span></span>`,
    )
  })

  it('shows a currency without a common sign by its code', () => {
    expect(renderToStaticMarkup(<Money value="20" currency="USD" />)).toContain(`<span class="ck-money-cur">${T}$</span>`)
    expect(renderToStaticMarkup(<Money value="20" currency="UZS" />)).toContain(`<span class="ck-money-cur">${T}UZS</span>`)
  })

  it('hides the digits from a screen reader while «Скрывать суммы» is on: it hears «сумма скрыта»', () => {
    expect(renderToStaticMarkup(<MoneyView value="312418.40" currency="KZT" size="hero" hidden />)).toBe(
      `<span class="ck-money ck-money--hero"><span class="ck-money-digits" aria-hidden="true"><span class="ck-money-int">312${T}418</span>`
      + `<span class="ck-money-frac">,40</span><span class="ck-money-cur">${T}₸</span></span><span class="ck-visually-hidden">сумма скрыта</span></span>`,
    )
    // A server render sees the sums shown: the attribute of the inline script blurs them anyway.
    expect(renderToStaticMarkup(<Money value="1" currency="KZT" />)).not.toContain('сумма скрыта')
  })
})

describe('rules of a sum (text of App.css, not rendering)', () => {
  const app = readFileSync(new URL('../App.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const rule = (selector: string) => [...app.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => match[1].split(',').map((item) => item.trim()).includes(selector)).map((match) => match[2].trim()).join(' ')

  it('draws tabular digits in the display font that never break, kopecks at 70 % and the sign in ink-2', () => {
    expect(rule('.ck-money')).toContain('font-family: var(--ck-font-display); font-variant-numeric: tabular-nums; white-space: nowrap;')
    expect(rule('.ck-money-frac')).toBe('font-size: 0.7em; font-weight: 500; color: var(--ck-ink-2);')
    expect(rule('.ck-money-cur')).toContain('color: var(--ck-ink-2);')
    expect(rule('.ck-money--hero')).toContain('font-size: min(var(--ck-text-money-hero), 11vw);')
  })

  it('blurs every sum while «Скрывать суммы» is on, and the words cannot be selected', () => {
    expect(rule(':root[data-privacy] .ck-money')).toBe('filter: blur(0.35em); -webkit-user-select: none; user-select: none;')
    expect(rule('.ck-visually-hidden')).toContain('clip-path: inset(50%);')
  })
})
