import { useCallback, useEffect, useId, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { getCategories } from '../../api/catalog'
import { createThread } from '../../api/chat'
import { createPlanned, deletePlanned, getPlannedAdvice, getPlannedMonth, openPlannedDeposit, updatePlanned } from '../../api/planned'
import type { AdviceKey, PlannedAdvice, PlannedMonth, PlannedSpend } from '../../api/planned'
import { getManualDefaults, getReceipts } from '../../api/receipts'
import type { ReceiptListItem } from '../../api/receipts'
import type { Category, LocalApiResult } from '../../api/types'
import ChipScroller from '../../components/ChipScroller'
import Icon from '../../components/Icon'
import RequestState from '../../components/RequestState'
import Sheet from '../../components/Sheet'
import { categoryIcon } from '../../lib/category-icons'
import { categoryTone } from '../../lib/category-tone'
import { formatMoney } from '../../lib/money'
import { Link, navigate } from '../../navigation'
import { cents, dashboardErrorMessage, dayAndMonth, inMonth, monthTitle, shiftMonth } from '../dashboard/dashboard-state'
import { evaluateAmount, groupDigits, hasOperator, ungrouped } from '../expense/amount-calc'
import { sumText } from '../expense/expense-form'
import {
  adviceSub, amountValue, bestOption, decimalOf, depositAmount, draftBody, draftErrors, draftOf, dueOf, dueText, isDone, largestOf, monthLabel, monthsRow, monthsText,
  nextOption, optionView, pillOf, plannedFailure, plansText, railOf, rowMeta, segmentsOf,
} from './planned-state'
import type { DraftErrors, Notice, PlannedDraft, Segment } from './planned-state'
import './Planned.css'

const UNASSIGNED = 'Не разобрано'
/** A level of a sub-category in the list of the form: two no-break spaces (a select draws no padding). */
const INDENT = String.fromCharCode(0xa0).repeat(2)
const CALC_KEYS = [['+', 'Плюс'], ['−', 'Минус'], ['×', 'Умножить'], ['÷', 'Разделить']] as const
const monthHref = (month: string) => `/planned?month=${month}`

/** The month as one strip: every plan a part in the colour of its category, the closed ones solid, the open ones tinted. */
export function Segments({ segments, label, small = false }: { segments: Segment[]; label: string; small?: boolean }) {
  return <div className={small ? 'pl-segments pl-segments-small' : 'pl-segments'} role="img" aria-label={label}>
    {segments.map((segment) => <i key={segment.key} className={`pl-cat-${segment.tone}${segment.done ? ' pl-seg-done' : ''}`} style={{ flex: segment.flex }} title={segment.name} />)}
  </div>
}

/** «285 000 ₸ ещё ждём»: the hero of the month, its strip and the legend. */
function Hero({ data }: { data: PlannedMonth }) {
  const { base } = data
  const current = data.month === data.today.slice(0, 7)
  const sub = [`из ${formatMoney(base.expected, data.currency)} запланированных`, `${base.done_count} из ${base.count} сделано`]
  if (current) sub.push('учтено в «можно тратить в день»')
  if (base.excluded > 0) sub.push(`без курса: ${base.excluded}`)
  return <section className="ck-panel pl-hero" aria-labelledby="pl-hero-heading">
    <h2 id="pl-hero-heading" className="pl-eyebrow">{monthLabel(data.month, data.today)}</h2>
    {base.count === 0
      ? <>
        <p className="pl-hero-line"><span className="ck-hero-figure">{formatMoney('0.00', data.currency)}</span><span className="pl-hero-word">планов</span></p>
        <p className="pl-hero-sub">Запланируйте покупку — сумма войдёт в «можно тратить в день», а советчик подскажет, как накопить.</p>
      </>
      : <>
        <p className="pl-hero-line"><span className="ck-hero-figure">{formatMoney(base.left, data.currency)}</span><span className="pl-hero-word">ещё ждём</span></p>
        <p className="pl-hero-sub">{sub.map((part, index) => <span key={part}>{index > 0 && ' · '}{part}</span>)}</p>
        <Segments segments={segmentsOf(base.segments)} label={`План ${inMonth(data.month)} по пунктам`} />
        <p className="pl-legend">
          <span><i aria-hidden="true" />сделано <b className="ck-figures">{formatMoney(base.done, data.currency)}</b></span>
          <span><i className="pl-legend-open" aria-hidden="true" />ждём <b className="ck-figures">{formatMoney(base.left, data.currency)}</b></span>
        </p>
      </>}
  </section>
}

/** The months ahead as cards in a row: the shown one marked, a month without plans says «пока пусто». */
function MonthCards({ data }: { data: PlannedMonth }) {
  const cards = monthsRow(data.months, data.month, data.today, data.currency)
  return <ChipScroller label="Ближайшие месяцы" className="pl-months">
    {cards.map((card) => <Link key={card.month} className={`pl-month${card.now ? ' pl-month-now' : ''}`} to={monthHref(card.month)} aria-current={card.now ? 'page' : undefined}>
      <span className="pl-month-label">{card.label}</span>
      <span className={`pl-month-sum ck-figures${card.empty ? ' pl-month-sum-empty' : ''}`}>{card.sum ?? 'пока пусто'}</span>
      <span className="pl-month-meta">{card.meta}</span>
      <span className="pl-month-bar" aria-hidden="true">{card.segments.map((segment) => <i key={segment.key} className={`pl-cat-${segment.tone}${segment.done ? ' pl-seg-done' : ''}`} style={{ flex: segment.flex }} />)}</span>
    </Link>)}
  </ChipScroller>
}

/** A plan of the list: the badge of its category, the rail, the words, the pill; the whole row opens its sheet. */
function PlanRow({ plan, largest, onOpen }: { plan: PlannedSpend; largest: bigint; onOpen: (plan: PlannedSpend) => void }) {
  const rail = railOf(plan, largest)
  const pill = pillOf(plan)
  const done = isDone(plan)
  return <li>
    <button type="button" className={`ck-row pl-row pl-row-button pl-cat-${categoryTone(plan.category?.id)}${done ? ' pl-done' : ''}`} aria-haspopup="dialog" onClick={() => onOpen(plan)}>
      <span className="ck-row-badge pl-badge" aria-hidden="true">{done ? <Icon name="check" size={20} /> : <Icon name={categoryIcon(plan.category?.icon)} size={20} />}</span>
      <span className="ck-row-main">
        <span className="pl-head">
          <span className="ck-row-title">{plan.name}</span>
          <span className="ck-row-amount ck-figures">
            {done && plan.receipt && <span className="pl-amount-plan">{formatMoney(plan.amount, plan.currency)}</span>}
            {done && plan.receipt ? formatMoney(plan.receipt.total, plan.receipt.currency) : formatMoney(plan.amount, plan.currency)}
          </span>
        </span>
        <span className="pl-rail" aria-hidden="true">
          {rail.plan > 0 && <b className="pl-rail-plan" style={{ width: `${rail.plan}%` }} />}
          {rail.over > 0 && <b className="pl-rail-over" style={{ width: `${rail.over}%` }} />}
          {rail.fact > 0 && <b className="pl-rail-fact" style={{ width: `${rail.fact}%` }} />}
          {rail.saved > 0 && <b className="pl-rail-saved" style={{ width: `${rail.saved}%` }} />}
        </span>
        <span className="pl-meta">
          <span>{rowMeta(plan).join(' · ')}</span>
          {pill && <span className={`pl-pill pl-pill-${pill.kind}`}>{pill.text}</span>}
        </span>
      </span>
    </button>
  </li>
}

function PlanList({ plans, onOpen }: { plans: PlannedSpend[]; onOpen: (plan: PlannedSpend) => void }) {
  const largest = largestOf(plans)
  return <ul className="ck-list pl-list">{plans.map((plan) => <PlanRow key={plan.id} plan={plan} largest={largest.get(plan.currency) ?? 0n} onOpen={onOpen} />)}</ul>
}

export function NoticeLine({ notice }: { notice: Notice | null }) {
  if (!notice) return null
  return <p className="pl-notice" role="status">{notice.text}
    {notice.receiptId ? <> <Link className="pl-inline-link" to={`/receipts/${notice.receiptId}`}>Открыть трату</Link></> : null}</p>
}

export type PlannedViewProps = {
  data: PlannedMonth
  busy?: boolean
  notice?: Notice | null
  onOpen?: (plan: PlannedSpend) => void
  onAdd?: () => void
  onAsk?: () => void
}

/** `/planned` without loading: the markup tests render it directly. Two boxless columns (display: contents below
 * 960 px, theme/desktop.css): the DOM order is the phone's order — the hero, the actions, the months, then the lists. */
export function PlannedView({ data, busy = false, notice = null, onOpen = () => {}, onAdd = () => {}, onAsk = () => {} }: PlannedViewProps) {
  // The plans without a date are not in `base`: their sum is added here, only when they are all in the base currency.
  const undatedTotal = data.undated.reduce((sum, plan) => sum + cents(plan.amount), 0n)
  const undatedOther = data.undated.some((plan) => plan.currency !== data.currency)
  return <div className="planned-page">
    <div className="planned-side">
      <Hero data={data} />
      <div className="pl-cta">
        <button type="button" className="pl-add" aria-haspopup="dialog" onClick={onAdd}>＋ Запланировать</button>
        <button type="button" className="ck-button-secondary pl-ask" aria-disabled={busy || undefined} onClick={busy ? undefined : onAsk}>✦ Спросить ИИ</button>
      </div>
      <MonthCards data={data} />
    </div>
    <div className="planned-main">
      <NoticeLine notice={notice} />
      <section className="ck-panel pl-card" aria-labelledby="pl-month-heading">
        <div className="ck-panel-head">
          <h2 id="pl-month-heading">{monthTitle(data.month)}</h2>
          <Link className="pl-card-link" to={monthHref(shiftMonth(data.month, -1))}>Прошлый месяц</Link>
        </div>
        {data.rows.length
          ? <PlanList plans={data.rows} onOpen={onOpen} />
          : <p className="pl-note">В этом месяце планов нет. «＋ Запланировать» добавит покупку со сроком — она войдёт в «можно тратить в день».</p>}
      </section>
      <section className="ck-panel pl-card" aria-labelledby="pl-undated-heading">
        <div className="ck-panel-head">
          <h2 id="pl-undated-heading">Без срока</h2>
          {data.undated.length > 0 && <span className="pl-head-meta ck-figures">{undatedOther ? plansText(data.undated.length)
            : `${formatMoney(decimalOf(undatedTotal), data.currency)} · ${plansText(data.undated.length)}`}</span>}
        </div>
        {data.undated.length
          ? <PlanList plans={data.undated} onOpen={onOpen} />
          : <p className="pl-note">Планы без срока не входят в месяц и в «можно тратить в день»: отложите на них понемногу — советчик скажет сколько.</p>}
      </section>
    </div>
  </div>
}

/** A field as a row of the sheet: the words on the left, the control on the right; its error under the row. */
function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: ReactNode }) {
  return <div className="pl-field-wrap">
    <label className="pl-field" htmlFor={id}><span>{label}</span>{children}</label>
    {error && <p className="pl-field-error" id={`${id}-error`}>{error}</p>}
  </div>
}

