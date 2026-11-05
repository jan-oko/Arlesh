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
