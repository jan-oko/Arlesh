import { expect, mock, test } from 'claude-code/testing'

import { MAX_ATTEMPTS, revive } from './book'

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

const releasedAnswer = (ids: string[]) => ({
  value: {
    structuredContent: {
      waits: ids.map((id) => ({ wait_id: `${id}-full`, short_id: id, task_short_id: '9a1', status: 'released' })),
    },
  },
})

/**
 * A session attached to a server that, on its first poll, says the given waits were released, and
 * holds every poll after it. `submits` answers each `prompt.submit` in turn; the last answer stays.
 * `enterTurn` starts the main loop's turn when a prompt enters, as the host does.
 */
function session(
  on: Hooks,
  released: string[],
  waits: Record<string, unknown>,
  submits: Array<'enter' | 'drop' | 'reject'>,
  agents: unknown[] = [],
  enterTurn?: (turnId: string) => Promise<unknown>,
) {
  const clock = mock.clock(on)
  const stored: Record<string, unknown> = { 'watch:s1': waits, 'agent:s1': { token: 't' } }
  const prompts: string[] = []
  const transcript: string[] = []
  const debug: string[] = []
  let attempts = 0
  let polled = false
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
  on('mcp.call', () => releasedAnswer(released))
  on('http.fetch', async () => {
    const first = !polled
    polled = true
    if (!first) await clock.sleep(25_000)
    return {
      value: {
        status: 200,
        ok: true,
        headers: {},
        text: JSON.stringify({ revision: 1, epoch: 'e', changes: [], reset: first }),
      },
    }
  })
  on('prompt.submit', async (_, e) => {
    const how = submits[Math.min(attempts, submits.length - 1)]
    attempts += 1
    if (how === 'reject') throw new Error('not now')
    if (how === 'drop') return { drop: 'a Stop stands' }
    prompts.push(e.text)
    // The host starts a turn from a prompt that enters; the test's own `$` drives it, as the hook's has no `turn`.
    if (enterTurn !== undefined) await enterTurn(`t${attempts}`)
    return { text: e.text }
  })
  on('ui.log', (_, e) => {
    ;(e.to === 'debug' ? debug : transcript).push(e.text)
    return { value: undefined }
  })
  return { clock, stored, prompts, transcript, debug, attempts: () => attempts }
}

async function start($: Parameters<Parameters<typeof test>[1]>[0], clock: ReturnType<typeof mock.clock>) {
  await $.session.start({ cwd: '/r', surface: null, isInteractive: false })
  await clock.advance(1)
  await clock.settle()
}

async function pollRounds(clock: ReturnType<typeof mock.clock>, rounds: number) {
  for (let round = 0; round < rounds; round += 1) {
    await clock.advance(26_000)
    await clock.settle()
  }
}

const bookOf = (stored: Record<string, unknown>) => revive(stored['watch:s1'])

test('a prompt the host drops is not a delivery: the change stays owed and goes in on a later poll', async ($, on) => {
  const s = session(on, ['w1'], { 'w1-full': watched('w1') }, ['drop', 'enter'])

  await start($, s.clock)
  expect(s.prompts).toEqual([])
  expect(bookOf(s.stored)['w1-full']?.owed).toEqual(['released'])
  expect(s.debug.join('\n')).toContain('not delivered, dropped: a Stop stands')

  await pollRounds(s.clock, 1)
  expect(s.prompts).toEqual([
    'Arlesh notification: wait w1 on Task 9a1 changed (released); read it with `arlesh_waits.get`.',
  ])
  expect(bookOf(s.stored)['w1-full']?.owed).toBeUndefined()
})

test('a prompt that is rejected is retried the same way', async ($, on) => {
  const s = session(on, ['w1'], { 'w1-full': watched('w1') }, ['reject', 'enter'])

  await start($, s.clock)
  await pollRounds(s.clock, 1)

  expect(s.prompts).toHaveLength(1)
})

test('two waits released together are one message, and a dropped one is sent again whole', async ($, on) => {
  const s = session(on, ['w1', 'w2'], { 'w1-full': watched('w1'), 'w2-full': watched('w2') }, ['drop', 'enter'])

  await start($, s.clock)
  await pollRounds(s.clock, 3)

  expect(s.prompts).toEqual([
    'Arlesh notification: 2 waits changed: wait w1 on Task 9a1 (released), wait w2 on Task 9a1 (released); ' +
      'read them with `arlesh_waits.get_many`.',
  ])
})