/** «Без срока / В месяце / К дате» with the month or the day under it. */
function DueFields({ draft, errors, idPrefix, onChange }: { draft: Pick<PlannedDraft, 'dueKind' | 'month' | 'date'>; errors: DraftErrors; idPrefix: string; onChange: (patch: Partial<PlannedDraft>) => void }) {
  const kinds: [PlannedDraft['dueKind'], string][] = [['none', 'Без срока'], ['month', 'В месяце'], ['date', 'К дате']]
  return <>
    <fieldset className="pl-due-choice">
      <legend>Срок</legend>
      <div className="pl-chips">
        {kinds.map(([key, label]) => <button key={key} type="button" className="ck-chip" aria-pressed={draft.dueKind === key} onClick={() => onChange({ dueKind: key })}>{label}</button>)}
      </div>
    </fieldset>
    {draft.dueKind === 'month' && <Field id={`${idPrefix}-month`} label="Месяц" error={errors.month}>
      <input id={`${idPrefix}-month`} type="month" value={draft.month} aria-invalid={Boolean(errors.month)} aria-describedby={errors.month ? `${idPrefix}-month-error` : undefined}
        onChange={(event) => onChange({ month: event.target.value })} />
    </Field>}
    {draft.dueKind === 'date' && <Field id={`${idPrefix}-date`} label="День" error={errors.date}>
      <input id={`${idPrefix}-date`} type="date" value={draft.date} aria-invalid={Boolean(errors.date)} aria-describedby={errors.date ? `${idPrefix}-date-error` : undefined}
        onChange={(event) => onChange({ date: event.target.value })} />
    </Field>}
  </>
}

