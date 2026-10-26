import { useEffect, useState } from 'react'
import { listThreads } from '../../api/chat'
import type { ThreadSummary } from '../../api/chat'
import { getMoney } from '../../api/money'
import type { Money } from '../../api/money'
import Icon from '../../components/Icon'
import RequestState from '../../components/RequestState'
import { Link } from '../../navigation'
import { statsMenuHref } from '../stats/stats-memory'
import { deviceMonth } from '../dashboard/dashboard-state'
import { flowOf, hubTiles, lastThread, moneyErrorMessage, monthName, summaryOf } from './money-state'
import type { HubTile } from './money-state'
import './Money.css'

/** The card of the month: «Доход · Потрачено · Отложено», the strip of the flow and its words. */
function SummaryCard({ data, today }: { data: Money; today: string }) {
  const summary = summaryOf(data)
  const flow = flowOf(data)
  return <section className="ck-panel money-summary" aria-labelledby="money-summary-heading">
    <h2 id="money-summary-heading" className="money-eyebrow">{monthName(data.month, today)}</h2>
    <dl className="money-sums">
      <div><dt>Доход</dt><dd className="ck-figures">{summary.income ?? 'не внесён'}</dd></div>
      <div><dt>Потрачено</dt><dd className="ck-figures">{summary.spent}</dd></div>
      <div><dt>Отложено</dt><dd className="ck-figures">{summary.setAside}</dd></div>
    </dl>
    {flow.parts.length > 0 && <div className="money-flow" role="img" aria-label={`Поток месяца: ${flow.caption.words}${flow.caption.free ? `, ${flow.caption.free}` : ''}`}>
      {flow.parts.map((part) => <i key={part.key} className={`money-flow-${part.key}`} style={{ flex: part.flex }} />)}
    </div>}
    <p className="money-caption">{flow.caption.words}{flow.caption.free && <> · <b className={flow.caption.over ? 'money-over' : undefined}>{flow.caption.free}</b></>}</p>
  </section>
}

/** One tile of the hub: the picture and the name, the big words (or the columns of the statistics), the note. */
function Tile({ tile }: { tile: HubTile & { columns?: { month: string; height: number; now: boolean }[] } }) {
  const tone = typeof tile.tone === 'number' ? `money-tone-${tile.tone}` : `money-tone-${tile.tone}`
  return <li>
    <Link className={`money-tile money-tile-${tile.key}`} to={tile.to} aria-label={tile.label}>
      <span className="money-tile-head"><i className={`money-tile-icon ${tone}`} aria-hidden="true"><Icon name={tile.icon} size={16} /></i>{tile.title}</span>
      {tile.columns
        ? <span className="money-columns" aria-hidden="true">{tile.columns.map((column) => <i key={column.month} className={column.now ? 'money-column-now' : undefined} style={{ height: `${column.height}%` }} />)}</span>
        : <span className="money-tile-value ck-figures">{tile.value}</span>}
      <span className="money-tile-note">{tile.note}</span>
    </Link>
  </li>
}

/** «Чат с ИИ»: the last thread and «Все беседы»; without threads — the invitation. `threads` undefined — still loading. */
function ChatCard({ threads }: { threads: ThreadSummary[] | undefined }) {
  const last = threads ? lastThread(threads) : null
  return <section className="ck-panel money-chat" aria-labelledby="money-chat-heading">
    <div className="ck-panel-head">
      <h2 id="money-chat-heading">Чат с ИИ</h2>
      <Link className="dash-card-link" to="/chat">Все беседы</Link>
    </div>
    <Link className="money-chat-row" to={last ? `/chat/${last.id}` : '/chat'}>
      <span className="money-chat-mark" aria-hidden="true"><Icon name="insight" size={20} /></span>
      <span className="ck-row-main">
        <span className="ck-row-title">{last ? last.title : 'Спросить о тратах'}</span>
        <span className="ck-row-meta money-chat-preview">{last ? last.preview : threads ? 'Любая трата, план или месяц — отвечу по цифрам семьи' : 'Открываем беседы…'}</span>
      </span>
      <Icon name="forward" size={18} className="ck-icon money-chat-go" />
    </Link>
  </section>
}

export type MoneyViewProps = {
  data: Money
  /** The month of the device: the note of the statistics says «пока» in the current month. */
  today?: string
  /** The threads of the chat; undefined while they load, [] without any. */
  threads?: ThreadSummary[]
  /** Where «Статистика» leads: the tab remembered on this device (features/stats/stats-memory). */
  statsHref?: string
}

/** «Деньги» without loading: the markup tests render it directly. */
export function MoneyView({ data, today = deviceMonth(), threads, statsHref = '/stats' }: MoneyViewProps) {
  const current = data.month === today
  return <div className="money-page">
    <div className="money-main">
      <SummaryCard data={data} today={today} />
      <ChatCard threads={threads} />
    </div>
    <div className="money-side">
      <ul className="money-hub" aria-label="Разделы денег">
        {hubTiles(data, statsHref, current).map((tile) => <Tile key={tile.key} tile={tile} />)}
      </ul>
    </div>
  </div>
}

type Load = { attempt: number } & ({ kind: 'error'; message: string } | { kind: 'ok'; data: Money })

/** «Деньги» (2026-10-26): the current month of the family as one answer (`GET /api/money/`), the last thread of the
 * chat beside it. The statistics tile leads where «Статистика» was left on this device. */
export default function MoneyPage() {
  const [load, setLoad] = useState<Load | undefined>()
  const [threads, setThreads] = useState<ThreadSummary[] | undefined>()
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    void getMoney(undefined, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted || result.kind === 'aborted') return
      setLoad(result.kind === 'ok' ? { attempt, kind: 'ok', data: result.data } : { attempt, kind: 'error', message: moneyErrorMessage(result) })
    })
    // The chat is a card of its own: its failure never hides the month.
    void listThreads({ signal: controller.signal }).then((result) => {
      if (controller.signal.aborted || result.kind === 'aborted') return
      setThreads(result.kind === 'ok' ? result.data : [])
    })
    return () => controller.abort()
  }, [attempt])
  // An answer belongs to its attempt: «Повторить» shows the skeleton until its own answer comes.
  if (!load || load.attempt !== attempt) return <RequestState kind="loading" message="Загружаем деньги месяца…" shape="columns" />
  if (load.kind === 'error') return <RequestState kind="error" message={load.message} onRetry={() => setAttempt((value) => value + 1)} />
  return <MoneyView data={load.data} threads={threads} statsHref={statsMenuHref({ kind: 'money' })} />
}
