import { atom, read, update } from 'claude-code'
import type { Register, EngineInterface } from 'claude-code'

import {
  agentName,
  attachArguments,
  attachedFrom,
  contextBlock,
  doorPort,
  doorUrl,
  isNotAttached,
  parseClaim,
  parsePin,
  reportedFrom,
  shouldReport,
  usageWindows,
  type Limit,
  type Reported,
  type Standing,
} from './attach'
import { forget, prune, remember, revive, type Book, type Entry } from './book'
import * as kids from './children'
import type { RowLines } from '../types'
import {
  expandVariables,
  mainCheckoutOf,
  originOf,
  pickServer,
  projectServers,
  type ServerEntry,
} from './config'
import { isRecord, parseJson, text } from './json'
import { nextWait, parsePoll, pollUrl, WAIT_START_S, type Cursor } from './poll'
import { currentFrom, waitsFrom, type Current } from './results'
import { changeBetween, namesRaiser, notificationText, routeTo, type Change, type Via } from './rules'

type Engine = EngineInterface

/** What the agents are told at the start of a session in which the notifications are on. */
const NOTES =
  'Arlesh notifications are on in this session: waits you ask, raise or `arlesh_waits.watch` ' +
  "will notify you when they change; don't poll."

const BACKOFF_FIRST_MS = 1_000
const BACKOFF_MAX_MS = 30_000
const NO_SERVER_RETRY_MS = 30_000
/** Failures in a row before the transcript is told once that Arlesh cannot be reached. */
const SURFACE_AFTER = 3
const SUBMIT_RETRY_MS = 3_000
const SUBMIT_TRIES = 20

let server: ServerEntry | undefined
let following = false
let queue: Promise<unknown> = Promise.resolve()
/** How this session stands with Arlesh's agents: attached as whom, or why not. */
let standing: Standing | undefined
/** An attach in flight, so two triggers do not attach twice. */
let attaching: Promise<Standing> | undefined
let lastReport: Reported | undefined
/** Which `Agent` call started each subagent, so its row can be found again. */
const spawned = new Map<string, string>()

/** The line under each subagent's row, by the Agent call's tool use id. */
const rows = atom({ plugin: 'arlesh-notify', key: 'rows' } as const, {} as RowLines)

const ARLESH_TOOL = /^mcp__.+__arlesh_[a-z_]+$/