test('a delivered change is never sent again', async ($, on) => {
  const s = session(on, ['w1'], { 'w1-full': watched('w1') }, ['enter'])

  await start($, s.clock)
  await pollRounds(s.clock, 3)
  await $.turn.complete({ reason: 'answer', answer: 'x', durationMs: 1, isAborted: false, turnId: 't' })
  await s.clock.settle()

  expect(s.prompts).toHaveLength(1)
})

test('the session going idle delivers what is owed without waiting for a poll', async ($, on) => {
  const s = session(on, ['w1'], { 'w1-full': watched('w1') }, ['drop', 'enter'])

  await start($, s.clock)
  expect(s.prompts).toEqual([])
  await $.turn.complete({ reason: 'answer', answer: 'x', durationMs: 1, isAborted: true, turnId: 't' })
  await s.clock.settle()

  expect(s.prompts).toHaveLength(1)
})

test('a change owed from an earlier run is delivered when the session starts', async ($, on) => {
  const s = session(on, [], { 'w1-full': watched('w1', { status: 'released', owed: ['released'] }) }, ['enter'])

  await start($, s.clock)

  expect(s.prompts).toHaveLength(1)
  expect(bookOf(s.stored)['w1-full']?.owed).toBeUndefined()
})

test('a notification given up on is said in the transcript, and then no more is tried', async ($, on) => {
  const s = session(on, ['w1'], { 'w1-full': watched('w1') }, ['drop'])

  await start($, s.clock)
  await pollRounds(s.clock, MAX_ATTEMPTS + 3)

  expect(s.attempts()).toBe(MAX_ATTEMPTS)
  expect(s.transcript.join('\n')).toContain('gave up telling this session that wait w1')
  expect(bookOf(s.stored)['w1-full']?.owed).toBeUndefined()
})

test('a delivery to a sub-agent that is not taken goes to the session, naming the sub-agent', async ($, on) => {
  const s = session(
    on,
    ['w1'],
    { 'w1-full': watched('w1', { via: { agentId: 'a1', description: 'Fix CI' } }) },
    ['enter'],
    [{ id: 'a1', description: 'Fix CI', type: 'general-purpose', status: 'running' }],
  )
  on('session.send', () => ({ isDelivered: false, reason: 'the recipient is gone' }))

  await start($, s.clock)

  expect(s.prompts).toHaveLength(1)
  expect(s.prompts[0]).toContain('The sub-agent "Fix CI" raised it.')
})

test('a book stored before changes could be owed still reads, owing nothing', () => {
  const old = { 'w1-full': { waitId: 'w1-full', shortId: 'w1', taskShortId: '9a1', status: 'pending', archived: false, seenAt: 1 } }

  expect(revive(old)['w1-full']).toEqual(old['w1-full'])
  expect(revive({ 'w1-full': { ...old['w1-full'], owed: ['nonsense'], attempts: 'x' } })['w1-full']).toEqual(old['w1-full'])
})

const turnOver = { reason: 'answer', answer: 'x', durationMs: 1, isAborted: true, turnId: 't' } as const

test('a wait released while a turn runs is not submitted into it, and goes in once the turn is over, exactly once', async ($, on) => {
  // The host queues a prompt submitted mid-turn and discards it when the turn is stopped, resolving
  // as if it had entered: here every submit made while the turn runs vanishes that way.
  const s = session(on, ['w1'], { 'w1-full': watched('w1') }, ['enter'])
  await $.turn.start({ turnId: 't' })

  await start($, s.clock)
  await pollRounds(s.clock, 2)
  expect(s.attempts()).toBe(0)
  expect(bookOf(s.stored)['w1-full']?.owed).toEqual(['released'])

  await $.turn.complete(turnOver)
  await s.clock.settle()
  await pollRounds(s.clock, 2)

  expect(s.prompts).toHaveLength(1)
  expect(bookOf(s.stored)['w1-full']?.owed).toBeUndefined()
})

