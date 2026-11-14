import { expect, test } from 'claude-code/testing'

import { KEEP_MS, forget, prune, remember, revive, type Entry } from './book'
import {
  agentName,
  attachArguments,
  attachedFrom,
  contextBlock,
  doorPort,
  doorUrl,
  isLoopback,
  isNotAttached,
  parseClaim,
  parsePin,
  reportedFrom,
  shouldReport,
  usageWindows,
} from './attach'
import { expandVariables, mainCheckoutOf, originOf, pickServer, projectServers } from './config'
import { nextWait, parsePoll, pollUrl } from './poll'
import { currentFrom, currentFromChange, waitsFrom } from './results'
import { changeBetween, namesRaiser, notificationText, routeTo } from './rules'

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
  expect(notificationText(wait, 'released', { agentId: 'a1', description: 'Fix CI' }, false)).not.toContain(
    'sub-agent',
  )
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

test('the sub-agent is named whenever the pointer goes to anyone but it', () => {
  const via = { agentId: 'child', description: 'Fix CI' }

  expect(namesRaiser({ kind: 'session' }, via)).toBe(true)
  expect(namesRaiser({ kind: 'agent', agentId: 'parent', byProxy: true }, via)).toBe(true)
  expect(namesRaiser({ kind: 'agent', agentId: 'child', byProxy: false }, via)).toBe(false)
  expect(namesRaiser({ kind: 'session' }, undefined)).toBe(false)
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
    { arlesh: { type: 'http', url: 'https://box.example/mcp', headers: { Authorization: 'Bearer <token>' } } },
    { Arlesh: { url: 'http://127.0.0.1:4747/mcp' } },
  ])

  expect(found).toEqual({
    name: 'arlesh',
    url: 'https://box.example/mcp',
    headers: { Authorization: 'Bearer <token>' },
  })
  expect(pickServer([{ Arlesh: { command: 'npx' } }])).toBeUndefined()
})

test('the long poll is on the origin of /mcp, and resumes from the cursor', () => {
  expect(originOf('http://127.0.0.1:4747/mcp')).toBe('http://127.0.0.1:4747')
  expect(originOf('https://box.example/arlesh/mcp/')).toBe('https://box.example/arlesh')
  expect(pollUrl('http://h', undefined, 25)).toBe('http://h/events/expectations?agentic=true&wait=25')
  expect(pollUrl('http://h', { revision: 7, epoch: 'a b' }, 5)).toBe(
    'http://h/events/expectations?agentic=true&after=7&epoch=a%20b&wait=5',
  )
})

test('a poll answer is read with its changes, its reset and its cursor', () => {
  const change = { wait_id: 'w', short_id: 's', task_short_id: 't', status: 'released', archived: false }

  expect(parsePoll(JSON.stringify({ revision: 3, epoch: 'e', changes: [change, { nonsense: 1 }] }))).toEqual({
    revision: 3,
    epoch: 'e',
    reset: false,
    changes: [{ waitId: 'w', state: { status: 'released', archived: false, shortId: 's', taskShortId: 't' } }],
  })
  expect(parsePoll('{"revision":1,"epoch":"e","changes":[],"reset":true}')?.reset).toBe(true)
  expect(parsePoll('{"revision":"1","epoch":"e"}')).toBeUndefined()
  expect(parsePoll('<html>')).toBeUndefined()
})

test('the wait halves on a timeout-like failure before the server could answer, to a floor', () => {
  const timeout = new Error('Request timed out')

  expect(nextWait(25, timeout, 10_000)).toBe(12)
  expect(nextWait(12, timeout, 3_000)).toBe(6)
  expect(nextWait(6, timeout, 1_000)).toBe(5)
  expect(nextWait(5, timeout, 1_000)).toBe(5)
  expect(nextWait(25, timeout, 25_000)).toBe(25)
  expect(nextWait(25, new Error('connection refused'), 100)).toBe(25)
})