export type PlannedFormProps = {
  plan: PlannedSpend | null
  categories: Category[]
  currency: string
  /** The month shown: a new plan starts in it. */
  month: string
  busy: boolean
  failure?: string | null
  onSubmit: (draft: PlannedDraft) => void
}

/** The form of a new plan (or a change of one): what, how much (the calculator of the spend form), when, the
 * category, a note. */
export function PlannedForm({ plan, categories, currency, month, busy, failure = null, onSubmit }: PlannedFormProps) {
  const id = useId()
  const [draft, setDraft] = useState<PlannedDraft>(() => draftOf(plan, currency, month))
  const [errors, setErrors] = useState<DraftErrors>({})
  const set = (patch: Partial<PlannedDraft>) => setDraft((before) => ({ ...before, ...patch }))
  const counted = hasOperator(draft.amount) ? evaluateAmount(draft.amount) : undefined
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    const found = draftErrors(draft)
    setErrors(found)
    if (!Object.keys(found).length) onSubmit(draft)
  }
  const described = (name: keyof DraftErrors) => (errors[name] ? `${id}-${name}-error` : undefined)
  const value = amountValue(draft.amount)
  return <form className="pl-form" onSubmit={submit} noValidate>
    <div className="pl-fields">
      <Field id={`${id}-name`} label="Что" error={errors.name}>
        <input id={`${id}-name`} value={draft.name} maxLength={100} placeholder="Зимняя куртка" autoComplete="off" aria-invalid={Boolean(errors.name)}
          aria-describedby={described('name')} onChange={(event) => set({ name: event.target.value })} />
      </Field>
      <div className="pl-field-wrap">
        <label className="pl-field" htmlFor={`${id}-amount`}><span>Сумма, {draft.currency || currency}</span>
          <input id={`${id}-amount`} className="ck-figures" inputMode="decimal" autoComplete="off" enterKeyHint="done" placeholder="0"
            value={groupDigits(draft.amount)} aria-invalid={Boolean(errors.amount)} aria-describedby={described('amount')}
            onChange={(event) => set({ amount: ungrouped(event.target.value) })} onBlur={() => { if (counted) set({ amount: counted }) }} />
        </label>
        {errors.amount && <p className="pl-field-error" id={`${id}-amount-error`}>{errors.amount}</p>}
        {draft.amount !== '' && <div className="pl-calc">
          {/* «120000+15000» on a phone, whose number keyboard has no «+»: the keys keep the field focused. */}
          <div className="expense-calc-keys" role="group" aria-label="Посчитать сумму">
            {CALC_KEYS.map(([key, label]) => <button key={key} type="button" className="expense-calc-key" aria-label={label}
              onPointerDown={(event) => event.preventDefault()} onMouseDown={(event) => event.preventDefault()}
              onClick={() => set({ amount: draft.amount + key })}>{key}</button>)}
          </div>
          {counted && <output className="expense-calc-result" htmlFor={`${id}-amount`}>= {sumText(counted)}</output>}
        </div>}
      </div>
      <Field id={`${id}-currency`} label="Валюта" error={errors.currency}>
        <input id={`${id}-currency`} value={draft.currency} maxLength={3} autoCapitalize="characters" autoComplete="off" spellCheck={false}
          aria-invalid={Boolean(errors.currency)} aria-describedby={described('currency')} onChange={(event) => set({ currency: event.target.value.toUpperCase() })} />
      </Field>
      <DueFields draft={draft} errors={errors} idPrefix={id} onChange={set} />
      <Field id={`${id}-category`} label="Категория">
        <select id={`${id}-category`} value={draft.category_id ?? ''} onChange={(event) => set({ category_id: event.target.value ? Number(event.target.value) : null })}>
          <option value="">Без категории</option>
          {categories.filter((category) => category.name !== UNASSIGNED).map((category) => <option key={category.id} value={category.id}>
            {`${INDENT.repeat(category.depth)}${category.name}`}</option>)}
        </select>
      </Field>
      <Field id={`${id}-note`} label="Комментарий">
        <input id={`${id}-note`} value={draft.note} maxLength={300} placeholder="необязательно" autoComplete="off" onChange={(event) => set({ note: event.target.value })} />
      </Field>
    </div>
    {failure && <p className="pl-field-error" role="alert">{failure}</p>}
    <button type="submit" className="pl-save" aria-disabled={busy || undefined}>
      {plan ? 'Сохранить' : 'Запланировать'}{value && ` · ${formatMoney(value, draft.currency.trim().toUpperCase() || currency)}`}
    </button>
  </form>
}

