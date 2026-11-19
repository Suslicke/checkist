import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { LocalApiErrorReason } from '../../api/types'
import { TrendsPage } from './index'
import { CategoryBlock, MonthlyBlock, PricesBlock } from './trends-blocks'
import { LimitsBlock, MonthToMonthBlock, SummaryStrip } from './trends-dashboard'
import { monthOfDate, shiftMonth } from './trends-period'
import { monthName } from './trends-state'
import { categoryFixture, limitsFixture, monthlyFixture, pricesFixture, suggestedFixture, utilitiesFixture } from './trends-test-support'

const noop = () => {}
/** Markup as a person reads it: non-breaking spaces as ordinary ones. */
const html = (node: React.ReactElement) => renderToStaticMarkup(node).replace(/[\u00a0\u202f]/g, ' ')
/** The words of the markup: a sum drawn by Money reads as one value, «179,73 €». */
const text = (markup: string) => markup
  .replace(/<span class="ck-money-(?:int|frac|cur|sign|approx)">([^<]*)<\/span>/g, '$1')
  .replace(/<span class="ck-money[^"]*">([^<]*)<\/span>/g, '$1')
  .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
const ok = <T,>(data: T) => ({ kind: 'ok' as const, data })
const failure = (reason: LocalApiErrorReason) => ({ kind: 'error' as const, reason })
const count = (markup: string, needle: string) => markup.split(needle).length - 1

