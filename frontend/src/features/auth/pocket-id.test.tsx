import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { POCKET_ID_LOGIN_URL, pocketIdOutcomes, readPocketIdOutcome } from '../../api/pocket-id'
import type { FormState } from './auth-state'
import { LoginView } from './LoginPage'
import type { LoginViewProps } from './LoginPage'
import { PocketIdView } from './PocketIdSection'
import type { PocketIdViewProps } from './PocketIdSection'

const idle: FormState = { kind: 'idle' }
const login = (props: Partial<LoginViewProps> = {}) => renderToStaticMarkup(<LoginView state={idle} expired={false}
  values={{ username: '', password: '' }} onChange={() => {}} onSubmit={() => {}} {...props} />)
const section = (props: Partial<PocketIdViewProps> = {}) => renderToStaticMarkup(<PocketIdView linked={false} busy={false}
  outcome={null} error={null} onLink={() => {}} onUnlink={() => {}} {...props} />)

describe('sign-in with Pocket ID', () => {
  it('shows the button only when the server has it on, and keeps the password form', () => {
    expect(login()).not.toContain('data-pocket-id-login')
    const html = login({ pocketId: true })
    expect(html).toContain(`href="${POCKET_ID_LOGIN_URL}"`)
    expect(html).toContain('Войти через Pocket ID')
    expect(html).toContain('id="login-password"')
  })

  it('explains a refused return', () => {
    expect(login({ pocketIdOutcome: 'not_linked' })).toContain(pocketIdOutcomes.not_linked)
  })

  it('reads only known outcomes from the address', () => {
    expect(readPocketIdOutcome('?pocket_id=not_linked')).toBe('not_linked')
    expect(readPocketIdOutcome('?pocket_id=linked&x=1')).toBe('linked')
    expect(readPocketIdOutcome('?pocket_id=<script>')).toBeNull()
    expect(readPocketIdOutcome('?pocket_id=toString')).toBeNull()
    expect(readPocketIdOutcome('')).toBeNull()
  })

  it('offers to connect or to disconnect on «Аккаунт»', () => {
    expect(section()).toContain('data-pocket-id-link')
    expect(section()).not.toContain('data-pocket-id-unlink')
    expect(section({ linked: true })).toContain('data-pocket-id-unlink')
    expect(section({ linked: true })).not.toContain('data-pocket-id-link')
    expect(section({ outcome: 'linked' })).toContain(pocketIdOutcomes.linked)
  })
})
