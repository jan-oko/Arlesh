import type { AgentInfo } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

type Call = { tool: string; args: Record<string, unknown> }
type On = Parameters<typeof mock.clock>[0]
let clock: ReturnType<typeof mock.clock>

const ok = (structuredContent: unknown) => ({ value: { content: [], isError: false, structuredContent } })
type Answer = ReturnType<typeof ok>
const identity = (over: Record<string, unknown> = {}) => ({
  agent: { id: 12, name: 'helper' },
  standing: 'unclaimed',
  ...over,
})

/** An attached session with an Arlesh server, and a fake that answers `arlesh_agents`. */
function session(on: On, agents: AgentInfo[], stored: Record<string, unknown> = {}, pause: () => Answer = () => ok(identity({ standing: 'paused' }))) {
  const calls: Call[] = []
  clock = mock.clock(on)
  on('session.root', () => ({ value: '/r' }))
  on('session.cwd', () => ({ value: '/r' }))
  on('session.id', () => ({ value: 's1' }))
  on('env.get', () => ({ value: '/home/u' }))
  on('fs.read', (_, e) =>
    e.path === '/r/.mcp.json'
      ? { value: JSON.stringify({ mcpServers: { arlesh: { url: 'http://127.0.0.1:4747/mcp' } } }) }
      : (() => {
          throw new Error('no such file')
        })(),
  )
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: '{}' } }))
  on('store.get', (_, e) => ({ value: e.key === 'agent:s1' ? { token: 'agent-token' } : stored[e.key] }))
  on('store.set', (_, e) => {
    stored[e.key] = e.value
    return { value: undefined }
  })
  on('agent.list', () => ({ value: agents }))
  on('ui.log', () => ({ value: undefined }))
  on('classic.SessionStart', () => ({}))
  on('classic.SubagentStart', () => ({}))
  on('mcp.call', (_, e) => {
    calls.push({ tool: e.tool, args: e.args })
    switch (e.args['operation']) {
      case 'attach':
        return ok(identity({ agent: { id: 7, name: 'orchestrator' } }))
      case 'register_child':
        return ok(identity({ sub_token: 'q3H' }))
      case 'pause':
        return pause()
      default:
        return ok(identity({ standing: 'active', claim_name: '077 Subagents' }))
    }
  })
  return { calls, stored }
}

const subagent = (id: string, over: Partial<AgentInfo> = {}): AgentInfo => ({
  id,
  description: 'Fix CI',
  type: 'general-purpose',
  status: 'running',
  ...over,
})

const attach = async ($: { classic: { SessionStart: (e: { source: 'startup' }) => Promise<unknown> } }) => {
  await $.classic.SessionStart({ source: 'startup' })
}

test('a session that has not attached registers nothing for its subagents', async ($, on) => {
  const { calls } = session(on, [subagent('a1')])

  const started = await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'general-purpose' })

  expect(calls).toEqual([])
  expect(started.additionalContext ?? []).toEqual([])
})

test('a subagent is registered under its description and its id, and handed the sub-token', async ($, on) => {
  const { calls, stored } = session(on, [subagent('a1')])
  await attach($)

  const started = await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'general-purpose' })

  const registered = calls.find((call) => call.args['operation'] === 'register_child')
  expect(registered?.args).toEqual({ operation: 'register_child', name: 'Fix CI', client_id: 'a1' })
  expect(started.additionalContext?.join('\n')).toContain('sub_token: "q3H"')
  expect(stored['children:s1']).toMatchObject({ a1: { childId: 12, subToken: 'q3H', name: 'helper' } })
})

test('a resumed subagent resumes its claim and is told nothing more', async ($, on) => {
  const { calls } = session(on, [subagent('a1')])
  await attach($)
  await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'general-purpose' })

  const again = await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'general-purpose' })

  const resumed = calls.filter((call) => call.args['operation'] === 'resume')
  expect(resumed.map((call) => call.args['sub_token'])).toEqual(['q3H'])
  expect(calls.filter((call) => call.args['operation'] === 'register_child')).toHaveLength(1)
  expect(again.additionalContext ?? []).toEqual([])
})

test('a subagent that stops has its claim paused with the sub-token', async ($, on) => {
  const { calls } = session(on, [subagent('a1')])
  on('turn.complete', (_, e) => ({ text: e.answer }))
  await attach($)
  await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'general-purpose' })

  await $.turn.complete({ agentId: 'a1', reason: 'answer', answer: 'done', durationMs: 5, isAborted: false, turnId: 't1' })
  await clock.settle()

  const paused = calls.filter((call) => call.args['operation'] === 'pause')
  expect(paused.map((call) => call.args['sub_token'])).toEqual(['q3H'])
})