/** Runs `job` after every earlier one: the book is read, changed and written in turn. */
function serially<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job)
  queue = run.catch(() => undefined)
  return run
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    server = await readServer($).catch(() => undefined)
    if (!following) {
      following = true
      void follow($)
    }
    return started
  })

  // The one line that says notifications are on: only when the server answered a quick request.
  on('classic.SessionStart', async ($, e, next) => {
    const started = await next(e)
    server ??= await readServer($).catch(() => undefined)
    if (server === undefined || !(await reachable($, server))) return started
    // Attached before the context is composed, with no action from the agent.
    const now = await attach($, server)
    void reportUsage($, undefined)
    return {
      ...started,
      additionalContext: [...(started.additionalContext ?? []), NOTES, contextBlock(now)],
    }
  })

  // The plan limits the session is under, reported for its account whenever one moves.
  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    void reportUsage($, e.rateLimits)
    return result
  })

  // The Agent call that starts (or resumes) a subagent: remembered, so its row can be drawn on.
  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    const id = e.resume?.agentId ?? started.agentId
    if (id !== undefined && !spawned.has(id)) spawned.set(id, e.tool_use_id)
    return started
  }).catch(($, e, next) => next(e))

  // A subagent starts: registered as a child agent, and told its sub-token once. Resumed: its
  // Claim resumes with it (what a resume says to it never reaches it, so it is not told again).
  on('classic.SubagentStart', async ($, e, next) => {
    const started = await next(e)
    try {
      const block = await childStarted($, e.agent_id)
      if (block === undefined) return started
      return { ...started, additionalContext: [...(started.additionalContext ?? []), block] }
    } catch (error) {
      $.ui.log(`arlesh-notify: could not register a subagent: ${String(error)}`, { to: 'debug' })
      return started
    }
  }).catch(($, e, next) => next(e))

  // A subagent that stops has its Claim paused; the child stays listed, still naming its Task.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined) void childStopped($, e.agentId)
    return done
  }).catch(($, e, next) => next(e))

  // An Arlesh call a subagent makes without its `sub_token` gets it, so the convention holds
  // whether or not the model remembers the argument.
  on('tool.call', { tool: ARLESH_TOOL }, async ($, e, next) => {
    const agentId = e.agentId
    const input: Record<string, unknown> = { ...e }
    if (agentId === undefined || input['sub_token'] !== undefined) return next(e)
    const found = await governingOf($, agentId)
    if (found === undefined) return next(e)
    const ran = await next({ ...e, ...{ sub_token: found.child.subToken } })
    void noteAnswer($, found, e.tool, ran.result ?? ran.text)
    return ran
  }).catch(($, e, next) => next(e))

  // Under a subagent's `Agent(…)` row: the Arlesh Task it is on, and whether its Claim is active
  // or paused. Every other row is drawn as it was.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.props.tool !== 'Agent') return next(e)
    const line = (await read($, rows))[e.props.tool_use_id]
    if (line === undefined) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {await next(e)}
        <Text dimColor>{line}</Text>
      </Box>
    )
  }).catch(($, e, next) => next(e))

  // A server that lost the binding (it restarted) turns the session away: attach again.
  on('tool.call', { tool: /^mcp__.+__arlesh_[a-z_]+$/ }, async ($, e, next) => {
    const ran = await next(e)
    if (!e.tool.endsWith('__arlesh_agents') && isNotAttached(ran.result ?? ran.text)) {
      standing = undefined
      void attach($, server ?? (await readServer($).catch(() => undefined)))
    }
    return ran
  }).catch(($, e, next) => next(e))

  // Every wait the session asks, raises or watches is recorded, whoever in it did.
  on('tool.call', { tool: /^mcp__.+__arlesh_waits$/ }, async ($, e, next) => {
    const ran = await next(e)
    try {
      if (ran.deny !== undefined || ran.isError === true) return ran
      const input: Record<string, unknown> = { ...e }
      // `next(e)` gives the result as the string the model reads, holding the JSON.
      const refs = waitsFrom(input['operation'], ran.result ?? ran.text, text(input, 'task_id'))
      if (refs.length === 0) return ran
      const via = await viaOf($, input['agentId'])
      await serially(async () => {
        let book = await loadBook($)
        const now = await $.clock.now()
        for (const ref of refs) {
          const entry: Entry = {
            ...ref,
            taskShortId: ref.taskShortId ?? '?',
            seenAt: now,
            ...(via === undefined ? {} : { via }),
          }
          book = remember(book, entry)
        }
        await saveBook($, book)
      })
    } catch (error) {
      $.ui.log(`could not record a wait: ${String(error)}`, { to: 'debug' })
    }
    return ran
  }).catch(($, e, next) => next(e))
}

/**
 * The `Arlesh` entry of the MCP configuration the session reads, headers expanded. A git
 * worktree without a local-scope entry of its own uses the main checkout's, as Claude Code does.
 */
async function readServer($: Engine): Promise<ServerEntry | undefined> {
  const root = await $.session.root()
  const home = await $.env.get('HOME')
  const sources: unknown[] = []
  const user = home === undefined ? undefined : await readJson($, `${home}/.claude.json`)
  if (isRecord(user)) {
    sources.push(projectServers(user['projects'], root, await mainCheckout($, root)))
  }
  const shared = await readJson($, `${root}/.mcp.json`)
  if (isRecord(shared)) sources.push(shared['mcpServers'])
  if (isRecord(user)) sources.push(user['mcpServers'])
  const found = pickServer(sources)
  if (found === undefined) return undefined
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(found.headers)) {
    headers[name] = await expandVariables(value, (variable) => environment($, variable))
  }
  return { ...found, url: await expandVariables(found.url, (v) => environment($, v)), headers }
}

