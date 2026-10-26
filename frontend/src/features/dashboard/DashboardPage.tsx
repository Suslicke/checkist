import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { getDashboard } from '../../api/budget'
import type { Dashboard, DashboardAttention, DashboardCategory, DashboardCurrency, DashboardRecent, DashboardSubCategory } from '../../api/budget'
import type { ExcludedSpends } from '../../api/base-currency'
import Icon from '../../components/Icon'
import { HeaderSlot } from '../../components/PageHeader'
import { usePageTitle } from '../../components/page-header'
import RequestState from '../../components/RequestState'
import type { Person } from '../../lib/people'
import Ring from '../../lib/charts/RingChart'
import { pulse } from '../../lib/charts/pulse'
import { Link } from '../../navigation'
import {
  capitalize, categoryIds, categoryTone, cents, currencyName, dashboardErrorMessage, dashboardPeople, deviceDate, deviceMonth,
  formatMoney, hasLimit, initials, inMonth, monthIsEmpty, monthSlide, monthTitle, progress, recentMeta, recentSource, shiftMonth,
} from './dashboard-state'
import { useSpendIcon } from '../../lib/list-icons'
import type { MonthSlide, Progress } from './dashboard-state'
import { categorySpendsHref } from './category-spends-state'
import { baseTwin, currencySymbol } from '../../lib/money'
import { collapsedHint, isExpanded, readExpanded, rowChildren, subListId, withChoice, writeExpanded } from './limit-collapse-state'
import type { ExpandedChoices } from './limit-collapse-state'
import { subCategoriesText } from './limits-state'
import {
  attentionBadge, attentionMeta, attentionMoreText, attentionRows, budgetShare, centsOf, hasPulse, heroFoot, legendOf, limitLine, percentText, pulseCaption, recentView, tilesOf, todayIn,
} from './home-state'
import type { TileView } from './home-state'
import './Dashboard.css'

const monthHref = (month: string) => `/?month=${month}`

/** The filled part of a bar; the numbers next to it say the same in words. */
function Bar({ value, label, small = false }: { value: Progress; label: string; small?: boolean }) {
  return <div className={`dash-bar${small ? ' dash-bar-small' : ''}${value.over ? ' dash-bar-over' : ''}`} role="progressbar" aria-label={label}
    aria-valuemin={0} aria-valuemax={100} aria-valuenow={value.percent}>
    <span className="dash-bar-fill" style={{ width: `${value.percent}%` }} />
  </div>
}

/** The header row of «Главная» (the shell's, components/PageHeader): the month as the heading of the page, then the two
 * small round steps «‹ ›» (2026-10-26: both after the heading, «›» only while a later month is not in the future) and
 * the family at the right edge. Drawn while the month loads too. */
function MonthHeader({ month, today, people, family }: { month: string; today: string; people: Person[]; family: boolean }) {
  // An ordinary space: on a window narrower than the row «Сентябрь 2026» goes to two lines, never «Сентябрь 2 / 026».
  usePageTitle(monthTitle(month).replace('\u00a0', ' '))
  return <HeaderSlot side="end">
    <span className="dash-month-steps">
      <Link className="ck-round dash-month-step" to={monthHref(shiftMonth(month, -1))} aria-label="Предыдущий месяц"><Icon name="back" size={18} /></Link>
      {month < today && <Link className="ck-round dash-month-step" to={monthHref(shiftMonth(month, 1))} aria-label="Следующий месяц"><Icon name="forward" size={18} /></Link>}
    </span>
    {people.length > 0 && <ul className="dash-family" aria-label={family ? 'Семья' : 'Кто тратит'}>
      {people.map((person, index) => <li key={person.username} className={`dash-avatar dash-cat-${(index % 6) + 1}`} title={person.display_name}>
        <span aria-hidden="true">{initials(person.display_name)}</span><span className="dash-visually-hidden">{person.display_name}</span>
      </li>)}
    </ul>}
  </HeaderSlot>
}

/** The pulse of the month under the ring: a bar a day, today in the accent, the days ahead flat, the average day dashed. */
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
      <span className="dash-pulse-x-middle">{middle.map((part, index) => <span key={part} className={index === 0 && caption.middle.today ? 'dash-pulse-today' : undefined}>{index > 0 && ' · '}{part}</span>)}</span>
      <span>{caption.end}</span>
    </p>
  </div>
}

