import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { getIncomeStats } from '../../api/incomes'
import type { IncomeStats } from '../../api/incomes'
import { getTrendsRange } from '../../api/trends'
import Money from '../../components/Money'
import RequestState from '../../components/RequestState'
import { formatMoney } from '../../lib/money'
import { Link, statsIncomesHref } from '../../navigation'
import type { StatsIncomesQuery } from '../../navigation'
import IncomeTrend from '../incomes/IncomeTrend'
import { categoryRows, summaryParts } from '../incomes/incomes-state'
import { useStatsRequest } from './receipts-request'
import type { StatsRequestState } from './receipts-request'
import { Failure, Panel } from './trends-blocks'
import { monthOfDate } from './trends-period'
import TrendsPeriodPicker from './trends-period-picker'
import { loadingOf, windowParams } from './trends-state'
import './ReceiptsStats.css'
import './Trends.css'
import '../incomes/Incomes.css'

const loadRange = (signal: AbortSignal) => getTrendsRange({ signal })
const addIncome = <Link className="action-link" to="/receipts/new?kind=income">Внести доход</Link>

/** The two cards of the answer: «Итог за период» and «Доход по категориям». Without loading: the markup tests render it. */
export function IncomeStatsBlocks({ state, onRetry }: { state: StatsRequestState<IncomeStats>; onRetry: () => void }) {
  const shown = loadingOf(state)
  if (shown.kind !== 'ok') {
    const body = shown.kind === 'loading' ? <RequestState kind="loading" message="Считаем доходы за период…" /> : <Failure state={shown} onRetry={onRetry} />
    return <Panel title="Итог за период" state={state}>{body}</Panel>
  }
  const data = shown.data
  const parts = summaryParts(data, data.base_currency)
  const rows = categoryRows(data)
  const own = data.categories_scope === 'own'
  let categories: ReactNode
  if (rows.length === 0) {
    categories = <RequestState kind="empty" message={own ? 'Ваших записей дохода за период нет.' : 'Доходов за период нет.'} action={addIncome} />
  } else {
    // An income is the income tone with «+» (Чекист 2.0), the bar compares the categories in their own colours.
    categories = <ul className="trends-rows">
      {rows.map((row, index) => <li key={row.id} className={`trends-row trends-cat-${row.tone}`}>
        <span className="trends-dot" aria-hidden="true" />
        <span className="trends-row-main">
          <span className="trends-row-name">{row.label}</span>
          {row.bar > 0 && <span className="trends-row-bar" aria-hidden="true"><span style={{ width: `${row.bar}%` }} /></span>}
        </span>
        <span className="trends-value"><Money value={data.categories[index].total} currency={data.base_currency} size="row" sign="plus" tone="in" /></span>
      </li>)}
    </ul>
  }
  const excluded = data.excluded.map((item) => formatMoney(item.total, item.currency)).join(', ')
  return <>
    <Panel title="Итог за период" state={state}
      note={`Доход всей семьи и траты видимых чеков в основной валюте по курсу дня.${excluded ? ` Нет курса Нацбанка — не вошли: ${excluded}.` : ''}`}>
      {/* The income of the period is the main number of the screen, in the income tone with «+»; spent and saved under it. */}
      {parts && data.income !== null && data.saved !== null ? <dl className="stats-inc-figures">
        {parts.map((part, index) => {
          const value = index === 0 ? data.income : index === 1 ? data.spent : data.saved?.replace(/^-/, '')
          return <div key={part.label} className={index === 0 ? 'stats-inc-figure stats-inc-main' : 'stats-inc-figure'}>
            <dt>{part.label}</dt>
            <dd><Money value={value} currency={data.base_currency} size={index === 0 ? 'display' : 'title'}
              {...(index === 0 && { sign: 'plus' as const, tone: 'in' as const })} />
              {part.note && <span className="stats-inc-note"> ({part.note})</span>}</dd>
          </div>
        })}
      </dl> : <RequestState kind="empty" message="За период доход не внесён: отложенное считать не из чего." action={addIncome} />}
    </Panel>
    <Panel title="Доход по категориям" state={state}>
      {/* A member of a family sees the records of others only in the family's total. */}
      {own && <p className="stats-note">Только ваши записи: записи других членов семьи видит главный в семье. Итог выше — доход всей семьи.</p>}
      {categories}
    </Panel>
  </>
}

/**
 * «Статистика → Доходы» (`/stats/incomes`): over the period of «Динамика» — the family's income, spent and saved, income by
 * category of the records the person may see, and the months: income against spends and what was saved.
 */
export default function IncomesStatsPage({ query }: { query: StatsIncomesQuery }) {
  const key = JSON.stringify(windowParams(query))
  const load = useMemo(() => {
    const params = JSON.parse(key)
    return (signal: AbortSignal) => getIncomeStats(params, { signal })
  }, [key])
  const stats = useStatsRequest(load)
  // The first month with receipts and the server's month: only the ready periods use them, as on «Динамика».
  const range = useStatsRequest(loadRange)
  const current = range.state.kind === 'ok' ? range.state.data.current_month : monthOfDate(new Date())
  const first = range.state.kind === 'ok' ? range.state.data.first_month : undefined
  return (
    <section className="stats-receipts trends" aria-labelledby="stats-incomes-heading">
      <h2 id="stats-incomes-heading">Доходы за период</h2>
      <p className="stats-intro">
        Доход семьи, траты и то, что отложено, в основной валюте по курсу дня; доход по категориям и по месяцам.
      </p>
      <TrendsPeriodPicker query={query} current={current} first={first} hrefOf={(period) => statsIncomesHref(period)} />
      <IncomeStatsBlocks state={stats.state} onRetry={stats.retry} />
      <IncomeTrend query={query} spent />
    </section>
  )
}
