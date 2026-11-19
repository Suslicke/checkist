import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { getDashboard } from '../../api/budget'
import type { Dashboard, DashboardAttention, DashboardCategory, DashboardCurrency, DashboardRecent, DashboardSubCategory } from '../../api/budget'
import { getMoney } from '../../api/money'
import type { ExcludedSpends } from '../../api/base-currency'
import Icon from '../../components/Icon'
import Money from '../../components/Money'
import { HeaderSlot } from '../../components/PageHeader'
import { usePageTitle } from '../../components/page-header'
import PrivacyToggle from '../../components/PrivacyToggle'
import RequestState from '../../components/RequestState'
import Sheet from '../../components/Sheet'
import type { Person } from '../../lib/people'
import Ring from '../../lib/charts/RingChart'
import { pulse } from '../../lib/charts/pulse'
import { Link } from '../../navigation'
import {
  capitalize, categoryIds, categoryTone, cents, currencyName, dashboardErrorMessage, dashboardPeople, deviceDate, deviceMonth,
  formatMoney, hasLimit, initials, inMonth, monthIsEmpty, monthSlide, monthTitle, plural, progress, recentSource, relativeDay, shiftMonth,
} from './dashboard-state'
import { useSpendIcon } from '../../lib/list-icons'
import type { MonthSlide } from './dashboard-state'
import { categorySpendsHref } from './category-spends-state'
import { currencySymbol } from '../../lib/money'
import { glue } from '../../lib/text'
import { ownerName } from '../../lib/people'
import { sourceMark } from '../receipts/spends'
import { collapsedHint, isExpanded, readExpanded, rowChildren, subListId, withChoice, writeExpanded } from './limit-collapse-state'
import type { ExpandedChoices } from './limit-collapse-state'
import { subCategoriesText } from './limits-state'
import {
  attentionAmount, attentionBadge, attentionMeta, attentionMoreText, attentionRows, budgetShare, centsOf, hasPulse, legendOf, limitState, percentText, pulseCaption,
  recentView, tilesOf, todayIn,
} from './home-state'
import type { TileView } from './home-state'
import { decimalOf, figureReasons, heroOf, monthDone, paceLabel, paceOf } from './home-hero'
import type { FreeState, HeroView, Pace } from './home-hero'
import { useHomeFigure } from './home-figure'
import type { HomeFigure } from './home-figure'
import HomeFigureSetting from './HomeFigureSetting'
import Words from './Words'
import { useRolled } from './rolled'
import './Dashboard.css'

const monthHref = (month: string) => `/?month=${month}`
/** The tone of a category tile (`--ck-tone`, tokens.css); none — the neutral tile. */
const toneClass = (tone: number) => tone > 0 ? ` ck-tone-${tone}` : ''

/** The header row of «Главная» (the shell's, components/PageHeader): the month is the heading of the page; after it the
 * two round steps «‹ ›» («›» only while a later month is not in the future), «Скрыть суммы» on the current month, and the
 * family at the right edge. Drawn while the month loads too. */
function MonthHeader({ month, today, people, family }: { month: string; today: string; people: Person[]; family: boolean }) {
  // An ordinary space: on a window narrower than the row «Сентябрь 2026» goes to two lines, never «Сентябрь 2 / 026».
  usePageTitle(monthTitle(month).replace('\u00a0', ' '))
  return <HeaderSlot side="end">
    <span className="dash-month-steps">
      <Link className="ck-round dash-month-step" to={monthHref(shiftMonth(month, -1))} aria-label="Предыдущий месяц"><Icon name="back" size={18} /></Link>
      {month < today && <Link className="ck-round dash-month-step" to={monthHref(shiftMonth(month, 1))} aria-label="Следующий месяц"><Icon name="forward" size={18} /></Link>}
    </span>
    {month === today && <PrivacyToggle className="dash-privacy" />}
    {people.length > 0 && <ul className="dash-family" aria-label={family ? 'Семья' : 'Кто тратит'}>
      {people.map((person, index) => <li key={person.username} className={`dash-avatar ck-tone-${(index % 6) + 1}`} title={person.display_name}>
        <span aria-hidden="true">{initials(person.display_name)}</span><span className="ck-visually-hidden">{person.display_name}</span>
      </li>)}
    </ul>}
  </HeaderSlot>
}

