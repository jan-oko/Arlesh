/** A wait as the mod last saw it. */
export interface Seen {
  status: 'pending' | 'released'
  archived: boolean
}

/** What happened to a wait that is worth waking an agent for. */
export type Change = 'released' | 'reopened' | 'archived' | 'deleted'

/**
 * What changed between the state last seen and the one now, or `null` when nothing worth a
 * wake-up did. `current` is `null` for a wait that is gone. An edit to a pending wait's title or
 * note changes neither field, so it never wakes anyone; coming back from the archive does not
 * either.
 */
export function changeBetween(seen: Seen, current: Seen | null): Change | null {
  if (current === null) return 'deleted'
  if (seen.status !== current.status) {
    return current.status === 'released' ? 'released' : 'reopened'
  }
  if (!seen.archived && current.archived) return 'archived'
  return null
}

/** The sub-agent that raised a wait, as the mod saw it do so. */
export interface Via {
  agentId: string
  description: string
  parentId?: string
}

/** An agent as `$.agent.list()` lists it, reduced to what routing reads. */
export interface AgentLite {
  id: string
  status: string
  parentId?: string
}

/** Who a notification goes to. */
export type Target =
  | { kind: 'session' }
  | { kind: 'agent'; agentId: string; byProxy: boolean }

const ALIVE = new Set(['pending', 'running', 'waiting', 'idle'])

/**
 * The sub-agent that raised the wait if it is still running; else the agent that spawned it, if
 * that is; else the session itself. `byProxy` is true when it is not the raiser that gets it, so
 * the message can name the sub-agent.
 */
export function routeTo(via: Via | undefined, agents: readonly AgentLite[]): Target {
  if (via === undefined) return { kind: 'session' }
  const alive = (id: string) => agents.some((agent) => agent.id === id && ALIVE.has(agent.status))
  if (alive(via.agentId)) return { kind: 'agent', agentId: via.agentId, byProxy: false }
  let parent = agents.find((agent) => agent.id === via.agentId)?.parentId ?? via.parentId
  for (let depth = 0; parent !== undefined && depth < 8; depth += 1) {
    if (alive(parent)) return { kind: 'agent', agentId: parent, byProxy: true }
    const next: string | undefined = agents.find((agent) => agent.id === parent)?.parentId
    parent = next
  }
  return { kind: 'session' }
}

/** What a notification says: where to look, never the answer itself. */
export function notificationText(
  wait: { shortId: string; taskShortId: string },
  change: Change,
  via: Via | undefined,
  byProxy: boolean,
): string {
  const named = byProxy && via !== undefined ? ` The sub-agent "${via.description}" raised it.` : ''
  return (
    `Arlesh notification: wait ${wait.shortId} on Task ${wait.taskShortId} changed ` +
    `(${change === 'deleted' ? 'gone' : change}); read it with \`arlesh_waits.get\`.${named}`
  )
}