/** The main checkout of the git worktree at `root`, if it is one. */
async function mainCheckout($: Engine, root: string): Promise<string | undefined> {
  const dotGit = await readText($, `${root}/.git`)
  const gitdir = dotGit?.split('\n')[0]?.replace(/^gitdir:/, '').trim()
  if (gitdir === undefined || gitdir === '') return undefined
  return mainCheckoutOf(dotGit, await readText($, `${gitdir}/commondir`))
}

/** The header the wait stream needs: this session's own agent token, if it has attached. */
async function agentHeaders($: Engine, connection: ServerEntry): Promise<Record<string, string> | undefined> {
  const stored = await $.store.get(`agent:${await $.session.id()}`)
  const token = isRecord(stored) ? text(stored, 'token') : undefined
  return token === undefined ? undefined : { ...connection.headers, 'X-Arlesh-Agent-Token': token }
}

/**
 * One quick request (`wait=0`): does the server answer? The wait stream tells an agent only of
 * waits inside its Claim, so it answers 401 to a session that has not attached; that is an answer.
 */
async function reachable($: Engine, connection: ServerEntry): Promise<boolean> {
  try {
    const answered = await $.http.fetch(pollUrl(originOf(connection.url), undefined, 0), {
      headers: (await agentHeaders($, connection)) ?? connection.headers,
    })
    return answered.ok || answered.status === 401
  } catch {
    return false
  }
}

/**
 * Polls the server for the session's life, one request at a time: each is held open by the
 * server until a wait changes or `wait` seconds pass, and the next one resumes from the cursor
 * it answered. With no cursor, or after the server restarted, it reads the watched waits
 * (`catchUp`) before polling on.
 */
async function follow($: Engine): Promise<void> {
  let backoff = BACKOFF_FIRST_MS
  let wait = WAIT_START_S
  let cursor: Cursor | undefined
  let failures = 0
  for (;;) {
    let started = 0
    // The whole iteration is guarded: whatever rejects (reading the configuration included), the
    // loop backs off and goes on, for the session's life.
    try {
      server ??= await readServer($)
      if (server === undefined) {
        await $.clock.sleep(NO_SERVER_RETRY_MS)
        continue
      }
      const connection = server
      const headers = await agentHeaders($, connection)
      if (headers === undefined) {
        // Not attached (yet): the stream tells only an attached agent, and only of its Claim.
        cursor = undefined
        await $.clock.sleep(NO_SERVER_RETRY_MS)
        continue
      }
      started = await $.clock.now()
      const answered = await $.http.fetch(pollUrl(originOf(connection.url), cursor, wait), {
        headers,
      })
      if (!answered.ok) throw new Error(`the server answered ${answered.status}`)
      const answer = parsePoll(answered.text)
      if (answer === undefined) throw new Error('the server answered something else than a poll')
      if (answer.reset || cursor === undefined || cursor.epoch !== answer.epoch) {
        await serially(() => catchUp($, connection))
      } else if (answer.changes.length > 0) {
        await serially(() => apply($, answer.changes))
      }
      // Only now is the round a success: a failed catch-up leaves the cursor unset, and must
      // back off and count like a failed poll, not reset both and poll again at once.
      backoff = BACKOFF_FIRST_MS
      failures = 0
      cursor = { revision: answer.revision, epoch: answer.epoch }
    } catch (error) {
      failures += 1
      try {
        wait = nextWait(wait, error, started === 0 ? Infinity : (await $.clock.now()) - started)
        $.ui.log(`the poll failed: ${String(error)}`, { to: 'debug' })
        if (failures === SURFACE_AFTER) {
          $.ui.log(
            'cannot reach Arlesh; notifications are paused and it keeps trying.',
          )
        }
        server = undefined // read the configuration again: the URL or token may have changed
        await $.clock.sleep(backoff)
      } catch {
        // Even the bookkeeping failed: the loop still goes on.
      }
      backoff = Math.min(backoff * 2, BACKOFF_MAX_MS)
    }
  }
}

/** Reads the watched waits once and tells of what changed while the stream was away. */
async function catchUp($: Engine, connection: ServerEntry): Promise<void> {
  const book = prune(await loadBook($), await $.clock.now())
  const ids = Object.keys(book)
  if (ids.length === 0) return
  const asked = await $.mcp.call(connection.name, 'arlesh_waits', {
    operation: 'get_many',
    ids,
  })
  await apply($, currentFrom(ids, asked), true)
}

