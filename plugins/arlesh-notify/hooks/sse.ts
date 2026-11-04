/** One Server-Sent Event, or a comment line the server sent to keep the stream open. */
export interface SseEvent {
  id?: string
  name?: string
  data?: string
  comment?: string
}

export interface SseParser {
  /** Feeds the next piece of the stream's text; answers the events it completed. */
  feed(text: string): SseEvent[]
}

/** A parser that holds what a piece left unfinished until the next one arrives. */
export function createSseParser(): SseParser {
  let pending = ''
  return {
    feed(text) {
      pending += text.replace(/\r\n?/g, '\n')
      const events: SseEvent[] = []
      for (;;) {
        const end = pending.indexOf('\n\n')
        if (end < 0) break
        const block = pending.slice(0, end)
        pending = pending.slice(end + 2)
        const event = parseBlock(block)
        if (event) events.push(event)
      }
      return events
    },
  }
}

function parseBlock(block: string): SseEvent | undefined {
  const event: SseEvent = {}
  const data: string[] = []
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) {
      event.comment = line.slice(1).trim()
      continue
    }
    const colon = line.indexOf(':')
    const field = colon < 0 ? line : line.slice(0, colon)
    const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '')
    if (field === 'id') event.id = value
    else if (field === 'event') event.name = value
    else if (field === 'data') data.push(value)
  }
  if (data.length > 0) event.data = data.join('\n')
  return event.name !== undefined || event.data !== undefined || event.comment !== undefined
    ? event
    : undefined
}
