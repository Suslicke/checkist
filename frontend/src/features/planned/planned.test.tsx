import { readFileSync } from 'node:fs'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { isDashboard } from '../../api/budget-schema'
import { dashboardFixture } from '../../api/budget-test-support'
import type { DashboardPlanned } from '../../api/budget-types'
import { isPlannedAdvice, isPlannedMonth, isPlannedSpend } from '../../api/planned'
import { plannedAdviceFixture, plannedFixture, plannedMonthFixture } from '../../api/planned-test-support'
import type { Category } from '../../api/types'
import { buildRoute, parseRoute } from '../../navigation/routes'
import { allowanceView } from '../dashboard/dashboard-state'
import { DashboardView } from '../dashboard/DashboardPage'
import PlannedCard from './PlannedCard'
import { PlanSheet, PlannedForm, PlannedView } from './PlannedPage'
import {
  adviceSub, amountValue, bestOption, byText, depositAmount, draftBody, draftErrors, draftFromPlanned, draftOf, dueText, largestOf, monthsRow, nextOption,
  optionView, pillOf, plannedFailure, plannedHref, railOf, rateText, rowMeta, savedText, segmentsOf,
} from './planned-state'

const NBSP = String.fromCharCode(0xa0)
/** Words are compared with ordinary spaces: `glue` puts no-break ones where a value must not break (checked once). */
const plain = (text: string) => text.replaceAll(NBSP, ' ')
const html = (node: ReactElement) => plain(renderToStaticMarkup(node).replace(/<svg\b.*?<\/svg>/g, ''))
const data = plannedMonthFixture()
const categories = [
  { id: 5, name: 'Жильё', path: [], parent_id: null, depth: 0 }, { id: 12, name: 'Одежда', path: [], parent_id: null, depth: 0 },
  { id: 9, name: 'Не разобрано', path: [], parent_id: null, depth: 0 },
].map((category) => ({ ...category, children_count: 0, generic_products_count: 0, products_count: 0, products_total: 0 })) as Category[]

describe('the shape of /api/planned/', () => {
  it('accepts the fixture, an older server without ai and goal, and refuses a dated-less exact plan', () => {
    expect(isPlannedMonth(data)).toBe(true)
    const older = { ...plannedFixture(), goal: undefined, ai: undefined }
    delete older.goal
    delete older.ai
    expect(isPlannedSpend(older)).toBe(true)
    expect(isPlannedSpend({ ...plannedFixture(), ai: { verdict: 'maybe', reason: '', at: null } })).toBe(false)
    expect(isPlannedSpend({ ...plannedFixture(), due: null, due_exact: true })).toBe(false)
    expect(isPlannedMonth({ ...data, base: { ...data.base, excluded: 'x' } })).toBe(false)
    expect(isPlannedAdvice(plannedAdviceFixture())).toBe(true)
    expect(isPlannedAdvice(plannedAdviceFixture({ options: [{ ...plannedAdviceFixture().options[0], risk: 4 }] }))).toBe(false)
    // The rate may come as a number from the settings of the server.
    expect(isPlannedAdvice(plannedAdviceFixture({ options: [{ ...plannedAdviceFixture().options[0], rate: 17 }] }))).toBe(true)
  })
})

