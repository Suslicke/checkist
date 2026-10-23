import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { getCategories } from '../../api/catalog'
import { getIncomeCategories } from '../../api/incomes'
import type { IncomeCategory } from '../../api/incomes'
import { getManualDefaults } from '../../api/receipts'
import {
  acceptSuggestion, createRecurring, decideRecurring, deleteRecurring, dismissSuggestion, getRecurringMonth, payRecurring, updateRecurring,
} from '../../api/recurring'
import type { RecurringBase, RecurringMonth, RecurringMonthPayment, RecurringPayment, RecurringSuggestion } from '../../api/recurring'
import type { Category, LocalApiResult } from '../../api/types'
import RequestState from '../../components/RequestState'
import Sheet from '../../components/Sheet'
import { StackedColumns } from '../../lib/charts'
import { categoryTone } from '../../lib/category-tone'
import { categoryIcon } from '../../lib/category-icons'
import Icon from '../../components/Icon'
import { formatMonthStart, formatMonthTick, monthStart, moneyAxis } from '../stats/trends-state'
import { formatMoney } from '../../lib/money'
import { dashboardErrorMessage, monthTitle } from '../dashboard/dashboard-state'
import { DueBadge, NoticeLine, QuestionsCard } from './RecurringDue'
import type { Decide } from './RecurringDue'
import { Field, PaySection } from './RecurringPay'
import type { Pay } from './RecurringPay'
import {
  changeText, counted, decisionNotice, draftBody, draftErrors, draftOf, historyWords, payNotice, recurringFailure, stateText, suggestionMeta,
} from './recurring-state'
import type { DraftErrors, Notice, RecurringDraft } from './recurring-state'
import './Recurring.css'

const UNASSIGNED = 'Не разобрано'
/** A level of a sub-category in the list of the form: two no-break spaces (a select draws no padding). */
const INDENT = String.fromCharCode(0xa0).repeat(2)

/** Six months up to this one as dots: paid, open, not needed — a gap is seen at a glance. */
function History({ row }: { row: RecurringMonthPayment }) {
  const label = row.history.map((item) => `${monthTitle(item.month).toLowerCase()} — ${historyWords[item.state]}`).join(', ')
  return <span className="rec-history" role="img" aria-label={`Полгода: ${label}`}>
    {row.history.map((item) => <span key={item.month} className={`rec-dot rec-dot-${item.state}`} title={`${monthTitle(item.month)}: ${historyWords[item.state]}`} />)}
  </span>
}

/** A payment of the list: the whole row opens its form. */
function PaymentItem({ row, today, onEdit }: { row: RecurringMonthPayment; today: string; onEdit: (payment: RecurringPayment) => void }) {
  const change = changeText(row)
  return <li>
    <button type="button" className="ck-row rec-row rec-row-button" aria-haspopup="dialog" onClick={() => onEdit(row)}>
      <DueBadge row={row} />
      <span className="ck-row-main">
        <span className="ck-row-title">{row.name}</span>
        <span className={`ck-row-meta rec-meta-${row.state}`}>{[stateText(row, today), row.store?.name ?? row.category.name].join(' · ')}</span>
        {change && <span className="ck-row-meta rec-change ck-figures">{change}</span>}
        {row.state !== 'inactive' && <History row={row} />}
      </span>
      <span className="ck-row-amount ck-figures">{formatMoney(row.paid?.total ?? row.amount, row.currency)}</span>
    </button>
  </li>
}

const groupKey = (id: number | null) => (id === null ? 'none' : String(id))

