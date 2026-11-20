import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { dashboardFixture, limitFixture } from '../../api/budget-test-support'
import type { Dashboard, DashboardAllowance } from '../../api/budget'
import type { Category } from '../../api/types'
import { allowanceView } from './dashboard-state'
import { DashboardView } from './DashboardPage'
import { LimitsView, MonthBudgetPanel } from './LimitsPage'

/** Spaces of any width as one: the glue of money (lib/text.ts) is not what these tests check. */
const plain = (text: string) => text.replace(/[\u00a0\u202f]/g, ' ')
/** <Money> repeats its amount for a screen reader as one phrase beside the digits; a person sees the digits once. */
const once = (html: string) => html.replace(/(<span class="ck-money-digits" aria-hidden="true">(?:<span class="ck-money-[a-z]+">[^<]*<\/span>)+<\/span>)<span class="ck-visually-hidden">[^<]*<\/span>/g, '$1')
const words = (html: string) => plain(once(html.replace(/<svg\b.*?<\/svg>/g, '')).replace(/<[^>]+>/g, ''))
const seen = (value: { note: string }) => ({ ...value, note: plain(value.note) })
const noop = () => {}
const save = async () => undefined
const allowance: DashboardAllowance = {
  currency: 'KZT', basis: 'budget', amount: '700000.00', spent: '287450.00', unpaid: '23000.00', unpaid_count: 2,
  days_left: 19, per_day: '20449.47', overspent: null,
}
const view = (extra: Partial<Dashboard>, today = '2026-10') =>
  renderToStaticMarkup(<DashboardView data={{ ...dashboardFixture(), ...extra }} today={today} date="2026-10-13" />)

describe('«Можно тратить в день» (2026-10-13)', () => {
  it('says the day, the basis, the payments set aside and the days', () => {
    expect(seen(allowanceView(allowance))).toEqual({
      label: 'Можно тратить в день', amount: '20449.47', over: false,
      note: 'Бюджет месяца 700 000 ₸ минус траты и 2 платежа к оплате (23 000 ₸), поровну на 19 дней',
    })
    expect(plain(allowanceView({ ...allowance, basis: 'income', unpaid: '0.00', unpaid_count: 0, days_left: 3 }).note))
      .toBe('Доход месяца 700 000 ₸ минус траты, поровну на 3 дня')
  })

  it('is an honest overspend below zero, never a negative day', () => {
    expect(seen(allowanceView({ ...allowance, per_day: null, overspent: '51437.63', unpaid: '0.00', unpaid_count: 0 }))).toEqual({
      label: 'Перерасход', amount: '51437.63', over: true, note: 'Траты больше бюджета месяца 700 000 ₸',
    })
    expect(plain(allowanceView({ ...allowance, basis: 'income', per_day: null, overspent: '10.00', unpaid_count: 1 }).note))
      .toBe('Траты и 1 платёж к оплате больше дохода месяца 700 000 ₸')
  })

  it('stands in the line under the main number of the current month only, with how it was counted as a title', () => {
    const html = view({ allowance })
    const sub = html.slice(html.indexOf('<p class="dash-hero-sub"'), html.indexOf('</p>', html.indexOf('<p class="dash-hero-sub"')))
    expect(words(sub)).toContain('20 449,47 ₸ в день')
    expect(plain(sub)).toContain('title="Бюджет месяца 700 000 ₸ минус траты и 2 платежа к оплате (23 000 ₸), поровну на 19 дней"')
    // Gone below zero: never a negative day in the line (the number «В день» says «Перерасход» instead, home-hero.test.ts).
    const over = view({ allowance: { ...allowance, per_day: null, overspent: '100.00' } })
    expect(words(over.slice(over.indexOf('<p class="dash-hero-sub"'), over.indexOf('</p>', over.indexOf('<p class="dash-hero-sub"'))))).not.toContain('в день')
    // A past month: the server sends none, and a stale one is not drawn either.
    expect(words(view({ allowance }, '2026-11'))).not.toContain('в день')
    expect(words(view({ allowance: null }))).not.toContain('в день')
  })
})

describe('«Бюджет месяца» on «Главная» (2026-10-26: the gap of the ring and the foot of the hero)', () => {
  it('is the remainder of the ring and the line under it, not a row in «Лимиты»', () => {
    const html = view({ budget: { amount: '400000.00', currency: 'KZT', spent: '287450.00' } })
    const hero = html.slice(html.indexOf('dash-hero'), html.indexOf('</section>', html.indexOf('dash-hero')))
    const ring = html.slice(html.indexOf('dash-where'), html.indexOf('</section>', html.indexOf('dash-where')))
    expect(words(hero)).toContain('из 400 000 ₸ бюджета')
    expect(words(ring)).toContain('Остаток бюджета 112 550 ₸')
    expect(words(ring)).toContain('72 %бюджета')
    expect(html.slice(html.indexOf('dash-limits'))).not.toContain('dash-budget')
    const over = view({ budget: { amount: '200000.00', currency: 'KZT', spent: '287450.00' } })
    expect(words(over)).toContain('сверх бюджета на 87 450 ₸')
    expect(words(over)).toContain('Сверх бюджета 87 450 ₸')
  })

  it('is not drawn in a month without spends, and is absent without a budget', () => {
    const empty = { currencies: [], recent: [] }
    expect(view({ ...empty, budget: { amount: '400000.00', currency: 'KZT', spent: '0.00' } })).not.toContain('Остаток бюджета')
    expect(view(empty)).toContain('Задать лимиты')
    expect(view({ budget: null })).not.toContain('Остаток бюджета')
  })
})

