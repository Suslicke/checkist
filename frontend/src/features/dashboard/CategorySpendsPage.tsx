import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { getCategorySpends } from '../../api/budget'
import type { CategorySpendCurrency, CategorySpendItem, CategorySpends } from '../../api/budget'
import Icon from '../../components/Icon'
import { usePageTitle } from '../../components/page-header'
import RequestState from '../../components/RequestState'
import { currencySymbol } from '../../lib/money'
import Money from '../../components/Money'
import { excludedNote } from '../../lib/base-currency'
import { Link } from '../../navigation'
import { capitalize, dashboardErrorMessage, dayAndMonth, deviceMonth, inMonth, monthSlide, monthTitle, plural, shiftMonth } from './dashboard-state'
import { glue } from '../../lib/text'
import type { MonthSlide } from './dashboard-state'
import { categorySpendsHref, partShare, showsLines, spendNote, spendSource, spendTitle, wholeReceipt } from './category-spends-state'
import { categoryTone } from '../../lib/category-tone'
import { useSpendIcon } from '../../lib/list-icons'
import { spendSource as entrySource } from '../receipts/spends'
import './Dashboard.css'
import { PrivateText } from '../../components/Private'

/** The source of a spend as a stamp (Чекист 2.0): «Фото» of a receipt, «Выписка» of a bank statement, «Вручную». */
const stampOf = { photo: 'Фото', statement: 'Выписка', manual: 'Вручную' } as const

function SpendItem({ item, currency, tone, icon }: { item: CategorySpendItem; currency: string; tone: number; icon?: string | null }) {
  const note = spendNote(item)
  const source = entrySource(item)
  // The picture of the category or how the spend came in — the choice of the device (lib/list-icons), as in «Траты».
  const picture = useSpendIcon(source, icon)
  const whole = wholeReceipt(item, currency)
  // A spend in another currency, counted in the base one: its own amount first, the converted one under it.
  const original = item.currency !== undefined && item.currency !== currency && item.original_amount !== undefined
  const bank = source === 'statement' ? spendSource(item).replace(/^Выписка\s*/, '') : ''
  return <li className="cat-spend">
    <Link className="ck-row cat-spend-row" to={`/receipts/${item.receipt_id}`}>
      {/* The stamp of the meta line names the source whatever the picture shows. */}
      <span className={`ck-row-badge${tone > 0 ? ` ck-tone-${tone}` : ''}`} data-icon={picture} aria-hidden="true"><Icon name={picture} size={20} /></span>
      <span className="ck-row-main">
        <span className="ck-row-title">{spendTitle(item)}</span>
        {note && <span className="cat-spend-note"><PrivateText>{note}</PrivateText></span>}
        <span className="ck-row-meta cat-spend-meta"><span className="ck-stamp">{stampOf[source]}</span>
          <span className="cat-spend-meta-text"><time dateTime={item.purchased_on}>{dayAndMonth(item.purchased_on)}</time>{bank && ` · ${bank}`} · {item.owner_name}</span></span>
      </span>
      <span className="ck-row-amount cat-spend-amount">
        {original ? <Money size="row" value={item.original_amount} currency={item.currency} /> : <Money size="row" value={item.category_amount} currency={currency} />}
        {original && <Money className="ck-twin" value={item.category_amount} currency={currency} approx />}
        {whole && <span className="cat-spend-whole">{whole}</span>}
      </span>
    </Link>
    {showsLines(item) && <details className="cat-spend-lines">
      <summary>Позиции: {item.lines.length.toLocaleString('ru-RU')}</summary>
      <ul>{item.lines.map((line) => <li key={line.id} className="ck-leader">
        <span className="cat-spend-line-name">{line.name}<span className="cat-spend-line-category"> · {line.category_name}</span></span>
        <Money value={line.amount} currency={currency} />
      </li>)}</ul>
    </details>}
  </li>
}

/** «‹ Октябрь 2026 ›» in the head of the first card: the month of the category, its steps through the address. */
function MonthSteps({ categoryId, month, today }: { categoryId: number; month: string; today: string }) {
  return <nav className="cat-month" aria-label="Месяц">
    <span className="cat-spends-month">{monthTitle(month)}</span>
    <span className="cat-month-steps">
      <Link className="ck-round dash-month-step" to={categorySpendsHref(categoryId, shiftMonth(month, -1))} aria-label="Предыдущий месяц"><Icon name="back" size={20} /></Link>
      {month < today
        ? <Link className="ck-round dash-month-step" to={categorySpendsHref(categoryId, shiftMonth(month, 1))} aria-label="Следующий месяц"><Icon name="forward" size={20} /></Link>
        : <span className="ck-round dash-month-step dash-month-step-off" aria-hidden="true"><Icon name="forward" size={20} /></span>}
    </span>
  </nav>
}