test('a batch released in one busy turn waits for the turn to end and goes in as one message', async ($, on) => {
  const s = session(on, ['w1', 'w2', 'w3'], { 'w1-full': watched('w1'), 'w2-full': watched('w2'), 'w3-full': watched('w3') }, ['enter'])
  await $.turn.start({ turnId: 't' })

  await start($, s.clock)
  expect(s.prompts).toEqual([])
  await $.turn.complete(turnOver)
  await s.clock.settle()

  expect(s.prompts).toHaveLength(1)
  expect(s.prompts[0]).toContain('3 waits changed')
  expect(bookOf(s.stored)['w1-full']?.owed).toBeUndefined()
})

test('an entry that owes two changes tells them in two flushes, as they are two events', async ($, on) => {
  const s = session(
    on,
    ['w1', 'w2'],
    { 'w1-full': watched('w1', { status: 'released', owed: ['released', 'reopened'] }), 'w2-full': watched('w2', { status: 'released', owed: ['released'] }) },
    ['enter'],
    [],
    (turnId) => $.turn.start({ turnId }),
  )

  await start($, s.clock)
  expect(s.prompts).toHaveLength(1)
  expect(s.prompts[0]).toContain('2 waits changed: wait w1 on Task 9a1 (released), wait w2 on Task 9a1 (released)')

  await $.turn.complete(turnOver)
  await s.clock.settle()

  expect(s.prompts).toHaveLength(2)
  expect(s.prompts[1]).toBe('Arlesh notification: wait w1 on Task 9a1 changed (reopened); read it with `arlesh_waits.get`.')
})

test('a failed message counts one attempt on each wait it carried', async ($, on) => {
  const s = session(on, ['w1', 'w2'], { 'w1-full': watched('w1'), 'w2-full': watched('w2') }, ['drop'])

  await start($, s.clock)

  expect(bookOf(s.stored)['w1-full']?.attempts).toBe(1)
  expect(bookOf(s.stored)['w2-full']?.attempts).toBe(1)
  expect(s.attempts()).toBe(1)
})

const via = (agentId: string) => ({ agentId, description: `Task of ${agentId}` })
const running = (id: string) => ({ id, description: `Task of ${id}`, type: 'general-purpose', status: 'running' })

test('the waits of two running sub-agents are one message each, to that sub-agent', async ($, on) => {
  const s = session(
    on,
    ['w1', 'w2', 'w3'],
    {
      'w1-full': watched('w1', { via: via('a1') }),
      'w2-full': watched('w2', { via: via('a1') }),
      'w3-full': watched('w3', { via: via('a2') }),
    },
    ['enter'],
    [running('a1'), running('a2')],
  )
  const sent: Array<{ to: unknown; text: string }> = []
  on('session.send', (_, e) => {
    sent.push({ to: e.to, text: e.text })
    return { isDelivered: true }
  })

  await start($, s.clock)

  expect(s.prompts).toEqual([])
  expect(sent.map((message) => message.to)).toEqual(['a1', 'a2'])
  expect(sent[0]?.text).toContain('2 waits changed: wait w1 on Task 9a1 (released), wait w2 on Task 9a1 (released)')
  expect(sent[1]?.text).toBe('Arlesh notification: wait w3 on Task 9a1 changed (released); read it with `arlesh_waits.get`.')
})

test('the entries of a sub-agent that does not take its message go to the session in the same flush, naming it', async ($, on) => {
  const s = session(
    on,
    ['w1', 'w2', 'w3'],
    {
      'w1-full': watched('w1', { via: via('a1') }),
      'w2-full': watched('w2', { via: via('a1') }),
      'w3-full': watched('w3'),
    },
    ['enter'],
    [running('a1')],
  )
  on('session.send', () => ({ isDelivered: false, reason: 'the recipient is gone' }))

  await start($, s.clock)

  expect(s.prompts).toHaveLength(1)
  expect(s.prompts[0]).toContain('3 waits changed')
  expect(s.prompts[0]).toContain('wait w1 on Task 9a1 (released — raised by the sub-agent "Task of a1")')
  expect(s.prompts[0]).toContain('wait w3 on Task 9a1 (released)')
  expect(s.prompts[0]).not.toContain('wait w3 on Task 9a1 (released — raised')
})
