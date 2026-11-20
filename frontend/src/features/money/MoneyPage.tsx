import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { listThreads } from '../../api/chat'
import type { ThreadSummary } from '../../api/chat'
import { getMoney } from '../../api/money'
import type { Money as MoneyData } from '../../api/money'
import Icon from '../../components/Icon'
import Money from '../../components/Money'
import { PrivateText } from '../../components/Private'
import RequestState from '../../components/RequestState'
import { Link } from '../../navigation'
import { hideAmounts, usePrivacy } from '../../theme/privacy'
import { statsMenuHref } from '../stats/stats-memory'
import { deviceMonth, inMonth } from '../dashboard/dashboard-state'
import { columnsLabel, columnsOf, flowOf, flowRows, hubTiles, lastThread, moneyErrorMessage, reviewRow, statsNote } from './money-state'
import type { HubTile } from './money-state'
import './Money.css'

/** «в ноябре»; «в ноябре 2025» when the year is not the year of `today`. */
const monthIn = (month: string, today: string) => month.slice(0, 4) === today.slice(0, 4) ? inMonth(month) : `${inMonth(month)}\u00a0${month.slice(0, 4)}`

/** The card of the month: the free sum as its figure, the strip of the flow and the lines that explain the strip. */
function MonthCard({ data, today }: { data: MoneyData; today: string }) {
  const flow = flowOf(data)
  const hidden = usePrivacy()
  return <section className="ck-panel money-month" aria-labelledby="money-month-heading">
    <div className={`money-figure${flow.figure.over ? ' is-over' : ''}`}>
      <h2 id="money-month-heading" className="money-figure-label">{flow.figure.label} {monthIn(data.month, today)}</h2>
      <Money value={flow.figure.amount} currency={data.currency} size="display" tone={flow.figure.over ? 'over' : undefined} />
      {flow.figure.note && <span className="money-figure-note"><PrivateText>{flow.figure.note}</PrivateText></span>}
    </div>
    {flow.parts.length > 0 && <div className="money-flow" role="img" aria-label={hidden ? hideAmounts(flow.label) : flow.label}>
      {flow.parts.map((part) => <i key={part.key} className={`money-flow-${part.key}`} style={{ flex: part.flex }} />)}
    </div>}
    <dl className="money-lines">
      {flowRows(data).map((row) => <div key={row.key} className={`money-line money-line-${row.key}`}>
        <dt><i className={`money-key money-key-${row.key}`} aria-hidden="true" />{row.label}</dt>
        <dd>{row.amount === null
          ? <span className="money-line-missing">не внесён</span>
          : <Money value={row.amount} currency={data.currency} size="row" tone={row.income ? 'in' : undefined} sign={row.income ? 'plus' : 'auto'} />}</dd>
      </div>)}
    </dl>
  </section>
}

/** One tile of the hub: the picture and the name, the figure (an amount, or words), the bar of the goals, the note. */
function Tile({ tile }: { tile: HubTile }) {
  const tone = tile.tone === 'in' ? 'money-tone-in' : `ck-tone-${tile.tone}`
  return <li>
    <Link className={`money-tile money-tile-${tile.key}`} to={tile.to}>
      <span className="money-tile-head">
        <span className={`ck-row-badge money-tile-icon ${tone}`} aria-hidden="true"><Icon name={tile.icon} size={20} /></span>
        <span className="money-tile-title">{tile.title}</span>
        <Icon name="forward" size={16} className="ck-icon money-tile-go" />
      </span>
      <span className="money-tile-value">{tile.amount
        ? <Money value={tile.amount.value} currency={tile.amount.currency} size="title" tone={tile.amount.income ? 'in' : undefined} sign={tile.amount.income ? 'plus' : 'auto'} />
        : <PrivateText>{tile.value ?? ''}</PrivateText>}</span>
      {tile.bar !== undefined && <span className="ck-bar money-tile-bar" aria-hidden="true"><span style={{ width: `${tile.bar}%` }} /></span>}
      <span className="money-tile-note"><PrivateText>{tile.note}</PrivateText>{tile.alert && <>{tile.note && ' · '}<b className="money-tile-alert"><PrivateText>{tile.alert}</PrivateText></b></>}</span>
    </Link>
  </li>
}