test('a pause the server refuses as a removed child drops the record', async ($, on) => {
  const gone: Answer = { value: { content: [], isError: true, structuredContent: { kind: 'not_permitted', message: 'the sub_token names no child agent of this session' } } }
  const { stored } = session(on, [subagent('a1')], {}, () => gone)
  on('turn.complete', (_, e) => ({ text: e.answer }))
  await attach($)
  await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'general-purpose' })

  await $.turn.complete({ agentId: 'a1', reason: 'answer', answer: 'done', durationMs: 5, isAborted: false, turnId: 't1' })
  await clock.settle()

  expect(stored['children:s1']).toEqual({})
})

test('a subagent\'s Arlesh call without a sub_token reaches the server with one, the session\'s does not', async ($, on) => {
  session(on, [subagent('a1')])
  const seen: Array<Record<string, unknown>> = []
  on('tool.call', (_, e) => {
    seen.push({ ...e })
    return { result: '{}' }
  })
  await attach($)
  await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'general-purpose' })

  await $.tool.call({ tool: 'mcp__arlesh__arlesh_snapshot', operation: 'load', agentId: 'a1' })
  await $.tool.call({ tool: 'mcp__arlesh__arlesh_snapshot', operation: 'load' })
  await $.tool.call({ tool: 'mcp__arlesh__arlesh_snapshot', operation: 'load', agentId: 'a1', sub_token: 'own' })

  expect(seen.map((call) => call['sub_token'])).toEqual(['q3H', undefined, 'own'])
})

test('a subagent started by a subagent is not registered and gets its ancestor\'s sub-token', async ($, on) => {
  const { calls, stored } = session(on, [subagent('a1'), subagent('b1', { parentId: 'a1', description: 'Nested' })])
  await attach($)
  await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'general-purpose' })

  const nested = await $.classic.SubagentStart({ agent_id: 'b1', agent_type: 'general-purpose' })

  expect(calls.filter((call) => call.args['operation'] === 'register_child')).toHaveLength(1)
  expect(nested.additionalContext?.join('\n')).toContain('sub_token: "q3H"')
  expect(stored['children:s1']).toMatchObject({ b1: { nested: true, subToken: 'q3H', childId: 12 } })
})

test('a teammate is not registered', async ($, on) => {
  const { calls } = session(on, [subagent('t1', { teammateId: 'scout@team' })])
  await attach($)

  await $.classic.SubagentStart({ agent_id: 't1', agent_type: 'scout' })

  expect(calls.filter((call) => call.args['operation'] === 'register_child')).toEqual([])
})

test('the subagent\'s Agent row gets a line naming its Task and whether its claim is active or paused', async ($, on) => {
  session(on, [subagent('a1')])
  on('agent.spawn', () => ({ model: 'm', agentId: 'a1' }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('tool.call', () => ({ result: JSON.stringify({ agent: { id: 12 }, standing: 'active', claim_name: '077 Subagents' }) }))
  await attach($)
  await $.agent.spawn({ tool_use_id: 'tu1', prompt: 'p', description: 'Fix CI', subagentType: 'general-purpose' } as never)
  await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'general-purpose' })
  await $.tool.call({ tool: 'mcp__arlesh__arlesh_agents', operation: 'claim', agentId: 'a1' })
  const row = { plugin: 'arlesh-notify', component: 'ToolUse', requestId: 'tu1', surface: 'terminal' } as const
  const props = { tool: 'Agent', tool_use_id: 'tu1', input: {}, isRunning: false, isErrored: false, isInterrupted: false }

  const active = await $.ui.mount({ ...row, props })
  expect((await active.find({ type: 'Text', text: /Arlesh/ }))?.text).toBe('Arlesh · 077 Subagents · Active')
  await active.unmount()
  await $.turn.complete({ agentId: 'a1', reason: 'answer', answer: 'done', durationMs: 5, isAborted: false, turnId: 't1' })
  await clock.settle()

  const paused = await $.ui.mount({ ...row, props })
  expect((await paused.find({ type: 'Text', text: /Arlesh/ }))?.text).toBe('Arlesh · 077 Subagents · Paused')
  await paused.unmount()
  const other = await $.ui.mount({ ...row, requestId: 'tu2', props: { ...props, tool: 'Bash', tool_use_id: 'tu2' } })
  expect(await other.find({ type: 'Text', text: /Arlesh/ })).toBeUndefined()
  await other.unmount()
})
