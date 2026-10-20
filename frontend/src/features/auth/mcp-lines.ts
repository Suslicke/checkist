import type { TokenScope } from '../../api/api-tokens'

// Lives apart from McpSection.tsx: a component file exports components only (react-refresh/only-export-components).
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
