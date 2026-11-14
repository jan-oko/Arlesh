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
function session(on: On, agents: AgentInfo[], stored: Record<string, unknown> = {}, pause: () => Answer = () => ok(identity({ standing: 'paused' })), opts: { unattached?: boolean } = {}) {
  const calls: Call[] = []
  if (opts.unattached !== true) stored['agent:s1'] ??= { token: 'agent-token' }
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
  on('http.fetch', (_, e) =>
    e.url.includes('/agents/pin')
      ? opts.unattached === true
        ? { value: { status: 500, ok: false, headers: {}, text: 'no' } }
        : { value: { status: 200, ok: true, headers: {}, text: '{"pin":"1234"}' } }
      : { value: { status: 200, ok: true, headers: {}, text: '{}' } },
  )
  on('store.get', (_, e) => ({ value: stored[e.key] }))
  on('store.set', (_, e) => {
    // As the engine: a value must be JSON data, and undefined is not.
    if (e.value === undefined) throw new Error('$.store.set: value is not JSON data (undefined)')
    stored[e.key] = e.value
    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    delete stored[e.key]
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

test('on the terminal the line is indented to the text of the result below it, on other surfaces it is not', async ($, on) => {
  session(on, [subagent('a1')])
  on('agent.spawn', () => ({ model: 'm', agentId: 'a1' }))
  on('tool.call', () => ({ result: JSON.stringify({ agent: { id: 12 }, standing: 'active', claim_name: '077 Subagents' }) }))
  await attach($)
  await $.agent.spawn(spawnArgs('Fix CI', 'go'))
  await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'general-purpose' })
  await $.tool.call({ tool: 'mcp__arlesh__arlesh_agents', operation: 'claim', agentId: 'a1' })
  const props = { tool: 'Agent', tool_use_id: 'tu1', input: {}, isRunning: false, isErrored: false, isInterrupted: false }

  for (const [surface, indent] of [['terminal', 5], ['desktop', 0]] as const) {
    const ui = await $.ui.mount({ plugin: 'arlesh-notify', component: 'ToolUse', requestId: 'tu1', surface, props })
    const row = await ui.find({ type: 'Box', text: /Arlesh/ })
    expect(JSON.stringify(row), surface).toContain(`"paddingLeft":${indent}`)
    expect((await ui.find({ type: 'Text', text: /Arlesh/ }))?.props).toEqual({ dimColor: true })
    await ui.unmount()
  }
})

// Re-attaching after the server forgot the session (a restart or a deploy).

const REFUSAL = { kind: 'not_permitted', message: 'this session is not attached: call arlesh_agents.attach with a PIN (or an agent token) first' }
const refused = { result: JSON.stringify(REFUSAL), text: JSON.stringify(REFUSAL), isError: true as const }
const attaches = (calls: Call[]) => calls.filter((call) => call.args['operation'] === 'attach')

/** A tool.call bottom that refuses the first `times` calls as not attached, then answers. */
function refusesFirst(on: On, times: number, seen: Array<Record<string, unknown>> = []) {
  let left = times
  on('tool.call', (_, e) => {
    seen.push({ ...e })
    if (left > 0) {
      left -= 1
      return refused
    }
    return { result: JSON.stringify({ tasks: [] }), text: '{"tasks":[]}' }
  })
  return seen
}

test('a call the server turns away as not attached re-attaches with the stored token and runs again, so the model sees the real answer', async ($, on) => {
  const { calls } = session(on, [])
  const seen = refusesFirst(on, 1)
  await attach($)

  const answered = await $.tool.call({ tool: 'mcp__arlesh__arlesh_snapshot', operation: 'load' })

  expect(seen).toHaveLength(2)
  expect(answered.isError).not.toBe(true)
  expect(answered.text).toBe('{"tasks":[]}')
  expect(attaches(calls).map((call) => call.args['token'])).toEqual(['agent-token', 'agent-token'])
})

test('an arlesh_agents call is recovered the same way', async ($, on) => {
  const { calls } = session(on, [])
  const seen = refusesFirst(on, 1)
  await attach($)

  const status = await $.tool.call({ tool: 'mcp__arlesh__arlesh_agents', operation: 'status' })

  expect(status.isError).not.toBe(true)
  expect(seen).toHaveLength(2)
  expect(attaches(calls)).toHaveLength(2)
})

test('a refused attach call is not retried: the attach is the way back in', async ($, on) => {
  const { calls } = session(on, [])
  const seen = refusesFirst(on, 5)
  await attach($)

  const attach_ = await $.tool.call({ tool: 'mcp__arlesh__arlesh_agents', operation: 'attach', token: 'agent-token' })

  expect(attach_.isError).toBe(true)
  expect(seen).toHaveLength(1)
  expect(attaches(calls)).toHaveLength(1)
})

test('a token the server refuses falls back to the PIN door, and the new token is kept', async ($, on) => {
  const { calls, stored, intercept } = session(on, [])
  refusesFirst(on, 1)
  await attach($)
  intercept.answer = (args) =>
    args['operation'] === 'attach' && args['token'] !== undefined
      ? { value: { content: [], isError: true, structuredContent: { kind: 'not_permitted', message: 'that agent token is not valid: attach again with a PIN' } } }
      : args['operation'] === 'attach'
        ? ok(identity({ agent: { id: 9, name: 'orchestrator' }, token: 'fresh' }))
        : undefined

  const answered = await $.tool.call({ tool: 'mcp__arlesh__arlesh_snapshot', operation: 'load' })

  expect(answered.isError).not.toBe(true)
  expect(attaches(calls).at(-1)?.args['pin']).toBe('1234')
  expect(stored['agent:s1']).toMatchObject({ token: 'fresh' })
})

test('a call that is still refused after the re-attach is returned as it is, not run a third time', async ($, on) => {
  session(on, [])
  const seen = refusesFirst(on, 5)
  await attach($)

  const answered = await $.tool.call({ tool: 'mcp__arlesh__arlesh_snapshot', operation: 'load' })

  expect(answered.isError).toBe(true)
  expect(seen).toHaveLength(2)
})

test('a subagent keeps working after the re-attach: its call still carries its sub-token', async ($, on) => {
  session(on, [subagent('a1')])
  const seen = refusesFirst(on, 1)
  await attach($)
  await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'general-purpose' })

  const answered = await $.tool.call({ tool: 'mcp__arlesh__arlesh_snapshot', operation: 'load', agentId: 'a1' })

  expect(answered.isError).not.toBe(true)
  expect(seen.map((call) => call['sub_token'])).toEqual(['q3H', 'q3H'])
})