/** The bar of the budget under the main number: spent in ink, the open payments and plans hatched, a mark of today. */
function PaceBar({ pace, currency }: { pace: Pace; currency: string }) {
  const ahead = pace.aheadAmount
  const words = pace.state === 'over' ? 'сверх бюджета' : pace.state === 'near' ? 'почти весь бюджет' : ''
  const label = [paceLabel(pace), words].filter(Boolean).join(', ')
  return <div className={`dash-pace is-${pace.state}`}>
    <div className="dash-pace-bar" role="img" aria-label={label}>
      <div className="dash-pace-track">
        <span className="dash-pace-spent" style={{ '--w': `${pace.spent}%` } as CSSProperties} />
        {pace.ahead > 0 && <span className="dash-pace-ahead" style={{ '--w': `${pace.ahead}%` } as CSSProperties} />}
      </div>
      {pace.today !== null && <span className="dash-pace-today" style={{ '--x': `${pace.today}%` } as CSSProperties} />}
    </div>
    <p className="dash-pace-legend" aria-hidden="true">
      <span className="dash-pace-key"><i className="dash-pace-swatch is-spent" />Потрачено {percentText(pace.percent)}{words && <span className="dash-pace-words">, {words}</span>}</span>
      {ahead && <span className="dash-pace-key"><i className="dash-pace-swatch is-ahead" />Платежи и планы <Money value={ahead} currency={currency} /></span>}
      {pace.today !== null && <span className="dash-pace-key"><i className="dash-pace-swatch is-today" />Сегодня</span>}
    </p>
  </div>
}

/** The one main number of the screen (`ck-money-hero`) with its label; a tap on the label opens «Главное число». */
function Hero({ view, pace, scope, open, onOpen }: { view: HeroView; pace: Pace | null; scope: string; open: boolean; onOpen: () => void }) {
  const value = useRolled(view.value, scope)
  return <section className={`dash-hero is-${view.shown}`} aria-labelledby="dash-hero-label">
    <button type="button" className="dash-hero-pick" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? 'dash-figure-sheet' : undefined}
      aria-describedby="dash-hero-pick-hint" onClick={onOpen}>
      <span id="dash-hero-label" className={`dash-hero-label${view.over ? ' is-over' : ''}`}>{view.label}</span>
      <Icon name="down" size={16} className="ck-icon dash-hero-chevron" />
    </button>
    <span id="dash-hero-pick-hint" className="ck-visually-hidden">Выбрать главное число</span>
    <p className="dash-hero-figure" aria-busy={value === null ? true : undefined}>
      {value === null
        ? <><span className="dash-hero-wait" aria-hidden="true" /><span className="ck-visually-hidden">Загружаем</span></>
        : <Money value={value} currency={view.currency} size="hero" tone={view.over ? 'over' : undefined} />}
    </p>
    {view.sub.length > 0 && <p className="dash-hero-sub" title={view.title}><Words phrases={view.sub} /></p>}
    {view.note && <p className="dash-hero-note">{view.note}</p>}
    {pace && <PaceBar pace={pace} currency={view.currency} />}
  </section>
}

/** The pulse of the month: a bar a day, today in ink, the days ahead flat, the average day dashed. */
function Pulse({ data, currency, current, date }: { data: Dashboard; currency: string; current: boolean; date: string }) {
  const today = current ? todayIn(data.month, date) : undefined
  const drawn = pulse((data.by_day ?? []).map((item) => ({ day: item.day, spent: centsOf(item.spent) })), today, data.average_day ? centsOf(data.average_day) : 0)
  const caption = pulseCaption(data, currency, today)
  const middle = [caption.middle.today, caption.middle.average].filter((part): part is string => part !== null)
  return <div className="dash-pulse-block">
    <div className="dash-pulse" role="img" aria-label={`Траты по дням ${inMonth(data.month)}`}>
      {drawn.average !== null && <span className="dash-pulse-average" style={{ bottom: `${drawn.average}%` }} aria-hidden="true" />}
      {drawn.bars.map((bar) => <i key={bar.day} className={`dash-pulse-day dash-pulse-${bar.state}`} style={bar.state === 'future' ? undefined : { height: `${bar.height}%` }} />)}
    </div>
    <p className="dash-pulse-x" aria-hidden="true">
      <span>{caption.start}</span>
      <span className="dash-pulse-x-middle">{middle.map((part, index) => <span key={part} className={index === 0 && caption.middle.today ? 'dash-pulse-now' : undefined}>{index > 0 && ' · '}{part}</span>)}</span>
      <span>{caption.end}</span>
    </p>
  </div>
}

