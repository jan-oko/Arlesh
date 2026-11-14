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
  const intercept: { answer?: (args: Record<string, unknown>) => Answer | undefined } = {}
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
    const special = intercept.answer?.(e.args)
    if (special !== undefined) return special
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
  return { calls, stored, intercept }
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

test('a subagent\'s Arlesh call reaches the server with its own sub_token, whatever it passed; the session\'s carries none', async ($, on) => {
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

  expect(seen.map((call) => call['sub_token'])).toEqual(['q3H', undefined, 'q3H'])
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

test('a subagent still known resumes and is not registered again, so its token is not rotated', async ($, on) => {
  const { calls } = session(on, [subagent('a1')])
  await attach($)
  await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'general-purpose' })

  await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'general-purpose' })

  expect(calls.filter((call) => call.args['operation'] === 'register_child')).toHaveLength(1)
})

test('a subagent whose record was lost registers again and is handed the new sub-token', async ($, on) => {
  const { calls, stored } = session(on, [subagent('a1')])
  await attach($)
  await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'general-purpose' })
  delete stored['children:s1']

  const again = await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'general-purpose' })

  expect(calls.filter((call) => call.args['operation'] === 'register_child')).toHaveLength(2)
  expect(calls.filter((call) => call.args['operation'] === 'resume')).toEqual([])
  expect(again.additionalContext?.join('\n')).toContain('sub_token: "q3H"')
  expect(stored['children:s1']).toMatchObject({ a1: { subToken: 'q3H' } })
})

test('a child the server removed (its Task was set Done) is registered afresh when the subagent starts again', async ($, on) => {
  const gone: Answer = { value: { content: [], isError: true, structuredContent: { kind: 'not_permitted', message: 'the sub_token names no child agent of this session' } } }
  const { calls, intercept } = session(on, [subagent('a1')])
  let removed = false
  intercept.answer = (args) => {
    if (!removed) return undefined
    if (args['operation'] === 'resume') return gone
    return args['operation'] === 'register_child' ? ok(identity({ sub_token: 'fresh' })) : undefined
  }
  await attach($)
  await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'general-purpose' })
  removed = true

  const again = await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'general-purpose' })

  expect(calls.filter((call) => call.args['operation'] === 'register_child')).toHaveLength(2)
  expect(again.additionalContext?.join('\n')).toContain('sub_token: "fresh"')
})

const LABEL = 'Fix CI · 077 Subagents: register under th…'
const TASK = { task: { short_id: '077', title: 'Subagents: register under the parent agent, claim a subtask' } }
const spawnArgs = (description: string, prompt: string) =>
  ({ tool_use_id: 'tu1', prompt, description, subagentType: 'general-purpose' }) as never

/** A session whose Agent calls the bottom sees, and whose `get` and `register_child` answers are the given. */
function marked(on: On, agents: AgentInfo[], registered: () => Answer | undefined, get: () => Answer = () => ok(TASK), settles = true) {
  const world = session(on, agents)
  const spawns: Array<{ description: string; prompt: string }> = []
  on('agent.spawn', (_, e) => {
    spawns.push({ description: e.description, prompt: e.prompt })
    return settles ? { model: 'm', agentId: agents[0]?.id ?? 'a1' } : { model: 'm' }
  })
  world.intercept.answer = (args) => {
    if (args['operation'] === 'get') return get()
    return args['operation'] === 'register_child' ? registered() : undefined
  }
  return { ...world, spawns }
}

const holding = () =>
  ok(identity({ agent: { id: 12, name: 'Fix CI', claim: { status: 'active' } }, standing: 'active', sub_token: 'q3H', claim_name: '077 Subagents: register under the parent agent' }))
const registeredOnly = (refused?: string) => () =>
  ok(identity({ agent: { id: 12, name: 'Fix CI', claim: null }, sub_token: 'q3H', ...(refused === undefined ? {} : { claim_refused: refused }) }))

test('a marker in the Agent call labels the subagent with its Task and its child is registered holding it', async ($, on) => {
  const { calls, spawns } = marked(on, [subagent('a1', { description: LABEL })], holding)
  await attach($)

  await $.agent.spawn(spawnArgs('Fix CI [arlesh:077]', 'Do the work.'))
  const started = await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'general-purpose' })

  expect(spawns).toEqual([{ description: LABEL, prompt: 'Do the work.' }])
  const registered = calls.find((call) => call.args['operation'] === 'register_child')
  expect(registered?.args).toEqual({
    operation: 'register_child',
    name: 'Fix CI',
    client_id: 'a1',
    subtree: { node_type: 'task', node_id: '077' },
  })
  const context = started.additionalContext?.join('\n') ?? ''
  expect(context).toContain('already hold your Claim, 077 Subagents')
  expect(context).toContain('do not call `arlesh_agents.claim`')
})

test('the Task is found by the label when the subagent starts before the spawn has settled', async ($, on) => {
  const { calls } = marked(on, [subagent('a1', { description: LABEL })], holding, () => ok(TASK), false)
  await attach($)
  await $.agent.spawn(spawnArgs('Fix CI [arlesh:077]', 'go'))

  await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'general-purpose' })

  const registered = calls.find((call) => call.args['operation'] === 'register_child')
  expect(registered?.args['subtree']).toEqual({ node_type: 'task', node_id: '077' })
})