// The session ends.

const ended = (reason: 'prompt_input_exit' | 'logout' | 'other' | 'clear' | 'resume') =>
  ({ reason, sessionId: 's1', resume: { id: 's1' } }) as const
const pauses = (calls: Call[]) => calls.filter((call) => call.args['operation'] === 'pause')

test('a session that ends pauses its own claim, so another session may take the subtree', async ($, on) => {
  const { calls } = session(on, [])
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await attach($)

  await $.session.end(ended('prompt_input_exit'))

  expect(pauses(calls)).toEqual([{ tool: 'arlesh_agents', args: { operation: 'pause' } }])
})

test('a /clear or a switch of session does not pause: the process goes on over the same connection', async ($, on) => {
  const { calls } = session(on, [])
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await attach($)

  await $.session.end(ended('clear'))
  await $.session.end(ended('resume'))

  expect(pauses(calls)).toEqual([])
})

test('a session that never attached pauses nothing when it ends', async ($, on) => {
  const { calls } = session(on, [], {}, undefined, { unattached: true })
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await attach($)

  await $.session.end(ended('other'))

  expect(pauses(calls)).toEqual([])
})

test('a returning session resumes the claim its last one left paused', async ($, on) => {
  const { calls, intercept } = session(on, [])
  intercept.answer = (args) =>
    args['operation'] === 'attach'
      ? ok(identity({ agent: { id: 7, name: 'orchestrator', claim: { status: 'paused', root: { node_kind: 'project', node_id: 1 } } } }))
      : args['operation'] === 'resume'
        ? ok(identity({ agent: { id: 7, name: 'orchestrator', claim: { status: 'active' } }, standing: 'active' }))
        : undefined

  const started = await $.classic.SessionStart({ source: 'resume' })

  expect(calls.filter((call) => call.args['operation'] === 'resume')).toHaveLength(1)
  expect(started.additionalContext?.join('\n')).not.toContain('could not be resumed')
})

test('a claim that cannot be resumed because someone else holds the subtree is said in the context', async ($, on) => {
  const { intercept } = session(on, [])
  intercept.answer = (args) =>
    args['operation'] === 'attach'
      ? ok(identity({ agent: { id: 7, name: 'orchestrator', claim: { status: 'paused' } } }))
      : args['operation'] === 'resume'
        ? { value: { content: [], isError: true, structuredContent: { kind: 'not_permitted', message: 'the subtree overlaps the active claim of agent other' } } }
        : undefined

  const started = await $.classic.SessionStart({ source: 'resume' })

  expect(started.additionalContext?.join('\n')).toContain(
    'paused when the last session ended and could not be resumed: the subtree overlaps the active claim of agent other',
  )
})

// A session the model attached by hand.

const byHand = (over: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  result: JSON.stringify(identity({ agent: { id: 7, name: 'hand', claim: null }, ...extra })),
  ...over,
})

