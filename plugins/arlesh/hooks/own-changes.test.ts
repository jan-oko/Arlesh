import { expect, mock, test } from 'claude-code/testing'

import { revive } from './book'

type Hooks = Parameters<typeof mock.clock>[0]

const watched = (id: string, over: Record<string, unknown> = {}) => ({
  waitId: `${id}-full`,
  shortId: id,
  taskShortId: '9a1',
  status: 'pending',
  archived: false,
  seenAt: 0,
  ...over,
})

const via = (agentId: string) => ({ agentId, description: `Task of ${agentId}` })
const running = (id: string) => ({ id, description: `Task of ${id}`, type: 'general-purpose', status: 'running' })

/** The answer `release` gives: the wait, released. */
const releaseResult = (id: string) =>
  JSON.stringify({ full_id: `${id}-full`, short_id: id, task_short_id: '9a1', status: 'released', archival: 'live' })

/**
 * A session attached to a server where `released` are the waits it says are released when asked
 * (the first poll resets, so the mod reads them with `get_many`).
 */
function session(on: Hooks, released: string[], waits: Record<string, unknown>, agents: unknown[] = []) {
  const clock = mock.clock(on)
  const stored: Record<string, unknown> = { 'watch:s1': waits, 'agent:s1': { token: 't' } }
  const prompts: string[] = []
  const sent: Array<{ to: unknown; text: string }> = []
  let polled = false
  let answer = JSON.stringify({})
  let status = 'released'
  on('session.start', () => ({ cwd: '/r' }))
  on('session.root', () => ({ value: '/r' }))
  on('env.get', () => ({ value: '/home/u' }))
  on('fs.read', (_, e) => {
    if (e.path === '/r/.mcp.json') {
      return { value: JSON.stringify({ mcpServers: { arlesh: { url: 'http://127.0.0.1:4747/mcp' } } }) }
    }
    throw new Error('no such file')
  })
  on('store.get', (_, e) => ({ value: stored[e.key] }))
  on('store.set', (_, e) => {
    stored[e.key] = e.value
    return { value: undefined }
  })
  on('session.id', () => ({ value: 's1' }))
  on('agent.list', () => ({ value: agents }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('turn.start', () => ({ turnId: 't' }))
  on('mcp.call', () => ({
    value: {
      structuredContent: {
        waits: released.map((id) => ({ wait_id: `${id}-full`, short_id: id, task_short_id: '9a1', status })),
      },
    },
  }))
  on('tool.call', () => ({ result: answer, text: answer }))
  on('http.fetch', async () => {
    const first = !polled
    polled = true
    if (!first) await clock.sleep(25_000)
    return {
      value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ revision: 1, epoch: 'e', changes: [], reset: first }) },
    }
  })
  on('prompt.submit', (_, e) => {
    prompts.push(e.text)
    return { text: e.text }
  })
  on('session.send', (_, e) => {
    sent.push({ to: e.to, text: e.text })
    return { isDelivered: true }
  })
  on('ui.log', () => ({ value: undefined }))
  return {
    clock,
    stored,
    prompts,
    sent,
    /** What the session's own next Arlesh call answers. */
    answers: (next: string) => {
      answer = next
    },
    /** The state the server reports for `released` from now on. */
    serverSays: (next: string) => {
      status = next
    },
  }
}

async function start($: Parameters<Parameters<typeof test>[1]>[0], clock: ReturnType<typeof mock.clock>) {
  await $.session.start({ cwd: '/r', surface: null, isInteractive: false })
  await clock.advance(1)
  await clock.settle()
}

async function release(
  $: Parameters<Parameters<typeof test>[1]>[0],
  s: ReturnType<typeof session>,
  id: string,
  agentId?: string,
) {
  s.answers(releaseResult(id))
  await $.tool.call({
    tool: 'mcp__Arlesh__arlesh_waits',
    operation: 'release',
    id,
    ...(agentId === undefined ? {} : { agentId }),
  })
}

const bookOf = (stored: Record<string, unknown>) => revive(stored['watch:s1'])

test('a wait the session releases itself is not notified, the call coming before the poll', async ($, on) => {
  const s = session(on, ['w1'], { 'w1-full': watched('w1') })

  await release($, s, 'w1')
  await start($, s.clock)

  expect(s.prompts).toEqual([])
  expect(bookOf(s.stored)['w1-full']).toMatchObject({ status: 'released' })
  expect(bookOf(s.stored)['w1-full']?.owed).toBeUndefined()
})

test('a wait the session releases itself is not notified, the poll coming before the call', async ($, on) => {
  const s = session(on, ['w1'], { 'w1-full': watched('w1') })
  // The turn is running, so the change the poll recorded stays owed until the call's result arrives.
  await $.turn.start({ turnId: 't' })
  await start($, s.clock)
  expect(bookOf(s.stored)['w1-full']?.owed).toEqual(['released'])

  await release($, s, 'w1')
  await $.turn.complete({ turnId: 't', answer: 'done' })
  await s.clock.settle()

  expect(s.prompts).toEqual([])
  expect(bookOf(s.stored)['w1-full']?.owed).toBeUndefined()
})

test('a release by someone else still notifies, and the next one after an own release too', async ($, on) => {
  const s = session(on, ['w1', 'w2'], { 'w1-full': watched('w1'), 'w2-full': watched('w2') })

  await release($, s, 'w1')
  await start($, s.clock)

  expect(s.prompts).toEqual([
    'Arlesh notification: wait w2 on Task 9a1 changed (released); read it with `arlesh_waits.get`.',
  ])
})

test('a mixed batch delivers the foreign change and not the own one', async ($, on) => {
  const s = session(on, ['w1', 'w2', 'w3'], {
    'w1-full': watched('w1'),
    'w2-full': watched('w2'),
    'w3-full': watched('w3'),
  })

  await release($, s, 'w2')
  await start($, s.clock)

  expect(s.prompts).toHaveLength(1)
  expect(s.prompts[0]).toContain('2 waits changed: wait w1 on Task 9a1 (released), wait w3 on Task 9a1 (released)')
})

test('a foreign change to a wait after the own release notifies', async ($, on) => {
  const s = session(on, ['w1'], { 'w1-full': watched('w1') })
  await release($, s, 'w1')
  // Someone reopens it: the book saw it released, so a reopening is owed.
  s.serverSays('pending')
  await start($, s.clock)

  expect(s.prompts).toEqual([
    'Arlesh notification: wait w1 on Task 9a1 changed (reopened); read it with `arlesh_waits.get`.',
  ])
})

test('a sub-agent releasing its own wait is not notified', async ($, on) => {
  const s = session(on, ['w1'], { 'w1-full': watched('w1', { via: via('a1') }) }, [running('a1')])

  await release($, s, 'w1', 'a1')
  await start($, s.clock)

  expect(s.sent).toEqual([])
  expect(s.prompts).toEqual([])
})

test('a sub-agent releasing a wait the session watches notifies the session', async ($, on) => {
  const s = session(on, ['w1'], { 'w1-full': watched('w1') }, [running('a1')])

  await release($, s, 'w1', 'a1')
  await start($, s.clock)

  expect(s.prompts).toHaveLength(1)
})

test('the session releasing a wait a running sub-agent raised notifies that sub-agent', async ($, on) => {
  const s = session(on, ['w1'], { 'w1-full': watched('w1', { via: via('a1') }) }, [running('a1')])

  await release($, s, 'w1')
  await start($, s.clock)

  expect(s.sent).toHaveLength(1)
  expect(s.sent[0]?.to).toBe('a1')
})