describe('words and widths of the plans', () => {
  it('names the date of a plan', () => {
    expect(plain(dueText({ due: '2026-10-20', due_exact: true }))).toBe('к 20 октября')
    expect(plain(dueText({ due: '2026-10-01', due_exact: false }))).toBe('в октябре')
    expect(dueText({ due: null, due_exact: false })).toBe('без срока')
    expect(plain(byText('2027-04'))).toBe('к апрелю')
    expect(plain(byText('2027-02-01'))).toBe('к 1 февраля')
    expect(plain(rowMeta(data.rows[1]).join(' · '))).toBe('Подарки · 24 октября · Technodom')
    expect(plain(rowMeta(data.rows[0]).join(' · '))).toBe('Одежда · в октябре · отложено 57 000 ₸ на депозите «Зима»')
    expect(savedText(data.undated[1])).toBe('ничего не отложено')
    expect(savedText({ ...data.undated[1], goal: { id: 9, name: 'Диван', kind: 'deposit', saved: '0.00', share: 0 } })).toBe('депозит «Диван» открыт, пока пусто')
    expect(plain(rowMeta({ ...data.undated[0], category: null }).join(' · '))).toBe('Без категории · без срока · отложено 248 000 ₸ на депозите «Отпуск»')
  })
  it('pins the pill: more than planned, less than planned, the verdict of the model', () => {
    expect(plain(pillOf(data.rows[1])?.text ?? '')).toBe('+7 400 ₸')
    expect(pillOf(data.rows[1])?.kind).toBe('over')
    expect(plain(pillOf(data.rows[3])?.text ?? '')).toBe('−2 000 ₸')
    expect(pillOf(data.rows[3])?.kind).toBe('under')
    expect(pillOf({ ...data.rows[3], receipt: { ...data.rows[3].receipt!, total: '30000.00' } })).toBeNull()
    expect(pillOf(data.undated[1])).toEqual({ kind: 'ai-wait', text: 'ИИ: подождать' })
    expect(pillOf(data.rows[4])).toEqual({ kind: 'ai-drop', text: 'ИИ: отговаривает' })
    expect(pillOf(data.rows[0])).toBeNull()
    expect(pillOf(data.rows[2])).toBeNull()
  })
  it('draws the rail against the largest plan of the month and the strip from the segments', () => {
    const largest = largestOf(data.rows).get('KZT')!
    expect(largest).toBe(15000000n)
    expect(railOf(data.rows[0], largest)).toEqual({ plan: 100, saved: 38, fact: 0, over: 0 })
    expect(railOf(data.rows[1], largest)).toEqual({ plan: 0, saved: 0, fact: 30, over: 35 })
    expect(railOf(data.rows[2], largest)).toEqual({ plan: 80, saved: 0, fact: 0, over: 0 })
    expect(railOf(data.rows[3], largest)).toEqual({ plan: 0, saved: 0, fact: 19, over: 0 })
    expect(railOf(data.rows[4], largest)).toEqual({ plan: 10, saved: 0, fact: 0, over: 0 })
    // Put aside more than planned: the saved part is the whole plan, never past it.
    expect(railOf({ ...data.rows[4], goal: { id: 9, name: 'x', kind: 'saving', saved: '99000.00', share: '0' } }, largest).saved).toBe(10)
    // A spend of the largest plan sets the scale: a plan spent over is the 100 %.
    expect(largestOf([data.rows[1]]).get('KZT')).toBe(5240000n)
    expect(segmentsOf(data.base.segments).map((segment) => [segment.tone, segment.done, segment.flex]))
      .toEqual([[6, false, 150000], [4, true, 52400], [3, false, 120000], [1, true, 28000], [2, false, 15000]])
  })
  it('fills the row of months from the shown one to the last with plans, the gaps empty', () => {
    const row = monthsRow(data.months, '2026-10', data.today, 'KZT')
    expect(row.map((card) => [plain(card.label), card.now, card.empty, plain(card.sum ?? ''), plain(card.meta)])).toEqual([
      ['Октябрь', true, false, '360 000 ₸', '5 планов · 2 сделано'],
      ['Ноябрь', false, false, '320 000 ₸', '3 плана'],
      ['Декабрь', false, false, '90 000 ₸', '2 плана'],
      ['Январь 2027', false, true, '', '＋ добавить'],
      ['Февраль 2027', false, false, '400 000 ₸', '1 план'],
    ])
    // A month before every listed one: the shown month leads, empty.
    expect(monthsRow(data.months, '2026-09', data.today, 'KZT')[0]).toMatchObject({ label: 'Сентябрь', now: true, empty: true })
    expect(monthsRow([], '2026-12', data.today, 'KZT')).toHaveLength(1)
  })
  it('checks the form and builds its body', () => {
    expect(amountValue('6 700,5')).toBe('6700.5')
    expect(amountValue('120000+15000')).toBe('135000')
    for (const wrong of ['', '0', '-5', 'abc', '1+']) expect(amountValue(wrong) === null || amountValue(wrong) === '1').toBe(true)
    const empty = draftOf(null, 'KZT', '2026-10')
    expect(empty).toEqual({ name: '', amount: '', currency: 'KZT', dueKind: 'month', month: '2026-10', date: '', category_id: null, note: '' })
    expect(Object.keys(draftErrors(empty)).sort()).toEqual(['amount', 'name'])
    expect(draftErrors({ ...empty, name: 'Шины', amount: '120 000', dueKind: 'date' })).toEqual({ date: 'Выберите день.' })
    expect(draftBody({ ...empty, name: ' Шины ', amount: '120 000', dueKind: 'date', date: '2026-10-20', category_id: 9, note: ' зимние ' }))
      .toEqual({ name: 'Шины', amount: '120000', currency: 'KZT', due: '2026-10-20', due_exact: true, category_id: 9, note: 'зимние' })
    expect(draftBody({ ...empty, name: 'Лампа', amount: '15000', dueKind: 'month', month: '2026-11' })).toMatchObject({ due: '2026-11-01', due_exact: false })
    expect(draftBody({ ...empty, name: 'Диван', amount: '20000', dueKind: 'none' })).toMatchObject({ due: null, due_exact: false })
    expect(draftOf(data.rows[1], 'USD', '2026-12')).toEqual({ name: 'Подарок маме', amount: '45000', currency: 'KZT', dueKind: 'date', month: '2026-10', date: '2026-10-25', category_id: 10, note: '' })
    expect(draftOf(data.undated[0], 'KZT', '2026-10')).toMatchObject({ dueKind: 'none', month: '2026-10', date: '' })
  })
  it('names a refusal in its own words', () => {
    expect(plannedFailure({ reason: 'invalid_request', status: 409 })).toBe('Эта трата уже закрывает другой план.')
    expect(plannedFailure({ reason: 'not_found' })).toContain('не найден')
    expect(plannedFailure({ reason: 'network' })).toContain('соединение')
  })
  it('turns the advice into the three cards and picks the deposit', () => {
    const advice = plannedAdviceFixture()
    expect(plain(adviceSub(advice))).toBe('Нужно 150 000 ₸ к 1 февраля · отложено 57 000 ₸ · не хватает 93 000 ₸')
    expect(plain(rateText('17.00') ?? '')).toBe('17 % годовых')
    expect(plain(rateText(14.5) ?? '')).toBe('14,5 % годовых')
    const [lump, monthly, invest] = advice.options.map((option) => optionView(option, advice))
    expect(plain(lump.sum)).toBe('89 200 ₸')
    expect(lump.under).toBe('сегодня, один раз')
    expect(lump.meta.map(plain)).toEqual(['вложить 89 200 ₸', 'банк добавит ≈ 3 800 ₸ · 17 % годовых', 'без снятия до 1 февраля'])
    expect(lump.bar).toEqual({ in: 89200, gain: 3800 })
    expect(plain(monthly.sum)).toBe('30 500 ₸')
    expect(monthly.under).toBe('в месяц × 3')
    expect(monthly.meta.map(plain)).toEqual(['взносы 91 500 ₸', 'банк добавит ≈ 1 500 ₸ · 15 % годовых', 'снять можно в любой день'])
    expect({ ...invest, under: plain(invest.under) }).toMatchObject({ available: false, sum: '—', under: 'не для 3 месяцев', bar: null, risk: 3, meta: ['Советуем только для планов дальше года и не на обязательные вещи.'] })
    // Without a date: the monthly option says the month the money is together by.
    const open = plannedAdviceFixture({ due: null, months: null, options: [{ ...advice.options[1], amount: '35000.00', times: 7, until: '2027-04' }] })
    expect(plain(optionView(open.options[0], open).under)).toBe('в месяц, хватит к апрелю')
    expect(plain(adviceSub(open))).toContain('без срока')
    expect(bestOption(advice)).toBe('lump_fixed')
    expect(nextOption(advice, 'lump_fixed')).toBe('monthly_flexible')
    expect(nextOption(advice, 'monthly_flexible')).toBe('lump_fixed')
    expect(plain(depositAmount(advice, 'lump_fixed') ?? '')).toBe('89 200 ₸')
    expect(depositAmount(advice, 'invest')).toBeNull()
    expect(bestOption(plannedAdviceFixture({ options: [advice.options[2]] }))).toBeNull()
  })
})