/** «Это она»: the spends of the month of the plan (of the shown month for one without a date), one tap closes the plan. */
function ReceiptPicker({ plan, month, busy, onPick, onCancel }: { plan: PlannedSpend; month: string; busy: boolean; onPick: (receipt: ReceiptListItem) => void; onCancel: () => void }) {
  const [load, setLoad] = useState<{ kind: 'loading' } | { kind: 'error' } | { kind: 'ok'; rows: ReceiptListItem[] }>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const from = plan.due ? plan.due.slice(0, 7) : month
  useEffect(() => {
    const controller = new AbortController()
    const to = shiftMonth(from, 1)
    void getReceipts({ date_from: `${from}-01`, date_to: `${to}-01`, page_size: 50, ordering: '-purchased_at' }, { signal: controller.signal }).then((result) => {
      if (result.kind === 'ok') setLoad({ kind: 'ok', rows: result.data.results.filter((row) => row.purchased_on < `${to}-01`) })
      else if (result.kind === 'error') setLoad({ kind: 'error' })
    })
    return () => controller.abort()
  }, [from, attempt])
  const title = (row: ReceiptListItem) => row.store?.name || row.first_line || row.note.replace(/^[\s·]+/, '') || (row.source === 'manual' ? 'Трата' : 'Чек')
  return <section className="pl-section" aria-labelledby="pl-pick-heading">
    <h3 id="pl-pick-heading">Какая трата закрыла «{plan.name}»?</h3>
    <p className="pl-note">Траты {monthTitle(from).toLowerCase()}: касание привязывает трату к плану, план считается сделанным.</p>
    {load.kind === 'loading' && <RequestState kind="loading" message="Загружаем траты месяца…" compact />}
    {load.kind === 'error' && <RequestState kind="error" message="Не удалось загрузить траты месяца." onRetry={() => { setLoad({ kind: 'loading' }); setAttempt((value) => value + 1) }} compact />}
    {load.kind === 'ok' && (load.rows.length
      ? <ul className="ck-list pl-list">{load.rows.map((row) => <li key={row.id}>
        <button type="button" className="ck-row pl-row-button pl-pick-row" aria-disabled={busy || undefined} onClick={busy ? undefined : () => onPick(row)}>
          <span className="ck-row-main">
            <span className="ck-row-title">{title(row)}</span>
            <span className="ck-row-meta">{[dayAndMonth(row.purchased_on), row.category?.name].filter(Boolean).join(' · ')}</span>
          </span>
          <span className="ck-row-amount ck-figures">{formatMoney(row.total, row.currency)}</span>
        </button>
      </li>)}</ul>
      : <p className="pl-note">Трат в этом месяце пока нет.</p>)}
    <button type="button" className="ck-button-secondary pl-wide" onClick={onCancel}>Назад</button>
  </section>
}