test('a worktree without an entry of its own uses the main checkout\'s', () => {
  const projects = { '/repo': { mcpServers: { arlesh: { url: 'http://h/mcp' } } }, '/repo-wt': {} }

  expect(projectServers(projects, '/repo-wt', '/repo')).toEqual({ arlesh: { url: 'http://h/mcp' } })
  expect(projectServers(projects, '/repo', undefined)).toEqual({ arlesh: { url: 'http://h/mcp' } })
  expect(projectServers(projects, '/elsewhere', undefined)).toBeUndefined()
  expect(
    projectServers({ ...projects, '/repo-wt': { mcpServers: { own: {} } } }, '/repo-wt', '/repo'),
  ).toEqual({ own: {} })
})

test('the main checkout is the parent of the git common directory of a linked worktree', () => {
  expect(mainCheckoutOf('gitdir: /repo/.git/worktrees/wt\n', '../..\n')).toBe('/repo')
  expect(mainCheckoutOf('gitdir: /repo/.git/worktrees/wt', '/repo/.git')).toBe('/repo')
  expect(mainCheckoutOf('gitdir: /srv/repo.git/worktrees/wt', '../..')).toBeUndefined()
  expect(mainCheckoutOf(undefined, '../..')).toBeUndefined()
  expect(mainCheckoutOf('ref: refs/heads/x', '../..')).toBeUndefined()
})