describe('«Динамика» screen (Vitest/SSR, not browser acceptance)', () => {
  it('opens with the window choice and every block loading', () => {
    // The ready periods end at the month of the device until the server names its own: the last 24 of today.
    const to = monthOfDate(new Date())
    const from = shiftMonth(to, -23)
    const markup = html(<TrendsPage query={{ from, to }} />)
    expect(markup).toContain(`<a class="ck-chip" aria-current="true" href="/stats/trends?from=${from}&amp;to=${to}">24 месяца</a>`)
    expect(text(markup)).toContain(`Период: ${monthName(from)} — ${monthName(to)} , 24 месяца`.replace(/[\u00a0\u202f]/g, ' '))
    for (const title of ['Траты по месяцам', 'Месяц к месяцу', 'Лимиты по месяцам', 'Категория во времени', 'Как менялись цены']) {
      expect(markup).toContain(`>${title}</h3>`)
    }
    expect(count(markup, 'aria-busy="true"')).toBeGreaterThanOrEqual(5)
    expect(markup).not.toContain('trends-strip')
  })

  it('shows the summary strip: big numbers, arrows with signs and words, the price index', () => {
    const markup = html(<SummaryStrip monthly={ok(monthlyFixture())} prices={ok(pricesFixture())} />)
    // The first currency carries the main number of the screen (Money, display), another a title-sized one; a change is
    // an arrow, a sign and words — calm, in ink.
    expect(markup).toContain('<p class="trends-big trends-big-main"><span class="ck-money ck-money--display">')
    expect(markup).toContain('<p class="trends-big"><span class="ck-money ck-money--title">')
    expect(count(markup, 'ck-money--display')).toBe(1)
    expect(text(markup)).toContain('сентябрь 2026 · € 190,24 €')
    expect(text(markup)).toContain('сентябрь 2026 · ₸ 7 836 ₸')
    expect(markup).toContain('<p class="trends-change trends-change-down"><span aria-hidden="true">▼</span> на 12,41 % меньше, чем в августе 2026</p>')
    expect(text(markup)).toContain('на 5,85 % больше, чем в среднем за период (179,73 €)')
    expect(markup).toContain('Потрачено за <time dateTime="2026-09-01">сентябрь 2026</time> · €')
    expect(text(markup)).toContain('Цены на те же товары выросли на 0,89 % с октября 2025')
    expect(text(markup)).toContain('Подорожало: 23 товара, подешевело: 4 товара')
    expect(html(<SummaryStrip monthly={{ kind: 'loading' }} prices={failure('network')} />)).toBe('')
  })

  it('draws the months as links with their totals and opens one of them', () => {
    const markup = html(<MonthlyBlock state={ok(monthlyFixture())} query={{ month: '2026-02' }} onRetry={noop} />)
    expect(count(markup, 'class="ck-columns-hit"')).toBe(24)
    expect(markup).toContain('aria-label="февраль 2026: 179,17 €, открыт"')
    expect(markup).toContain('class="ck-columns-swatch ck-columns-tone-6"')
    expect(text(markup)).toContain('Траты месяца подробно →')
    expect(markup).toContain('href="/stats?date_from=2026-02-01&amp;date_to=2026-02-28&amp;currency=EUR"')
    expect(markup).toContain('<summary>Таблица значений</summary>')
    const closed = html(<MonthlyBlock state={ok(monthlyFixture())} query={{}} onRetry={noop} />)
    expect(text(closed)).toContain('Нажмите на столбец')
  })

  it('lists categories month to month with a sparkline and a change badge', () => {
    const markup = html(<MonthToMonthBlock state={ok(monthlyFixture())} query={{}} onRetry={noop} />)
    expect(count(markup, '<svg class="trends-spark"')).toBe(monthlyFixture().currencies.reduce((sum, block) => sum + block.rows.length, 0))
    expect(markup).toContain('<tr class="trends-sub-row"><th scope="row"><a href="/stats/trends?category=2">Молочные продукты</a></th>')
    expect(markup).toContain('<th scope="col" class="trends-number"><time dateTime="2026-08-01">авг 2026</time></th>')
    expect(count(markup, '<th scope="col" class="trends-number"><time')).toBe(24)
    expect(markup).toContain('<span class="trends-spark-from">с декабря 2025</span>')
    expect(text(markup)).toContain('Итого за период')
    expect(markup).toContain('trends-badge trends-badge-up')
  })

  it('shows the share of the limit per month and marks the months over the limit', () => {
    const markup = html(<LimitsBlock state={ok(limitsFixture())} onRetry={noop} />)
    expect(count(markup, 'class="trends-cell trends-cell-over"')).toBe(5)
    expect(count(markup, '> · сверх лимита</span>')).toBe(5)
    expect(text(markup)).toContain('Сверх лимита: 2 из 6 мес.')
    // The 2.0 LimitBar: from 80 % the over tone with the words «почти лимит», past 100 % «сверх лимита».
    expect(markup).toContain('<span class="trends-cell-bar ck-bar is-near" aria-hidden="true"><span style="width:86%"></span></span>')
    expect(count(markup, 'class="trends-cell-bar ck-bar is-over"')).toBe(5)
    expect(count(markup, 'class="trends-cell trends-cell-near"')).toBe(count(markup, '> · почти лимит</span>'))
    expect(count(markup, '> · почти лимит</span>')).toBeGreaterThan(0)
    // A month says what was spent against the limit of that month; the newest month comes first.
    expect(text(markup)).toContain('68,93 € из 80 €')
    expect(markup.indexOf('dateTime="2026-09-01"')).toBeLessThan(markup.indexOf('dateTime="2026-04-01"'))
    expect(markup).toContain('<a class="stats-panel-link" href="/budget/limits">Изменить</a>')
    const empty = html(<LimitsBlock state={ok({ ...limitsFixture(), limits: [] })} onRetry={noop} />)
    expect(empty).toContain('href="/budget/limits"')
  })

  it('shows utilities over time with the average and split by sub-category', () => {
    const markup = html(<CategoryBlock state={ok(utilitiesFixture())} query={{ category: 21 }} onRetry={noop} />)
    expect(markup).toContain('<option value="21" selected="">Жильё › Коммунальные услуги</option>')
    expect(markup).toContain('<p class="trends-big"><span class="ck-money ck-money--title">')
    expect(text(markup)).toContain('Последний месяц 35 100 ₸')
    expect(text(markup)).toContain('Больше, чем в сентябре 2026 (30 800 ₸)')
    expect(text(markup)).toContain('Из чего складывается')
    expect(markup).toContain('aria-label="Жильё › Коммунальные услуги: подкатегории по месяцам, KZT"')
    expect(text(markup)).toContain('Жильё › Коммунальные услуги: без подкатегории')
  })

  it('names a suggested category and keeps the demo parts', () => {
    expect(text(html(<CategoryBlock state={ok(suggestedFixture())} query={{}} onRetry={noop} />))).toContain('выбрана категория, где тратили чаще всего')
    expect(text(html(<CategoryBlock state={ok(categoryFixture())} query={{ category: 1 }} onRetry={noop} />))).toContain('Молочные продукты')
    const missing = html(<CategoryBlock state={failure('not_found')} query={{ category: 999 }} onRetry={noop} />)
    expect(missing).toContain('Такой категории нет.')
  })

  it('lists what got dearer and cheaper with links to the product cards and a note about manual spends', () => {
    const markup = html(<PricesBlock state={ok(pricesFixture())} onRetry={noop} />)
    expect(markup).toContain('<a class="trends-mover-name" href="/catalog/products/11">Demo Butterkeks</a>')
    expect(text(markup)).toContain('1,55 €/шт → 1,62 €/шт')
    expect(text(markup)).toContain('ручные траты без товаров в расчёт не входят')
    expect(markup).toContain('<span aria-hidden="true">▼</span> <span class="trends-value">−3,88 %</span>')
  })

  it('has loading, empty and error states in every block', () => {
    expect(html(<MonthlyBlock state={{ kind: 'loading' }} query={{}} onRetry={noop} />)).toContain('Загружаем траты по месяцам…')
    expect(html(<MonthlyBlock state={ok({ ...monthlyFixture(), currencies: [], excluded: [] })} query={{}} onRetry={noop} />)).toContain('За это время трат нет.')
    // Spends only in a currency without a rate: they are named, not reported as no spends at all.
    const unconverted = html(<MonthlyBlock state={ok({ ...monthlyFixture(), currencies: [] })} query={{}} onRetry={noop} />)
    expect(unconverted).toContain('Нет курса Нацбанка на дату покупки — в итог не вошли:')
    expect(unconverted).not.toContain('За это время трат нет.')
    expect(html(<PricesBlock state={ok({ ...pricesFixture(), currencies: [] })} onRetry={noop} />)).toContain('нет покупок товаров из чеков с фото')
    expect(html(<PricesBlock state={failure('network')} onRetry={noop} />)).toContain('data-request-retry')
    expect(html(<LimitsBlock state={failure('timeout')} onRetry={noop} />)).toContain('Сервер не ответил вовремя.')
    expect(html(<MonthToMonthBlock state={failure('invalid_parameter')} query={{}} onRetry={noop} />)).not.toContain('data-request-retry')
  })
})
