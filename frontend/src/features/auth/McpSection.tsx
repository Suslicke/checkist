import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { createApiToken, getApiTokens, revokeApiToken } from '../../api/api-tokens'
import type { ApiToken, IssuedToken, TokenScope } from '../../api/api-tokens'

export const scopeTexts: Record<TokenScope, string> = { read: 'Только чтение', write: 'Чтение и запись' }

/** The address of the MCP endpoint of this site. */
export const mcpUrl = (origin: string) => `${origin}/mcp`

/** Ready lines for the clients: the address with the header, the address with the token inside (for a client where
 * only an address can be typed) and the command of Claude Code. */
export function connectLines(origin: string, token: string) {
  const url = mcpUrl(origin)
  return {
    header: `Authorization: Bearer ${token}`,
    inUrl: `${url}/${token}`,
    claudeCode: `claude mcp add --transport http checkist ${url} --header "Authorization: Bearer ${token}"`,
  }
}

const day = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('ru-RU') : null

export type McpViewProps = {
  origin: string
  tokens: ApiToken[] | null
  failed: boolean
  issued: IssuedToken | null
  busy: boolean
  error: string | null
  onCreate: (name: string, scope: TokenScope) => void
  onRevoke: (id: number) => void
  onHide: () => void
}

/** «Подключение нейросети»: the screen without the network, the markup tests render it directly. */
export function McpView({ origin, tokens, failed, issued, busy, error, onCreate, onRevoke, onHide }: McpViewProps) {
  const [name, setName] = useState('')
  const [scope, setScope] = useState<TokenScope>('read')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!busy && name.trim()) onCreate(name.trim(), scope)
  }
  const lines = issued ? connectLines(origin, issued.token) : null
  const copy = (text: string) => { void navigator.clipboard?.writeText(text).catch(() => undefined) }
  return (
    <section className="ck-panel ck-auth-mcp" aria-labelledby="mcp-heading" data-mcp>
      <div className="ck-panel-head"><h2 id="mcp-heading">Подключение нейросети (MCP)</h2></div>
      <p className="ck-auth-hint">Claude, ChatGPT, Cursor и другие клиенты MCP подключаются по адресу <code>{mcpUrl(origin)}</code> с
        личным токеном. Нейросеть видит и меняет ровно то же, что вы; токен «{scopeTexts.read}» ничего не меняет.</p>

      {lines && issued && <div className="ck-auth-mcp-issued" role="status" data-mcp-issued>
        <p><strong>Токен «{issued.name}» выпущен.</strong> Скопируйте его сейчас — больше он показан не будет.</p>
        {([['Токен', issued.token], ['Заголовок', lines.header], ['Адрес с токеном (если клиент берёт только адрес)', lines.inUrl],
          ['Claude Code', lines.claudeCode]] as const).map(([label, value]) => <div key={label} className="ck-auth-mcp-copy">
          <span className="ck-auth-row-label">{label}</span>
          <div className="ck-auth-mcp-copy-row">
            <input readOnly value={value} aria-label={label} onFocus={(event) => event.target.select()} />
            <button type="button" className="ck-button-secondary" onClick={() => copy(value)}>Копировать</button>
          </div>
        </div>)}
        <button type="button" className="ck-button-secondary" onClick={onHide}>Готово, скрыть</button>
      </div>}

      <form className="ck-auth-mcp-form" onSubmit={submit} noValidate>
        <div className="ck-auth-field">
          <label htmlFor="mcp-name">Название</label>
          <input id="mcp-name" maxLength={60} placeholder="Например, Claude на ноутбуке" value={name}
            onChange={(event) => setName(event.target.value)} />
        </div>
        <fieldset className="ck-auth-mcp-scope">
          <legend>Права</legend>
          {(['read', 'write'] as const).map((value) => <label key={value}>
            <input type="radio" name="mcp-scope" value={value} checked={scope === value} onChange={() => setScope(value)} />
            {scopeTexts[value]}
          </label>)}
        </fieldset>
        <button type="submit" disabled={busy || !name.trim()}>{busy ? 'Выпускаем…' : 'Выпустить токен'}</button>
        {error && <p className="ck-auth-error" role="alert">{error}</p>}
      </form>

      {failed && <p className="ck-auth-error" role="alert">Не удалось загрузить токены.</p>}
      {tokens && tokens.length > 0 && <ul className="ck-list ck-auth-mcp-tokens">
        {tokens.map((token) => <li key={token.id} className="ck-row" data-revoked={token.revoked_at ? '' : undefined}>
          <span className="ck-row-main">
            <span className="ck-row-title">{token.name}</span>
            <span className="ck-row-meta">{scopeTexts[token.scope]} · {token.prefix}… · {token.revoked_at
              ? `отозван ${day(token.revoked_at)}` : token.last_used_at ? `последний раз ${day(token.last_used_at)}` : 'ещё не использовался'}</span>
          </span>
          {!token.revoked_at && <button type="button" className="ck-button-danger" disabled={busy}
            aria-label={`Отозвать токен «${token.name}»`} onClick={() => onRevoke(token.id)}>Отозвать</button>}
        </li>)}
      </ul>}
    </section>
  )
}

/** The section of `/account`: loads the tokens, issues and revokes. */
export default function McpSection() {
  const [tokens, setTokens] = useState<ApiToken[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [issued, setIssued] = useState<IssuedToken | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    void getApiTokens({ signal: controller.signal }).then((result) => {
      if (result.kind === 'ok') setTokens(result.data.results)
      else if (result.kind === 'error') setFailed(true)
    })
    return () => controller.abort()
  }, [attempt])
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  return <McpView origin={origin} tokens={tokens} failed={failed} issued={issued} busy={busy} error={error}
    onHide={() => setIssued(null)}
    onCreate={(name, scope) => {
      setBusy(true)
      setError(null)
      void createApiToken(name, scope).then((result) => {
        setBusy(false)
        if (result.kind === 'ok') { setIssued(result.data); setAttempt((value) => value + 1) }
        else if (result.kind === 'error') setError(result.reason === 'invalid_parameter' ? 'Проверьте название: не больше 60 символов, не больше 20 действующих токенов.' : 'Не удалось выпустить токен. Повторите попытку.')
      })
    }}
    onRevoke={(id) => {
      setBusy(true)
      void revokeApiToken(id).then((result) => {
        setBusy(false)
        if (result.kind === 'ok') setAttempt((value) => value + 1)
        else if (result.kind === 'error') setError('Не удалось отозвать токен. Повторите попытку.')
      })
    }} />
}