/** The first currency of the month: the ring of the categories with what is left of the budget as the gap, the legend,
 * the pulse of the days (a server of 2026-10-26) and the line of the budget, the days and «в день». */
function HeroCard({ block, data, family, current, date }: { block: DashboardCurrency; data: Dashboard; family: boolean; current: boolean; date: string }) {
  const legend = legendOf(block, data.budget)
  const share = budgetShare(block.spent, data.budget?.currency === block.currency ? data.budget : null)
  const foot = heroFoot(data, block, current)
  const ringLabel = legend.all.length ? `Потрачено ${formatMoney(block.spent, block.currency)}: ${legend.all.map((row) => `${row.name} ${formatMoney(row.amount, block.currency)}`).join(', ')}` : `Потрачено ${formatMoney(block.spent, block.currency)}`
  return <section className="ck-panel dash-card dash-hero" aria-label={`Потрачено, ${block.currency}`}>
    <div className="dash-ring-wrap">
      <Ring items={legend.all.map((row) => ({ key: row.key, value: centsOf(row.amount), tone: row.tone }))} remainder={legend.remainder === null ? 0 : Number(legend.remainder)} label={ringLabel}>
        <span className="dash-ring-label">{family ? 'Потрачено семьёй' : 'Потрачено'}</span>
        <span className="dash-ring-value ck-figures">{formatMoney(block.spent, block.currency)}</span>
        <span className={`dash-ring-label${share !== null && share > 100 ? ' dash-over' : ''}`}>{share === null ? 'за месяц' : `${percentText(share)} бюджета`}</span>
      </Ring>
      <ul className="dash-legend" aria-label="По категориям">
        {legend.rows.map((row) => <li key={row.key} className={`dash-legend-row dash-cat-${row.tone}`}>
          <i className="dash-legend-swatch" aria-hidden="true" />
          {row.categoryId === null ? <span className="dash-legend-name">{row.name}</span>
            : <Link className="dash-legend-name" to={categorySpendsHref(row.categoryId, data.month)}>{row.name}</Link>}
          <b className="dash-legend-amount ck-figures">{formatMoney(row.amount, block.currency)}</b>
        </li>)}
        {legend.more > 0 && <li className="dash-legend-row dash-legend-rest"><i className="dash-legend-swatch" aria-hidden="true" /><Link className="dash-legend-name" to="/stats">ещё {legend.more}</Link></li>}
        {legend.remainder !== null && <li className="dash-legend-row dash-legend-rest">
          <i className="dash-legend-swatch" aria-hidden="true" />
          <span className="dash-legend-name">{legend.remainder < 0n ? 'Сверх бюджета' : 'Остаток бюджета'}</span>
          <b className={`dash-legend-amount ck-figures${legend.remainder < 0n ? ' dash-over' : ''}`}>{formatMoney(legend.remainder < 0n ? -legend.remainder : legend.remainder, block.currency)}</b>
        </li>}
      </ul>
    </div>
    {hasPulse(data) && <Pulse data={data} currency={block.currency} current={current} date={date} />}
    {(foot.left.length > 0 || foot.right) && <div className="dash-hero-foot">
      <span className={foot.leftOver ? 'dash-hero-budget dash-over' : 'dash-hero-budget'}>{foot.left.join(' · ')}</span>
      {foot.right && <span className={`dash-hero-day${foot.right.over ? ' dash-over' : ''}`} title={foot.right.title ?? undefined}>
        {foot.right.label} <b className="ck-figures">{foot.right.amount}</b>
        {foot.right.title && <span className="dash-visually-hidden">. {foot.right.title}</span>}
      </span>}
    </div>}
  </section>
}

