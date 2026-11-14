import { isRecord } from './json'
import { payloadOf } from './results'

/** How long a child's record outlives its last sign of life, as the agent token does. */
export const KEEP_MS = 30 * 24 * 60 * 60 * 1000

/** One subagent registered as a child agent of the session's agent. */
export interface Child {
  /** The child agent's id on the server. */
  childId: number
  /** What the subagent passes as `sub_token`: the child's own, or its nearest ancestor's. */
  subToken: string
  /** What the child is called in Settings → Agents. */
  name: string
  /** A subagent started by a subagent: it works under its ancestor's sub-Claim and is not registered. */
  nested?: true
  /** The claimed Task as the server names it (`077 Subagents: …`), once known. */
  claimName?: string
  /** `active` or `paused`, as last known. */
  standing?: string
  /** When the record was made or last used, in milliseconds. */
  savedAt: number
}

/** The children of one session, by Claude Code's id for each subagent. */
export type Children = Record<string, Child>

/** The records as stored; anything that is not a well-formed record is dropped. */
export function revive(stored: unknown): Children {
  const children: Children = {}
  if (!isRecord(stored)) return children
  for (const [id, record] of Object.entries(stored)) {
    if (isChild(record)) children[id] = record
  }
  return children
}

function isChild(value: unknown): value is Child {
  return (
    isRecord(value) &&
    typeof value['childId'] === 'number' &&
    typeof value['subToken'] === 'string' &&
    typeof value['name'] === 'string' &&
    typeof value['savedAt'] === 'number'
  )
}

/** The records nobody has touched for [KEEP_MS] dropped. */
export function prune(children: Children, now: number): Children {
  return Object.fromEntries(Object.entries(children).filter(([, child]) => now - child.savedAt < KEEP_MS))
}

/** The Task a subagent is to hold, as `register_child` takes it. */
export interface TaskRef {
  node_type: 'task'
  node_id: string
}

/** The arguments of `arlesh_agents.register_child`, with the Task to hold from the start if one is named. */
export function registerArguments(name: string, clientId: string, subtree?: TaskRef): Record<string, unknown> {
  return { operation: 'register_child', name, client_id: clientId, ...(subtree === undefined ? {} : { subtree }) }
}

/** What `register_child` answered. */
export interface Registered {
  childId: number
  name: string
  subToken?: string
  /** Whether the child holds a sub-Claim now. */
  holds: boolean
  /** The claimed Task as the server names it (`077 Subagents: …`). */
  claimName?: string
  /** Why the Claim asked for with the registration was refused, when it was. */
  claimRefused?: string
}

/** Reads a `register_child` answer, or `undefined` when it is a refusal. */
export function registeredFrom(result: unknown): Registered | undefined {
  const payload = payloadOf(result)
  if (!isRecord(payload) || !isRecord(payload['agent'])) return undefined
  const { id, name } = payload['agent']
  if (typeof id !== 'number' || typeof name !== 'string') return undefined
  const subToken = payload['sub_token']
  const claimName = payload['claim_name']
  const claimRefused = payload['claim_refused']
  return {
    childId: id,
    name,
    holds: isRecord(payload['agent']['claim']),
    ...(typeof subToken === 'string' ? { subToken } : {}),
    ...(typeof claimName === 'string' ? { claimName } : {}),
    ...(typeof claimRefused === 'string' ? { claimRefused } : {}),
  }
}

/** The claimed Task's name and the standing, as an `arlesh_agents` answer gives them. */
export interface Identity {
  claimName?: string
  standing?: string
}

/** Reads the identity an `arlesh_agents` answer carries; `undefined` for a refusal. */
export function identityFrom(result: unknown): Identity | undefined {
  const payload = payloadOf(result)
  if (!isRecord(payload) || !isRecord(payload['agent'])) return undefined
  const claimName = payload['claim_name']
  const standing = payload['standing']
  return {
    ...(typeof claimName === 'string' ? { claimName } : {}),
    ...(typeof standing === 'string' ? { standing } : {}),
  }
}

/** Whether a tool's answer says the sub-token names no child of this session (it was removed). */
export function isChildGone(result: unknown): boolean {
  const text = typeof result === 'string' ? result : JSON.stringify(result ?? '')
  return /not_permitted/.test(text) && /(sub_token names no child|not attached)/i.test(text)
}

/**
 * The block added to a registered subagent's starting context. `holding` is the Task it already
 * holds, when the orchestrator named one and the server gave it; `refused` is why a Task the
 * orchestrator named could not be given.
 */