/** Compares each `current` with what was seen, notifies, and stores the new state. */
async function apply($: Engine, answers: Current[], pruneFirst = false): Promise<void> {
  let book = await loadBook($)
  if (pruneFirst) book = prune(book, await $.clock.now())
  const now = await $.clock.now()
  const wakes: Array<{ entry: Entry; change: Change }> = []
  for (const answer of answers) {
    const entry = book[answer.waitId]
    if (entry === undefined) continue
    const change = changeBetween(entry, answer.state)
    if (answer.state === null) {
      book = forget(book, answer.waitId)
    } else {
      book = { ...book, [answer.waitId]: { ...entry, ...answer.state, seenAt: now } }
    }
    if (change !== null) wakes.push({ entry, change })
  }
  await saveBook($, book)
  for (const { entry, change } of wakes) await deliver($, entry, change)
}

/** Sends the pointer to the raising sub-agent if it runs, else to whoever spawned it. */
async function deliver($: Engine, entry: Entry, change: Change): Promise<void> {
  const agents = (await $.agent.list()).map((agent) => ({
    id: agent.id,
    status: agent.status,
    ...(agent.parentId === undefined ? {} : { parentId: agent.parentId }),
  }))
  const target = routeTo(entry.via, agents)
  const message = notificationText(entry, change, entry.via, namesRaiser(target, entry.via))
  if (target.kind === 'agent') {
    try {
      await $.session.send({ to: { agentId: target.agentId }, text: message })
      return
    } catch (error) {
      $.ui.log(`could not message the agent: ${String(error)}`, { to: 'debug' })
    }
  }
  submit($, message, SUBMIT_TRIES)
}

/** Wakes the session, as a finished background command does; tried again while it is busy. */
function submit($: Engine, message: string, tries: number): void {
  $.prompt.submit({ text: message }).catch(async () => {
    if (tries <= 1) return
    await $.clock.sleep(SUBMIT_RETRY_MS)
    submit($, message, tries - 1)
  })
}

async function viaOf($: Engine, agentId: unknown): Promise<Via | undefined> {
  if (typeof agentId !== 'string') return undefined
  const agent = (await $.agent.list()).find((candidate) => candidate.id === agentId)
  return {
    agentId,
    description: agent?.description ?? agentId,
    ...(agent?.parentId === undefined ? {} : { parentId: agent.parentId }),
  }
}

async function storeKey($: Engine): Promise<string> {
  return `watch:${await $.session.id()}`
}

async function loadBook($: Engine): Promise<Book> {
  return revive(await $.store.get(await storeKey($)))
}

async function saveBook($: Engine, book: Book): Promise<void> {
  await $.store.set(await storeKey($), book)
}

async function readText($: Engine, path: string): Promise<string | undefined> {
  try {
    return await $.fs.read(path)
  } catch {
    return undefined
  }
}

async function readJson($: Engine, path: string): Promise<unknown> {
  const source = await readText($, path)
  return source === undefined ? undefined : parseJson(source)
}

/** An environment variable's value; `$.env.get` takes only literal names, so ask `printenv`. */
async function environment($: Engine, name: string): Promise<string | undefined> {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return undefined
  const ran = await $.process.run(['printenv', name])
  return ran.exitCode === 0 ? ran.stdout.replace(/\n$/, '') : undefined
}

/** Attaches the session once at a time, and remembers how it stands. Never throws. */
function attach($: Engine, connection: ServerEntry | undefined): Promise<Standing> {
  if (standing?.kind === 'attached') return Promise.resolve(standing)
  attaching ??= (async () => {
    try {
      standing =
        connection === undefined
          ? { kind: 'unattached', reason: 'the Arlesh server is not configured' }
          : await attachTo($, connection)
    } catch (error) {
      $.ui.log(`arlesh-notify: could not attach: ${String(error)}`, { to: 'debug' })
      standing = { kind: 'unattached', reason: 'attaching failed' }
    }
    return standing
  })().finally(() => {
    attaching = undefined
  })
  return attaching
}