/** «Куда ушли деньги»: the ring of the categories (the gap is what is left of the budget), the legend beside it and the
 * pulse of the days under both. The money of the month is the main number above: the ring says the share of the budget. */
function WhereCard({ block, data, current, date }: { block: DashboardCurrency; data: Dashboard; current: boolean; date: string }) {
  const legend = legendOf(block, data.budget)
  const share = budgetShare(block.spent, data.budget?.currency === block.currency ? data.budget : null)
  const ringLabel = legend.all.length ? `Потрачено ${formatMoney(block.spent, block.currency)}: ${legend.all.map((row) => `${row.name} ${formatMoney(row.amount, block.currency)}`).join(', ')}` : `Потрачено ${formatMoney(block.spent, block.currency)}`
  const over = legend.remainder !== null && legend.remainder < 0n
  return <section className="ck-panel dash-card dash-where" aria-labelledby="dash-where-heading">
    <div className="ck-panel-head"><h2 id="dash-where-heading">Куда ушли деньги</h2></div>
    <div className="dash-ring-wrap">
      <Ring items={legend.all.map((row) => ({ key: row.key, value: centsOf(row.amount), tone: row.tone }))} remainder={legend.remainder === null ? 0 : Number(legend.remainder)} label={ringLabel}>
        {share === null
          ? <><span className="dash-ring-value">{legend.all.length}</span><span className="dash-ring-label">{plural(legend.all.length, 'категория', 'категории', 'категорий')}</span></>
          : <><span className={`dash-ring-value${share > 100 ? ' is-over' : ''}`}>{percentText(share)}</span><span className="dash-ring-label">бюджета</span></>}
      </Ring>
      <ul className="dash-legend" aria-label="По категориям">
        {legend.rows.map((row) => <li key={row.key} className={`dash-legend-row${toneClass(row.tone)}`}>
          <i className="dash-legend-swatch" aria-hidden="true" />
          {row.categoryId === null ? <span className="dash-legend-name">{row.name}</span>
            : <Link className="dash-legend-name" to={categorySpendsHref(row.categoryId, data.month)}>{row.name}</Link>}
          <Money className="dash-legend-amount" value={row.amount} currency={block.currency} />
        </li>)}
        {legend.more > 0 && <li className="dash-legend-row dash-legend-rest"><i className="dash-legend-swatch" aria-hidden="true" /><Link className="dash-legend-name" to="/stats">ещё {legend.more}</Link></li>}
        {legend.remainder !== null && <li className={`dash-legend-row dash-legend-rest${over ? ' is-over' : ''}`}>
          <i className="dash-legend-swatch" aria-hidden="true" />
          <span className="dash-legend-name">{over ? 'Сверх бюджета' : 'Остаток бюджета'}</span>
          <Money className="dash-legend-amount" value={decimalOf(over ? -legend.remainder! : legend.remainder!)} currency={block.currency} tone={over ? 'over' : undefined} />
        </li>}
      </ul>
    </div>
    {hasPulse(data) && <Pulse data={data} currency={block.currency} current={current} date={date} />}
  </section>
}

/** Another currency of the month: one compact row each, never a second hero and never added to the first. */
function OtherCurrencies({ blocks }: { blocks: DashboardCurrency[] }) {
  return <section className="ck-panel dash-card dash-others" aria-labelledby="dash-others-heading">
    <div className="ck-panel-head"><h2 id="dash-others-heading">Другие валюты</h2></div>
    <ul className="ck-list">
      {blocks.map((block) => {
        const state = block.limited_spent != null && block.limit_total ? limitState(block.limited_spent, block.limit_total) : null
        return <li key={block.currency} className="ck-row dash-other" aria-label={`Потрачено, ${block.currency}`}>
          <span className="ck-row-badge dash-currency-badge" aria-hidden="true">{currencySymbol(block.currency)}</span>
          <span className="ck-row-main">
            <span className="ck-row-title">{currencyName(block.currency)}</span>
            {state && block.limit_total && <span className={`ck-row-meta${state.state === 'calm' ? '' : ' is-over'}`}>
              {percentText(state.percent)} лимитов{state.words && ` · ${state.words}`}
            </span>}
          </span>
          <Money className="ck-row-amount" size="row" value={block.spent} currency={block.currency} />
        </li>
      })}
    </ul>
  </section>
}

/** Spends of the month in a currency whose rate of the National Bank on the day of purchase is not loaded yet: not in
 * the total above, so they are named here instead of silently missing. Every other currency is in the total. */