/** The dashboard of the month: a tile per root category — expected sum, how many are paid, what is left; a tap scrolls to the group. */
function Tiles({ base }: { base: RecurringBase }) {
  return <ul className="rec-tiles" aria-label="Платежи по категориям">
    {base.groups.map((group) => <li key={groupKey(group.category_id)} className={`rec-tile rec-cat-${categoryTone(group.category_id)}`}>
      <a href={`#rec-group-${groupKey(group.category_id)}`}>
        <span className="rec-tile-head"><Icon name={categoryIcon(group.icon)} size={18} /><span className="rec-tile-name">{group.name}</span></span>
        <span className="rec-tile-sum ck-figures">{formatMoney(group.expected, base.currency)}</span>
        <span className="rec-tile-meta">{group.done === group.payments
          ? `оплачено ${group.done} из ${group.payments}`
          : <>осталось <span className="ck-figures">{formatMoney(group.left, base.currency)}</span></>}</span>
      </a>
    </li>)}
  </ul>
}

/** The payments of the month under their root category; without `base` (an older server) — one flat list. */
function Groups({ base, rows, today, onEdit }: { base?: RecurringBase; rows: RecurringMonthPayment[]; today: string; onEdit: (payment: RecurringPayment) => void }) {
  const list = (items: RecurringMonthPayment[]) => <ul className="ck-list rec-list">{items.map((row) => <PaymentItem key={row.id} row={row} today={today} onEdit={onEdit} />)}</ul>
  if (!base || base.groups.length === 0) return list(rows)
  const grouped = new Set(base.groups.flatMap((group) => group.payment_ids))
  const rest = rows.filter((row) => !grouped.has(row.id))
  return <>
    {base.groups.map((group) => {
      const items = rows.filter((row) => group.payment_ids.includes(row.id))
      return items.length === 0 ? null : <section key={groupKey(group.category_id)} className={`rec-group rec-cat-${categoryTone(group.category_id)}`}
        id={`rec-group-${groupKey(group.category_id)}`} aria-label={group.name}>
        <h3 className="rec-group-head"><span className="rec-tile-dot" aria-hidden="true" />{group.name}
          <span className="rec-group-sum ck-figures">{formatMoney(group.expected, base.currency)}</span></h3>
        {list(items)}
      </section>
    })}
    {rest.length > 0 && <section className="rec-group" aria-label="Без курса">
      <h3 className="rec-group-head">Без курса</h3>
      {list(rest)}
    </section>}
  </>
}

/** Twelve months of payments by group, in the base currency; the legend is the order of the tiles. */
function YearCard({ base }: { base: RecurringBase }) {
  const amount = (value: string) => formatMoney(value, base.currency)
  const legend = base.groups.map((group) => ({ key: groupKey(group.category_id), label: group.name, tone: categoryTone(group.category_id) }))
  const known = new Set(legend.map((entry) => entry.key))
  const columns = base.year.map((entry) => ({
    x: monthStart(entry.month), totalText: amount(entry.total),
    segments: entry.groups.filter((part) => known.has(groupKey(part.category_id)))
      .map((part) => ({ key: groupKey(part.category_id), value: Number(part.paid), valueText: amount(part.paid) })),
  }))
  return <section className="ck-panel rec-card" aria-labelledby="rec-year-heading">
    <div className="ck-panel-head"><h2 id="rec-year-heading">Платежи за 12 месяцев</h2></div>
    <StackedColumns title="Платежи за 12 месяцев" columns={columns} legend={legend} formatX={formatMonthStart} formatTick={formatMonthTick}
      formatValue={moneyAxis} valueAxisLabel={base.currency} />
  </section>
}

function SuggestionItem({ item, busy, onAccept, onDismiss }: {
  item: RecurringSuggestion; busy: boolean; onAccept: (item: RecurringSuggestion) => void; onDismiss: (item: RecurringSuggestion) => void
}) {
  return <li className="rec-suggestion">
    <div className="ck-row rec-row">
      <span className="ck-row-badge rec-day rec-day-suggested" aria-hidden="true">{item.due_day}</span>
      <span className="ck-row-main">
        <span className="ck-row-title">{item.name}</span>
        <span className="ck-row-meta">{suggestionMeta(item)} · {item.category_name}</span>
      </span>
      <span className="ck-row-amount ck-figures">{formatMoney(item.amount, item.currency)}</span>
    </div>
    <div className="rec-suggestion-actions">
      <button type="button" aria-disabled={busy || undefined} onClick={busy ? undefined : () => onAccept(item)}>Добавить</button>
      <button type="button" className="ck-button-secondary" aria-disabled={busy || undefined} onClick={busy ? undefined : () => onDismiss(item)}>Не надо</button>
    </div>
  </li>
}

