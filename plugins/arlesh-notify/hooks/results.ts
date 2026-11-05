import { isRecord, parseJson, text } from './json'
import type { Seen } from './rules'

/** A wait named by an `arlesh_waits` result. */
export interface WaitRef extends Seen {
  waitId: string
  shortId: string
  /** The Task's short id, or what the agent called the Task, when the result does not say. */
  taskShortId: string | undefined
}

/**
 * The payload of an MCP tool result. A `tool.call` hook's `next(e)` gives the result as the
 * string the model reads, holding the JSON; `$.mcp.call` gives an object, with its structured
 * content or its text blocks. An error result carries no payload.
 */
export function payloadOf(result: unknown): unknown {
  if (typeof result === 'string') return parseJson(result)
  if (!isRecord(result)) return undefined
  if (result['isError'] === true) return undefined
  if (result['structuredContent'] !== undefined) return result['structuredContent']
  const content = result['content']
  if (!Array.isArray(content)) return undefined
  for (const block of content) {
    if (isRecord(block) && block['type'] === 'text' && typeof block['text'] === 'string') {
      const parsed = parseJson(block['text'])
      if (parsed !== undefined) return parsed
    }
  }
  return undefined
}

function seen(value: Record<string, unknown>): Seen {
  return {
    status: value['status'] === 'released' ? 'released' : 'pending',
    archived: value['archival'] === 'archived' || value['archived'] === true,
  }
}

/**
 * The waits an `arlesh_waits` call named: the one `ask` or `raise` made, or the ones `watch`
 * validated. `taskLabel` is what the call called the Task, for a result that does not carry it.
 */
export function waitsFrom(
  operation: unknown,
  result: unknown,
  taskLabel: string | undefined,
): WaitRef[] {
  const payload = payloadOf(result)
  if (!isRecord(payload)) return []
  if (operation === 'ask' || operation === 'raise') {
    const waitId = text(payload, 'full_id')
    const shortId = text(payload, 'short_id')
    if (waitId === undefined || shortId === undefined) return []
    return [{ waitId, shortId, taskShortId: taskLabel, ...seen(payload) }]
  }
  if (operation === 'watch') {
    const waits = payload['waits']
    if (!Array.isArray(waits)) return []
    const refs: WaitRef[] = []
    for (const wait of waits) {
      if (!isRecord(wait) || wait['gone'] === true) continue
      const waitId = text(wait, 'wait_id')
      const shortId = text(wait, 'short_id')
      if (waitId === undefined || shortId === undefined) continue
      refs.push({ waitId, shortId, taskShortId: text(wait, 'task_short_id'), ...seen(wait) })
    }
    return refs
  }
  return []
}

/** What the server says of a watched wait now: its state, or `null` when it is gone. */
export interface Current {
  waitId: string
  state: (Seen & { shortId: string; taskShortId: string }) | null
}

/** The states a `get_many` answered, for the ids asked (full ids are what the mod asks with). */
export function currentFrom(asked: readonly string[], result: unknown): Current[] {
  const payload = payloadOf(result)
  if (!isRecord(payload) || !Array.isArray(payload['waits'])) return []
  const answers: Current[] = []
  for (const wait of payload['waits']) {
    if (!isRecord(wait)) continue
    const id = text(wait, 'id')
    const waitId = text(wait, 'wait_id') ?? asked.find((candidate) => candidate === id)
    if (waitId === undefined) continue
    const shortId = text(wait, 'short_id')
    const taskShortId = text(wait, 'task_short_id')
    if (wait['gone'] === true || shortId === undefined || taskShortId === undefined) {
      answers.push({ waitId, state: null })
    } else {
      answers.push({ waitId, state: { ...seen(wait), shortId, taskShortId } })
    }
  }
  return answers
}

/** One change as the server sends it (`wait-changed` data, a long poll's `changes` entry). */
export function currentFromChange(change: unknown): Current | undefined {
  if (!isRecord(change)) return undefined
  const waitId = text(change, 'wait_id')
  const shortId = text(change, 'short_id')
  const taskShortId = text(change, 'task_short_id')
  if (waitId === undefined || shortId === undefined || taskShortId === undefined) return undefined
  if (change['deleted'] === true) return { waitId, state: null }
  return { waitId, state: { ...seen(change), shortId, taskShortId } }
}