test('an attach by PIN made by the model is adopted: the token is kept and subagents get children', async ($, on) => {
  const { calls, stored } = session(on, [subagent('a1')], {}, undefined, { unattached: true })
  on('tool.call', () => byHand({}, { token: 'handtok' }))
  await attach($)

  await $.tool.call({ tool: 'mcp__arlesh__arlesh_agents', operation: 'attach', pin: '4321', session_id: 's1' })
  const started = await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'general-purpose' })

  expect(stored['agent:s1']).toMatchObject({ token: 'handtok' })
  expect(calls.filter((call) => call.args['operation'] === 'register_child')).toHaveLength(1)
  expect(started.additionalContext?.join('\n')).toContain('sub_token: "q3H"')
})

test('an attach by token made by the model is adopted with the token it presented', async ($, on) => {
  const { stored } = session(on, [], {}, undefined, { unattached: true })
  on('tool.call', () => byHand({}))
  await attach($)

  await $.tool.call({ tool: 'mcp__arlesh__arlesh_agents', operation: 'attach', token: 'presented', session_id: 's1' })

  expect(stored['agent:s1']).toMatchObject({ token: 'presented' })
})

test('an attach that rebinds the session to another agent forgets the children of the old one', async ($, on) => {
  const { stored } = session(on, [subagent('a1')], {}, undefined, { unattached: true })
  let id = 7
  on('tool.call', () => ({ result: JSON.stringify(identity({ agent: { id, name: `agent-${id}`, claim: null } })) }))
  await attach($)
  await $.tool.call({ tool: 'mcp__arlesh__arlesh_agents', operation: 'attach', token: 'one', session_id: 's1' })
  await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'general-purpose' })
  expect(Object.keys(stored['children:s1'] as object)).toEqual(['a1'])

  await $.tool.call({ tool: 'mcp__arlesh__arlesh_agents', operation: 'attach', token: 'one', session_id: 's1' })
  expect(Object.keys(stored['children:s1'] as object)).toEqual(['a1'])
  id = 8
  await $.tool.call({ tool: 'mcp__arlesh__arlesh_agents', operation: 'attach', token: 'two', session_id: 's1' })

  expect(stored['children:s1']).toEqual({})
  expect(stored['agent:s1']).toMatchObject({ token: 'two' })
})

test('an attach the server refused, or one made inside a subagent, is not adopted', async ($, on) => {
  const { stored } = session(on, [subagent('a1')], {}, undefined, { unattached: true })
  on('tool.call', (_, e) =>
    e.agentId === undefined
      ? { result: JSON.stringify(REFUSAL), text: JSON.stringify(REFUSAL), isError: true }
      : byHand({}, { token: 'nope' }),
  )
  await attach($)

  await $.tool.call({ tool: 'mcp__arlesh__arlesh_agents', operation: 'attach', pin: 'bad', session_id: 's1' })

  expect(stored['agent:s1']).toBeUndefined()
})

// What a subagent with no child of its own may not do as the session.

const GUARDED = ['claim', 'release', 'pause', 'resume', 'attach', 'lock', 'unlock', 'report_usage', 'register_child'] as const

for (const operation of GUARDED) {
  test(`${operation} from a subagent with no child of its own is denied, with a child it carries the sub-token`, async ($, on) => {
    const { calls } = session(on, [subagent('a1'), subagent('a9')])
    const seen: Array<Record<string, unknown>> = []
    on('tool.call', (_, e) => {
      seen.push({ ...e })
      return { result: '{}' }
    })
    await attach($)
    await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'general-purpose' })
    const before = calls.length

    const orphan = await $.tool.call({ tool: 'mcp__arlesh__arlesh_agents', operation, agentId: 'a9' })
    const own = await $.tool.call({ tool: 'mcp__arlesh__arlesh_agents', operation, agentId: 'a1' })
    const session_ = await $.tool.call({ tool: 'mcp__arlesh__arlesh_agents', operation })

    expect(orphan.deny).toContain(`\`${operation}\` here would run as the session`)
    expect(own.deny).toBeUndefined()
    expect(seen.filter((call) => call['agentId'] === 'a1').map((call) => call['sub_token'])).toEqual(['q3H'])
    expect(session_.deny).toBeUndefined()
    expect(calls.length).toBe(before)
  })
}

test('status from a subagent with no child of its own still runs: it only reads', async ($, on) => {
  session(on, [subagent('a9')])
  on('tool.call', () => ({ result: '{}' }))
  await attach($)

  const status = await $.tool.call({ tool: 'mcp__arlesh__arlesh_agents', operation: 'status', agentId: 'a9' })

  expect(status.deny).toBeUndefined()
})

test('a subagent that passes a sub-token of its own is left to the server', async ($, on) => {
  session(on, [subagent('a9')])
  on('tool.call', () => ({ result: '{}' }))
  await attach($)

  const lock = await $.tool.call({ tool: 'mcp__arlesh__arlesh_agents', operation: 'lock', agentId: 'a9', sub_token: 'x' })

  expect(lock.deny).toBeUndefined()
})