/** «Как накопить»: the three ways with their figures; «Открыть депозит на …» opens a deposit goal for the chosen one. */
function AdvicePanel({ plan, busy, failure, onDeposit, onCancel }: { plan: PlannedSpend; busy: boolean; failure: string | null; onDeposit: (option: AdviceKey) => void; onCancel: () => void }) {
  const [load, setLoad] = useState<{ kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ok'; advice: PlannedAdvice }>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [chosen, setChosen] = useState<AdviceKey | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    void getPlannedAdvice(plan.id, { signal: controller.signal }).then((result) => {
      if (result.kind === 'ok') { setLoad({ kind: 'ok', advice: result.data }); setChosen(bestOption(result.data)) }
      else if (result.kind === 'error') setLoad({ kind: 'error', message: plannedFailure(result) })
    })
    return () => controller.abort()
  }, [plan.id, attempt])
  if (load.kind === 'loading') return <RequestState kind="loading" message="Считаем варианты…" compact />
  if (load.kind === 'error') return <RequestState kind="error" message={load.message} onRetry={() => { setLoad({ kind: 'loading' }); setAttempt((value) => value + 1) }} compact />
  const { advice } = load
  const deposit = depositAmount(advice, chosen)
  const another = nextOption(advice, chosen)
  return <section className="pl-section pl-advice" aria-labelledby="pl-advice-heading">
    <h3 id="pl-advice-heading">Как накопить на «{plan.name}»</h3>
    <p className="pl-advice-sub">{adviceSub(advice)}</p>
    {advice.months !== null && advice.due && <div className="pl-timeline" aria-hidden="true"><span>сегодня</span><i><s>{monthsText(advice.months)}</s></i><span>{dayAndMonth(advice.due)}</span></div>}
    <ul className="pl-options" aria-label="Варианты">
      {advice.options.map((option) => {
        const view = optionView(option, advice)
        const risk = <span className="pl-risk" role="img" aria-label={`риск ${['низкий', 'средний', 'высокий'][view.risk - 1] ?? 'высокий'}`}>
          {[1, 2, 3].map((level) => <b key={level} className={level <= view.risk ? 'pl-risk-on' : undefined} />)}</span>
        const body = <>
          <span className="pl-option-head"><span className="pl-option-name">{view.name}{risk}</span>
            <span className="pl-option-sum ck-figures">{view.sum}<small>{view.under}</small></span></span>
          {view.bar && <span className="pl-option-bar" aria-hidden="true"><i className="pl-option-in" style={{ flex: view.bar.in }} /><i className="pl-option-gain" style={{ flex: view.bar.gain }} /></span>}
          {view.meta.length > 0 && <span className="pl-option-meta">{view.meta.map((item, index) => <span key={item}>{index === 0 && view.bar && <i className="pl-option-in" aria-hidden="true" />}{index === 1 && view.bar && <i className="pl-option-gain" aria-hidden="true" />}{item}</span>)}</span>}
        </>
        return <li key={option.key} className={`pl-option${!view.available ? ' pl-option-off' : ''}${chosen === option.key ? ' pl-option-best' : ''}`}>
          {view.available
            ? <button type="button" className="pl-option-pick" aria-pressed={chosen === option.key} onClick={() => setChosen(option.key)}>{body}</button>
            : <div className="pl-option-pick">{body}</div>}
        </li>
      })}
    </ul>
    {failure && <p className="pl-field-error" role="alert">{failure}</p>}
    <div className="pl-actions">
      {deposit && chosen && <button type="button" aria-disabled={busy || undefined} onClick={busy ? undefined : () => onDeposit(chosen)}>Открыть депозит на {deposit}</button>}
      {another && another !== chosen && <button type="button" className="ck-button-secondary" onClick={() => setChosen(another)}>Другой вариант</button>}
      <button type="button" className="ck-button-secondary" onClick={onCancel}>Назад</button>
    </div>
    <p className="pl-foot">Ставки примерные, задаются на сервере. Депозит откроется целью семьи на недостающую сумму и привяжется к плану.</p>
  </section>
}