export type RecurringViewProps = {
  data: RecurringMonth
  busy?: boolean
  notice?: Notice | null
  onDecide?: Decide
  onAccept?: (item: RecurringSuggestion) => void
  onDismiss?: (item: RecurringSuggestion) => void
  /** `kind` — of a new one: «Добавить доход» opens the form on a regular income. */
  onEdit?: (payment: RecurringPayment | null, kind?: RecurringDraft['kind']) => void
}

/** `/recurring` without loading: the markup tests render it directly. */
export function RecurringView({ data, busy = false, notice = null, onDecide = () => {}, onAccept = () => {}, onDismiss = () => {}, onEdit = () => {} }: RecurringViewProps) {
  const active = data.payments.filter((row) => row.state !== 'inactive' && row.kind !== 'income')
  const incomes = data.payments.filter((row) => row.state !== 'inactive' && row.kind === 'income')
  const off = data.payments.filter((row) => row.state === 'inactive')
  const left = data.totals.filter((total) => total.left !== null)
  const rows = counted(data)
  return <div className="rec-page">
    <p className="rec-intro">Оплачен — если около срока нашлась трата, где сошлись два из трёх: место, категория, сумма (±25 %).
      Сам я ничего не добавляю.</p>
    {/* Two boxless columns (display: contents below 960 px, theme/desktop.css): the DOM order is the phone's order. */}
    <div className="rec-main">
    <QuestionsCard questions={data.questions} today={data.today} busy={busy} onDecide={onDecide} />
    <NoticeLine notice={notice} />
    {data.suggestions.length > 0 && <section className="ck-panel rec-card" aria-labelledby="rec-suggest-heading">
      <div className="ck-panel-head"><h2 id="rec-suggest-heading">Нашёл по истории</h2></div>
      <p className="rec-note">Тот же получатель и похожая сумма три месяца подряд.</p>
      <ul className="ck-list rec-list">{data.suggestions.map((item) => <SuggestionItem key={`${item.store_id}:${item.category_id}:${item.currency}`}
        item={item} busy={busy} onAccept={onAccept} onDismiss={onDismiss} />)}</ul>
    </section>}
    <section className="ck-panel rec-card" aria-labelledby="rec-list-heading">
      <div className="ck-panel-head">
        <h2 id="rec-list-heading">{monthTitle(data.month)}</h2>
        {rows.length > 0 && <span className="rec-head-meta">оплачено {rows.length - rows.filter((row) => row.state === 'due' || row.state === 'overdue').length} из {rows.length}</span>}
      </div>
      {data.base && data.base.groups.length > 0 && <Tiles base={data.base} />}
      {data.base && <p className="rec-sum rec-total">Обязательных платежей в месяц <span className="ck-figures rec-sum-value">{formatMoney(data.base.expected, data.base.currency)}</span>
        {' · '}оплачено <span className="ck-figures rec-sum-value">{formatMoney(data.base.paid, data.base.currency)}</span>
        {data.base.excluded > 0 && ` · без курса: ${data.base.excluded}`}</p>}
      {left.length > 0 && <p className="rec-sum">Осталось оплатить {left.map((total, index) => <span key={total.currency}>
        {index > 0 && ' + '}<span className="ck-figures rec-sum-value">{formatMoney(total.left, total.currency)}</span></span>)}</p>}
      {active.length
        ? <Groups base={data.base} rows={active} today={data.today} onEdit={onEdit} />
        : <p className="rec-note">Регулярных платежей пока нет. Добавьте аренду, коммунальные или подписки — на главной будет видно, что
          осталось оплатить в месяце.</p>}
      <button type="button" className="rec-add" onClick={() => onEdit(null)} aria-haspopup="dialog">Добавить платёж</button>
    </section>
    {data.base && data.base.year.length > 0 && <YearCard base={data.base} />}
    </div>
    <div className="rec-side">
    <section className="ck-panel rec-card" aria-labelledby="rec-income-heading">
      <div className="ck-panel-head"><h2 id="rec-income-heading">Регулярный доход</h2></div>
      {incomes.length
        ? <ul className="ck-list rec-list">{incomes.map((row) => <PaymentItem key={row.id} row={row} today={data.today} onEdit={onEdit} />)}</ul>
        : <p className="rec-note">Зарплата, аванс, проценты — на главной в свой день спрошу «внести?», одно касание вносит доход. Видят
          его автор и главный в семье.</p>}
      <button type="button" className="ck-button-secondary rec-add" onClick={() => onEdit(null, 'income')} aria-haspopup="dialog">Добавить доход</button>
    </section>
    {off.length > 0 && <section className="ck-panel rec-card" aria-labelledby="rec-off-heading">
      <div className="ck-panel-head"><h2 id="rec-off-heading">Выключены</h2></div>
      <ul className="ck-list rec-list">{off.map((row) => <PaymentItem key={row.id} row={row} today={data.today} onEdit={onEdit} />)}</ul>
    </section>}
    </div>
  </div>
}