function Unconverted({ items }: { items: ExcludedSpends[] }) {
  return <section className="ck-panel dash-card dash-others dash-unconverted" aria-labelledby="dash-unconverted-heading">
    <div className="ck-panel-head"><h2 id="dash-unconverted-heading">Без курса</h2></div>
    <ul className="ck-list">
      {items.map((item) => <li key={item.currency} className="ck-row dash-other" aria-label={`Без курса, ${item.currency}`}>
        <span className="ck-row-badge dash-currency-badge" aria-hidden="true">{currencySymbol(item.currency)}</span>
        <span className="ck-row-main">
          <span className="ck-row-title">{currencyName(item.currency)}</span>
          <span className="ck-row-meta">Нет курса Нацбанка на дату покупки — не в итоге</span>
        </span>
        <Money className="ck-row-amount" size="row" value={item.total} currency={item.currency} />
      </li>)}
    </ul>
  </section>
}

function AttentionRow({ row }: { row: DashboardAttention }) {
  const badge = attentionBadge(row.kind)
  const amount = attentionAmount(row)
  return <Link className="ck-row dash-attention-row" to={row.href} data-kind={row.kind} title={attentionMeta(row)}>
    <span className={`ck-row-badge dash-attention-badge is-${badge.tone}`} aria-hidden="true"><Icon name={badge.icon} size={20} /></span>
    <span className="ck-row-main">
      <span className="ck-row-title">{row.title}</span>
      {row.meta && <span className={`ck-row-meta${badge.tone === 'over' ? ' is-over' : ''}`}>{row.meta}</span>}
    </span>
    {amount
      ? <span className="ck-row-amount dash-attention-amount">
        <Money size="row" value={amount.money} currency={amount.currency} tone={amount.over ? 'over' : undefined} />
        {amount.caption && <span className={`dash-amount-caption${amount.over ? ' is-over' : ''}`}>{amount.caption}</span>}
      </span>
      : <Icon name="forward" size={18} className="ck-icon dash-row-go" />}
  </Link>
}

/** «Требует внимания»: up to three rows the server picked — a payment due, the income not entered, a limit near or
 * over, a verdict of the assistant — each a link; «ещё N» shows the rest in place (or leads to «Деньги» for an older
 * server). No rows — no card. */
function AttentionCard({ rows, more, rest = [] }: { rows: DashboardAttention[]; more: number | undefined; rest?: DashboardAttention[] }) {
  const moreText = attentionMoreText(more)
  // «ещё N» shows the rest right here (2026-11-11: the link led to «Деньги», where those rows are not).
  const [open, setOpen] = useState(false)
  const shown = open ? [...rows, ...rest] : rows
  return <section className="ck-panel dash-card dash-attention" aria-labelledby="dash-attention-heading">
    <div className="ck-panel-head">
      <h2 id="dash-attention-heading">Требует внимания</h2>
      {moreText && (rest.length > 0
        ? <button type="button" className="dash-card-link dash-card-more" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Свернуть' : moreText}</button>
        : <Link className="dash-card-link" to="/money">{moreText}</Link>)}
    </div>
    <ul className="ck-list">
      {shown.map((row, index) => <li key={`${row.kind}-${index}`}><AttentionRow row={row} /></li>)}
    </ul>
  </section>
}

/** The three tiles «Платежи · Планы · Цели»: the whole tile is a link; a mini bar of parts under the words. */
function Tiles({ tiles }: { tiles: TileView[] }) {
  return <ul className="dash-tiles" aria-label="Платежи, планы и цели">
    {tiles.map((tile) => <li key={tile.key}>
      <Link className={`dash-tile dash-tile-${tile.key}${tile.reached ? ' is-reached' : ''}`} to={tile.to}>
        <span className="dash-tile-title">{tile.title}</span>
        <span className="dash-tile-value"><Words phrases={[tile.value]} /></span>
        <span className="dash-tile-note"><Words phrases={[tile.note]} /></span>
        {tile.bar.length > 0 && <span className="dash-mini" role="img" aria-label={tile.label}>
          {tile.bar.map((part) => <i key={part.key} className={`dash-mini-part${part.on ? ' is-on' : ''}`} style={{ flex: part.flex }} />)}
        </span>}
      </Link>
    </li>)}
  </ul>
}

/** The heading of a category row: a link to what its money went on this month («Траты категории»); a row without
 * a category id (an older server) stays plain text. */