test('variables expand as .mcp.json expands them', async () => {
  const lookup = async (name: string) => (name === 'TOKEN' ? '<token>' : undefined)

  expect(await expandVariables('Bearer ${TOKEN}', lookup)).toBe('Bearer <token>')
  expect(await expandVariables('${NOPE:-fallback}/x', lookup)).toBe('fallback/x')
  expect(await expandVariables('plain', lookup)).toBe('plain')
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
  // `next(e)` in a tool.call hook gives the JSON the model reads, as a string.
  expect(waitsFrom('ask', JSON.stringify(asked.structuredContent), '9a1')).toEqual([
    { waitId: 'w-full', shortId: 'w1', taskShortId: '9a1', status: 'pending', archived: false },
  ])
  expect(waitsFrom('ask', 'Error: not permitted', '9a1')).toEqual([])
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

test('a change for a deleted wait is gone, and one without ids is ignored', () => {
  const change = { wait_id: 'w', short_id: 's', task_short_id: 't', status: 'pending', archived: false, deleted: true }

  expect(currentFromChange(change)).toEqual({ waitId: 'w', state: null })
  expect(currentFromChange({})).toBeUndefined()
  expect(currentFromChange(undefined)).toBeUndefined()
})

test('the PIN door is the local endpoint itself, else the desktop app on its loopback port', () => {
  expect(isLoopback('http://127.0.0.1:4747/mcp')).toBe(true)
  expect(isLoopback('http://localhost:4747')).toBe(true)
  expect(isLoopback('https://board.example.org')).toBe(false)
  expect(doorUrl('http://127.0.0.1:4747', undefined)).toBe('http://127.0.0.1:4747/agents/pin')
  expect(doorUrl('https://board.example.org', undefined)).toBe('http://127.0.0.1:4747/agents/pin')
  expect(doorUrl('https://board.example.org', 4800)).toBe('http://127.0.0.1:4800/agents/pin')
  expect(doorPort('4800')).toBe(4800)
  expect(doorPort('nope')).toBeUndefined()
  expect(doorPort('70000')).toBeUndefined()
})

test('a door answers a PIN, and anything else is none', () => {
  expect(parsePin('{"pin":"12345678","expires_at":"2026-11-07T10:05:00"}')).toBe('12345678')
  expect(parsePin('{"error":1}')).toBeUndefined()
  expect(parsePin('<html>')).toBeUndefined()
})

test('ARLESH_CLAIM names a node by type and id', () => {
  expect(parseClaim('project:ARL')).toEqual({ node_type: 'project', node_id: 'ARL' })
  expect(parseClaim('goal:9a1')).toEqual({ node_type: 'goal', node_id: '9a1' })
  expect(parseClaim('ARL')).toBeUndefined()
  expect(parseClaim(':x')).toBeUndefined()
  expect(parseClaim(undefined)).toBeUndefined()
})

test('the agent is named after the project directory and the start of the session id', () => {
  expect(agentName('/work/My Project/', 'ab12-cd34')).toBe('My-Project-ab12')
  expect(agentName('/', 'zz')).toBe('session-zz')
})

test('a PIN attach names the agent, a token attach only the session and the token', () => {
  const subtree = { node_type: 'project', node_id: 'ARL' }
  expect(attachArguments({ sessionId: 's', pin: '1', name: 'n', account: 'a', subtree })).toEqual({
    operation: 'attach', session_id: 's', pin: '1', name: 'n', account: 'a', subtree,
  })
  expect(attachArguments({ sessionId: 's', token: 't', name: 'n', account: 'a', subtree })).toEqual({
    operation: 'attach', session_id: 's', token: 't',
  })
})

test('an attach answer gives the name, the token and the claim', () => {
  const answer = {
    structuredContent: {
      agent: { name: 'arl-ab12', claim: { root: { node_kind: 'goal', node_id: 10 }, status: 'active' } },
      token: 'abc',
      claim_refused: 'overlaps',
    },
  }
  expect(attachedFrom(answer)).toEqual({ name: 'arl-ab12', token: 'abc', claim: 'goal 10', claimRefused: 'overlaps' })
  expect(attachedFrom({ isError: true, content: [] })).toBeUndefined()
})

test('only the not-attached refusal triggers a new attach', () => {
  const refusal = { kind: 'not_permitted', message: 'this session is not attached: call arlesh_agents.attach' }
  expect(isNotAttached(JSON.stringify(refusal))).toBe(true)
  expect(isNotAttached({ structuredContent: refusal })).toBe(true)
  expect(isNotAttached(JSON.stringify({ kind: 'not_permitted', message: 'outside the roots' }))).toBe(false)
  expect(isNotAttached('{"ok":1}')).toBe(false)
})

test('usage is reported when a percent moves a whole point, a window changes, or five minutes pass', () => {
  const limits = [{ kind: 'five_hour', percentUsed: 40, resetsAt: '2026-11-07T14:00:00Z' }]
  const before = reportedFrom(limits, 0)

  expect(usageWindows(limits)).toEqual([{ kind: 'five_hour', percent_used: 40, resets_at: '2026-11-07T14:00:00Z' }])
  expect(shouldReport(undefined, limits, 0)).toBe(true)
  expect(shouldReport(before, limits, 1000)).toBe(false)
  expect(shouldReport(before, [{ ...limits[0]!, percentUsed: 40.5 }], 1000)).toBe(false)
  expect(shouldReport(before, [{ ...limits[0]!, percentUsed: 41 }], 1000)).toBe(true)
  expect(shouldReport(before, limits, 5 * 60 * 1000)).toBe(true)
  expect(shouldReport(before, [...limits, { kind: 'seven_day', percentUsed: 1, resetsAt: 'x' }], 1000)).toBe(true)
  expect(shouldReport(undefined, [{ kind: 'five_hour', percentUsed: 5 }], 0)).toBe(false)
})

test('the context block says whether the session is attached and how a claim works, briefly', () => {
  const attached = contextBlock({ kind: 'attached', name: 'arl-ab12', claim: 'goal 10', automatic: true })
  expect(attached).toContain('attached automatically as arl-ab12, claim: goal 10')
  expect(attached).toContain('arlesh_agents.claim')
  expect(attached).toContain('whole view')
  expect(attached).toContain('[arlesh:<task id>]')
  expect(attached.length).toBeLessThan(700)
  expect(contextBlock({ kind: 'attached', name: 'n', claim: undefined, automatic: true })).toContain('no claim yet')
  const waiting = contextBlock({ kind: 'unattached', reason: 'no PIN door answered' })
  expect(waiting).toContain('Settings → Agents')
  expect(waiting).toContain('arlesh_agents.attach')
})
