import type { Seen, Via } from './rules'

/** One watched wait: what the mod last saw of it, and who asked. */
export interface Entry extends Seen {
  waitId: string
  shortId: string
  taskShortId: string
  via?: Via
  /** When it was last recorded or seen to change, in milliseconds. */
  seenAt: number
}

/** The waits a session watches, by full wait id. */
export type Book = Record<string, Entry>

/** How long a watch outlives its last sign of life. */
export const KEEP_MS = 30 * 24 * 60 * 60 * 1000

/** The book as stored; anything that is not a well-formed entry is dropped. */
export function revive(stored: unknown): Book {
  const book: Book = {}
  if (typeof stored !== 'object' || stored === null) return book
  for (const [id, entry] of Object.entries(stored)) {
    if (isEntry(entry)) book[id] = entry
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
  return { ...book, [entry.waitId]: via === undefined ? entry : { ...entry, via } }
}

/** The book without `waitId`. */
export function forget(book: Book, waitId: string): Book {
  return Object.fromEntries(Object.entries(book).filter(([id]) => id !== waitId))
}
