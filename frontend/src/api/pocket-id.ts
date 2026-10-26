/** Sign-in with Pocket ID (`/api/auth/pocket-id/…`, 2026-10-26). Off on the server — every route answers 404, and the
 * screens show nothing of it. The sign-in itself and the return from Pocket ID are page navigations, not requests. */
import { getLocalJson, mutate } from './local.ts'
import { bool, nullable, object, text } from './schema.ts'
import type { LocalApiResult, RequestOptions } from './types.ts'

/** `linked` — `null` for a guest. */
export type PocketIdStatus = { enabled: boolean; linked: boolean | null; linked_at: string | null }
export type PocketIdStart = { authorize_url: string }

/** A navigation, not a fetch: the server answers with a redirect to Pocket ID. */
export const POCKET_ID_LOGIN_URL = '/api/auth/pocket-id/login/'

const isStatus = object<PocketIdStatus>({ enabled: bool, linked: nullable(bool), linked_at: nullable(text) })
const isStart = object<PocketIdStart>({ authorize_url: text })

export function getPocketIdStatus(options: RequestOptions = {}): Promise<LocalApiResult<PocketIdStatus>> {
  return getLocalJson('auth/pocket-id/', {}, isStatus, { ...options, fresh: true })
}
/** Starts binding the signed-in person to their Pocket ID; the page then opens `authorize_url`. */
export function startPocketIdLink(options: RequestOptions = {}): Promise<LocalApiResult<PocketIdStart>> {
  return mutate('auth/pocket-id/link/', JSON.stringify({}), isStart, options)
}
export function unlinkPocketId(options: RequestOptions = {}): Promise<LocalApiResult<null>> {
  return mutate('auth/pocket-id/link/', '', (value): value is null => value === null, options, false, undefined, { method: 'DELETE' })
}

/** What the server put into `?pocket_id=` on the way back; anything else is not shown. */
export const pocketIdOutcomes = {
  linked: 'Pocket ID подключён: теперь можно входить через него.',
  not_linked: 'Этот вход Pocket ID не подключён ни к одному аккаунту. Войдите паролем и подключите Pocket ID в «Аккаунте».',
  already_linked: 'Не подключено: этот Pocket ID уже связан с другим аккаунтом, либо у аккаунта уже есть Pocket ID.',
  session_changed: 'Не подключено: пока шёл вход в Pocket ID, сессия сменилась. Попробуйте ещё раз.',
  denied: 'Pocket ID отказал во входе.',
  invalid_token: 'Не удалось проверить ответ Pocket ID. Попробуйте ещё раз.',
  unavailable: 'Pocket ID сейчас недоступен. Попробуйте позже.',
  failed: 'Вход через Pocket ID не удался. Попробуйте ещё раз.',
} as const
export type PocketIdOutcome = keyof typeof pocketIdOutcomes

export function readPocketIdOutcome(search: string): PocketIdOutcome | null {
  const value = new URLSearchParams(search).get('pocket_id')
  return value !== null && Object.hasOwn(pocketIdOutcomes, value) ? value as PocketIdOutcome : null
}

/** Reads `?pocket_id=` once and drops it from the address, so a reload does not repeat the message. */
export function takePocketIdOutcome(): PocketIdOutcome | null {
  if (typeof window === 'undefined') return null
  const outcome = readPocketIdOutcome(window.location.search)
  if (outcome) {
    const url = new URL(window.location.href)
    url.searchParams.delete('pocket_id')
    try { window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`) } catch { /* not allowed */ }
  }
  return outcome
}