function RowHead({ categoryId, month, className = 'dash-limit-head', children }: { categoryId: number | null; month: string; className?: string; children: ReactNode }) {
  return categoryId === null ? <div className={className}>{children}</div>
    : <Link className={`${className} dash-limit-link`} to={categorySpendsHref(categoryId, month)}>{children}</Link>
}

/** The bar of a limit and the words under it (LimitBar of the design system): ink while calm, the over bar from 80 %
 * with «осталось …», full with «… сверх лимита» — the words always go with the colour; a mark of today in the
 * current month. */
function LimitBar({ name, spent, limit, currency, today, small = false }: { name: string; spent: string; limit: string | null; currency: string; today: number | null; small?: boolean }) {
  const bar = progress(spent, limit)
  const state = limitState(spent, limit)
  if (!bar || !state || limit === null) return null
  const note = state.state === 'over'
    ? <><Money value={decimalOf(bar.overBy)} currency={currency} /> сверх лимита</>
    : state.state === 'near' ? bar.remaining === 0n ? `${percentText(state.percent)}, ${state.words}`
      : <>{percentText(state.percent)}, осталось <Money value={decimalOf(bar.remaining)} currency={currency} /></>
      : percentText(state.percent)
  return <>
    <div className={`ck-bar dash-bar${small ? ' dash-bar-small' : ''}${state.state === 'calm' ? '' : ` is-${state.state}`}`} role="progressbar"
      aria-label={`${name}: потрачено ${bar.percent}% лимита${state.words ? `, ${state.words}` : ''}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={bar.percent}>
      <span style={{ width: `${bar.percent}%` }} />
      {today !== null && <i className="dash-bar-today" style={{ left: `${today}%` }} aria-hidden="true" />}
    </div>
    <p className={`dash-limit-note${state.state === 'calm' ? '' : ' is-over'}`} aria-hidden="true">{note}</p>
  </>
}

/** «63 600 ₸ из 70 000 ₸» at the right of a limit row; without a limit — what was spent. */
function LimitOf({ spent, limit, currency, sub = false }: { spent: string; limit: string | null; currency: string; sub?: boolean }) {
  return <span className={`dash-limit-value${sub ? ' dash-sublimit-value' : ''}`}>
    <Money value={spent} currency={currency} />{limit !== null && cents(limit) > 0n && <> из <Money value={limit} currency={currency} /></>}
  </span>
}

/** Folds and unfolds the direct sub-categories of a row: a button of its own, beside the link of the row, so a tap on
 * the row still opens «Траты категории». Folded, it says how many there are and, when it fits one line, their limits. */
function SubToggle({ row, listId, expanded, onToggle, count }: { row: DashboardCategory | DashboardSubCategory; listId: string; expanded: boolean; onToggle: Toggle; count: number }) {
  const hint = expanded ? null : collapsedHint(row)
  return <button type="button" className="dash-sub-toggle" aria-expanded={expanded} aria-controls={listId}
    onClick={() => row.category_id !== null && onToggle(row.category_id, !expanded)}>
    <Icon name="forward" size={14} className="ck-icon dash-sub-chevron" />
    <span className="dash-sub-text">
      <span className="ck-visually-hidden">{row.name}: </span>
      <span className="dash-sub-count">{subCategoriesText(count)}</span>
      {hint && <span className="dash-sub-hint">{hint}</span>}
    </span>
  </button>
}

type Toggle = (categoryId: number, open: boolean) => void
/** The open rows and their toggle; `today` — the part of the month gone (the mark on the bars), null in a past month. */
type Fold = { choices: ExpandedChoices; onToggle: Toggle; today: number | null }

/** The sub-categories of a row with their button; a row without a category id (an older server) has none. */
function SubLimits({ row, currency, month, fold }: { row: DashboardCategory | DashboardSubCategory; currency: string; month: string; fold: Fold }) {
  const children = rowChildren(row)
  if (!children.length || row.category_id === null) return null
  const listId = subListId(currency, row.category_id)
  const expanded = isExpanded(row, fold.choices)
  return <>
    <SubToggle row={row} listId={listId} expanded={expanded} onToggle={fold.onToggle} count={children.length} />
    <ul className="dash-sublimit-list" id={listId} aria-label={`${row.name}: подкатегории`} hidden={!expanded}>
      {children.map((child) => <SubLimitRow key={child.category_id} row={child} currency={currency} month={month} fold={fold} />)}
    </ul>
  </>
}

/** «Аренда» under «Жильё»: indented, a thinner bar. Every sub-category with spends of the month comes here, and a
 * limited one with its ancestors; one without its own limit shows what was spent. */
function SubLimitRow({ row, currency, month, fold }: { row: DashboardSubCategory; currency: string; month: string; fold: Fold }) {
  return <li className="dash-sublimit">
    <RowHead categoryId={row.category_id} month={month}>
      <span className="dash-sublimit-name">{row.name}</span>
      <LimitOf sub spent={row.spent} limit={row.limit} currency={currency} />
    </RowHead>
    <LimitBar small name={row.name} spent={row.spent} limit={row.limit} currency={currency} today={fold.today} />
    <SubLimits row={row} currency={currency} month={month} fold={fold} />
  </li>
}

/** A category with a limit: the name and what was spent, the bar, the share with its words and the limit under it. */
function LimitRow({ category, currency, month, fold }: { category: DashboardCategory; currency: string; month: string; fold: Fold }) {
  return <li className={`dash-limit${toneClass(categoryTone(category.category_id))}`}>
    <RowHead categoryId={category.category_id} month={month}>
      <i className="dash-limit-dot" aria-hidden="true" />
      <span className="dash-limit-name">{category.name}</span>
      <LimitOf spent={category.spent} limit={category.limit} currency={currency} />
    </RowHead>
    <LimitBar name={category.name} spent={category.spent} limit={category.limit} currency={currency} today={fold.today} />
    <SubLimits row={category} currency={currency} month={month} fold={fold} />
  </li>
}

/** «Лимиты» compact: the limited categories only, a row each; without any limit the card is one link. */
function LimitsCard({ block, several, month, fold }: { block: DashboardCurrency; several: boolean; month: string; fold: Fold }) {
  const headingId = `dash-limits-${block.currency}`
  const limited = block.categories.filter(hasLimit)
  const key = (category: DashboardCategory) => category.category_id ?? `none-${category.name}`
  if (!limited.length) return <LimitsEmpty currency={several ? block.currency : undefined} />
  return <section className="ck-panel dash-card dash-limits" aria-labelledby={headingId}>
    <div className="ck-panel-head">
      <h2 id={headingId}>Лимиты{several && <span className="dash-currency"> · {currencySymbol(block.currency)}</span>}</h2>
      <Link className="dash-card-link" to="/budget/limits">Изменить</Link>
    </div>
    <ul className="dash-limit-list">{limited.map((category) => <LimitRow key={key(category)} category={category} currency={block.currency} month={month} fold={fold} />)}</ul>
  </section>
}

function LimitsEmpty({ currency }: { currency?: string }) {
  return <Link className="ck-panel dash-card dash-limits dash-limits-empty" to="/budget/limits" aria-label="Лимиты: задать лимиты">
    <span className="ck-row-badge dash-limits-empty-badge" aria-hidden="true"><Icon name="stats" size={20} /></span>
    <span className="dash-limits-empty-text">
      <span className="dash-limits-empty-title">Лимиты{currency && <span className="dash-currency"> · {currencySymbol(currency)}</span>}</span>
      <span className="dash-limits-empty-note">Задать лимиты</span>
    </span>
    <Icon name="forward" size={18} className="ck-icon dash-row-go" />
  </Link>
}

/** The source of a spend as a stamp (Чекист 2.0): «Фото» of a receipt, «Выписка» of a bank statement, «Вручную». */
const stampOf = { photo: 'Фото', statement: 'Выписка', manual: 'Вручную' } as const

function RecentItem({ item, tone, date, base }: { item: DashboardRecent; tone: number; date: string; base?: string }) {
  const source = recentSource(item)
  // «20 $» and under it «≈ 8 979 ₸»: a spend in another currency keeps its own amount, the total above counts the twin.
  const twin = base && item.currency !== base && item.base_total !== null && item.base_total !== undefined ? item.base_total : null
  // The category's picture or how the spend came in — the choice of the device (lib/list-icons), as in «Траты».
  const icon = useSpendIcon(source, item.category_icon)
  const bank = source === 'statement' ? sourceMark(item.source, item.note).replace(/^Выписка\s*/, '') : ''
  const lines = source === 'photo' && item.lines_count > 0 ? glue(String(item.lines_count), plural(item.lines_count, 'позиция', 'позиции', 'позиций')) : ''
  const meta = [ownerName(item), relativeDay(item.purchased_on, date), bank || lines].filter(Boolean).join(' · ')
  return <li>
    <Link className="ck-row dash-recent-item" to={`/receipts/${item.id}`}>
      <span className={`ck-row-badge dash-badge${toneClass(tone)}`} data-icon={icon} aria-hidden="true"><Icon name={icon} size={20} /></span>
      <span className="ck-row-main">
        <span className="ck-row-title dash-recent-title">{item.title || (item.source === 'manual' ? 'Трата' : 'Чек')}</span>
        <span className="ck-row-meta dash-recent-meta"><span className="ck-stamp">{stampOf[source]}</span><span className="dash-recent-meta-text">{meta}</span></span>
      </span>
      <span className="ck-row-amount dash-recent-amount">
        <Money size="row" value={item.total} currency={item.currency} />
        {twin && <Money className="ck-twin" value={twin} currency={base} approx />}
      </span>
    </Link>
  </li>
}

export type DashboardViewProps = {
  data: Dashboard
  /** The month of the device: there is nothing to see after it. */
  today?: string
  /** «Пользователь с семьёй» says «семьёй»; one person without a family — just «Потрачено». */
  family?: boolean
  /** The month came after another one: it slides in from that side (not under reduced motion). */
  slide?: MonthSlide
  /** Opened and closed rows of «Лимиты» to start with; the saved ones of this browser by default. */
  expanded?: ExpandedChoices
  /** The date of the device: «сегодня» and «вчера» of the latest spends, today on the pulse and the bar. */
  date?: string
  /** The main number; the choice of the device (`checkist.homeFigure`) by default. */
  figure?: HomeFigure
  /** The answer of «Деньги» for «Свободно», asked by the page while that number is chosen. */
  free?: FreeState
}

/** The dashboard itself, without loading: the markup tests render it directly (the header row then stays in place). */
export function DashboardView({ data, today = deviceMonth(), family = data.members.length > 1, slide, expanded, date = deviceDate(), figure, free }: DashboardViewProps) {
  const [chosen] = useHomeFigure()
  const current = data.month === today
  const empty = monthIsEmpty(data)
  const unconverted = data.excluded ?? []
  const ids = categoryIds(data)
  const several = data.currencies.length > 1
  const [choices, setChoices] = useState<ExpandedChoices>(() => expanded ?? readExpanded())
  const [picking, setPicking] = useState(false)
  const fold: Fold = {
    choices, today: monthDone(data.month, date, current),
    onToggle: (categoryId, open) => setChoices((before) => {
      const next = withChoice(before, categoryId, open)
      writeExpanded(next)
      return next
    }),
  }
  const spent = data.currencies.filter((block) => cents(block.spent) !== 0n || block.limit_total !== null)
  const [hero, ...others] = spent
  const currency = data.base_currency ?? hero?.currency ?? data.currencies[0]?.currency ?? ''
  // The main currency always gets its limits card; another one only when it has limits (its spends are in «Другие валюты»).
  const limits = data.currencies.filter((block, index) => block.limit_total !== null || (index === 0 && block.categories.length))
  const attention = attentionRows(data)
  const tiles = tilesOf(data, currency)
  const recent = recentView(data.recent, data.month, date)
  const shownHero = !empty && hero ? heroOf({ data, block: hero, figure: figure ?? chosen, current, free }) : null
  const pace = !empty && hero ? paceOf(data, hero, current, date) : null
  // Two columns on a wide screen: the main number, «Требует внимания», the latest spends and the ring at the left; the
  // tiles and the limits at the right. A phone reads one column: the number, the attention, the spends of today and
  // yesterday, the tiles, the ring, the limits (the `order` rules of Dashboard.css).
  return <div className={`dash${slide ? ` dash-slide-${slide}` : ''}`}>
    <MonthHeader month={data.month} today={today} people={dashboardPeople(data)} family={family} />
    <div className="dash-column dash-column-main">
      {(empty || !hero) && unconverted.length > 0 ? null : !shownHero
        ? <section className="ck-panel dash-card dash-empty">
          <p className="dash-empty-title">{capitalize(inMonth(data.month))} трат {current ? 'пока нет' : 'не было'}</p>
          {current && <p className="dash-note">Снимите чек или добавьте трату — сумма появится здесь.</p>}
          <Link className="action-link dash-empty-action" to="/receipts/new">Добавить трату</Link>
        </section>
        : <Hero view={shownHero} pace={pace} scope={`${data.month}:${shownHero.currency}`} open={picking} onOpen={() => setPicking(true)} />}
      {!empty && others.length > 0 && <OtherCurrencies blocks={others} />}
      {unconverted.length > 0 && <Unconverted items={unconverted} />}
      {attention.length > 0 && <AttentionCard rows={attention} more={data.attention_more} rest={data.attention_rest} />}
      <section className="ck-panel dash-card dash-recent" aria-labelledby="dash-recent-heading">
        <div className="ck-panel-head">
          <h2 id="dash-recent-heading">{recent.title}</h2>
          <Link className="dash-card-link" to="/receipts">Все траты</Link>
        </div>
        {recent.empty
          ? <p className="dash-note">{current ? 'Сегодня трат нет.' : 'Трат не было.'}</p>
          : <ul className="ck-list dash-recent-list">{recent.items.map((item) => <RecentItem key={item.id} item={item} date={date} base={data.base_currency}
            tone={categoryTone(item.category_name === null ? null : ids.get(item.category_name))} />)}</ul>}
      </section>
      {!empty && hero && <WhereCard block={hero} data={data} current={current} date={date} />}
    </div>
    <div className="dash-column dash-column-side">
      {tiles && <Tiles tiles={tiles} />}
      {limits.map((block) => <LimitsCard key={block.currency} block={block} several={several} month={data.month} fold={fold} />)}
      {!data.currencies.length && <LimitsEmpty />}
    </div>
    {shownHero && <Sheet open={picking} onClose={() => setPicking(false)} title="Главное число" id="dash-figure-sheet">
      <HomeFigureSetting hideLegend legend="Главное число на Главной" unavailable={figureReasons(data, hero, current, free)} onPick={() => setPicking(false)} />
    </Sheet>}
  </div>
}

type Load = { key: string } & ({ kind: 'error'; message: string } | { kind: 'ok'; data: Dashboard; slide?: MonthSlide })

/** «Главная»: the month of the family budget. The month lives in the address (`/?month=YYYY-MM`).
 * An answer belongs to its month and attempt: another month shows «loading» until its own answer comes.
 * «Свободно» as the main number asks «Деньги» of the same month (`GET /api/money/`) — only while it is chosen. */
export default function DashboardPage({ month }: { month?: string }) {
  const [load, setLoad] = useState<Load | undefined>()
  const [attempt, setAttempt] = useState(0)
  const [figure] = useHomeFigure()
  const [free, setFree] = useState<{ month: string; state: FreeState } | undefined>()
  const key = `${month ?? ''}:${attempt}`
  // The month shown last: the next one slides in from its side.
  const shown = useRef<string | undefined>(undefined)
  useEffect(() => {
    const controller = new AbortController()
    void getDashboard(month, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted || result.kind === 'aborted') return
      if (result.kind !== 'ok') { setLoad({ key, kind: 'error', message: dashboardErrorMessage(result) }); return }
      const slide = monthSlide(shown.current, result.data.month)
      shown.current = result.data.month
      setLoad({ key, kind: 'ok', data: result.data, slide })
    })
    return () => controller.abort()
  }, [month, key])
  const loadedMonth = load?.kind === 'ok' ? load.data.month : undefined
  const wantsFree = figure === 'free'
  useEffect(() => {
    if (!wantsFree || !loadedMonth) return
    const controller = new AbortController()
    void getMoney(loadedMonth, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted || result.kind === 'aborted') return
      setFree({ month: loadedMonth, state: result.kind === 'ok' ? { kind: 'ok', data: result.data } : { kind: 'error' } })
    })
    return () => controller.abort()
  }, [wantsFree, loadedMonth])
  const today = deviceMonth()
  // While the month loads, its header is already there: the steps work, the heading names the month, the family of the
  // month shown before stays in its place.
  const before = load?.kind === 'ok' ? load.data : undefined
  const waiting = <MonthHeader month={month ?? today} today={today} people={before ? dashboardPeople(before) : []} family={before ? before.members.length > 1 : false} />
  if (!load || load.key !== key) return <>{waiting}<RequestState kind="loading" message="Загружаем траты месяца…" shape="home" /></>
  if (load.kind === 'error') return <>{waiting}<RequestState kind="error" message={load.message} onRetry={() => setAttempt((value) => value + 1)} /></>
  const freeState: FreeState | undefined = wantsFree ? (free?.month === load.data.month ? free.state : { kind: 'loading' }) : undefined
  return <DashboardView data={load.data} slide={load.slide} free={freeState} />
}
