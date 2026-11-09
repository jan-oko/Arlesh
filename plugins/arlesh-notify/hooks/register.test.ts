import { expect, mock, test } from 'claude-code/testing'

const asked = { full_id: 'w-full', short_id: 'w1', status: 'pending', archival: 'live' }

function storeTo(on: Parameters<typeof mock.clock>[0], stored: Record<string, unknown>) {
  mock.clock(on)
  on('store.get', (_, e) => ({ value: stored[e.key] }))
  on('store.set', (_, e) => {
    stored[e.key] = e.value
    return { value: undefined }
  })
  on('session.id', () => ({ value: 's1' }))
  on('agent.list', () => ({
    value: [{ id: 'a1', description: 'Fix CI', type: 'general-purpose', status: 'running', parentId: 'main-ish' }],
  }))
}

test('a wait asked in the session is recorded when the hook sees the result as the string the model reads', async ($, on) => {
  const stored: Record<string, unknown> = {}
  storeTo(on, stored)
  on('tool.call', () => ({ result: JSON.stringify(asked), text: JSON.stringify(asked) }))

  await $.tool.call({
    tool: 'mcp__Arlesh__arlesh_waits',
    operation: 'ask',
    task_id: '9a1',
    title: 'Which colour?',
    agentId: 'a1',
  })

  expect(stored['watch:s1']).toMatchObject({
    'w-full': { shortId: 'w1', taskShortId: '9a1', via: { agentId: 'a1', description: 'Fix CI' } },
  })
})

test('a wait is recorded from an object result too', async ($, on) => {
  const stored: Record<string, unknown> = {}
  storeTo(on, stored)
  on('tool.call', () => ({ result: { structuredContent: asked } }))

  await $.tool.call({ tool: 'mcp__Arlesh__arlesh_waits', operation: 'ask', task_id: '9a1', title: 'Which?' })

  expect(stored['watch:s1']).toMatchObject({ 'w-full': { shortId: 'w1', taskShortId: '9a1' } })
})

test('a call that failed records nothing', async ($, on) => {
  const stored: Record<string, unknown> = {}
  storeTo(on, stored)
  on('tool.call', () => ({ result: JSON.stringify(asked), text: JSON.stringify(asked), isError: true }))

  await $.tool.call({ tool: 'mcp__Arlesh__arlesh_waits', operation: 'ask', task_id: '9a1', title: 'Which?' })

  expect(stored['watch:s1']).toBeUndefined()
})

test('the poll loop survives the configuration failing to read, and recovers', async ($, on) => {
  const clock = mock.clock(on)
  let rootCalls = 0
  let fetches = 0
  on('session.start', () => ({ cwd: '/r' }))
  on('session.root', () => {
    rootCalls += 1
    if (rootCalls <= 2) throw new Error('no root yet')
    return { value: '/r' }
  })
  on('env.get', () => ({ value: '/home/u' }))
  on('fs.read', (_, e) =>
    e.path === '/r/.mcp.json'
      ? { value: JSON.stringify({ mcpServers: { arlesh: { url: 'http://127.0.0.1:4747/mcp' } } }) }
      : (() => {
          throw new Error('no such file')
        })(),
  )
  on('http.fetch', async () => {
    fetches += 1
    await clock.sleep(25_000) // the server holds the poll
    return {
      value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ revision: 1, epoch: 'e', changes: [], reset: true }) },
    }
  })
  on('store.get', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's1' }))

  await $.session.start({ cwd: '/r', surface: null, isInteractive: false })
  await clock.settle()
  expect(fetches).toBe(0)

  await clock.advance(1_000)
  await clock.settle()

  expect(rootCalls).toBeGreaterThan(2)
  expect(fetches).toBeGreaterThan(0)
})

test('a failing catch-up backs off and warns once, instead of polling every second', async ($, on) => {
  const clock = mock.clock(on)
  let fetches = 0
  const warnings: string[] = []
  const watched = { waitId: 'w-full', shortId: 'w1', taskShortId: '9a1', status: 'pending', archived: false, seenAt: 0 }
  on('session.start', () => ({ cwd: '/r' }))
  on('session.root', () => ({ value: '/r' }))
  on('env.get', () => ({ value: '/home/u' }))
  on('fs.read', (_, e) =>
    e.path === '/r/.mcp.json'
      ? { value: JSON.stringify({ mcpServers: { arlesh: { url: 'http://127.0.0.1:4747/mcp' } } }) }
      : (() => {
          throw new Error('no such file')
        })(),
  )
  let finished = false
  on('http.fetch', async () => {
    // The mod's loop outlives the test: from here the server holds each poll, as it does.
    if (finished) await clock.sleep(25_000)
    fetches += 1
    return {
      value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ revision: 1, epoch: 'e', changes: [], reset: true }) },
    }
  })
  on('store.get', () => ({ value: finished ? {} : { 'w-full': watched } }))
  on('session.id', () => ({ value: 's1' }))
  // No handler for `mcp.call`: the catch-up call fails, as it does when the session's MCP
  // connection has dropped.
  on('ui.log', (_, e) => {
    if (e.to !== 'debug') warnings.push(e.text)
    return { value: undefined }
  })

  await $.session.start({ cwd: '/r', surface: null, isInteractive: false })
  for (let second = 0; second < 60; second += 1) {
    await clock.advance(1_000)
    await clock.settle()
  }

  const polled = fetches
  finished = true
  await clock.advance(31_000)
  await clock.settle()
  expect(polled).toBeGreaterThan(3)
  expect(polled).toBeLessThan(10)
  expect(warnings).toEqual(['cannot reach Arlesh; notifications are paused and it keeps trying.'])
})
