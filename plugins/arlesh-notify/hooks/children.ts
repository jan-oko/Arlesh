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

/** The arguments of `arlesh_agents.register_child`. */
export function registerArguments(name: string, clientId: string): Record<string, unknown> {
  return { operation: 'register_child', name, client_id: clientId }
}

/** What `register_child` answered. */
export interface Registered {
  childId: number
  name: string
  /** Only the first registration of a subagent answers its sub-token. */
  subToken?: string
}

/** Reads a `register_child` answer, or `undefined` when it is a refusal. */
export function registeredFrom(result: unknown): Registered | undefined {
  const payload = payloadOf(result)
  if (!isRecord(payload) || !isRecord(payload['agent'])) return undefined
  const { id, name } = payload['agent']
  if (typeof id !== 'number' || typeof name !== 'string') return undefined
  const subToken = payload['sub_token']
  return { childId: id, name, ...(typeof subToken === 'string' ? { subToken } : {}) }
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

/** The block added to a registered subagent's starting context. */
export function contextBlock(name: string, subToken: string): string {
  return (
    `You are a subagent working on Arlesh as child agent \`${name}\` of this session's agent. ` +
    `Pass \`sub_token: "${subToken}"\` on every Arlesh tool call: it gives you your own view. ` +
    'First claim the Task your brief names with `arlesh_agents.claim` ' +
    '(`subtree: {node_type: "task", node_id: "<its short id>"}`) and the `sub_token`; ' +
    'you can claim only inside the session\'s Claim. ' +
    'When you stop, your Claim is paused for you; it resumes when you are resumed.'
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
