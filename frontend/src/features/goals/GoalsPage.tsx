import { Fragment, useEffect, useState } from 'react'
import { createGoal, getGoals } from '../../api/goals'
import type { Goal, GoalList } from '../../api/goals'
import Icon from '../../components/Icon'
import Money from '../../components/Money'
import RequestState from '../../components/RequestState'
import Sheet from '../../components/Sheet'
import { Link, navigate } from '../../navigation'
import { GoalForm } from './GoalForms'
import { barShare, goalBody, goalFailure, goalMeta } from './goals-state'
import type { GoalDraft } from './goals-state'
import './Goals.css'

/** The ring of a goal: the share saved as an arc in ink on the track; a goal reached — a milestone: the whole ring and a
 * check in gold. Decoration only: the words of the row say the same. */
export function GoalRing({ percent, reached, size = 40 }: { percent: number; reached: boolean; size?: number }) {
  const radius = 17
  const length = 2 * Math.PI * radius
  const share = reached ? 100 : Math.max(0, Math.min(100, percent))
  return <span className={`goal-ring${reached ? ' is-reached' : ''}`} style={{ width: size, height: size }} aria-hidden="true">
    <svg viewBox="0 0 40 40" width={size} height={size} focusable="false">
      <circle className="goal-ring-track" cx="20" cy="20" r={radius} />
      {share > 0 && <circle className="goal-ring-arc" cx="20" cy="20" r={radius} strokeDasharray={`${(length * share) / 100} ${length}`} transform="rotate(-90 20 20)" />}
    </svg>
    <Icon name={reached ? 'check' : 'goal'} size={size > 40 ? 22 : 18} />
  </span>
}

/** A goal of the list: the ring, the name, saved of the amount and whose and till when; the per cent; the whole row opens it. */
export function GoalRow({ goal, household }: { goal: Goal; household: boolean }) {
  const meta = goalMeta(goal, household)
  return <li>
    <Link className={`ck-row goal-row${goal.reached ? ' is-reached' : ''}`} to={`/goals/${goal.id}`}>
      <GoalRing percent={barShare(goal)} reached={goal.reached} />
      <span className="ck-row-main">
        <span className="ck-row-title">{goal.name}</span>
        <span className="ck-row-meta goal-row-sum"><Money value={goal.saved} /> из <Money value={goal.amount} currency={goal.currency} /></span>
        {meta && <span className="ck-row-meta goal-row-meta">{meta.split(' · ').map((part, index) =>
          <Fragment key={index}>{index > 0 && ' · '}<span>{part}</span></Fragment>)}</span>}
      </span>
      <span className="ck-row-amount goal-percent">{goal.percent}&nbsp;%</span>
    </Link>
  </li>
}

function Group({ id, title, goals, household }: { id: string; title: string; goals: Goal[]; household: boolean }) {
  if (!goals.length) return null
  return <section className="ck-panel" aria-labelledby={id}>
    <div className="ck-panel-head"><h2 id={id}>{title}</h2></div>
    <ul className="ck-list goal-list">{goals.map((goal) => <GoalRow key={goal.id} goal={goal} household={household} />)}</ul>
  </section>
}

/** `/goals` without loading: the markup tests render it directly. */
export function GoalsView({ data, onAdd }: { data: GoalList; onAdd: () => void }) {
  const shared = data.results.filter((goal) => goal.shared)
  const personal = data.results.filter((goal) => !goal.shared)
  return <div className="goals ck-stack">
    {data.results.length === 0
      ? <section className="ck-panel goal-empty">
        <GoalRing percent={0} reached={false} size={48} />
        <h2>Целей пока нет</h2>
        <p className="goal-note">Отпуск, подушка, подарок — задайте сумму и срок, отмечайте взносы, а я покажу, сколько уже накоплено
          и когда цель будет достигнута. Переводы на свой депозит из выписки тоже станут взносами.</p>
      </section>
      : <>
        <Group id="goals-shared-heading" title={data.household ? 'Общие семьи' : 'Цели'} goals={shared} household={data.household} />
        <Group id="goals-personal-heading" title={shared.length || data.household ? 'Личные' : 'Цели'} goals={personal} household={data.household} />
      </>}
    <button type="button" className="goal-add" aria-haspopup="dialog" onClick={onAdd}><Icon name="plus" size={20} />Новая цель</button>
  </div>
}

/** «Цели»: shared goals of the family, then personal ones; a new goal in a sheet opens its page. */
export default function GoalsPage() {
  const [load, setLoad] = useState<{ kind: 'error'; message: string } | { kind: 'ok'; data: GoalList }>()
  const [attempt, setAttempt] = useState(0)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    void getGoals({ signal: controller.signal }).then((result) => {
      if (result.kind === 'ok') setLoad({ kind: 'ok', data: result.data })
      else if (result.kind === 'error') setLoad({ kind: 'error', message: goalFailure(result) })
    })
    return () => controller.abort()
  }, [attempt])
  if (!load) return <RequestState kind="loading" message="Загружаем цели…" shape="columns" />
  if (load.kind === 'error') return <RequestState kind="error" message={load.message} onRetry={() => setAttempt((value) => value + 1)} />
  const { data } = load
  const save = (draft: GoalDraft) => {
    if (busy) return
    setBusy(true)
    setFailure(null)
    void createGoal(goalBody(draft, data.household)).then((result) => {
      setBusy(false)
      if (result.kind === 'ok') navigate(`/goals/${result.data.id}`)
      else if (result.kind === 'error') setFailure(goalFailure(result))
    })
  }
  return <>
    <GoalsView data={data} onAdd={() => { setFailure(null); setAdding(true) }} />
    <Sheet open={adding} onClose={() => setAdding(false)} title="Новая цель">
      {adding && <GoalForm goal={null} currency={data.base_currency} household={data.household} busy={busy} failure={failure} onSubmit={save} />}
    </Sheet>
  </>
}