describe('the budget panel of «Лимиты»', () => {
  const category: Category = { id: 3, name: 'Продукты', path: [{ id: 3, name: 'Продукты' }], parent_id: null, depth: 0, children_count: 0,
    generic_products_count: 0, products_count: 0, products_total: 0 }
  const limits = (budget?: Parameters<typeof LimitsView>[0]['budget']) => renderToStaticMarkup(<LimitsView categories={[category]}
    limits={[limitFixture()]} currencies={['KZT']} currency="KZT" base="KZT" family drafts={{}} statuses={{}}
    onCurrency={noop} onAddCurrency={() => undefined} onDraft={noop} onSave={noop} onDelete={noop} budget={budget} />)

  it('comes after the currency, before the rows, with a newer server only', () => {
    const html = limits({ state: { kind: 'ok', budget: { amount: '700000.00', currency: 'KZT', base_currency: 'KZT' } }, onSave: save })
    expect(html.indexOf('limits-budget')).toBeGreaterThan(html.indexOf('limits-currencies'))
    expect(html.indexOf('limits-budget')).toBeLessThan(html.indexOf('limits-list'))
    expect(limits()).not.toContain('limits-budget')
  })

  it('stands with the currency, the list and the save bar in one wrapper; the history and «На главную» come after it (desktop columns)', () => {
    // The wrapper is `display: contents` below 960 px: a phone reads the same sequence as before.
    const html = renderToStaticMarkup(<LimitsView categories={[category]} limits={[limitFixture()]} currencies={['KZT']} currency="KZT" base="KZT"
      family drafts={{}} statuses={{}} onCurrency={noop} onAddCurrency={() => undefined} onDraft={noop} onSave={noop} onDelete={noop}
      budget={{ state: { kind: 'ok', budget: { amount: '700000.00', currency: 'KZT', base_currency: 'KZT' } }, onSave: save }}
      history={{ kind: 'ok', changes: [] }} />)
    const at = (marker: string) => { const index = html.indexOf(marker); expect(index, marker).toBeGreaterThan(-1); return index }
    expect(html).toContain('</p><div class="limits-main"><section class="ck-panel dash-card limits-currencies"')
    expect(at('limits-intro')).toBeLessThan(at('<div class="limits-main">'))
    expect(at('limits-currencies')).toBeLessThan(at('limits-budget'))
    expect(at('limits-budget')).toBeLessThan(at('limits-list'))
    expect(at('limits-list')).toBeLessThan(at('limits-savebar'))
    expect(at('limits-savebar')).toBeLessThan(at('limits-history'))
    expect(at('limits-history')).toBeLessThan(at('limits-back'))
    // The wrapper closes right after the save bar: the history is a sibling of the wrapper, not its child.
    expect(html).toContain('</button></div></div><section class="ck-panel dash-card limits-history"')
    expect(html.match(/limits-main/g)).toHaveLength(1)
  })

  it('shows the amount, the field in the base currency, «Сохранить» and «Убрать»', () => {
    const html = renderToStaticMarkup(<MonthBudgetPanel family onSave={save}
      state={{ kind: 'ok', budget: { amount: '700000.00', currency: 'KZT', base_currency: 'KZT' } }} />)
    expect(html).toContain('<h2 id="limits-budget-heading" class="limits-small-heading">Бюджет месяца</h2>')
    expect(html).toContain('<span class="limits-current"><span class="ck-money ck-money--inline"><span class="ck-money-digits" aria-hidden="true"><span class="ck-money-int">700\u202f000</span><span class="ck-money-cur">\u202f₸</span></span><span class="ck-visually-hidden">700\u202f000\u202f₸</span></span></span>')
    expect(html).toContain('value="700000"')
    // A tonal button: the save bar of the limits is the one seal of the screen.
    expect(html).toContain('<button type="submit" class="ck-button-secondary limits-budget-save">Сохранить бюджет</button>')
    expect(html).toContain('>Убрать</button>')
    const none = renderToStaticMarkup(<MonthBudgetPanel family={false} onSave={save}
      state={{ kind: 'ok', budget: { amount: null, currency: null, base_currency: 'KZT' } }} />)
    expect(none).toContain('не задан')
    expect(none).toContain('Сколько вы готовы потратить')
    expect(none).not.toContain('Убрать')
    expect(renderToStaticMarkup(<MonthBudgetPanel family onSave={save} state={{ kind: 'error', message: 'Нет связи.' }} />)).toContain('Нет связи.')
  })
})