describe('/planned (Vitest/SSR, not browser visual acceptance)', () => {
  const page = html(<PlannedView data={data} />)
  it('shows the hero with the strip, the legend, the two actions and the months in a scroller', () => {
    expect(page).toContain('<h2 id="pl-hero-heading" class="pl-eyebrow">Октябрь</h2>')
    expect(page).toContain('<p class="pl-hero-line"><span class="ck-hero-figure">285 000 ₸</span><span class="pl-hero-word">ещё ждём</span></p>')
    expect(page).toContain('<span>из 360 000 ₸ запланированных</span><span> · 2 из 5 сделано</span><span> · учтено в «можно тратить в день»</span>')
    expect(page).toContain('<div class="pl-segments" role="img" aria-label="План в октябре по пунктам"><i class="pl-cat-6" style="flex:150000" title="Зимняя куртка"></i><i class="pl-cat-4 pl-seg-done" style="flex:52400" title="Подарок маме"></i>')
    expect(page).toContain('<span><i aria-hidden="true"></i>сделано <b class="ck-figures">80 400 ₸</b></span><span><i class="pl-legend-open" aria-hidden="true"></i>ждём <b class="ck-figures">285 000 ₸</b></span>')
    expect(page).toContain('<button type="button" class="pl-add" aria-haspopup="dialog">＋ Запланировать</button><button type="button" class="ck-button-secondary pl-ask">✦ Спросить ИИ</button>')
    expect(page).toContain('role="region" aria-label="Ближайшие месяцы" tabindex="0"')
    expect(page).toContain('<a class="pl-month pl-month-now" aria-current="page" href="/planned?month=2026-10"><span class="pl-month-label">Октябрь</span><span class="pl-month-sum ck-figures">360 000 ₸</span><span class="pl-month-meta">5 планов · 2 сделано</span>')
    expect(page).toContain('<a class="pl-month" href="/planned?month=2027-01"><span class="pl-month-label">Январь 2027</span><span class="pl-month-sum ck-figures pl-month-sum-empty">пока пусто</span><span class="pl-month-meta">＋ добавить</span><span class="pl-month-bar" aria-hidden="true"></span></a>')
    // A past month: no «учтено».
    expect(html(<PlannedView data={plannedMonthFixture({ month: '2026-09' })} />)).not.toContain('учтено в')
  })
  it('lists the month with the badge, the rail and the pill, then the plans without a date', () => {
    expect(page).toContain('<h2 id="pl-month-heading">Октябрь 2026</h2><a class="pl-card-link" href="/planned?month=2026-09">Прошлый месяц</a>')
    const list = page.slice(page.indexOf('class="planned-main"'))
    const jacket = list.slice(list.indexOf('Зимняя куртка'), list.indexOf('Подарок маме'))
    expect(page).toContain('<button type="button" class="ck-row pl-row pl-row-button pl-cat-6" aria-haspopup="dialog"><span class="ck-row-badge pl-badge" aria-hidden="true"></span>')
    expect(jacket).toContain('<span class="pl-rail" aria-hidden="true"><b class="pl-rail-plan" style="width:100%"></b><b class="pl-rail-saved" style="width:38%"></b></span>')
    expect(jacket).toContain('<span class="pl-meta"><span>Одежда · в октябре · отложено 57 000 ₸ на депозите «Зима»</span></span>')
    const gift = list.slice(list.indexOf('Подарок маме'), list.indexOf('Шины на зиму'))
    expect(page).toContain('pl-row-button pl-cat-4 pl-done"')
    expect(gift).toContain('<span class="ck-row-amount ck-figures"><span class="pl-amount-plan">45 000 ₸</span>52 400 ₸</span>')
    expect(gift).toContain('<b class="pl-rail-over" style="width:35%"></b><b class="pl-rail-fact" style="width:30%"></b>')
    expect(gift).toContain('<span>Подарки · 24 октября · Technodom</span><span class="pl-pill pl-pill-over">+7 400 ₸</span>')
    expect(page).toContain('<span class="pl-pill pl-pill-under">−2 000 ₸</span>')
    expect(page).toContain('<span>Дом · в октябре · ничего не отложено</span><span class="pl-pill pl-pill-ai-drop">ИИ: отговаривает</span>')
    expect(page).toContain('<h2 id="pl-undated-heading">Без срока</h2><span class="pl-head-meta ck-figures">540 000 ₸ · 3 плана</span>')
    expect(page).toContain('<span>Техника · без срока · ничего не отложено</span><span class="pl-pill pl-pill-ai-wait">ИИ: подождать</span>')
    expect(page).toContain('<span>Путешествия · без срока · отложено 248 000 ₸ на депозите «Отпуск»</span>')
  })
  it('wraps the hero, the actions and the months in one boxless column before the lists in another', () => {
    expect(page).toMatch(/^<div class="planned-page"><div class="planned-side"><section class="ck-panel pl-hero"/)
    expect(page).toContain('</a></div></div></div><div class="planned-main"><section class="ck-panel pl-card" aria-labelledby="pl-month-heading">')
    expect(page).toMatch(/pl-undated-heading.*<\/section><\/div><\/div>$/)
    expect(page.match(/class="planned-main"/g)).toHaveLength(1)
    expect(page.match(/class="planned-side"/g)).toHaveLength(1)
  })
  it('invites to plan when the month is empty and reads an older server without ai and goal', () => {
    const older = plannedMonthFixture({
      rows: data.rows.map((row) => { const copy = { ...row }; delete copy.ai; delete copy.goal; return copy }),
      undated: [], base: { ...data.base, count: 0, done_count: 0, expected: '0.00', done: '0.00', left: '0.00', segments: [] },
    })
    const empty = html(<PlannedView data={{ ...older, rows: [] }} />)
    expect(empty).toContain('<span class="ck-hero-figure">0 ₸</span><span class="pl-hero-word">планов</span>')
    expect(empty).toContain('В этом месяце планов нет.')
    expect(empty).toContain('Планы без срока не входят в месяц')
    expect(empty).not.toContain('pl-segments')
    const plainRows = html(<PlannedView data={older} />)
    expect(plainRows).toContain('Одежда · в октябре · ничего не отложено')
    expect(plainRows).not.toContain('pl-pill-ai')
    expect(plainRows).not.toContain('pl-rail-saved')
  })
  it('draws the form as rows with the calculator keys and the three kinds of a date', () => {
    const form = html(<PlannedForm plan={null} categories={categories} currency="KZT" month="2026-10" busy={false} onSubmit={() => {}} />)
    expect(form).toMatch(/<label class="pl-field" for="[^"]+-name"><span>Что<\/span><input id="[^"]+-name" maxLength="100" placeholder="Зимняя куртка" autoComplete="off" aria-invalid="false" value=""\/><\/label>/)
    expect(form).toContain('<span>Сумма, KZT</span>')
    expect(form).toContain('<legend>Срок</legend><div class="pl-chips"><button type="button" class="ck-chip" aria-pressed="false">Без срока</button><button type="button" class="ck-chip" aria-pressed="true">В месяце</button><button type="button" class="ck-chip" aria-pressed="false">К дате</button></div>')
    expect(form).toMatch(/<input id="[^"]+-month" type="month" aria-invalid="false" value="2026-10"\/>/)
    expect(form).toContain('<option value="" selected="">Без категории</option><option value="5">Жильё</option><option value="12">Одежда</option></select>')
    expect(form).not.toContain('Не разобрано')
    expect(form).toContain('<button type="submit" class="pl-save">Запланировать</button>')
    const edit = html(<PlannedForm plan={data.rows[2]} categories={categories} currency="USD" month="2026-10" busy={false} onSubmit={() => {}} />)
    expect(edit).toMatch(/<input id="[^"]+-date" type="date" aria-invalid="false" value="2026-10-20"\/>/)
    expect(edit).toContain('value="120 000"')
    expect(edit).toContain('<button type="submit" class="pl-save">Сохранить · 120 000 ₸</button>')
    // The calculator keys as in the spend form.
    expect(edit).toContain('<div class="expense-calc-keys" role="group" aria-label="Посчитать сумму"><button type="button" class="expense-calc-key" aria-label="Плюс">+</button>')
  })
  it('opens the sheet of a plan with its actions, a closed one with its spend and «Это не она»', () => {
    const noop = () => {}
    const open = html(<PlanSheet plan={data.rows[0]} month="2026-10" categories={categories} busy={false} failure={null} onPatch={noop} onDeposit={noop} onDelete={noop} />)
    expect(open).toContain('<p class="pl-sheet-sum ck-figures">150 000 ₸</p><p class="pl-note">Одежда · в октябре · отложено 57 000 ₸ на депозите «Зима»</p>')
    expect(open).toContain('<p class="pl-verdict pl-verdict-keep"><b>ИИ: берите</b> — Холода не ждут.</p>')
    expect(open).toContain('<button type="button">Это она</button><a class="pl-link-button" href="/receipts/new?planned=1">Добавить трату</a><button type="button" class="ck-button-secondary">Как накопить</button><button type="button" class="ck-button-secondary">Перенести</button><button type="button" class="ck-button-secondary">Изменить</button><button type="button" class="ck-button-danger">Удалить</button>')
    const done = html(<PlanSheet plan={data.rows[1]} month="2026-10" categories={categories} busy={false} failure={null} onPatch={noop} onDeposit={noop} onDelete={noop} />)
    expect(done).toContain('Закрыт тратой 52 400 ₸ 24 октября. <a class="pl-inline-link" href="/receipts/201">Открыть трату</a>')
    expect(done).toContain('<button type="button" class="ck-button-secondary">Это не она</button>')
    expect(done).not.toContain('Как накопить')
  })
})

