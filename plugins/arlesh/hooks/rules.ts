/** A wait as the mod last saw it. */
export interface Seen {
  status: 'pending' | 'released'
  archived: boolean
}

/** What happened to a wait that is worth waking an agent for. */
export type Change = 'released' | 'reopened' | 'archived' | 'deleted'

/** Every [Change], to check a stored one against. */
export const CHANGES: readonly Change[] = ['released', 'reopened', 'archived', 'deleted']

/** What came of one try to put a notification in front of its recipient. */
export type Delivery = { delivered: true } | { delivered: false; reason: string }

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

/** Whether the message names the sub-agent: it does whenever it goes to anyone else than it. */
export function namesRaiser(target: Target, via: Via | undefined): boolean {
  return via !== undefined && !(target.kind === 'agent' && !target.byProxy)
}

/**
 * What a notification says: where to look, never the answer itself. `named` says the sub-agent
 * that raised the wait by its description, for when the pointer does not go to that sub-agent.
 */
export function notificationText(
  wait: { shortId: string; taskShortId: string },
  change: Change,
  via: Via | undefined,
  named: boolean,
): string {
  const naming = named && via !== undefined ? ` The sub-agent "${via.description}" raised it.` : ''
  return (
    `Arlesh notification: wait ${wait.shortId} on Task ${wait.taskShortId} changed ` +
    `(${change === 'deleted' ? 'gone' : change}); read it with \`arlesh_waits.get\`.${naming}`
  )
}

/** One change a session is owed, with what a message about it names. */
export interface Owed {
  waitId: string
  shortId: string
  taskShortId: string
  via?: Via
  change: Change
}

/** A change and whether the message about it names the sub-agent that raised the wait. */
export interface Addressed {
  owed: Owed
  named: boolean
}

/** Who gets what in one flush: each running sub-agent its own, the session the rest. */
export interface Plan {
  agents: Array<{ agentId: string; items: Addressed[] }>
  session: Addressed[]
}

/**
 * Groups the changes owed by recipient. Each is routed as [routeTo] routes it: to the sub-agent
 * that raised the wait while it runs, else to whoever spawned it, else to the session. Changes with
 * the same recipient go together, so a batch of answers is one wake-up for each agent.
 */
export function planDeliveries(owed: readonly Owed[], agents: readonly AgentLite[]): Plan {
  const plan: Plan = { agents: [], session: [] }
  for (const item of owed) {
    const target = routeTo(item.via, agents)
    const addressed = { owed: item, named: namesRaiser(target, item.via) }
    if (target.kind === 'session') {
      plan.session.push(addressed)
      continue
    }
    const group = plan.agents.find((candidate) => candidate.agentId === target.agentId)
    if (group === undefined) plan.agents.push({ agentId: target.agentId, items: [addressed] })
    else group.items.push(addressed)
  }
  return plan
}

/**
 * What the session is told when a sub-agent did not take its changes: the same changes, each
 * naming the sub-agent that raised its wait.
 */
export function forSession(items: readonly Addressed[]): Addressed[] {
  return items.map(({ owed }) => ({ owed, named: owed.via !== undefined }))
}

/**
 * What a batch says: how many waits changed and each one, never the answers. An item that goes to
 * anyone but the sub-agent that raised its wait names that sub-agent.
 */
export function batchNotificationText(items: readonly Addressed[]): string {
  const each = items.map(({ owed, named }) => {
    const raiser = named && owed.via !== undefined ? ` — raised by the sub-agent "${owed.via.description}"` : ''
    const change = owed.change === 'deleted' ? 'gone' : owed.change
    return `wait ${owed.shortId} on Task ${owed.taskShortId} (${change}${raiser})`
  })
  return (
    `Arlesh notification: ${items.length} waits changed: ${each.join(', ')}; ` +
    'read them with `arlesh_waits.get_many`.'
  )
}

/**
 * The one message for a recipient: a single change reads exactly as [notificationText] always
 * did; several read as [batchNotificationText].
 */
export function messageFor(items: readonly Addressed[]): string {
  const [only, ...rest] = items
  if (only !== undefined && rest.length === 0) {
    return notificationText(only.owed, only.owed.change, only.owed.via, only.named)
  }
  return batchNotificationText(items)
}
