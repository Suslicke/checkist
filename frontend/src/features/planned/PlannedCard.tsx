import type { DashboardPlanned } from '../../api/budget-types'
import { formatMoney } from '../../lib/money'
import { Link } from '../../navigation'
import { inMonth } from '../dashboard/dashboard-state'
import { Segments } from './PlannedPage'
import { segmentsOf } from './planned-state'
import './Planned.css'

/** «Планируем в октябре» on «Главная»: the strip of the month, «ещё ждём …», up to three open plans (the server picks
 * them), «Все планы». Nothing without plans in the month (`dashboard.planned` is null). The names of the categories are
 * not in the dashboard's rows: `categoryNames` maps the ids the dashboard knows. */
export default function PlannedCard({ planned, month, currency, current, categoryNames }: {
  planned: DashboardPlanned | null | undefined; month: string; currency: string; current: boolean; categoryNames: Map<number, string>
}) {
  if (!planned || planned.count === 0) return null
  return <section className="ck-panel dash-card pl-dash" aria-labelledby="pl-dash-heading">
    <div className="ck-panel-head">
      <h2 id="pl-dash-heading">Планируем {inMonth(month)}</h2>
      <Link className="dash-card-link" to={`/planned?month=${month}`}>Все планы</Link>
    </div>
    <Segments segments={segmentsOf(planned.segments)} label={`План ${inMonth(month)} по пунктам`} small />
    <p className="pl-legend pl-dash-legend">
      <span>ещё ждём <b className="ck-figures">{formatMoney(planned.left, currency)}</b></span>
      <span><b>{planned.done_count} из {planned.count}</b> сделано</span>
      {current && <span>уже учтено в «можно тратить в день»</span>}
    </p>
    {planned.rows.length > 0 && <ul className="ck-list pl-dash-rows">
      {planned.rows.map((row) => <li key={row.id} className="ck-row pl-row">
        <span className="ck-row-main">
          <span className="pl-head"><span className="ck-row-title">{row.name}</span><span className="ck-row-amount ck-figures">{formatMoney(row.amount, row.currency)}</span></span>
          {row.category_id !== null && categoryNames.has(row.category_id) && <span className="pl-meta">{categoryNames.get(row.category_id)}</span>}
        </span>
      </li>)}
    </ul>}
  </section>
}
