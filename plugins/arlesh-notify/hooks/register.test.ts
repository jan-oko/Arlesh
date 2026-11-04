import { expect, mock, test } from 'claude-code/testing'

test('a wait asked in the session is recorded under the session, with the sub-agent that asked', async ($, on) => {
  const stored: Record<string, unknown> = {}
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
  on('tool.call', () => ({
    result: { structuredContent: { full_id: 'w-full', short_id: 'w1', status: 'pending', archival: 'live' } },
  }))

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
