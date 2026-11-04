import { expect, test } from 'claude-code/testing'

import { KEEP_MS, forget, prune, remember, revive, type Entry } from './book'
import { curlConfig, expandVariables, expectationsUrl, pickServer } from './config'
import { currentFrom, currentFromEvent, waitsFrom } from './results'
import { changeBetween, notificationText, routeTo } from './rules'
import { createSseParser } from './sse'

const pending = { status: 'pending', archived: false } as const
const released = { status: 'released', archived: false } as const

test('a release, a reopening, an archive and a deletion wake; nothing else does', () => {
  expect(changeBetween(pending, released)).toBe('released')
  expect(changeBetween(released, pending)).toBe('reopened')
  expect(changeBetween(pending, { ...pending, archived: true })).toBe('archived')
  expect(changeBetween(pending, null)).toBe('deleted')
  expect(changeBetween(pending, pending)).toBeNull()
  expect(changeBetween({ ...pending, archived: true }, pending)).toBeNull()
})

test('a notification points at the wait and never quotes it', () => {
  const wait = { shortId: '7c0', taskShortId: '9a1' }

  expect(notificationText(wait, 'released', undefined, false)).toBe(
    'Arlesh notification: wait 7c0 on Task 9a1 changed (released); read it with `arlesh_waits.get`.',
  )
  expect(notificationText(wait, 'deleted', undefined, false)).toContain('(gone)')
  expect(
    notificationText(wait, 'released', { agentId: 'a1', description: 'Fix CI' }, true),
  ).toContain('The sub-agent "Fix CI" raised it.')
})

test('a notification goes to the raising sub-agent while it runs, else to its parent, else the session', () => {
  const via = { agentId: 'child', description: 'Fix CI', parentId: 'parent' }
  const running = (id: string, parentId?: string) => ({
    id,
    status: 'running',
    ...(parentId === undefined ? {} : { parentId }),
  })
  const done = (id: string, parentId?: string) => ({ ...running(id, parentId), status: 'completed' })

  expect(routeTo(via, [running('child', 'parent'), running('parent')])).toEqual({
    kind: 'agent',
    agentId: 'child',
    byProxy: false,
  })
  expect(routeTo(via, [done('child', 'parent'), running('parent')])).toEqual({
    kind: 'agent',
    agentId: 'parent',
    byProxy: true,
  })
  expect(routeTo(via, [done('child', 'parent'), done('parent')])).toEqual({ kind: 'session' })
  expect(routeTo(via, [])).toEqual({ kind: 'session' })
  expect(routeTo(undefined, [running('child')])).toEqual({ kind: 'session' })
})

test('the book keeps who first asked, forgets, and drops what is a month old', () => {
  const entry: Entry = {
    waitId: 'w1', shortId: 'w1s', taskShortId: 't1', ...pending, seenAt: 1_000,
    via: { agentId: 'a1', description: 'first' },
  }
  const again: Entry = { ...entry, via: { agentId: 'a2', description: 'second' } }

  const book = remember(remember({}, entry), again)

  expect(book['w1']?.via?.agentId).toBe('a1')
  expect(Object.keys(forget(book, 'w1'))).toEqual([])
  expect(Object.keys(prune(book, 1_000 + KEEP_MS - 1))).toEqual(['w1'])
  expect(Object.keys(prune(book, 1_000 + KEEP_MS))).toEqual([])
  expect(revive({ w1: entry, bad: { waitId: 1 } })).toEqual({ w1: entry })
  expect(revive('nonsense')).toEqual({})
})

test('the server is the Arlesh entry, found by its name in any case, with its headers', () => {
  const found = pickServer([
    undefined,
    { other: { url: 'http://x/mcp' } },
    { arlesh: { type: 'http', url: 'https://box.example/mcp', headers: { Authorization: 'Bearer t' } } },
    { Arlesh: { url: 'http://127.0.0.1:4747/mcp' } },
  ])

  expect(found).toEqual({
    name: 'arlesh',
    url: 'https://box.example/mcp',
    headers: { Authorization: 'Bearer t' },
  })
  expect(pickServer([{ Arlesh: { command: 'npx' } }])).toBeUndefined()
})

