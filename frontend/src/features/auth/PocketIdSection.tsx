import { useEffect, useState } from 'react'
import { getPocketIdStatus, pocketIdOutcomes, startPocketIdLink, takePocketIdOutcome, unlinkPocketId } from '../../api/pocket-id'
import type { PocketIdOutcome } from '../../api/pocket-id'

export type PocketIdViewProps = {
  linked: boolean
  busy: boolean
  /** The result of the last return from Pocket ID (`?pocket_id=`). */
  outcome: PocketIdOutcome | null
  error: string | null
  onLink: () => void
  onUnlink: () => void
}

/** «Вход через Pocket ID» on «Аккаунт»: the markup tests render it directly. */
export function PocketIdView({ linked, busy, outcome, error, onLink, onUnlink }: PocketIdViewProps) {
  return (
    <section className="ck-panel ck-auth-pocket-id-section" aria-labelledby="pocket-id-heading" data-pocket-id>
      <div className="ck-panel-head"><h2 id="pocket-id-heading">Вход через Pocket ID</h2></div>
      <p className="ck-auth-hint">{linked
        ? 'Pocket ID подключён: на странице входа можно нажать «Войти через Pocket ID». Пароль продолжает работать.'
        : 'Подключите свой Pocket ID, чтобы входить по ключу доступа без пароля. Подключить можно только к аккаунту, в который вы вошли.'}</p>
      {outcome && <p className={outcome === 'linked' ? 'ck-auth-done' : 'ck-auth-error'} role="status" data-pocket-id-outcome>{pocketIdOutcomes[outcome]}</p>}
      {linked
        ? <button type="button" className="ck-auth-danger" data-pocket-id-unlink aria-disabled={busy || undefined} onClick={busy ? undefined : onUnlink}>Отключить Pocket ID</button>
        : <button type="button" className="ck-auth-secondary ck-auth-pocket-id" data-pocket-id-link aria-disabled={busy || undefined} onClick={busy ? undefined : onLink}>Подключить Pocket ID</button>}
      {error && <p className="ck-auth-error" role="alert">{error}</p>}
    </section>
  )
}

/** Hidden while the server has the sign-in off (the status answers 404). */
export default function PocketIdSection() {
  const [linked, setLinked] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outcome] = useState(takePocketIdOutcome)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    void getPocketIdStatus({ signal: controller.signal }).then((result) => {
      if (result.kind === 'ok' && result.data.enabled) setLinked(Boolean(result.data.linked))
    })
    return () => controller.abort()
  }, [attempt])
  if (linked === null) return null
  return <PocketIdView linked={linked} busy={busy} outcome={outcome} error={error}
    onLink={() => {
      setBusy(true)
      setError(null)
      void startPocketIdLink().then((result) => {
        if (result.kind === 'ok') { window.location.assign(result.data.authorize_url); return }
        setBusy(false)
        if (result.kind === 'error') setError(result.status === 409 ? pocketIdOutcomes.already_linked : pocketIdOutcomes.unavailable)
      })
    }}
    onUnlink={() => {
      setBusy(true)
      setError(null)
      void unlinkPocketId().then((result) => {
        setBusy(false)
        if (result.kind === 'ok') setAttempt((value) => value + 1)
        else if (result.kind === 'error') setError('Не удалось отключить Pocket ID. Повторите попытку.')
      })
    }} />
}
