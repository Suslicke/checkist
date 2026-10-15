import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { connectLines, McpView } from './McpSection'
import type { McpViewProps } from './McpSection'

const noop = () => {}
const token = { id: 3, name: 'Claude', scope: 'write' as const, prefix: 'ck_Ab3xYz9', created_at: '2026-10-15T10:00:00Z', last_used_at: null, revoked_at: null }
const view = (patch: Partial<McpViewProps> = {}) => renderToStaticMarkup(<McpView origin="https://example.test" tokens={[token]} failed={false}
  issued={null} busy={false} error={null} onCreate={noop} onRevoke={noop} onHide={noop} {...patch} />)

describe('«Подключение нейросети (MCP)» (SSR markup)', () => {
  it('offers to issue a token with a choice of rights and lists the tokens without their secret', () => {
    const html = view()
    expect(html).toContain('<code>https://example.test/mcp</code>')
    expect(html).toContain('checked="" value="read"')
    expect(html).toContain('Чтение и запись')
    expect(html).toContain('Чтение и запись · ck_Ab3xYz9… · ещё не использовался')
    expect(html).toContain('aria-label="Отозвать токен «Claude»"')
    expect(html).not.toContain('data-mcp-issued')
  })

  it('shows a new token once with ready lines for the clients', () => {
    const issued = { ...token, token: 'ck_secret' }
    const html = view({ issued })
    expect(html).toContain('data-mcp-issued')
    expect(html).toContain('value="ck_secret"')
    expect(connectLines('https://example.test', 'ck_secret')).toEqual({
      header: 'Authorization: Bearer ck_secret',
      inUrl: 'https://example.test/mcp/ck_secret',
      claudeCode: 'claude mcp add --transport http checkist https://example.test/mcp --header "Authorization: Bearer ck_secret"',
    })
  })

  it('a revoked token has no button', () => {
    expect(view({ tokens: [{ ...token, revoked_at: '2026-10-15T11:00:00Z' }] })).not.toContain('Отозвать токен')
  })
})
