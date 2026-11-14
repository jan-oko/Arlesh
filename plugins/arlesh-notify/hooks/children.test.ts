import { expect, test } from 'claude-code/testing'

import {
  changesSessionClaim,
  contextBlock,
  governing,
  identityFrom,
  isChildGone,
  label,
  parseMarker,
  prune,
  registeredFrom,
  registerArguments,
  revive,
  rowLine,
  stripMarker,
  taskFrom,
  KEEP_MS,
  type Child,
} from './children'

const child = (over: Partial<Child> = {}): Child => ({ childId: 12, subToken: 'tok', name: 'helper', savedAt: 1000, ...over })
const answer = (payload: unknown) => ({ content: [], isError: false, structuredContent: payload })

test('register_child names the subagent and the client id', () => {
  expect(registerArguments('Fix CI', 'a1')).toEqual({ operation: 'register_child', name: 'Fix CI', client_id: 'a1' })
})

test('a register_child answer gives the child, and its sub-token only the first time', () => {
  const first = answer({ agent: { id: 12, name: 'helper' }, sub_token: 'q3H' })
  const again = answer({ agent: { id: 12, name: 'helper' } })

  expect(registeredFrom(first)).toEqual({ childId: 12, name: 'helper', holds: false, subToken: 'q3H' })
  expect(registeredFrom(again)).toEqual({ childId: 12, name: 'helper', holds: false })
  expect(registeredFrom({ content: [], isError: true })).toBeUndefined()
})

test('an arlesh_agents answer gives the Task named and the standing', () => {
  const result = answer({ agent: { id: 12 }, standing: 'paused', claim_name: '077 Subagents' })

  expect(identityFrom(result)).toEqual({ claimName: '077 Subagents', standing: 'paused' })
  expect(identityFrom(answer({ kind: 'not_permitted' }))).toBeUndefined()
})

test('a child that was removed is told by the sub_token refusal', () => {
  const gone = JSON.stringify({ kind: 'not_permitted', message: 'the sub_token names no child agent of this session' })

  expect(isChildGone(gone)).toBe(true)
  expect(isChildGone(JSON.stringify({ kind: 'not_permitted', message: 'outside your parent agent\'s Claim' }))).toBe(false)
  expect(isChildGone(answer({ agent: {} }))).toBe(false)
})

test('the context block names the token, the claim and the pause', () => {
  const block = contextBlock('helper', 'q3H')

  expect(block).toContain('sub_token: "q3H"')
  expect(block).toContain('arlesh_agents.claim')
  expect(block).toContain('paused')
})

test('a subagent works under its own record, else its nearest registered ancestor\'s', () => {
  const children = { a1: child({ name: 'one' }) }
  const parents = new Map([['b1', 'a1'], ['c1', 'b1'], ['x1', 'nobody']])

  expect(governing(children, parents, 'a1')?.id).toBe('a1')
  expect(governing(children, parents, 'c1')?.child.name).toBe('one')
  expect(governing(children, parents, 'x1')).toBeUndefined()
})

test('the row line names the Task and whether the claim is active or paused', () => {
  expect(rowLine(child())).toBeUndefined()
  expect(rowLine(child({ claimName: '077 Subagents', standing: 'active' }))).toBe('Arlesh · 077 Subagents · Active')
  expect(rowLine(child({ claimName: '077 Subagents', standing: 'paused' }))).toBe('Arlesh · 077 Subagents · Paused')
})

test('stored records are revived whole and pruned after thirty days', () => {
  const stored = { a1: child(), bad: { childId: 'x' } }

  expect(Object.keys(revive(stored))).toEqual(['a1'])
  expect(Object.keys(prune(revive(stored), 1000 + KEEP_MS - 1))).toEqual(['a1'])
  expect(Object.keys(prune(revive(stored), 1000 + KEEP_MS))).toEqual([])
})

