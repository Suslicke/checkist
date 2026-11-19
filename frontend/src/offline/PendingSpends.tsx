import { useState } from 'react'
import ConfirmDialog from '../components/ConfirmDialog'
import Money from '../components/Money'
import { formatPurchasedOn } from '../lib/format'
import { localToday } from '../features/receipts/spends'
import { dayWords } from '../features/receipts/when'
import { navigate } from '../navigation'
import { offlineIcon } from './icon'
import { spendAmount } from './pending'
import type { PendingSpend } from './pending'
import { discardPending, handOff, sendPendingNow, usePendingSpends } from './pending-store'
import type { PendingState } from './pending-store'
import './Offline.css'

export const pendingSavedText = 'Сохранено на телефоне — отправим, когда появится сеть.'
export const photosOnlineText = 'Фото можно отправить только при сети.'

export type PendingSpendsViewProps = {
  state: Pick<PendingState, 'items' | 'syncing' | 'note'>
  onSend: () => void
  onFix: (spend: PendingSpend) => void
  onDelete: (spend: PendingSpend) => void
  /** The day of the device: «сегодня», «вчера» in words. */
  today?: string
}

const place = (spend: PendingSpend) => spend.body.store_name?.trim() || spend.body.note?.trim() || 'Без места'

/** The spends waiting on the phone, at the top of «Траты», laid out as a day of the list: a quiet heading, a panel of rows
 * (a tile, the place and the date, the amount), the actions of each spend under its row; nothing while there are none.
 * Calm (Чекист 2.0): ink and ink-2; only a refusal of the server is said in the colour of an error, with its words. */
export function PendingSpendsView({ state, onSend, onFix, onDelete, today = localToday() }: PendingSpendsViewProps) {
  if (!state.items.length) return null
  return <section className="pending-spends" aria-labelledby="pending-spends-heading">
    <div className="pending-spends-head">
      <h2 id="pending-spends-heading">Ждут отправки: {state.items.length.toLocaleString('ru-RU')}</h2>
      <p>{pendingSavedText} {photosOnlineText}</p>
    </div>
    <div className="pending-spends-card">
      <ul className="pending-spend-list">{state.items.map((spend) => <li key={spend.id} className="pending-spend">
        <span className="pending-spend-badge" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20" focusable="false">{offlineIcon.map((d) => <path key={d} d={d} />)}</svg>
        </span>
        <span className="pending-spend-main">
          <span className="pending-spend-place">{place(spend)}</span>
          <time dateTime={spend.body.purchased_on}>{spend.body.purchased_on ? dayWords(spend.body.purchased_on, today) : formatPurchasedOn(null)}</time>
        </span>
        <span className="pending-spend-amount"><Money value={spendAmount(spend.body)} currency={spend.body.currency} size="row" /></span>
        <span className="pending-spend-actions">
          <button type="button" className="ck-button-ghost" onClick={() => onFix(spend)}>Исправить</button>
          <button type="button" className="ck-button-ghost pending-spend-delete" onClick={() => onDelete(spend)}>Удалить</button>
        </span>
        {spend.error && <p className="pending-spend-error" role="alert">Не отправлено: {spend.error}</p>}
      </li>)}</ul>
      <button type="button" className="ck-button-secondary pending-spends-send" onClick={onSend} disabled={state.syncing}>{state.syncing ? 'Отправляем…' : 'Отправить сейчас'}</button>
      {state.note && <p className="pending-spends-note" role="status">{state.note}</p>}
    </div>
  </section>
}

/** The question before a waiting spend is dropped: it never reached the server, nothing brings it back. */
const discardWords = {
  title: 'Удалить трату с телефона?', message: 'На сервер она не попадёт. Отменить удаление нельзя.', action: 'Удалить трату',
}

export default function PendingSpends() {
  const state = usePendingSpends()
  const [asking, setAsking] = useState<PendingSpend | null>(null)
  return <>
    <PendingSpendsView state={state} onSend={() => { void sendPendingNow() }}
      onFix={(spend) => { handOff(spend); navigate('/receipts/new') }}
      onDelete={setAsking} />
    <ConfirmDialog open={asking !== null} title={discardWords.title} message={discardWords.message} confirmLabel={discardWords.action} danger
      onConfirm={() => { if (asking) void discardPending(asking.id); setAsking(null) }} onCancel={() => setAsking(null)} />
  </>
}
