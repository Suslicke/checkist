/** Personal tokens of the MCP connection (`/api/auth/tokens/`, 2026-10-15): any AI client reads — and with `write` changes —
 * the person's data at `/mcp` with exactly the person's rights. The token itself comes once, in the answer of `create`. */
import { getLocalJson, mutate } from './local.ts'
import { array, choice, isId, nullable, object, text } from './schema.ts'
import type { Guard } from './schema.ts'
import type { LocalApiResult, RequestOptions } from './types.ts'

export type TokenScope = 'read' | 'write'
export type ApiToken = { id: number; name: string; scope: TokenScope; prefix: string; created_at: string;
  last_used_at: string | null; revoked_at: string | null }
export type IssuedToken = ApiToken & { token: string }

const fields = { id: isId, name: text, scope: choice('read', 'write'), prefix: text, created_at: text,
  last_used_at: nullable(text), revoked_at: nullable(text) }
const isToken = object<ApiToken>(fields)
const isIssued = object<IssuedToken>({ ...fields, token: text })
const isList: Guard<{ results: ApiToken[] }> = object<{ results: ApiToken[] }>({ results: array(isToken) })

export function getApiTokens(options: RequestOptions = {}): Promise<LocalApiResult<{ results: ApiToken[] }>> {
  return getLocalJson('auth/tokens/', {}, isList, { ...options, fresh: true })
}
export function createApiToken(name: string, scope: TokenScope, options: RequestOptions = {}): Promise<LocalApiResult<IssuedToken>> {
  return mutate('auth/tokens/', JSON.stringify({ name, scope }), isIssued, options)
}
export function revokeApiToken(id: number, options: RequestOptions = {}): Promise<LocalApiResult<null>> {
  return mutate(`auth/tokens/${id}/`, '', (value): value is null => value === null, options, false, undefined, { method: 'DELETE' })
}
