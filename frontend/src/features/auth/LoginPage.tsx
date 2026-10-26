import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import logo640 from '../../assets/brand/logo-640.webp'
import logo1280 from '../../assets/brand/logo-1280.webp'
import { getPocketIdStatus, POCKET_ID_LOGIN_URL, pocketIdOutcomes, takePocketIdOutcome } from '../../api/pocket-id'
import type { PocketIdOutcome } from '../../api/pocket-id'
import { login } from '../../api/session'
import { applyMe } from '../../session'
import { ThemeToggle } from '../../theme'
import { checkLogin, useAuthForm } from './auth-state'
import type { FormState, LoginInput } from './auth-state'
import { loginRefusal, sessionExpiredText } from './labels'

/** The result of a form next to its button. A refusal is rendered once; the region itself always exists. */
export function FormMessage({ state, id }: { state: FormState; id: string }) {
  return (
    <div id={id} className="ck-auth-message" aria-live="polite">
      {state.kind === 'failed' && <div className="ck-auth-error" data-auth-error>
        <p>{state.message}</p>
        {state.details.length > 0 && <ul>{state.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>}
      </div>}
      {state.kind === 'done' && <p className="ck-auth-done" data-auth-done>{state.message}</p>}
    </div>
  )
}

export type LoginViewProps = {
  state: FormState
  expired: boolean
  values: LoginInput
  onChange: (values: LoginInput) => void
  onSubmit: () => void
  /** The shell's `h1#page-heading`: it names the form and takes the focus when the screen opens. */
  heading?: ReactNode
  /** «Войти через Pocket ID» under the form: only when the server has it on. */
  pocketId?: boolean
  /** Why the return from Pocket ID did not sign in (`?pocket_id=`). */
  pocketIdOutcome?: PocketIdOutcome | null
}

/** The sign-in on the address the person opened: the whole screen with its own `<main>`, no shell around it —
    the logo as an app icon above a card with the form (two columns from 720 px). A real form: a password manager
    offers to save and to fill it. The order in the markup is the Tab order: name, password, «Войти», theme switch. */
export function LoginView({ state, expired, values, onChange, onSubmit, heading, pocketId, pocketIdOutcome }: LoginViewProps) {
  const pending = state.kind === 'pending'
  const invalid = (field: string) => (state.kind === 'failed' && state.fields.includes(field)) || undefined
  const submit = (event: FormEvent) => { event.preventDefault(); if (!pending) onSubmit() }
  return (
    <main id="main" className="ck-login">
      <div className="ck-login-layout">
        <div className="ck-login-board">
          <span className="ck-login-rays" aria-hidden="true" />
          <img className="ck-login-logo" src={logo640} srcSet={`${logo640} 640w, ${logo1280} 1280w`}
            sizes="(min-width: 720px) min(50vw, 520px), 152px" width="640" height="640" alt="Чекист — продуктовая разведка" />
        </div>
        <div className="ck-login-panel">
          <div className="ck-login-title">
            {heading}
            <p className="ck-login-subtitle">Семейный бюджет</p>
          </div>
          <section className="ck-auth" aria-labelledby="page-heading">
            {expired && <p className="ck-auth-notice" data-auth-expired>{sessionExpiredText}</p>}
            {pocketIdOutcome && <div className="ck-auth-error" role="alert" data-pocket-id-outcome><p>{pocketIdOutcomes[pocketIdOutcome]}</p></div>}
            <form className="ck-auth-panel" method="post" noValidate onSubmit={submit}>
              <div className="ck-auth-field">
                <label htmlFor="login-username">Имя пользователя</label>
                <input id="login-username" name="username" type="text" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                  maxLength={150} required aria-invalid={invalid('username')} value={values.username}
                  onChange={(event) => onChange({ ...values, username: event.target.value })} />
              </div>
              <div className="ck-auth-field">
                <label htmlFor="login-password">Пароль</label>
                <input id="login-password" name="password" type="password" autoComplete="current-password" required
                  aria-invalid={invalid('password')} value={values.password}
                  onChange={(event) => onChange({ ...values, password: event.target.value })} />
              </div>
              <div className="ck-auth-actions">
                {/* Not `disabled`: the button keeps focus during the request; the form state refuses a second press. */}
                <button type="submit" className="ck-auth-primary" data-auth-submit aria-disabled={pending || undefined} aria-describedby="login-message">{pending ? 'Входим…' : 'Войти'}</button>
                <FormMessage state={state} id="login-message" />
              </div>
            </form>
            {/* A plain navigation: the server answers with the redirect to Pocket ID and brings the person back signed in. */}
            {pocketId && <a className="ck-auth-secondary ck-auth-pocket-id" href={POCKET_ID_LOGIN_URL} data-pocket-id-login>Войти через Pocket ID</a>}
          </section>
          <p className="ck-login-note">Пропуска выдаёт администратор</p>
        </div>
        <div className="ck-login-footer">
          <ThemeToggle />
        </div>
      </div>
    </main>
  )
}

export default function LoginPage({ expired, heading }: { expired: boolean; heading?: ReactNode }) {
  // The password lives only in this component: never in the address, history state or storage.
  const [values, setValues] = useState<LoginInput>({ username: '', password: '' })
  const [pocketId, setPocketId] = useState(false)
  const [pocketIdOutcome] = useState(takePocketIdOutcome)
  useEffect(() => {
    const controller = new AbortController()
    // 404 — the server has it off: the button stays hidden.
    void getPocketIdStatus({ signal: controller.signal }).then((result) => { if (result.kind === 'ok') setPocketId(result.data.enabled) })
    return () => controller.abort()
  }, [])
  const { state, run } = useAuthForm({
    check: checkLogin,
    send: (input: LoginInput, signal) => login({ username: input.username, password: input.password }, { signal }),
    refusal: loginRefusal,
    // The shell opens the page of the same address as soon as the session has a user.
    success: (me) => { applyMe(me) },
  })
  return <LoginView state={state} expired={expired} values={values} onChange={setValues} onSubmit={() => { void run(values) }} heading={heading}
    pocketId={pocketId} pocketIdOutcome={pocketIdOutcome} />
}