/** «Перенести»: the new date of the plan. */
function MoveForm({ plan, month, busy, failure, onMove, onCancel }: { plan: PlannedSpend; month: string; busy: boolean; failure: string | null; onMove: (patch: ReturnType<typeof dueOf>) => void; onCancel: () => void }) {
  const id = useId()
  const [draft, setDraft] = useState<Pick<PlannedDraft, 'dueKind' | 'month' | 'date'>>(() => {
    const base = draftOf(plan, plan.currency, month)
    return { dueKind: base.dueKind, month: base.month, date: base.date }
  })
  const [errors, setErrors] = useState<DraftErrors>({})
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    const found: DraftErrors = {}
    if (draft.dueKind === 'month' && !/^\d{4}-(0[1-9]|1[0-2])$/.test(draft.month)) found.month = 'Выберите месяц.'
    if (draft.dueKind === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) found.date = 'Выберите день.'
    setErrors(found)
    if (!Object.keys(found).length) onMove(dueOf(draft))
  }
  return <form className="pl-form pl-section" onSubmit={submit} noValidate aria-label={`Перенести «${plan.name}»`}>
    <h3>Перенести «{plan.name}»</h3>
    <div className="pl-fields"><DueFields draft={draft} errors={errors} idPrefix={id} onChange={(patch) => setDraft((before) => ({ ...before, ...patch }))} /></div>
    {failure && <p className="pl-field-error" role="alert">{failure}</p>}
    <div className="pl-actions">
      <button type="submit" aria-disabled={busy || undefined}>Перенести</button>
      <button type="button" className="ck-button-secondary" onClick={onCancel}>Отмена</button>
    </div>
  </form>
}

