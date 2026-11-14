import { isRecord, parseJson, text } from './json'
import { currentFromChange, type Current } from './results'

/** How long the server holds a long poll when asked for no better, and the least the mod asks. */
export const WAIT_START_S = 25
export const WAIT_MIN_S = 5

/** Where the mod has heard up to, as the server last told it. */
export interface Cursor {
  revision: number
  epoch: string
}

/** One long-poll answer. */
export interface PollAnswer extends Cursor {
  /** There was no cursor to resume from: read the waits, then poll from `revision`. */
  reset: boolean
  changes: Current[]
}

/** The long-poll URL for the server whose MCP endpoint is at `origin`'s `/mcp`. */
export function pollUrl(origin: string, cursor: Cursor | undefined, waitSeconds: number): string {
  const after =
    cursor === undefined
      ? ''
      : `&after=${cursor.revision}&epoch=${encodeURIComponent(cursor.epoch)}`
  return `${origin}/events/expectations?agentic=true${after}&wait=${waitSeconds}`
}

/** The answer a long poll gave, or `undefined` when the body is not one. */
export function parsePoll(body: string): PollAnswer | undefined {
  const parsed = parseJson(body)
  if (!isRecord(parsed)) return undefined
  const revision = parsed['revision']
  const epoch = text(parsed, 'epoch')
  if (typeof revision !== 'number' || !Number.isFinite(revision) || epoch === undefined) {
    return undefined
  }
  const raw = parsed['changes']
  const changes: Current[] = []
  for (const change of Array.isArray(raw) ? raw : []) {
    const current = currentFromChange(change)
    if (current !== undefined) changes.push(current)
  }
  return { revision, epoch, reset: parsed['reset'] === true, changes }
}

const TIMEOUT_LIKE = /time(d)?[ -]?out|etimedout|aborted?|deadline/i

/**
 * How long to ask the server to hold the next poll. The host has no timeout option for a fetch,
 * but it may have its own: a request that failed with a timeout-like error before the server
 * would have answered halves the wait, down to [WAIT_MIN_S]. Any other outcome keeps it.
 */
export function nextWait(waitSeconds: number, error: unknown, elapsedMs: number): number {
  const timedOut = TIMEOUT_LIKE.test(error instanceof Error ? error.message : String(error))
  if (!timedOut || elapsedMs >= waitSeconds * 1000) return waitSeconds
  return Math.max(WAIT_MIN_S, Math.floor(waitSeconds / 2))
}