/** «Траты за полгода»: six columns, the shown month in ink, the others quiet; the words under them; «Статистика». */
function MonthsCard({ data, today, statsHref }: { data: MoneyData; today: string; statsHref: string }) {
  const columns = columnsOf(data.months, data.month)
  const hidden = usePrivacy()
  const label = columnsLabel(columns, data.currency)
  return <section className="ck-panel money-months" aria-labelledby="money-months-heading">
    <div className="ck-panel-head">
      <h2 id="money-months-heading">Траты за полгода</h2>
      <Link className="money-link" to={statsHref}>Статистика</Link>
    </div>
    {columns.length > 0 && <div className="money-columns" role="img" aria-label={hidden ? hideAmounts(label) : label}>
      {columns.map((column) => <span key={column.month} className={`money-column${column.now ? ' is-now' : ''}`}>
        <i style={{ '--money-column': `${column.height}%` } as CSSProperties} />
        <span className="money-column-label">{column.label}</span>
      </span>)}
    </div>}
    <p className="money-months-note"><PrivateText>{capitalized(statsNote(data.months, data.month, data.month === today))}</PrivateText></p>
  </section>
}

const capitalized = (text: string) => text ? `${text[0].toUpperCase()}${text.slice(1)}` : text

/** The assistant: the review of the month before and the last thread of the chat. `threads` undefined — still loading. */
function AssistantCard({ data, threads }: { data: MoneyData; threads: ThreadSummary[] | undefined }) {
  const last = threads ? lastThread(threads) : null
  const review = reviewRow(data)
  return <section className="ck-panel money-ai" aria-labelledby="money-ai-heading">
    <div className="ck-panel-head">
      <h2 id="money-ai-heading" className="money-ai-who"><Icon name="insight" size={18} />Ассистент</h2>
      <Link className="money-link" to="/chat">Все беседы</Link>
    </div>
    <ul className="ck-list money-ai-list">
      <li><Link className="ck-row money-ai-row" to={review.to}>
        <span className="ck-row-badge money-ai-badge" aria-hidden="true"><Icon name="stats" size={20} /></span>
        <span className="ck-row-main">
          <span className="ck-row-title">{review.title}</span>
          <span className="ck-row-meta money-ai-meta"><PrivateText>{review.note}</PrivateText></span>
        </span>
        <Icon name="forward" size={18} className="ck-icon money-ai-go" />
      </Link></li>
      <li><Link className="ck-row money-ai-row" to={last ? `/chat/${last.id}` : '/chat'}>
        <span className="ck-row-badge money-ai-badge" aria-hidden="true"><Icon name="insight" size={20} /></span>
        <span className="ck-row-main">
          <span className="ck-row-title"><PrivateText>{last ? last.title : 'Спросить о тратах'}</PrivateText></span>
          <span className="ck-row-meta money-ai-meta"><PrivateText>{last ? last.preview : threads ? 'Любая трата, план или месяц — отвечу по цифрам семьи' : 'Открываем беседы…'}</PrivateText></span>
        </span>
        <Icon name="forward" size={18} className="ck-icon money-ai-go" />
      </Link></li>
    </ul>
  </section>
}

export type MoneyViewProps = {
  data: MoneyData
  /** The month of the device: the note of the six months says «пока» in the current month. */
  today?: string
  /** The threads of the chat; undefined while they load, [] without any. */
  threads?: ThreadSummary[]
  /** Where «Статистика» leads: the tab remembered on this device (features/stats/stats-memory). */
  statsHref?: string
}

/** «Деньги» without loading: the markup tests render it directly. Two boxless columns (display: contents below 960 px):
 * the month and the six months at the left, the tiles and the assistant at the right; a phone reads month · tiles · six
 * months · assistant (Money.css `order`). */
export function MoneyView({ data, today = deviceMonth(), threads, statsHref = '/stats' }: MoneyViewProps) {
  return <div className="money-page">
    <div className="money-main">
      <MonthCard data={data} today={today} />
      <MonthsCard data={data} today={today} statsHref={statsHref} />
    </div>
    <div className="money-side">
      <ul className="money-hub" aria-label="Разделы денег">
        {hubTiles(data).map((tile) => <Tile key={tile.key} tile={tile} />)}
      </ul>
      <AssistantCard data={data} threads={threads} />
    </div>
  </div>
}

type Load = { attempt: number } & ({ kind: 'error'; message: string } | { kind: 'ok'; data: MoneyData })

/** «Деньги» (2026-10-26): the current month of the family as one answer (`GET /api/money/`), the last thread of the
 * chat beside it. «Статистика» leads where it was left on this device. */
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
