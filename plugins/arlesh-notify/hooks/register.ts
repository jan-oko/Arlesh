import type { Register, EngineInterface } from 'claude-code'

import { forget, prune, remember, revive, type Book, type Entry } from './book'
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

/** Runs `job` after every earlier one: the book is read, changed and written in turn. */
function serially<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job)
  queue = run.catch(() => undefined)
  return run
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    server = await readServer($)
    if (!following) {
      following = true
      void follow($)
    }
    return started
  })

  // The one line that says notifications are on: only when the server answered a quick request.
  on('classic.SessionStart', async ($, e, next) => {
    const started = await next(e)
    server ??= await readServer($)
    if (server === undefined || !(await reachable($, server))) return started
    return { ...started, additionalContext: [...(started.additionalContext ?? []), NOTES] }
  })

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
      $.ui.log(`arlesh-notify: could not record a wait: ${String(error)}`, { to: 'debug' })
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

/** One quick request (`wait=0`): does the server answer? */
async function reachable($: Engine, connection: ServerEntry): Promise<boolean> {
  try {
    const answered = await $.http.fetch(pollUrl(originOf(connection.url), undefined, 0), {
      headers: connection.headers,
    })
    return answered.ok
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
    server ??= await readServer($)
    if (server === undefined) {
      await $.clock.sleep(NO_SERVER_RETRY_MS)
      continue
    }
    const connection = server
    const started = await $.clock.now()
    try {
      const answered = await $.http.fetch(pollUrl(originOf(connection.url), cursor, wait), {
        headers: connection.headers,
      })
      if (!answered.ok) throw new Error(`the server answered ${answered.status}`)
      const answer = parsePoll(answered.text)
      if (answer === undefined) throw new Error('the server answered something else than a poll')
      backoff = BACKOFF_FIRST_MS
      failures = 0
      if (answer.reset || cursor === undefined || cursor.epoch !== answer.epoch) {
        await serially(() => catchUp($, connection))
      } else if (answer.changes.length > 0) {
        await serially(() => apply($, answer.changes))
      }
      cursor = { revision: answer.revision, epoch: answer.epoch }
    } catch (error) {
      failures += 1
      wait = nextWait(wait, error, (await $.clock.now()) - started)
      $.ui.log(`arlesh-notify: the poll failed: ${String(error)}`, { to: 'debug' })
      if (failures === SURFACE_AFTER) {
        $.ui.log(
          'arlesh-notify: cannot reach Arlesh; notifications are paused and it keeps trying.',
        )
      }
      server = undefined // read the configuration again: the URL or token may have changed
      await $.clock.sleep(backoff)
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
      $.ui.log(`arlesh-notify: could not message the agent: ${String(error)}`, { to: 'debug' })
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