export function contextBlock(name: string, subToken: string, extra: { holding?: string; refused?: string } = {}): string {
  const who =
    `You are a subagent working on Arlesh as child agent \`${name}\` of this session's agent. ` +
    `Pass \`sub_token: "${subToken}"\` on every Arlesh tool call: it gives you your own view. `
  const stops = 'When you stop, your Claim is paused for you; it resumes when you are resumed.'
  if (extra.holding !== undefined) {
    return `${who}You already hold your Claim, ${extra.holding}: do not call \`arlesh_agents.claim\`. ${stops}`
  }
  const why = extra.refused === undefined ? '' : `The Task the orchestrator named could not be claimed for you (${extra.refused}). `
  return (
    `${who}${why}First claim the Task your brief names with \`arlesh_agents.claim\` ` +
    '(`subtree: {node_type: "task", node_id: "<its short id>"}`) and the `sub_token`; ' +
    `you can claim only inside the session's Claim. ${stops}`
  )
}

/** A subagent's record, with the id it is kept under. */
export interface Governing {
  id: string
  child: Child
}

/**
 * The record a subagent works under: its own, or its nearest ancestor's when it is not
 * registered. `parents` maps a subagent's id to the id of the agent that spawned it.
 */
export function governing(
  children: Children,
  parents: ReadonlyMap<string, string>,
  id: string,
): Governing | undefined {
  const seen = new Set<string>()
  for (let at: string | undefined = id; at !== undefined && !seen.has(at); at = parents.get(at)) {
    seen.add(at)
    const child = children[at]
    if (child !== undefined) return { id: at, child }
  }
  return undefined
}

/** The line under a subagent's row: `Arlesh · <Task> · Active`, or `undefined` while there is none. */
export function rowLine(child: Child): string | undefined {
  if (child.claimName === undefined) return undefined
  const standing = child.standing === 'paused' ? 'Paused' : 'Active'
  return `Arlesh · ${child.claimName} · ${standing}`
}

/** What an Agent call's marker said. */
export type Marker = { kind: 'none' } | { kind: 'one'; ref: string } | { kind: 'invalid'; reason: string }

const MARKER = /\[arlesh:([0-9A-Za-z-]{3,40})\]/g
const MARKER_START = '[arlesh:'

/**
 * The Task the orchestrator named in an Agent call: `[arlesh:<id>]` with an id of 3 to 40 letters,
 * digits or hyphens, once, in the `description` or the `prompt`. A repeated marker, or text that
 * starts one and is not a whole marker, counts as none: `invalid`, for the debug log.
 */
export function parseMarker(description: string, prompt: string): Marker {
  const text = `${description}\n${prompt}`
  const started = text.split(MARKER_START).length - 1
  if (started === 0) return { kind: 'none' }
  const whole = [...text.matchAll(MARKER)]
  if (started !== whole.length) return { kind: 'invalid', reason: 'a marker that is not whole' }
  const [first] = whole
  if (whole.length > 1 || first?.[1] === undefined) return { kind: 'invalid', reason: 'more than one marker' }
  return { kind: 'one', ref: first[1] }
}

/** `text` without the markers, and the space that stood before each. */
export function stripMarker(text: string): string {
  return text.replace(/ ?\[arlesh:[0-9A-Za-z-]{3,40}\]/g, '').trim()
}

/** The longest Task title a label carries. */
export const TITLE_MAX = 28

/**
 * What the subagent list shows for a subagent holding a Task: its own description first, then the
 * Task's short id and title, cut to stay readable in a narrow list.
 * `Fix CI · 077 Subagents: register under t…`
 */
export function label(description: string, shortId: string, title: string): string {
  const cut = title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX).trimEnd()}…` : title
  const base = description.trim() === '' ? 'subagent' : description.trim()
  return `${base} · ${shortId} ${cut}`
}

/** The short id and title of the Task an `arlesh_tasks.get` answered, or `undefined`. */
export function taskFrom(result: unknown): { shortId: string; title: string } | undefined {
  const payload = payloadOf(result)
  const task = isRecord(payload) ? payload['task'] : undefined
  if (!isRecord(task)) return undefined
  const shortId = task['short_id']
  const title = task['title']
  return typeof shortId === 'string' && typeof title === 'string' ? { shortId, title } : undefined
}

/** The operations that would change the session's own Claim when made with no `sub_token`. */
const CLAIM_OPERATIONS = new Set(['claim', 'release'])

/**
 * Whether an Arlesh call is a `claim` or `release` that carries no `sub_token`: made inside a
 * subagent's loop it would run as the session and change the session's Claim.
 */
export function changesSessionClaim(tool: string, input: Record<string, unknown>): boolean {
  const operation = input['operation']
  return (
    tool.endsWith('__arlesh_agents') &&
    typeof operation === 'string' &&
    CLAIM_OPERATIONS.has(operation) &&
    typeof input['sub_token'] !== 'string'
  )
}