export type RecurringFormProps = {
  payment: RecurringPayment | null
  categories: Category[]
  currency: string
  busy: boolean
  failure?: string | null
  onSubmit: (draft: RecurringDraft) => void
  onDelete?: () => void
  /** A new regular income (`income`) takes the categories of incomes and has no place. */
  kind?: RecurringDraft['kind']
  incomeCategories?: IncomeCategory[]
}

/** The form of a new or a changed payment; a deletion asks once more. */
export function RecurringForm({ payment, categories, currency, busy, failure = null, onSubmit, onDelete, kind = 'spend', incomeCategories = [] }: RecurringFormProps) {
  const [draft, setDraft] = useState<RecurringDraft>(() => draftOf(payment, currency, kind))
  const income = draft.kind === 'income'
  const [errors, setErrors] = useState<DraftErrors>({})
  const [confirming, setConfirming] = useState(false)
  const set = (patch: Partial<RecurringDraft>) => setDraft((before) => ({ ...before, ...patch }))
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    const found = draftErrors(draft)
    setErrors(found)
    if (!Object.keys(found).length) onSubmit(draft)
  }
  const described = (name: keyof DraftErrors) => (errors[name] ? `rec-form-${name}-error` : undefined)
  return <form className="rec-form" onSubmit={submit} noValidate>
    <div className="rec-fields">
      <Field id="rec-form-name" label="Название" error={errors.name}>
        <input id="rec-form-name" value={draft.name} maxLength={100} placeholder={income ? 'Зарплата' : 'Аренда'} aria-invalid={Boolean(errors.name)}
          aria-describedby={described('name')} onChange={(event) => set({ name: event.target.value })} />
      </Field>
      {!income && <Field id="rec-form-store" label="Кому">
        <input id="rec-form-store" value={draft.store_name} maxLength={100} placeholder="необязательно" autoComplete="off"
          onChange={(event) => set({ store_name: event.target.value })} />
      </Field>}
      <Field id="rec-form-category_id" label="Категория" error={errors.category_id}>
        <select id="rec-form-category_id" value={draft.category_id ?? ''} aria-invalid={Boolean(errors.category_id)}
          aria-describedby={described('category_id')} onChange={(event) => set({ category_id: event.target.value ? Number(event.target.value) : null })}>
          <option value="">Выберите</option>
          {income ? incomeCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)
            : categories.filter((category) => category.name !== UNASSIGNED).map((category) => <option key={category.id} value={category.id}>
              {`${INDENT.repeat(category.depth)}${category.name}`}</option>)}
        </select>
      </Field>
      <Field id="rec-form-amount" label="Сумма" error={errors.amount}>
        <input id="rec-form-amount" className="ck-figures" value={draft.amount} inputMode="decimal" autoComplete="off" placeholder="0"
          aria-invalid={Boolean(errors.amount)} aria-describedby={described('amount')} onChange={(event) => set({ amount: event.target.value })} />
      </Field>
      <Field id="rec-form-currency" label="Валюта" error={errors.currency}>
        <input id="rec-form-currency" value={draft.currency} maxLength={3} autoCapitalize="characters" autoComplete="off" spellCheck={false}
          aria-invalid={Boolean(errors.currency)} aria-describedby={described('currency')} onChange={(event) => set({ currency: event.target.value.toUpperCase() })} />
      </Field>
      <Field id="rec-form-due_day" label="Число месяца" error={errors.due_day}>
        <input id="rec-form-due_day" className="ck-figures" value={draft.due_day} inputMode="numeric" maxLength={2} placeholder="1–31"
          aria-invalid={Boolean(errors.due_day)} aria-describedby={described('due_day')} onChange={(event) => set({ due_day: event.target.value })} />
      </Field>
      {payment && <div className="rec-field-wrap">
        <label className="rec-field rec-field-check" htmlFor="rec-form-active">
          <span>Включён</span>
          <input id="rec-form-active" type="checkbox" checked={draft.active} onChange={(event) => set({ active: event.target.checked })} />
        </label>
      </div>}
    </div>
    {failure && <p className="rec-field-error" role="alert">{failure}</p>}
    <button type="submit" className="rec-save" aria-disabled={busy || undefined}>{payment ? 'Сохранить' : income ? 'Добавить доход' : 'Добавить платёж'}</button>
    {payment && onDelete && (confirming
      ? <div className="rec-confirm">
        <p>Удалить «{payment.name}»? {income ? 'Внесённые доходы останутся.' : 'Ответы по месяцам удалятся вместе с ним, траты останутся.'}</p>
        <button type="button" className="ck-button-danger" aria-disabled={busy || undefined} onClick={busy ? undefined : onDelete}>Удалить</button>
        <button type="button" className="ck-button-secondary" onClick={() => setConfirming(false)}>Отмена</button>
      </div>
      : <button type="button" className="ck-button-danger" onClick={() => setConfirming(true)}>Удалить платёж</button>)}
  </form>
}