async function attachTo($: Engine, connection: ServerEntry): Promise<Standing> {
  const sessionId = await $.session.id()
  const key = `agent:${sessionId}`
  const stored = await $.store.get(key)
  const token = isRecord(stored) ? text(stored, 'token') : undefined
  const name = agentName(await $.session.cwd(), sessionId)
  const account = (await environment($, 'ARLESH_ACCOUNT')) || 'default'
  const subtree = parseClaim(await environment($, 'ARLESH_CLAIM'))
  if (token !== undefined) {
    const back = attachedFrom(
      await $.mcp.call(connection.name, 'arlesh_agents', attachArguments({ sessionId, token, name, account })),
    )
    if (back !== undefined) {
      return { kind: 'attached', name: back.name, claim: back.claim, automatic: true }
    }
    await $.store.set(key, undefined) // the agent was removed: a PIN makes a new one
  }
  const port = doorPort(await environment($, 'ARLESH_DOOR_PORT'))
  let pin: string | undefined
  try {
    const door = await $.http.fetch(doorUrl(originOf(connection.url), port), { method: 'POST' })
    pin = door.ok ? parsePin(door.text) : undefined
  } catch {
    pin = undefined
  }
  if (pin === undefined) {
    return { kind: 'unattached', reason: 'no PIN door answered: is the Arlesh app running?' }
  }
  const made = attachedFrom(
    await $.mcp.call(
      connection.name,
      'arlesh_agents',
      attachArguments({ sessionId, pin, name, account, ...(subtree === undefined ? {} : { subtree }) }),
    ),
  )
  if (made === undefined) return { kind: 'unattached', reason: 'the server refused the PIN' }
  if (made.token !== undefined) await $.store.set(key, { token: made.token, savedAt: await $.clock.now() })
  return {
    kind: 'attached',
    name: made.name,
    claim: made.claim,
    ...(made.claimRefused === undefined ? {} : { claimRefused: made.claimRefused }),
    automatic: true,
  }
}

/** Tells the server how much of the plan limits is used, when that moved. Never throws. */
async function reportUsage($: Engine, given: readonly Limit[] | undefined): Promise<void> {
  try {
    if (standing?.kind !== 'attached' || server === undefined) return
    const limits = given ?? (await $.session.usage()).rateLimits
    const now = await $.clock.now()
    if (!shouldReport(lastReport, limits, now)) return
    lastReport = reportedFrom(limits, now)
    await $.mcp.call(server.name, 'arlesh_agents', {
      operation: 'report_usage',
      windows: usageWindows(limits),
    })
  } catch (error) {
    $.ui.log(`arlesh-notify: could not report usage: ${String(error)}`, { to: 'debug' })
  }
}

/** The key the session's children are stored under. */
async function childrenKey($: Engine): Promise<string> {
  return `children:${await $.session.id()}`
}

async function loadChildren($: Engine): Promise<kids.Children> {
  return kids.prune(kids.revive(await $.store.get(await childrenKey($))), await $.clock.now())
}

async function saveChildren($: Engine, children: kids.Children): Promise<void> {
  await $.store.set(await childrenKey($), children)
}

/** Which agent spawned each of the session's subagents. */
async function spawnersOf($: Engine): Promise<Map<string, string>> {
  const parents = new Map<string, string>()
  for (const agent of await $.agent.list()) {
    if (agent.parentId !== undefined) parents.set(agent.id, agent.parentId)
  }
  return parents
}

/** The record a subagent works under: its own, or its nearest registered ancestor's. */
async function governingOf($: Engine, agentId: string): Promise<kids.Governing | undefined> {
  return kids.governing(await loadChildren($), await spawnersOf($), agentId)
}

/** Draws (or redraws) the line under the `Agent` row that started `agentId`. */
async function showRow($: Engine, agentId: string, child: kids.Child): Promise<void> {
  const toolUseId = spawned.get(agentId)
  const line = kids.rowLine(child)
  if (toolUseId === undefined || line === undefined) return
  await update($, rows, (current) => ({ ...current, [toolUseId]: line }))
}