function CurrencyBlock({ block, month, hero, categoryName, tone, icon, steps, note }: {
  block: CategorySpendCurrency; month: string; hero: boolean; categoryName: string; tone: number; icon?: string | null; steps?: ReactNode; note?: string
}) {
  const headingId = `cat-spends-items-${block.currency}`
  const parts = block.parts.filter((part) => !part.direct || block.parts.length > 1)
  return <>
    <section className="ck-panel dash-card cat-spends-total" aria-label={`Потрачено, ${block.currency}`}>
      {steps}
      <p className="dash-label">{steps ? 'Потрачено' : `Потрачено ${inMonth(month)}`}{hero ? '' : `, ${currencySymbol(block.currency)}`}</p>
      <p className="dash-total"><Money size={hero ? 'hero' : 'display'} value={block.total} currency={block.currency} /></p>
      <p className="dash-note cat-spends-count">{glue(block.receipts_count.toLocaleString('ru-RU'), plural(block.receipts_count, 'чек или трата', 'чека или траты', 'чеков и трат'))}</p>
      {note && <p className="dash-note"><PrivateText>{note}</PrivateText></p>}
      {parts.length > 0 && <ul className="cat-parts" aria-label="Из чего сложилось">
        {parts.map((part) => {
          const share = partShare(part, block.total)
          const body = <>
            <span className="cat-part-head">
              <span className="dash-limit-dot" aria-hidden="true" />
              <span className="cat-part-name">{part.direct ? `${categoryName} без подкатегории` : part.name}</span>
              <Money className="cat-part-amount" value={part.amount} currency={block.currency} />
            </span>
            <span className="ck-bar dash-bar-small" aria-hidden="true"><span style={{ width: `${share}%` }} /></span>
          </>
          return <li key={`${part.id}:${part.direct}`} className={`cat-part-item ck-tone-${categoryTone(part.id)}`}>
            {part.direct ? <span className="cat-part">{body}</span>
              : <Link className="cat-part cat-part-link" to={categorySpendsHref(part.id, month)}>{body}</Link>}
          </li>
        })}
      </ul>}
    </section>
    <section className="ck-panel dash-card cat-spends-items" aria-labelledby={headingId}>
      <div className="ck-panel-head"><h2 id={headingId}>Траты и чеки{hero ? '' : ` · ${currencySymbol(block.currency)}`}</h2></div>
      <ul className="cat-spend-list">{block.items.map((item) => <SpendItem key={item.receipt_id} item={item} currency={block.currency} tone={tone} icon={icon} />)}</ul>
    </section>
  </>
}

export type CategorySpendsViewProps = { data: CategorySpends; today?: string; slide?: MonthSlide }

/** The screen without loading: the markup tests render it directly. The name of the category is the heading of the
 * page (the header row of the shell); the categories above it are links under the heading. */
export function CategorySpendsView({ data, today = deviceMonth(), slide }: CategorySpendsViewProps) {
  const { category, month } = data
  const ancestors = category.path.slice(0, -1)
  usePageTitle(category.name)
  const tone = categoryTone(category.path[0]?.id ?? category.id)
  const steps = <MonthSteps categoryId={category.id} month={month} today={today} />
  return <div className={`dash cat-spends${slide ? ` dash-slide-${slide}` : ''}`}>
    {ancestors.length > 0 && <nav className="cat-crumbs" aria-label="Категории выше">
      {ancestors.map((step) => <Link key={step.id} to={categorySpendsHref(step.id, month)}>{step.name}</Link>)}
    </nav>}
    {data.currencies.length
      ? data.currencies.map((block, index) => <CurrencyBlock key={block.currency} block={block} month={month} hero={index === 0} categoryName={category.name}
        tone={tone} icon={category.icon} steps={index === 0 ? steps : undefined} note={index === 0 ? excludedNote(data.excluded) : undefined} />)
      : <>
        <section className="ck-panel dash-card cat-spends-total" aria-label="Месяц">{steps}
          {data.excluded?.length ? <p className="dash-note"><PrivateText>{excludedNote(data.excluded)}</PrivateText></p> : null}</section>
        <RequestState kind="empty" title={`${capitalize(inMonth(month))} трат в этой категории ${month < today ? 'не было' : 'пока нет'}`}
          message="Траты появятся здесь, как только в категории будет хотя бы одна строка чека или трата."
          action={<Link className="action-link" to={month === today ? '/' : `/?month=${month}`}>На главную</Link>} />
      </>}
  </div>
}

type Load = { key: string } & ({ kind: 'error'; message: string; notFound: boolean } | { kind: 'ok'; data: CategorySpends; slide?: MonthSlide })

/** `/spends/category/{id}?month=YYYY-MM`: the shell keys it by the category, another month slides in from its side. */
export default function CategorySpendsPage({ categoryId, month }: { categoryId: number; month?: string }) {
  const [load, setLoad] = useState<Load | undefined>()
  const [attempt, setAttempt] = useState(0)
  const key = `${month ?? ''}:${attempt}`
  const shown = useRef<string | undefined>(undefined)
  useEffect(() => {
    const controller = new AbortController()
    void getCategorySpends(categoryId, month, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted || result.kind === 'aborted') return
      if (result.kind !== 'ok') {
        setLoad({ key, kind: 'error', message: dashboardErrorMessage(result), notFound: result.reason === 'not_found' })
        return
      }
      const slide = monthSlide(shown.current, result.data.month)
      shown.current = result.data.month
      setLoad({ key, kind: 'ok', data: result.data, slide })
    })
    return () => controller.abort()
  }, [categoryId, month, key])
  if (!load || load.key !== key) return <RequestState kind="loading" message="Загружаем траты категории…" />
  if (load.kind === 'error') {
    return load.notFound
      ? <RequestState kind="empty" message="Такой категории нет: возможно, её удалили из каталога." action={<Link className="action-link" to="/">На главную</Link>} />
      : <RequestState kind="error" message={load.message} onRetry={() => setAttempt((value) => value + 1)} />
  }
  return <CategorySpendsView data={load.data} slide={load.slide} />
}