type Load = { kind: 'error'; message: string } | { kind: 'ok'; data: RecurringMonth; categories: Category[]; currency: string; incomeCategories: IncomeCategory[] }
type Editing = { payment: RecurringPayment | null; kind?: RecurringDraft['kind'] } | null

/** `/recurring`: the payments of this month with their state, the suggestions from history on top, the form in a sheet. */
export default function RecurringPage() {
  const [load, setLoad] = useState<Load>()
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [editing, setEditing] = useState<Editing>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [payFailure, setPayFailure] = useState<string | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    const signal = controller.signal
    // The edit sheet sends a payment back whole: never an answer from memory (api/answer-cache.ts).
    void Promise.all([getRecurringMonth(undefined, { signal, fresh: true }), getCategories({}, { signal }), getManualDefaults({ signal }),
      getIncomeCategories({ signal })])
      .then(([month, categories, defaults, incomeCategories]) => {
        if (signal.aborted) return
        if (month.kind === 'error') { setLoad({ kind: 'error', message: dashboardErrorMessage(month) }); return }
        if (month.kind !== 'ok') return
        setLoad({
          kind: 'ok', data: month.data, categories: categories.kind === 'ok' ? categories.data.results : [],
          currency: defaults.kind === 'ok' ? defaults.data.currency : 'KZT',
          incomeCategories: incomeCategories.kind === 'ok' ? incomeCategories.data : [],
        })
      })
    return () => controller.abort()
  }, [attempt])
  const reload = useCallback(() => {
    void getRecurringMonth().then((result) => {
      if (result.kind === 'ok') setLoad((before) => before?.kind === 'ok' ? { ...before, data: result.data } : before)
    })
  }, [])

  const run = <T,>(request: () => Promise<LocalApiResult<T>>, done: (data: T) => Notice | null) => {
    if (busy) return
    setBusy(true)
    setNotice(null)
    void request().then((result) => {
      setBusy(false)
      if (result.kind === 'ok') setNotice(done(result.data))
      else if (result.kind === 'error') setNotice({ text: recurringFailure(result) })
      reload()
    })
  }
  const decide: Decide = (question, decision) => run(() => decideRecurring(question.payment_id, question.month, decision),
    (data) => decisionNotice(question, decision, data.receipt_id, load?.kind === 'ok' ? load.data.today : question.month))
  const save = (draft: RecurringDraft) => {
    if (busy || !editing) return
    const payment = editing.payment
    setBusy(true)
    setFailure(null)
    const body = draftBody(draft)
    void (payment ? updateRecurring(payment.id, body) : createRecurring(body)).then((result) => {
      setBusy(false)
      if (result.kind === 'ok') {
        setEditing(null)
        setNotice({ text: payment ? `«${result.data.name}» сохранён.` : `«${result.data.name}» добавлен.` })
        reload()
      } else if (result.kind === 'error') setFailure(recurringFailure(result))
    })
  }
  // «Оплатил» of the sheet: the spend is made, the sheet closes with a line about it and a link to the spend.
  const pay: Pay = (row, values) => {
    if (busy || load?.kind !== 'ok') return
    const { month, today } = load.data
    const input = { ...values, month }
    setBusy(true)
    setPayFailure(null)
    void payRecurring(row.id, input).then((result) => {
      setBusy(false)
      if (result.kind === 'ok') {
        setEditing(null)
        setNotice(payNotice(row, input, result.data.receipt_id, today))
      } else if (result.kind === 'error') setPayFailure(recurringFailure(result))
      // A 409 means the month was closed meanwhile: the sheet shows it once the month is read again.
      reload()
    })
  }
  const remove = () => {
    const payment = editing?.payment
    if (!payment || busy) return
    setBusy(true)
    void deleteRecurring(payment.id).then((result) => {
      setBusy(false)
      if (result.kind === 'ok' || (result.kind === 'error' && result.reason === 'not_found')) {
        setEditing(null)
        setNotice({ text: `«${payment.name}» удалён.` })
        reload()
      } else if (result.kind === 'error') setFailure(recurringFailure(result))
    })
  }

  if (!load) return <RequestState kind="loading" message="Загружаем регулярные платежи…" shape="columns" />
  if (load.kind === 'error') return <RequestState kind="error" message={load.message} onRetry={() => setAttempt((value) => value + 1)} />
  // The month of the payment being changed, read again after every answer: «Оплатил» and the history of a year.
  const monthRow = editing?.payment ? load.data.payments.find((row) => row.id === editing.payment?.id) : undefined
  return <>
    <RecurringView data={load.data} busy={busy} notice={notice} onDecide={decide}
      onAccept={(item) => run(() => acceptSuggestion(item), (payment) => ({ text: `«${payment.name}» теперь в регулярных платежах.` }))}
      onDismiss={(item) => run(() => dismissSuggestion(item), () => ({ text: `«${item.name}» больше не предлагаю.` }))}
      onEdit={(payment, kind) => { setFailure(null); setPayFailure(null); setEditing({ payment, kind }) }} />
    <Sheet open={editing !== null} onClose={() => setEditing(null)} id="rec-form-sheet"
      title={editing?.payment ? editing.payment.name : editing?.kind === 'income' ? 'Новый доход' : 'Новый платёж'}>
      {monthRow && <PaySection key={`pay-${monthRow.id}`} row={monthRow} month={load.data.month} today={load.data.today} busy={busy}
        failure={payFailure} onPay={pay} />}
      {editing && <RecurringForm key={editing.payment?.id ?? `new-${editing.kind ?? 'spend'}`} payment={editing.payment} categories={load.categories}
        currency={load.currency} busy={busy} failure={failure} onSubmit={save} onDelete={remove} kind={editing.kind}
        incomeCategories={load.incomeCategories} />}
    </Sheet>
  </>
}
