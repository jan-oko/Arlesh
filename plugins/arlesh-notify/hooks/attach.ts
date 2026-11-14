import { isRecord, parseJson, text } from './json'
import { payloadOf } from './results'

/** The port the desktop app's loopback door listens on unless `ARLESH_DOOR_PORT` says otherwise. */
export const DEFAULT_DOOR_PORT = 4747

/** At most this often a usage report is sent when no percent moved a whole point. */
export const REPORT_EVERY_MS = 5 * 60 * 1000

/** Whether `url` is on this machine. */
export function isLoopback(url: string): boolean {
  const host = /^[a-z][a-z0-9+.-]*:\/\/(?:[^/@]*@)?(\[[^\]]+\]|[^/:?#]+)/i.exec(url)?.[1]?.toLowerCase()
  return host === 'localhost' || host === '[::1]' || host?.startsWith('127.') === true
}

/**
 * Where to ask for a PIN: the server's own origin when that is the desktop app's local endpoint,
 * else the desktop app's loopback door, which forwards to the server it is connected to.
 */
export function doorUrl(origin: string, port: number | undefined): string {
  const base = isLoopback(origin) ? origin : `http://127.0.0.1:${port ?? DEFAULT_DOOR_PORT}`
  return `${base}/agents/pin`
}

/** The port `ARLESH_DOOR_PORT` names, if it names one. */
export function doorPort(value: string | undefined): number | undefined {
  const port = Number(value)
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : undefined
}

/** The PIN a door answered, or `undefined` for anything else. */
export function parsePin(body: string): string | undefined {
  const parsed = parseJson(body)
  return isRecord(parsed) ? text(parsed, 'pin') : undefined
}

/** A subtree to claim, as `ARLESH_CLAIM` spells it: `project:ARL`. */
export interface Subtree {
  node_type: string
  node_id: string
}

export function parseClaim(value: string | undefined): Subtree | undefined {
  const at = value?.indexOf(':') ?? -1
  if (value === undefined || at <= 0) return undefined
  const node_type = value.slice(0, at).trim()
  const node_id = value.slice(at + 1).trim()
  return node_type === '' || node_id === '' ? undefined : { node_type, node_id }
}

/** A name for the agent: the project directory and the start of the session id. */
export function agentName(cwd: string, sessionId: string): string {
  const directory = cwd.split('/').filter((part) => part !== '').pop() ?? 'session'
  const cleaned = directory.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'session'
  return `${cleaned.slice(0, 32)}-${sessionId.replace(/[^A-Za-z0-9]/g, '').slice(0, 4) || 'x'}`
}

/** The arguments of `arlesh_agents.attach`, by PIN or, once there is one, by token. */
export function attachArguments(args: {
  sessionId: string
  pin?: string
  token?: string
  name: string
  account: string
  subtree?: Subtree
}): Record<string, unknown> {
  const credential = args.token === undefined ? { pin: args.pin } : { token: args.token }
  return {
    operation: 'attach',
    session_id: args.sessionId,
    ...credential,
    ...(args.token === undefined
      ? { name: args.name, account: args.account, ...(args.subtree === undefined ? {} : { subtree: args.subtree }) }
      : {}),
  }
}

/** What an attach came to. */
export interface Attached {
  name: string
  token?: string
  /** The claim as the server reports it, e.g. `goal 10`, or `undefined` when none is held. */
  claim?: string
  claimRefused?: string
  /** The agent's id on the server: two attaches as different agents rebind the session. */
  agentId?: number
  /** Whether the Claim is held or paused, when there is one. */
  claimStatus?: 'active' | 'paused'
}

/** Reads an `arlesh_agents` answer, or `undefined` when it is a refusal. */
export function attachedFrom(result: unknown): Attached | undefined {
  const payload = payloadOf(result)
  if (!isRecord(payload) || !isRecord(payload['agent'])) return undefined
  const agent = payload['agent']
  const name = text(agent, 'name')
  if (name === undefined) return undefined
  const root = isRecord(agent['claim']) ? agent['claim']['root'] : undefined
  const claim =
    isRecord(root) && typeof root['node_kind'] === 'string' && root['node_id'] !== undefined
      ? `${root['node_kind']} ${String(root['node_id'])}`
      : undefined
  const token = text(payload, 'token')
  const claimRefused = text(payload, 'claim_refused')
  const id = agent['id']
  const status = isRecord(agent['claim']) ? agent['claim']['status'] : undefined
  return {
    name,
    ...(typeof id === 'number' ? { agentId: id } : {}),
    ...(status === 'active' || status === 'paused' ? { claimStatus: status } : {}),
    ...(token === undefined ? {} : { token }),
    ...(claim === undefined ? {} : { claim }),
    ...(claimRefused === undefined ? {} : { claimRefused }),
  }
}

/** Whether a tool's answer is the server turning an unattached session away. */
export function isNotAttached(result: unknown): boolean {
  // Whatever the shape (the JSON the model reads, a result object, text with a prefix), the refusal
  // names its kind and says the session is not attached: look at all of it.
  const found = typeof result === 'string' ? result : JSON.stringify(result ?? '')
  return /not_permitted/.test(found) && /not attached/i.test(found)
}

/** The reason a refused `arlesh_agents` call gives, from whatever shape its answer has. */
export function refusalMessage(result: unknown): string | undefined {
  const structured = isRecord(result) ? result['structuredContent'] : undefined
  const body = isRecord(structured) ? structured : typeof result === 'string' ? parseJson(result) : undefined
  if (isRecord(body)) return text(body, 'message')
  const blocks = isRecord(result) ? result['content'] : undefined
  const first = Array.isArray(blocks) ? blocks[0] : undefined
  const inner = isRecord(first) && typeof first['text'] === 'string' ? parseJson(first['text']) : undefined
  return isRecord(inner) ? text(inner, 'message') : undefined
}

/** A plan-limit window as the session reports it. */
export interface Limit {
  kind: string
  percentUsed: number
  resetsAt?: string
}

/** The windows `arlesh_agents.report_usage` takes: those with a reset time. */
export function usageWindows(limits: readonly Limit[]): Array<{ kind: string; percent_used: number; resets_at: string }> {
  return limits.flatMap((limit) =>
    limit.resetsAt === undefined
      ? []
      : [{ kind: limit.kind, percent_used: limit.percentUsed, resets_at: limit.resetsAt }],
  )
}

/** What was last reported: when, and each window's percent. */
export interface Reported {
  at: number
  percents: Record<string, number>
}

/** Whether to report `limits` now: a percent moved a whole point, a window came or went, or it is time. */
export function shouldReport(previous: Reported | undefined, limits: readonly Limit[], now: number): boolean {
  const windows = usageWindows(limits)
  if (windows.length === 0) return false
  if (previous === undefined) return true
  if (now - previous.at >= REPORT_EVERY_MS) return true
  if (windows.length !== Object.keys(previous.percents).length) return true
  return windows.some((window) => {
    const before = previous.percents[window.kind]
    return before === undefined || Math.abs(window.percent_used - before) >= 1
  })
}

export function reportedFrom(limits: readonly Limit[], now: number): Reported {
  return {
    at: now,
    percents: Object.fromEntries(usageWindows(limits).map((window) => [window.kind, window.percent_used])),
  }
}

/** The state of this session's attach, as the context block tells it. */
export type Standing =
  | {
      kind: 'attached'
      name: string
      claim: string | undefined
      claimRefused?: string
      /** Why the Claim paused when the last session ended could not be resumed, when it could not. */
      resumeRefused?: string
      agentId?: number
      automatic: boolean
    }
  | { kind: 'unattached'; reason: string }

/**
 * The short block added to the session-start context: that the session tracks work on Arlesh, whether
 * and as whom it is attached, and how a Claim works. The server's own instructions hold the rest.
 */
export function contextBlock(standing: Standing): string {
  const how =
    'Claim a subtree with `arlesh_agents.claim`, pause it (`pause`, `resume`) to let another agent take it, or `release` it; ' +
    'a Claim is your whole view of the board. See the Arlesh server\'s instructions.'
  if (standing.kind === 'unattached') {
    return (
      'This session tracks work on Arlesh but is not attached (' + standing.reason + '). ' +
      'Ask the user for a one-time PIN (Settings → Agents), then call `arlesh_agents.attach` with it, ' +
      'your session id, a name, your account and the subtree to work. Until then Arlesh shows you nothing.'
    )
  }
  const held = standing.claim === undefined ? 'no claim yet' : `claim: ${standing.claim}`
  const refused =
    (standing.claimRefused === undefined ? '' : ` The claim asked for was refused: ${standing.claimRefused}.`) +
    (standing.resumeRefused === undefined
      ? ''
      : ` Its claim was paused when the last session ended and could not be resumed: ${standing.resumeRefused}.`)
  const verb = standing.automatic ? 'attached automatically' : 'attached'
  const subagents = 'To start a subagent already holding its Task, write [arlesh:<task id>] once in the Agent call\'s description or prompt.'
  return `This session tracks work on Arlesh: ${verb} as ${standing.name}, ${held}.${refused} ${how} ${subagents}`
}