/** Another currency of the month: one compact row each, never a second hero and never added to the first. */
function OtherCurrencies({ blocks }: { blocks: DashboardCurrency[] }) {
  return <section className="ck-panel dash-card dash-others" aria-labelledby="dash-others-heading">
    <div className="ck-panel-head"><h2 id="dash-others-heading">Другие валюты</h2></div>
    <ul className="ck-list">
      {blocks.map((block) => {
        const total = block.limited_spent != null && block.limit_total ? limitLine(block.limited_spent, block.limit_total, block.currency) : null
        return <li key={block.currency} className="ck-row dash-other" aria-label={`Потрачено, ${block.currency}`}>
          <span className="ck-row-badge dash-currency-badge" aria-hidden="true">{currencySymbol(block.currency)}</span>
          <span className="ck-row-main">
            <span className="ck-row-title">{currencyName(block.currency)}</span>
            {total && <span className={`ck-row-meta${total.over ? ' dash-over' : ''}`}>{total.text}</span>}
          </span>
          <span className="ck-row-amount ck-figures dash-other-amount">{formatMoney(block.spent, block.currency)}</span>
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
        <span className="ck-row-amount ck-figures dash-other-amount">{formatMoney(item.total, item.currency)}</span>
      </li>)}
    </ul>
  </section>
}

/** «Требует внимания» (2026-10-26): up to three rows the server picked — a payment due, the income not entered, a limit
 * near or over, a verdict of the model — each a link; «ещё N» leads to «Деньги». No rows — no card. */
function AttentionCard({ rows, more }: { rows: DashboardAttention[]; more: number | undefined }) {
  const moreText = attentionMoreText(more)
  return <section className="ck-panel dash-card dash-attention" aria-labelledby="dash-attention-heading">
    <div className="ck-panel-head">
      <h2 id="dash-attention-heading">Требует внимания</h2>
      {moreText && <Link className="dash-card-link" to="/money">{moreText}</Link>}
    </div>
    <ul className="ck-list">
      {rows.map((row, index) => {
        const badge = attentionBadge(row.kind)
        return <li key={`${row.kind}-${index}`}>
          <Link className="ck-row dash-attention-row" to={row.href} data-kind={row.kind}>
            <span className={`ck-row-badge dash-attention-badge dash-attention-${badge.tone}`} aria-hidden="true"><Icon name={badge.icon} size={20} /></span>
            <span className="ck-row-main">
              <span className="ck-row-title">{row.title}</span>
              <span className="ck-row-meta">{attentionMeta(row)}</span>
            </span>
            <Icon name="forward" size={18} className="ck-icon dash-attention-go" />
          </Link>
        </li>
      })}
    </ul>
  </section>
}

/** The three tiles «Платежи · Планы · Цели» (2026-10-26): the whole tile is a link; a mini bar of parts under the words. */
function Tiles({ tiles }: { tiles: TileView[] }) {
  return <ul className="dash-tiles" aria-label="Платежи, планы и цели">
    {tiles.map((tile) => <li key={tile.key}>
      <Link className={`dash-tile dash-tile-${tile.key}`} to={tile.to}>
        <span className="dash-tile-title">{tile.title}</span>
        <span className="dash-tile-value ck-figures">{tile.value}</span>
        <span className="dash-tile-note">{tile.note}</span>
        {tile.bar.length > 0 && <span className="dash-mini" role="img" aria-label={tile.label}>
          {tile.bar.map((part) => <i key={part.key} className={`dash-mini-part dash-cat-${part.tone}${part.on ? ' dash-mini-on' : ''}`} style={{ flex: part.flex }} />)}
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

/** «92 % · 112 000 из 120 000 ₸» on one line, in the colour of an overspend when it is one; without a limit what was spent. */
function LimitValue({ spent, limit, currency, sub = false }: { spent: string; limit: string | null; currency: string; sub?: boolean }) {
  const line = limitLine(spent, limit, currency)
  return <span className={`dash-limit-value${sub ? ' dash-sublimit-value' : ''}${line.over ? ' dash-limit-spent-over' : ''} ck-figures`}>{line.text}</span>
}

/** Folds and unfolds the direct sub-categories of a row: a button of its own, beside the link of the row, so a tap on
 * the row still opens «Траты категории». Folded, it says how many there are and, when it fits one line, their limits. */
function SubToggle({ row, listId, expanded, onToggle, count }: { row: DashboardCategory | DashboardSubCategory; listId: string; expanded: boolean; onToggle: Toggle; count: number }) {
  const hint = expanded ? null : collapsedHint(row)
  return <button type="button" className="dash-sub-toggle" aria-expanded={expanded} aria-controls={listId}
    onClick={() => row.category_id !== null && onToggle(row.category_id, !expanded)}>
    <Icon name="forward" size={14} className="ck-icon dash-sub-chevron" />
    <span className="dash-sub-text">
      <span className="dash-visually-hidden">{row.name}: </span>
      <span className="dash-sub-count">{subCategoriesText(count)}</span>
      {hint && <span className="dash-sub-hint ck-figures">{hint}</span>}
    </span>
  </button>
}

type Toggle = (categoryId: number, open: boolean) => void
type Fold = { choices: ExpandedChoices; onToggle: Toggle }

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

/** «Аренда» under «Жильё»: indented, a thinner bar, the colour of its top-level row. Every sub-category with spends
 * of the month comes here, and a limited one with its ancestors; one without its own limit shows what was spent. */
function SubLimitRow({ row, currency, month, fold }: { row: DashboardSubCategory; currency: string; month: string; fold: Fold }) {
  const bar = progress(row.spent, row.limit)
  return <li className="dash-sublimit">
    <RowHead categoryId={row.category_id} month={month}>
      <span className="dash-sublimit-name">{row.name}</span>
      <LimitValue spent={row.spent} limit={row.limit} currency={currency} sub />
    </RowHead>
    {bar && <Bar small value={bar} label={`${row.name}: потрачено ${bar.percent}% лимита`} />}
    <SubLimits row={row} currency={currency} month={month} fold={fold} />
  </li>
}

/** A category with a limit: the name, «N % · spent из limit» and a bar in its colour (the overspend colour over it). */
function LimitRow({ category, currency, month, fold }: { category: DashboardCategory; currency: string; month: string; fold: Fold }) {
  const bar = progress(category.spent, category.limit)
  return <li className={`dash-limit dash-cat-${categoryTone(category.category_id)}`}>
    <RowHead categoryId={category.category_id} month={month}>
      <span className="dash-limit-name">{category.name}</span>
      <LimitValue spent={category.spent} limit={category.limit} currency={currency} />
    </RowHead>
    {bar && <Bar value={bar} label={`${category.name}: потрачено ${bar.percent}% лимита`} />}
    <SubLimits row={category} currency={currency} month={month} fold={fold} />
  </li>
}

/** «Лимиты» compact (2026-10-26): the limited categories only, a row each; without any limit the card is one link. */
function LimitsCard({ block, several, month, fold }: { block: DashboardCurrency; several: boolean; month: string; fold: Fold }) {
  const headingId = `dash-limits-${block.currency}`
  const limited = block.categories.filter(hasLimit)
  const key = (category: DashboardCategory) => category.category_id ?? `none-${category.name}`
  if (!limited.length) {
    return <Link className="ck-panel dash-card dash-limits dash-limits-empty" to="/budget/limits" aria-label="Лимиты: задать лимиты">
      <span className="dash-limits-empty-title">Лимиты{several && <span className="dash-currency"> · {currencySymbol(block.currency)}</span>}</span>
      <span className="dash-limits-empty-note">Задать лимиты</span>
      <Icon name="forward" size={18} className="ck-icon dash-attention-go" />
    </Link>
  }
  return <section className="ck-panel dash-card dash-limits" aria-labelledby={headingId}>
    <div className="ck-panel-head">
      <h2 id={headingId}>Лимиты{several && <span className="dash-currency"> · {currencySymbol(block.currency)}</span>}</h2>
      <Link className="dash-card-link" to="/budget/limits">Изменить</Link>
    </div>
    <ul className="dash-limit-list">{limited.map((category) => <LimitRow key={key(category)} category={category} currency={block.currency} month={month} fold={fold} />)}</ul>
  </section>
}

function RecentItem({ item, tone, date, base }: { item: DashboardRecent; tone: number; date: string; base?: string }) {
  // «20 $» and under it «≈ 8 979 ₸»: a spend in another currency keeps its own amount, the total above counts the twin.
  const twin = baseTwin(item.currency, item.base_total, base)
  // The category's picture or how the spend came in — the choice of the device (lib/list-icons), as in «Траты».
  const icon = useSpendIcon(recentSource(item), item.category_icon)
  return <li>
    <Link className="ck-row dash-recent-item" to={`/receipts/${item.id}`}>
      <span className={`ck-row-badge dash-badge dash-cat-${tone}`} data-icon={icon} aria-hidden="true"><Icon name={icon} size={20} /></span>
      <span className="ck-row-main">
        <span className="ck-row-title dash-recent-title">{item.title || (item.source === 'manual' ? 'Трата' : 'Чек')}</span>
        <span className="ck-row-meta">{recentMeta(item, date)}</span>
      </span>
      <span className="ck-row-amount ck-figures">{formatMoney(item.total, item.currency)}
        {twin && <span className="dash-recent-twin">{twin}</span>}</span>
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
  /** The date of the device: «сегодня» and «вчера» of the latest spends, today on the pulse. */
  date?: string
}

/** The dashboard itself, without loading: the markup tests render it directly (the header row then stays in place). */
export function DashboardView({ data, today = deviceMonth(), family = data.members.length > 1, slide, expanded, date = deviceDate() }: DashboardViewProps) {
  const current = data.month === today
  const empty = monthIsEmpty(data)
  const unconverted = data.excluded ?? []
  const ids = categoryIds(data)
  const several = data.currencies.length > 1
  const [choices, setChoices] = useState<ExpandedChoices>(() => expanded ?? readExpanded())
  const fold: Fold = {
    choices,
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
  // Two columns on a wide screen: the ring, «Требует внимания» and the latest spends at the left; the limits and the
  // tiles at the right. A phone reads one column in the order of the mockup — the ring, the attention, the tiles, the
  // spends of today and yesterday, the limits (the `order` rules of Dashboard.css).
  return <div className={`dash${slide ? ` dash-slide-${slide}` : ''}`}>
    <MonthHeader month={data.month} today={today} people={dashboardPeople(data)} family={family} />
    <div className="dash-column dash-column-main">
      {(empty || !hero) && unconverted.length > 0 ? null : empty || !hero
        ? <section className="ck-panel dash-card dash-empty">
          <p className="dash-empty-title">{capitalize(inMonth(data.month))} трат {current ? 'пока нет' : 'не было'}</p>
          {current && <p className="dash-note">Снимите чек или добавьте трату — сумма появится здесь.</p>}
          <Link className="dash-empty-action" to="/receipts/new">Добавить трату</Link>
        </section>
        : <HeroCard block={hero} data={data} family={family} current={current} date={date} />}
      {!empty && others.length > 0 && <OtherCurrencies blocks={others} />}
      {unconverted.length > 0 && <Unconverted items={unconverted} />}
      {attention.length > 0 && <AttentionCard rows={attention} more={data.attention_more} />}
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
    </div>
    <div className="dash-column dash-column-side">
      {tiles && <Tiles tiles={tiles} />}
      {limits.map((block) => <LimitsCard key={block.currency} block={block} several={several} month={data.month} fold={fold} />)}
      {!data.currencies.length && <Link className="ck-panel dash-card dash-limits dash-limits-empty" to="/budget/limits" aria-label="Лимиты: задать лимиты">
        <span className="dash-limits-empty-title">Лимиты</span>
        <span className="dash-limits-empty-note">Задать лимиты</span>
        <Icon name="forward" size={18} className="ck-icon dash-attention-go" />
      </Link>}
    </div>
  </div>
}

type Load = { key: string } & ({ kind: 'error'; message: string } | { kind: 'ok'; data: Dashboard; slide?: MonthSlide })

/** «Главная»: the month of the family budget. The month lives in the address (`/?month=YYYY-MM`).
 * An answer belongs to its month and attempt: another month shows «loading» until its own answer comes. */
export default function DashboardPage({ month }: { month?: string }) {
  const [load, setLoad] = useState<Load | undefined>()
  const [attempt, setAttempt] = useState(0)
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
  const today = deviceMonth()
  // While the month loads, its header is already there: the steps work, the heading names the month, the family of the
  // month shown before stays in its place.
  const before = load?.kind === 'ok' ? load.data : undefined
  const waiting = <MonthHeader month={month ?? today} today={today} people={before ? dashboardPeople(before) : []} family={before ? before.members.length > 1 : false} />
  if (!load || load.key !== key) return <>{waiting}<RequestState kind="loading" message="Загружаем траты месяца…" shape="home" /></>
  if (load.kind === 'error') return <>{waiting}<RequestState kind="error" message={load.message} onRetry={() => setAttempt((value) => value + 1)} /></>
  return <DashboardView data={load.data} slide={load.slide} />
}