test('a Claim the server refuses leaves the child registered and the subagent told to claim, with the reason', async ($, on) => {
  const { stored } = marked(on, [subagent('a1', { description: LABEL })], registeredOnly('overlaps the active claim of agent sibling'))
  await attach($)
  await $.agent.spawn(spawnArgs('Fix CI [arlesh:077]', 'go'))

  const started = await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'general-purpose' })

  const context = started.additionalContext?.join('\n') ?? ''
  expect(context).toContain('could not be claimed for you (overlaps the active claim of agent sibling)')
  expect(context).toContain('First claim the Task your brief names')
  expect(stored['children:s1']).toMatchObject({ a1: { childId: 12, subToken: 'q3H' } })
  expect(JSON.stringify(stored['children:s1'])).not.toContain('claimName')
})

test('without a marker the call is unchanged and the child is registered unclaimed', async ($, on) => {
  const { calls, spawns } = marked(on, [subagent('a1')], registeredOnly())
  await attach($)

  await $.agent.spawn(spawnArgs('Fix CI', 'Do the work.'))
  const started = await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'general-purpose' })

  expect(spawns).toEqual([{ description: 'Fix CI', prompt: 'Do the work.' }])
  expect(calls.find((call) => call.args['operation'] === 'register_child')?.args['subtree']).toBeUndefined()
  expect(started.additionalContext?.join('\n')).toContain('First claim the Task your brief names')
})

test('a repeated or malformed marker counts as none and the call is left as it was', async ($, on) => {
  const { calls, spawns } = marked(on, [subagent('a1')], registeredOnly())
  await attach($)

  await $.agent.spawn(spawnArgs('Fix CI [arlesh:077]', 'and again [arlesh:077]'))
  await $.agent.spawn(spawnArgs('Fix CI [arlesh:7]', 'x'))

  expect(spawns).toEqual([
    { description: 'Fix CI [arlesh:077]', prompt: 'and again [arlesh:077]' },
    { description: 'Fix CI [arlesh:7]', prompt: 'x' },
  ])
  expect(calls.filter((call) => call.args['operation'] === 'get')).toEqual([])
})

test('a Task the mod cannot read loses only its marker and the child is registered unclaimed', async ($, on) => {
  const failed: Answer = { value: { content: [], isError: true, structuredContent: { kind: 'not_permitted', message: 'no' } } }
  const { calls, spawns } = marked(on, [subagent('a1', { description: 'Fix CI' })], registeredOnly(), () => failed)
  await attach($)

  await $.agent.spawn(spawnArgs('Fix CI [arlesh:077]', 'go'))
  await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'general-purpose' })

  expect(spawns).toEqual([{ description: 'Fix CI', prompt: 'go' }])
  expect(calls.find((call) => call.args['operation'] === 'register_child')?.args['subtree']).toBeUndefined()
})

test('a resumed subagent keeps its label and its child: nothing is rewritten, registered or claimed again', async ($, on) => {
  const { calls, spawns } = marked(on, [subagent('a1', { description: LABEL })], holding)
  await attach($)
  await $.agent.spawn(spawnArgs('Fix CI [arlesh:077]', 'go'))
  await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'general-purpose' })

  await $.agent.spawn({ ...(spawnArgs('again [arlesh:077]', 'more') as object), resume: { agentId: 'a1' } } as never)
  await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'general-purpose' })

  expect(spawns[1]).toEqual({ description: 'again [arlesh:077]', prompt: 'more' })
  expect(calls.filter((call) => call.args['operation'] === 'register_child')).toHaveLength(1)
  expect(calls.filter((call) => call.args['operation'] === 'resume')).toHaveLength(1)
})

test('a claim or release made inside a subagent with no child of its own is denied, anything else is not', async ($, on) => {
  const { calls } = session(on, [subagent('a9')])
  on('tool.call', () => ({ result: '{}' }))
  await attach($)

  const claim = await $.tool.call({ tool: 'mcp__arlesh__arlesh_agents', operation: 'claim', agentId: 'a9' })
  const release = await $.tool.call({ tool: 'mcp__arlesh__arlesh_agents', operation: 'release', agentId: 'a9' })
  const status = await $.tool.call({ tool: 'mcp__arlesh__arlesh_agents', operation: 'status', agentId: 'a9' })
  const own = await $.tool.call({ tool: 'mcp__arlesh__arlesh_agents', operation: 'claim', agentId: 'a9', sub_token: 'x' })
  const session_ = await $.tool.call({ tool: 'mcp__arlesh__arlesh_agents', operation: 'claim' })

  expect(claim.deny).toContain('no child agent of its own')
  expect(release.deny).toContain('no child agent of its own')
  expect(status.deny).toBeUndefined()
  expect(own.deny).toBeUndefined()
  expect(session_.deny).toBeUndefined()
  expect(calls.filter((call) => call.args['operation'] === 'claim')).toEqual([])
})

test('a subagent that has a child may claim: its call carries the sub-token', async ($, on) => {
  session(on, [subagent('a1')])
  const seen: Array<Record<string, unknown>> = []
  on('tool.call', (_, e) => {
    seen.push({ ...e })
    return { result: '{}' }
  })
  await attach($)
  await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'general-purpose' })

  const claim = await $.tool.call({ tool: 'mcp__arlesh__arlesh_agents', operation: 'claim', agentId: 'a1' })

  expect(claim.deny).toBeUndefined()
  expect(seen.at(-1)?.['sub_token']).toBe('q3H')
})

test('a marker written in the prompt names the Task too, and is taken out of it', async ($, on) => {
  const { spawns } = marked(on, [subagent('a1', { description: LABEL })], holding)
  await attach($)

  await $.agent.spawn(spawnArgs('Fix CI', 'Work on [arlesh:077] today.'))

  expect(spawns).toEqual([{ description: LABEL, prompt: 'Work on today.' }])
})