describe('«Планируем в октябре» on «Главная» and the allowance', () => {
  const planned: DashboardPlanned = {
    expected: '360000.00', left: '285000.00', count: 5, done_count: 2, segments: data.base.segments,
    rows: [
      { id: 1, name: 'Зимняя куртка', amount: '150000.00', currency: 'KZT', category_id: 12 },
      { id: 3, name: 'Шины на зиму', amount: '120000.00', currency: 'KZT', category_id: 11 },
      { id: 5, name: 'Лампа в спальню', amount: '15000.00', currency: 'KZT', category_id: 6 },
    ],
  }
  const allowance = { currency: 'KZT', basis: 'budget' as const, amount: '700000.00', spent: '287450.00', unpaid: '63000.00', unpaid_count: 3, days_left: 19, per_day: '18397.37', overspent: null }
  it('accepts the fields of the dashboard, all optional', () => {
    const body = { ...dashboardFixture(), planned, allowance: { ...allowance, planned: '40000.00', planned_count: 1 } }
    expect(isDashboard(body)).toBe(true)
    expect(isDashboard({ ...body, planned: null })).toBe(true)
    expect(isDashboard({ ...body, allowance })).toBe(true)
    expect(isDashboard({ ...body, planned: { ...planned, rows: [{ id: 1, name: 'x' }] } })).toBe(false)
    expect(isDashboard({ ...body, allowance: { ...allowance, planned_count: -1 } })).toBe(false)
  })
  it('draws the card after the payments with the small strip, the legend and up to three rows; nothing without plans', () => {
    const names = new Map([[11, 'Транспорт'], [6, 'Дом']])
    const card = html(<PlannedCard planned={planned} month="2026-10" currency="KZT" current categoryNames={names} />)
    expect(card).toContain('<h2 id="pl-dash-heading">Планируем в октябре</h2><a class="dash-card-link" href="/planned?month=2026-10">Все планы</a>')
    expect(card).toContain('<div class="pl-segments pl-segments-small" role="img" aria-label="План в октябре по пунктам">')
    expect(card).toContain('<p class="pl-legend pl-dash-legend"><span>ещё ждём <b class="ck-figures">285 000 ₸</b></span><span><b>2 из 5</b> сделано</span><span>уже учтено в «можно тратить в день»</span></p>')
    expect(card).toContain('<span class="pl-head"><span class="ck-row-title">Шины на зиму</span><span class="ck-row-amount ck-figures">120 000 ₸</span></span><span class="pl-meta">Транспорт</span>')
    // A category the dashboard does not name: the row without a second line.
    expect(card).toContain('<span class="ck-row-title">Зимняя куртка</span><span class="ck-row-amount ck-figures">150 000 ₸</span></span></span></li>')
    expect(html(<PlannedCard planned={planned} month="2026-09" currency="KZT" current={false} categoryNames={names} />)).not.toContain('учтено')
    expect(html(<PlannedCard planned={null} month="2026-10" currency="KZT" current categoryNames={names} />)).toBe('')
    expect(html(<PlannedCard planned={{ ...planned, count: 0, rows: [], segments: [] }} month="2026-10" currency="KZT" current categoryNames={names} />)).toBe('')
    // Since 2026-10-26 the card is not on «Главная» (the plans are a tile there); the view stays for its own screen.
    const source = readFileSync(new URL('../dashboard/DashboardPage.tsx', import.meta.url), 'utf8')
    expect(source).not.toContain('PlannedCard')
    expect(html(<DashboardView data={{ ...dashboardFixture(), base_currency: 'KZT', planned }} today="2026-10" date="2026-10-20" />)).not.toContain('pl-dash')
  })
  it('names the open plans of the month beside the unpaid payments in the note of «можно тратить в день»', () => {
    // The server's `unpaid` is the payments only; `planned` is a separate sum — the note lists both.
    expect(plain(allowanceView({ ...allowance, planned: '40000.00', planned_count: 1 }).note))
      .toBe('Бюджет месяца 700 000 ₸ минус траты, 3 платежа к оплате (63 000 ₸) и 1 планируемая трата (40 000 ₸), поровну на 19 дней')
    expect(plain(allowanceView({ ...allowance, planned: '40000.00', planned_count: 2 }).note)).toContain('и 2 планируемые траты (40 000 ₸)')
    expect(plain(allowanceView({ ...allowance, planned: '40000.00', planned_count: 5, unpaid_count: 5 }).note)).toContain('5 планируемых трат')
    expect(plain(allowanceView({ ...allowance, planned: '40000.00', planned_count: 1, unpaid: '0.00', unpaid_count: 0 }).note))
      .toBe('Бюджет месяца 700 000 ₸ минус траты и 1 планируемая трата (40 000 ₸), поровну на 19 дней')
    expect(plain(allowanceView({ ...allowance, planned: '40000.00', planned_count: 1, per_day: null, overspent: '10.00' }).note))
      .toBe('Траты, 3 платежа к оплате и 1 планируемая трата больше бюджета месяца 700 000 ₸')
    expect(plain(allowanceView({ ...allowance, planned: '0.00', planned_count: 0 }).note)).not.toContain('планируем')
    expect(plain(allowanceView(allowance).note)).toBe('Бюджет месяца 700 000 ₸ минус траты и 3 платежа к оплате (63 000 ₸), поровну на 19 дней')
  })
})