test('the wait stream is on the origin of /mcp', () => {
  expect(expectationsUrl('http://127.0.0.1:4747/mcp')).toBe(
    'http://127.0.0.1:4747/events/expectations?agentic=true',
  )
  expect(expectationsUrl('https://box.example/arlesh/mcp/')).toBe(
    'https://box.example/arlesh/events/expectations?agentic=true',
  )
})

test('variables expand as .mcp.json expands them', async () => {
  const lookup = async (name: string) => (name === 'TOKEN' ? 'abc' : undefined)

  expect(await expandVariables('Bearer ${TOKEN}', lookup)).toBe('Bearer abc')
  expect(await expandVariables('${NOPE:-fallback}/x', lookup)).toBe('fallback/x')
  expect(await expandVariables('plain', lookup)).toBe('plain')
})

test('the curl config escapes values and keeps the token off the command line', () => {
  const config = curlConfig('http://h/e', { Authorization: 'Bearer "t"\\' })

  expect(config).toContain('url = "http://h/e"')
  expect(config).toContain('header = "Accept: text/event-stream"')
  expect(config).toContain('header = "Authorization: Bearer \\"t\\"\\\\"')
})

test('the stream is parsed across pieces, with comments and CRLF', () => {
  const parser = createSseParser()

  expect(parser.feed(': conn')).toEqual([])
  expect(parser.feed('ected\n\nid: e:1\nevent: wait-chan')).toEqual([{ comment: 'connected' }])
  expect(parser.feed('ged\r\ndata: {"a":1}\r\n\r\n')).toEqual([
    { id: 'e:1', name: 'wait-changed', data: '{"a":1}' },
  ])
})

test('a wait an agent asks, raises or watches is read off the tool result', () => {
  const asked = { structuredContent: { full_id: 'w-full', short_id: 'w1', status: 'pending', archival: 'live' } }
  const watched = {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          waits: [
            { id: 'x', gone: false, wait_id: 'w2-full', short_id: 'w2', task_short_id: 't2', status: 'released', archived: false },
            { id: 'y', gone: true },
          ],
        }),
      },
    ],
  }

  expect(waitsFrom('ask', asked, '9a1')).toEqual([
    { waitId: 'w-full', shortId: 'w1', taskShortId: '9a1', status: 'pending', archived: false },
  ])
  expect(waitsFrom('watch', watched, undefined)).toEqual([
    { waitId: 'w2-full', shortId: 'w2', taskShortId: 't2', status: 'released', archived: false },
  ])
  expect(waitsFrom('release', asked, undefined)).toEqual([])
  expect(waitsFrom('ask', { isError: true, structuredContent: {} }, undefined)).toEqual([])
})

test('a catch-up read says which waits are gone', () => {
  const result = {
    structuredContent: {
      waits: [
        { id: 'w1-full', gone: false, wait_id: 'w1-full', short_id: 'w1', task_short_id: 't', status: 'released', archived: false },
        { id: 'w2-full', gone: true },
      ],
    },
  }

  expect(currentFrom(['w1-full', 'w2-full'], result)).toEqual([
    { waitId: 'w1-full', state: { status: 'released', archived: false, shortId: 'w1', taskShortId: 't' } },
    { waitId: 'w2-full', state: null },
  ])
})

test('an event for a deleted wait is gone, and one without ids is ignored', () => {
  const data = JSON.stringify({ wait_id: 'w', short_id: 's', task_short_id: 't', status: 'pending', archived: false, deleted: true })

  expect(currentFromEvent(data)).toEqual({ waitId: 'w', state: null })
  expect(currentFromEvent('{}')).toBeUndefined()
  expect(currentFromEvent(undefined)).toBeUndefined()
})