test('a marker is one [arlesh:<id>] in the description or the prompt, and anything else counts as none', () => {
  expect(parseMarker('Fix CI [arlesh:077]', 'do it')).toEqual({ kind: 'one', ref: '077' })
  expect(parseMarker('Fix CI', 'Work on [arlesh:8ee4cf4d-8137]. Go.')).toEqual({ kind: 'one', ref: '8ee4cf4d-8137' })
  expect(parseMarker('Fix CI', 'no marker here')).toEqual({ kind: 'none' })
  expect(parseMarker('[arlesh:077]', '[arlesh:077]').kind).toBe('invalid')
  expect(parseMarker('[arlesh:077] [arlesh:078]', '').kind).toBe('invalid')
  for (const malformed of ['[arlesh:]', '[arlesh:07]', '[arlesh: 077]', '[arlesh:077', '[Arlesh:077]x[arlesh:ab c]']) {
    expect(parseMarker(malformed, '').kind, malformed).not.toBe('one')
  }
})

test('the marker is taken out with the space before it, and nothing else is touched', () => {
  expect(stripMarker('Fix CI [arlesh:077]')).toBe('Fix CI')
  expect(stripMarker('[arlesh:077] Fix CI')).toBe('Fix CI')
  expect(stripMarker('Work on this.\n\nAnd [arlesh:077] that.\n')).toBe('Work on this.\n\nAnd that.')
})

test('the label keeps the description first, then the Task short id and a title cut to fit', () => {
  expect(label('Fix CI', '077', 'Subagents: register under the parent agent, claim a subtask')).toBe(
    'Fix CI · 077 Subagents: register under th…',
  )
  expect(label('Fix CI', '9a1', 'Short title')).toBe('Fix CI · 9a1 Short title')
  expect(label('  ', '9a1', 'T')).toBe('subagent · 9a1 T')
})

test('the Task a get answered is read from its task member', () => {
  const answer = { content: [], isError: false, structuredContent: { task: { short_id: '077', title: 'Subagents' }, infos: [] } }

  expect(taskFrom(answer)).toEqual({ shortId: '077', title: 'Subagents' })
  expect(taskFrom({ content: [], isError: true })).toBeUndefined()
})

test('a register_child answer says whether the child holds its Claim and why not', () => {
  const held = answer({ agent: { id: 12, name: 'h', claim: { status: 'active' } }, sub_token: 't', claim_name: '077 Subagents' })
  const refused = answer({ agent: { id: 12, name: 'h', claim: null }, sub_token: 't', claim_refused: 'not inside your parent agent\'s Claim' })

  expect(registeredFrom(held)).toMatchObject({ holds: true, claimName: '077 Subagents' })
  expect(registeredFrom(refused)).toMatchObject({ holds: false, claimRefused: 'not inside your parent agent\'s Claim' })
  expect(registerArguments('h', 'a1', { node_type: 'task', node_id: '077' })).toEqual({
    operation: 'register_child', name: 'h', client_id: 'a1', subtree: { node_type: 'task', node_id: '077' },
  })
})

test('a starting context says the subagent already holds its Task, or why it must claim', () => {
  const holding = contextBlock('helper', 'q3H', { holding: '077 Subagents' })
  const refused = contextBlock('helper', 'q3H', { refused: 'overlaps a sibling' })

  expect(holding).toContain('already hold your Claim, 077 Subagents')
  expect(holding).toContain('do not call `arlesh_agents.claim`')
  expect(refused).toContain('could not be claimed for you (overlaps a sibling)')
  expect(refused).toContain('First claim the Task your brief names')
})

test('a claim or release without a sub_token is the kind of call that would change the session\'s Claim', () => {
  expect(changesSessionClaim('mcp__arlesh__arlesh_agents', { operation: 'claim' })).toBe(true)
  expect(changesSessionClaim('mcp__arlesh__arlesh_agents', { operation: 'release' })).toBe(true)
  expect(changesSessionClaim('mcp__arlesh__arlesh_agents', { operation: 'claim', sub_token: 'x' })).toBe(false)
  expect(changesSessionClaim('mcp__arlesh__arlesh_agents', { operation: 'status' })).toBe(false)
  expect(changesSessionClaim('mcp__arlesh__arlesh_tasks', { operation: 'claim' })).toBe(false)
})