describe('a spend from a plan (/receipts/new?planned=)', () => {
  it('has its address and the form from the plan: «Что купили», the category, the amount, the currency', () => {
    expect(parseRoute('/receipts/new?planned=7')).toEqual({ kind: 'expense-new', planned: 7 })
    expect(buildRoute({ kind: 'expense-new', planned: 7 })).toBe('/receipts/new?planned=7')
    expect(parseRoute('/receipts/new?planned=x')).toEqual({ kind: 'expense-new' })
    expect(parseRoute('/planned?month=2026-11')).toEqual({ kind: 'planned', month: '2026-11' })
    expect(parseRoute('/planned?month=2026-13')).toEqual({ kind: 'planned' })
    expect(buildRoute({ kind: 'planned', month: '2026-11' })).toBe('/planned?month=2026-11')
    expect(buildRoute({ kind: 'planned' })).toBe('/planned')
    expect(draftFromPlanned(data.rows[0], categories, '2026-10-26')).toEqual({
      amount: '150000', currency: 'KZT', category: 12, date: '2026-10-26', place: '', note: '', lines: [], item: 'Зимняя куртка',
    })
    // A category the form does not offer is left unchosen.
    expect(draftFromPlanned(data.rows[3], categories, '2026-10-26').category).toBeNull()
    expect(plannedHref(data.rows[0])).toBe('/planned?month=2026-10')
    expect(plannedHref(data.undated[0])).toBe('/planned')
    const source = readFileSync(new URL('../expense/ExpensePage.tsx', import.meta.url), 'utf8')
    expect(source).toContain('updatePlanned(planned, { receipt_id: result.data.id }')
    expect(source).toContain('navigate(plannedHref(plan))')
  })
})

describe('«Планы» at ≥ 960 (theme/desktop.css): lists at the left, hero and months at the right', () => {
  const css = readFileSync(new URL('../../theme/desktop.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const media = /@media\s*\(min-width:\s*960px\)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/
  const outside = css.replace(media, '')
  const block = media.exec(css)?.[1] ?? ''
  it('dissolves the wrappers below the line and places them as columns above it', () => {
    expect(outside).toContain('.planned-main, .planned-side { display: contents; }')
    expect(block).toContain('.planned-page { max-width: none; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); align-items: start; }')
    expect(block).toContain('.planned-main { grid-column: 1; grid-row: 1; }')
    expect(block).toContain('.planned-side { grid-column: 2; grid-row: 1; }')
    expect(block).toContain('.pl-months > .ck-chip-scroller-track { flex-wrap: wrap; }')
    const own = readFileSync(new URL('./Planned.css', import.meta.url), 'utf8')
    expect(own).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(/i)
    expect(own).not.toMatch(/@media \(min-width|animation|transition|@keyframes/)
    for (const [, size] of own.matchAll(/font-size:\s*([^;]+);/g)) expect(size.trim()).toMatch(/^var\(--ck-text-(2xs|xs|sm|base|lg|xl|hero)\)$/)
  })
})