type Panel = 'none' | 'pick' | 'advice' | 'move' | 'edit' | 'delete'

export type PlanSheetProps = {
  plan: PlannedSpend; month: string; categories: Category[]; busy: boolean; failure: string | null
  onPatch: (patch: Parameters<typeof updatePlanned>[1], done: string) => void
  onDeposit: (option: AdviceKey) => void
  onDelete: () => void
}

/** The sheet of one plan: its figures, then the actions — «Это она», «Добавить трату», «Как накопить», «Перенести»,
 * «Изменить», «Удалить»; a closed plan gets its spend and «Это не она» instead. */
export function PlanSheet({ plan, month, categories, busy, failure, onPatch, onDeposit, onDelete }: PlanSheetProps) {
  const [panel, setPanel] = useState<Panel>('none')
  const done = isDone(plan)
  const back = () => setPanel('none')
  if (panel === 'pick') return <ReceiptPicker plan={plan} month={month} busy={busy} onCancel={back} onPick={(row) => onPatch({ receipt_id: row.id }, `«${plan.name}» закрыт тратой ${formatMoney(row.total, row.currency)}.`)} />
  if (panel === 'advice') return <AdvicePanel plan={plan} busy={busy} failure={failure} onDeposit={onDeposit} onCancel={back} />
  if (panel === 'move') return <MoveForm plan={plan} month={month} busy={busy} failure={failure} onCancel={back} onMove={(patch) => onPatch(patch, `«${plan.name}» перенесён: ${dueText({ due: patch.due ?? null, due_exact: patch.due_exact ?? false })}.`)} />
  if (panel === 'edit') return <PlannedForm plan={plan} categories={categories} currency={plan.currency} month={month} busy={busy} failure={failure}
    onSubmit={(draft) => onPatch(draftBody(draft), `«${draft.name.trim()}» сохранён.`)} />
  return <div className="pl-sheet">
    <p className="pl-sheet-sum ck-figures">{formatMoney(plan.amount, plan.currency)}</p>
    <p className="pl-note">{rowMeta(plan).join(' · ')}{plan.note && ` · ${plan.note}`}</p>
    {plan.ai && <p className={`pl-verdict pl-verdict-${plan.ai.verdict}`}>
      <b>{{ keep: 'ИИ: берите', wait: 'ИИ: подождите', drop: 'ИИ: отговаривает' }[plan.ai.verdict]}</b>{plan.ai.reason && ` — ${plan.ai.reason}`}</p>}
    {done && plan.receipt && <p className="pl-note">Закрыт тратой {formatMoney(plan.receipt.total, plan.receipt.currency)} {dayAndMonth(plan.receipt.purchased_on)}.
      {' '}<Link className="pl-inline-link" to={`/receipts/${plan.receipt.id}`}>Открыть трату</Link></p>}
    {failure && <p className="pl-field-error" role="alert">{failure}</p>}
    {panel === 'delete'
      ? <div className="pl-confirm">
        <p>Удалить «{plan.name}»? Трата и цель, если они есть, останутся.</p>
        <button type="button" className="ck-button-danger" aria-disabled={busy || undefined} onClick={busy ? undefined : onDelete}>Удалить</button>
        <button type="button" className="ck-button-secondary" onClick={back}>Отмена</button>
      </div>
      : <div className="pl-sheet-actions">
        {done
          ? <button type="button" className="ck-button-secondary" aria-disabled={busy || undefined} onClick={busy ? undefined : () => onPatch({ receipt_id: null }, `«${plan.name}» снова открыт.`)}>Это не она</button>
          : <>
            <button type="button" onClick={() => setPanel('pick')}>Это она</button>
            <Link className="pl-link-button" to={`/receipts/new?planned=${plan.id}`}>Добавить трату</Link>
            <button type="button" className="ck-button-secondary" onClick={() => setPanel('advice')}>Как накопить</button>
            <button type="button" className="ck-button-secondary" onClick={() => setPanel('move')}>Перенести</button>
          </>}
        <button type="button" className="ck-button-secondary" onClick={() => setPanel('edit')}>Изменить</button>
        <button type="button" className="ck-button-danger" onClick={() => setPanel('delete')}>Удалить</button>
      </div>}
  </div>
}

