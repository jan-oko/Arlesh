import { isRecord, text } from './json'

/** The session's `Arlesh` MCP server entry: where it is and how it is let in. */
export interface ServerEntry {
  /** The key the entry has in the MCP configuration, which `$.mcp.call` takes. */
  name: string
  url: string
  headers: Record<string, string>
}

const SERVER_NAME = /^arlesh$/i

/**
 * The `Arlesh` HTTP server among `sources`, each an `mcpServers` object, the one the session
 * would use first (local, then project, then user).
 */
export function pickServer(sources: readonly unknown[]): ServerEntry | undefined {
  for (const source of sources) {
    if (!isRecord(source)) continue
    for (const [name, entry] of Object.entries(source)) {
      if (!SERVER_NAME.test(name) || !isRecord(entry)) continue
      const url = text(entry, 'url')
      if (url === undefined) continue
      const headers: Record<string, string> = {}
      const given = entry['headers']
      if (isRecord(given)) {
        for (const [key, value] of Object.entries(given)) {
          if (typeof value === 'string') headers[key] = value
        }
      }
      return { name, url, headers }
    }
  }
  return undefined
}

/** The wait stream on the same origin as the MCP endpoint at `mcpUrl`. */
export function expectationsUrl(mcpUrl: string): string {
  const origin = mcpUrl.replace(/[?#].*$/, '').replace(/\/mcp\/?$/, '').replace(/\/$/, '')
  return `${origin}/events/expectations?agentic=true`
}

/** `${NAME}` and `${NAME:-fallback}` in `value`, as `.mcp.json` expands them. */
export async function expandVariables(
  value: string,
  lookup: (name: string) => Promise<string | undefined>,
): Promise<string> {
  let out = ''
  let rest = value
  for (;;) {
    const start = rest.indexOf('${')
    const end = start < 0 ? -1 : rest.indexOf('}', start)
    if (end < 0) return out + rest
    out += rest.slice(0, start)
    const [name = '', ...fallback] = rest.slice(start + 2, end).split(':-')
    out += (await lookup(name)) ?? fallback.join(':-')
    rest = rest.slice(end + 1)
  }
}

/**
 * The config curl reads from its standard input, so a token never shows in the process list.
 * Quotes and backslashes in a value are escaped as curl's config format asks.
 */
export function curlConfig(url: string, headers: Record<string, string>): string {
  const quoted = (value: string) =>
    `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]/g, '')}"`
  const lines = [`url = ${quoted(url)}`, `header = ${quoted('Accept: text/event-stream')}`]
  for (const [name, value] of Object.entries(headers)) {
    lines.push(`header = ${quoted(`${name}: ${value}`)}`)
  }
  return lines.join('\n') + '\n'
}
