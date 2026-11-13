import { expect, test } from 'claude-code/testing'

import {
  contextBlock,
  governing,
  identityFrom,
  isChildGone,
  prune,
  registeredFrom,
  registerArguments,
  revive,
  rowLine,
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

  expect(registeredFrom(first)).toEqual({ childId: 12, name: 'helper', subToken: 'q3H' })
  expect(registeredFrom(again)).toEqual({ childId: 12, name: 'helper' })
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