/** Changes one record under the queue, and redraws its row. */
async function changeChild(
  $: Engine,
  id: string,
  change: (child: kids.Child) => kids.Child | undefined,
): Promise<void> {
  const changed = await serially(async () => {
    const children = await loadChildren($)
    const child = children[id]
    if (child === undefined) return undefined
    const next = change(child)
    const { [id]: _gone, ...rest } = children
    await saveChildren($, next === undefined ? rest : { ...rest, [id]: { ...next, savedAt: await $.clock.now() } })
    return next
  })
  if (changed !== undefined) await showRow($, id, changed)
}

/** What a call to the child's `arlesh_agents` (pause, resume, claim) says of it, kept for the row. */
async function noteAnswer($: Engine, found: kids.Governing, tool: string, result: unknown): Promise<void> {
  try {
    if (kids.isChildGone(result)) return await changeChild($, found.id, () => undefined)
    if (!tool.endsWith('__arlesh_agents')) return
    const identity = kids.identityFrom(result)
    if (identity === undefined) return
    await changeChild($, found.id, (child) => ({
      ...child,
      ...(identity.claimName === undefined ? {} : { claimName: identity.claimName }),
      ...(identity.standing === undefined ? {} : { standing: identity.standing }),
    }))
  } catch (error) {
    $.ui.log(`arlesh-notify: could not note a subagent's answer: ${String(error)}`, { to: 'debug' })
  }
}

/**
 * A subagent started: the context block to hand it, or `undefined` when it needs none (not an
 * attached session, not a plain subagent, already known, or resumed).
 */
async function childStarted($: Engine, id: string): Promise<string | undefined> {
  if (attaching !== undefined) await attaching
  const connection = server
  if (standing?.kind !== 'attached' || connection === undefined) return undefined
  const agents = await $.agent.list()
  const info = agents.find((agent) => agent.id === id)
  if (info === undefined || info.teammateId !== undefined) return undefined
  const known = (await loadChildren($))[id]
  if (known !== undefined) {
    if (known.nested === true) return undefined
    const back = await $.mcp.call(connection.name, 'arlesh_agents', { operation: 'resume', sub_token: known.subToken })
    if (!kids.isChildGone(back)) {
      await noteAnswer($, { id, child: known }, `mcp__${connection.name}__arlesh_agents`, back)
      return undefined
    }
    await changeChild($, id, () => undefined)
  }
  const ancestor =
    info.parentId === undefined ? undefined : kids.governing(await loadChildren($), await spawnersOf($), info.parentId)
  if (ancestor !== undefined) {
    const record: kids.Child = { ...ancestor.child, nested: true, savedAt: await $.clock.now() }
    delete record.claimName
    delete record.standing
    await serially(async () => saveChildren($, { ...(await loadChildren($)), [id]: record }))
    return kids.contextBlock(ancestor.child.name, ancestor.child.subToken)
  }
  const made = kids.registeredFrom(
    await $.mcp.call(connection.name, 'arlesh_agents', kids.registerArguments(info.description || id, id)),
  )
  if (made === undefined) return undefined
  if (made.subToken === undefined) return undefined
  const record: kids.Child = { childId: made.childId, subToken: made.subToken, name: made.name, savedAt: await $.clock.now() }
  await serially(async () => saveChildren($, { ...(await loadChildren($)), [id]: record }))
  return kids.contextBlock(made.name, made.subToken)
}

/** A subagent stopped: its Claim is paused, unless the child is gone or is not its own. */
async function childStopped($: Engine, id: string): Promise<void> {
  try {
    const known = (await loadChildren($))[id]
    const connection = server
    if (known === undefined || known.nested === true || connection === undefined) return
    const paused = await $.mcp.call(connection.name, 'arlesh_agents', { operation: 'pause', sub_token: known.subToken })
    if (kids.isChildGone(paused)) return await changeChild($, id, () => undefined)
    await noteAnswer($, { id, child: known }, `mcp__${connection.name}__arlesh_agents`, paused)
  } catch (error) {
    $.ui.log(`arlesh-notify: could not pause a subagent's claim: ${String(error)}`, { to: 'debug' })
  }
}