type Load = { kind: 'error'; message: string } | { kind: 'ok'; data: PlannedMonth; categories: Category[]; currency: string }
type Opened = { kind: 'add' } | { kind: 'plan'; id: number } | null

/** `/planned`: the plans of the month (`?month=`), the months ahead, the sheets of a plan and of a new one. */
export default function PlannedPage({ month }: { month?: string }) {
  const [load, setLoad] = useState<Load>()
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [opened, setOpened] = useState<Opened>(null)
  const [failure, setFailure] = useState<string | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    const signal = controller.signal
    // The sheet sends a plan back whole: never an answer from memory (api/answer-cache.ts).
    void Promise.all([getPlannedMonth(month, { signal, fresh: true }), getCategories({}, { signal }), getManualDefaults({ signal })])
      .then(([planned, categories, defaults]) => {
        if (signal.aborted) return
        if (planned.kind === 'error') { setLoad({ kind: 'error', message: dashboardErrorMessage(planned) }); return }
        if (planned.kind !== 'ok') return
        setLoad({ kind: 'ok', data: planned.data, categories: categories.kind === 'ok' ? categories.data.results : [], currency: defaults.kind === 'ok' ? defaults.data.currency : planned.data.currency })
      })
    return () => controller.abort()
  }, [month, attempt])
  const reload = useCallback(() => {
    void getPlannedMonth(month, { fresh: true }).then((result) => {
      if (result.kind === 'ok') setLoad((before) => before?.kind === 'ok' ? { ...before, data: result.data } : before)
    })
  }, [month])

  const run = <T,>(request: () => Promise<LocalApiResult<T>>, done: (data: T) => Notice | null, close = true) => {
    if (busy) return
    setBusy(true)
    setFailure(null)
    void request().then((result) => {
      setBusy(false)
      if (result.kind === 'ok') {
        setNotice(done(result.data))
        if (close) setOpened(null)
      } else if (result.kind === 'error') setFailure(plannedFailure(result))
      reload()
    })
  }
  // «Спросить ИИ»: a thread about the plans (the server asks its first question itself), then the chat screen.
  const ask = () => run(() => createThread({ kind: 'plans' }), (detail) => { navigate(`/chat/${detail.thread.id}`); return null }, false)

  if (!load) return <RequestState kind="loading" message="Загружаем планы…" shape="columns" />
  if (load.kind === 'error') return <RequestState kind="error" message={load.message} onRetry={() => setAttempt((value) => value + 1)} />
  const plan = opened?.kind === 'plan' ? [...load.data.rows, ...load.data.undated].find((row) => row.id === opened.id) : undefined
  return <>
    <PlannedView data={load.data} busy={busy} notice={notice} onAdd={() => { setFailure(null); setOpened({ kind: 'add' }) }} onAsk={ask}
      onOpen={(row) => { setFailure(null); setOpened({ kind: 'plan', id: row.id }) }} />
    <Sheet open={opened !== null && (opened.kind === 'add' || plan !== undefined)} onClose={() => setOpened(null)} id="pl-sheet" title={plan ? plan.name : 'Новый план'}>
      {opened?.kind === 'add' && <PlannedForm key="new" plan={null} categories={load.categories} currency={load.currency} month={load.data.month} busy={busy} failure={failure}
        onSubmit={(draft) => run(() => createPlanned(draftBody(draft)), (saved) => ({ text: `«${saved.name}» запланирован: ${dueText(saved)}.` }))} />}
      {plan && <PlanSheet key={plan.id} plan={plan} month={load.data.month} categories={load.categories} busy={busy} failure={failure}
        onPatch={(patch, text) => run(() => updatePlanned(plan.id, patch), () => ({ text }))}
        onDeposit={(option) => run(() => openPlannedDeposit(plan.id, option), (saved) => ({ text: saved.goal ? `Открыт депозит «${saved.goal.name}» для «${saved.name}».` : `Депозит для «${saved.name}» открыт.` }))}
        onDelete={() => run(() => deletePlanned(plan.id), () => ({ text: `«${plan.name}» удалён.` }))} />}
    </Sheet>
  </>
}
