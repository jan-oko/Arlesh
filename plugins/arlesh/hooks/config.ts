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

/** The origin the MCP endpoint at `mcpUrl` is on, with any path in front of `/mcp` kept. */
export function originOf(mcpUrl: string): string {
  return mcpUrl.replace(/[?#].*$/, '').replace(/\/mcp\/?$/, '').replace(/\/$/, '')
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
 * The MCP servers Claude Code applies to a session in `root`: the local-scope entry of the
 * project at `root`, else (a git worktree has none of its own) the one of the main checkout.
 */
export function projectServers(
  projects: unknown,
  root: string,
  mainCheckout: string | undefined,
): unknown {
  if (!isRecord(projects)) return undefined
  for (const path of [root, mainCheckout]) {
    const project = path === undefined ? undefined : projects[path]
    if (isRecord(project) && isRecord(project['mcpServers'])) return project['mcpServers']
  }
  return undefined
}

/**
 * The main checkout a linked git worktree belongs to, from the `.git` file in the worktree
 * (`gitdir: <main>/.git/worktrees/<name>`) and that directory's `commondir` file (`../..`).
 * `undefined` for a plain checkout, or one whose common directory is not a `.git` folder.
 */
export function mainCheckoutOf(
  dotGit: string | undefined,
  commondir: string | undefined,
): string | undefined {
  const line = dotGit?.split('\n')[0]?.trim()
  if (line === undefined || !line.startsWith('gitdir:') || commondir === undefined) return undefined
  const gitdir = line.slice('gitdir:'.length).trim()
  const common = normalize(commondir.trim().startsWith('/') ? commondir.trim() : `${gitdir}/${commondir.trim()}`)
  return common.endsWith('/.git') ? common.slice(0, -'/.git'.length) || '/' : undefined
}

function normalize(path: string): string {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return `/${parts.join('/')}`
}
