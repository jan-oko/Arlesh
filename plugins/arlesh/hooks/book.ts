import type { Change, Seen, Via } from './rules'
import { CHANGES } from './rules'

/** One watched wait: what the mod last saw of it, and who asked. */
export interface Entry extends Seen {
  waitId: string
  shortId: string
  taskShortId: string
  via?: Via
  /** When it was last recorded or seen to change, in milliseconds. */
  seenAt: number
  /**
   * Changes the session has not been told of yet, oldest first: a change is recorded here when
   * it is seen and leaves only once its notification entered the session. Absent in books
   * stored before it existed, which read as nothing owed.
   */
  owed?: Change[]
  /** Delivery attempts that failed for the change at the head of `owed`. */
  attempts?: number
}

/** Failed delivery attempts after which a notification is given up on and said so. */
export const MAX_ATTEMPTS = 20

/** The waits a session watches, by full wait id. */
export type Book = Record<string, Entry>

/** How long a watch outlives its last sign of life. */
export const KEEP_MS = 30 * 24 * 60 * 60 * 1000

/** The book as stored; anything that is not a well-formed entry is dropped. */
export function revive(stored: unknown): Book {
  const book: Book = {}
  if (typeof stored !== 'object' || stored === null) return book
  for (const [id, entry] of Object.entries(stored)) {
    if (isEntry(entry)) book[id] = tidy(entry)
  }
  return book
}

function isEntry(value: unknown): value is Entry {
  if (typeof value !== 'object' || value === null) return false
  const entry: Record<string, unknown> = { ...value }
  return (
    typeof entry['waitId'] === 'string' &&
    typeof entry['shortId'] === 'string' &&
    typeof entry['taskShortId'] === 'string' &&
    (entry['status'] === 'pending' || entry['status'] === 'released') &&
    typeof entry['archived'] === 'boolean' &&
    typeof entry['seenAt'] === 'number'
  )
}

/** The entry with a malformed `owed` or `attempts` dropped, as an old book may hold none. */
function tidy(entry: Entry): Entry {
  const { owed, attempts, ...rest } = entry
  const changes = Array.isArray(owed) ? owed.filter(isChange) : []
  if (changes.length === 0) return rest
  const failed = typeof attempts === 'number' && attempts > 0 ? attempts : 0
  return failed === 0 ? { ...rest, owed: changes } : { ...rest, owed: changes, attempts: failed }
}

function isChange(value: unknown): value is Change {
  return CHANGES.some((change) => change === value)
}

/** The changes `entry` still owes the session, oldest first. */
export function owedBy(entry: Entry): readonly Change[] {
  return entry.owed ?? []
}

/** The change at the head of every entry's `owed`: what the next flush tells, one per wait. */
export function owedHeads(book: Book): Array<{ entry: Entry; change: Change }> {
  const heads: Array<{ entry: Entry; change: Change }> = []
  for (const entry of Object.values(book)) {
    const change = owedBy(entry)[0]
    if (change !== undefined) heads.push({ entry, change })
  }
  return heads
}

/** The entry owing one more `change`, after those it owes already. */
export function owing(entry: Entry, change: Change): Entry {
  return { ...entry, owed: [...owedBy(entry), change] }
}

/**
 * The entry once its recipient's own call changed the wait to `state`: the new state counts as
 * seen, so the poll's report of it is no change, and a `change` the poll reported first and
 * still owed is taken back (the newest one, which is the one the call caused).
 */
export function acknowledged(entry: Entry, state: Seen, change: Change, now: number): Entry {
  const { owed, attempts, ...rest } = entry
  const all = [...(owed ?? [])]
  const index = all.lastIndexOf(change)
  if (index >= 0) all.splice(index, 1)
  const kept: Entry = { ...rest, ...state, seenAt: now }
  if (all.length === 0) return kept
  return index === 0 || attempts === undefined ? { ...kept, owed: all } : { ...kept, owed: all, attempts }
}

/** The entry once the change at the head of `owed` has been delivered or given up on. */
export function settled(entry: Entry): Entry {
  const { owed, attempts, ...rest } = entry
  const later = (owed ?? []).slice(1)
  return later.length === 0 ? rest : { ...rest, owed: later }
}

/** The entry after one more failed attempt to deliver the head of `owed`. */
export function failedOnce(entry: Entry): Entry {
  return { ...entry, attempts: (entry.attempts ?? 0) + 1 }
}

/** The book without the watches nobody has touched for [KEEP_MS]. */
export function prune(book: Book, now: number): Book {
  return Object.fromEntries(
    Object.entries(book).filter(([, entry]) => now - entry.seenAt < KEEP_MS),
  )
}

/** The book with `entry` in it; a wait already watched keeps who first asked. */
export function remember(book: Book, entry: Entry): Book {
  const known = book[entry.waitId]
  const via = known?.via ?? entry.via
  const kept: Entry = {
    ...entry,
    ...(known?.owed === undefined ? {} : { owed: known.owed }),
    ...(known?.attempts === undefined ? {} : { attempts: known.attempts }),
  }
  return { ...book, [entry.waitId]: via === undefined ? kept : { ...kept, via } }
}

/** The book without `waitId`. */
export function forget(book: Book, waitId: string): Book {
  return Object.fromEntries(Object.entries(book).filter(([id]) => id !== waitId))
}
