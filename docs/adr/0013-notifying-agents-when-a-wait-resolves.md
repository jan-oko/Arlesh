# ADR 0013: notifying agents when a wait resolves

Status: accepted 2026-11-04, built. Decided with the user in a design session; this replaces the
2026-11-02 draft, which compared long-polls, MCP tasks and channels and chose none of them.

## Context

An agent that raises a wait (`arlesh_waits.ask`) hands a question to the user and has nothing to do
until it is answered. Polling `arlesh_waits.get` burns turns; an idle session is not woken by
anything. Claude Code documents no way for an MCP server to wake a session, but a **mod** (plugin of
function hooks) can hold a connection and submit a prompt.

## Decision

**A Claude Code mod follows an Arlesh wait stream and wakes the session when a wait it watches
changes.** No MCP tasks, no channels, no `/waits/await` long-poll.

**Which waits a session watches.** Every wait the session raised (the mod reads the results of
`arlesh_waits.ask` and `raise` through a hook), and any wait the agent passes to the new
`arlesh_waits.watch(ids)`, which on the server only validates the ids and answers their current
states. A watch lasts as long as the session. It is stored per session id, so it survives a restart
and `claude --resume`, and an entry untouched for 30 days is dropped.

**Which changes wake the agent.** The wait is released or answered; archived or deleted (the agent
is told it is *gone*); reopened, by undo or by hand. Edits to a pending wait's title or note do not.

**Streams, in both serving paths** (the app's Standalone server beside `/mcp`, and `arlesh-server`,
which proxies the core's):

- `/events/changes`: today's "board changed, revision N" stream under a new name. It replaced
  `/events` outright; the apps switched in the same change and no alias is kept.
- `/events/expectations[?agentic=true]`: a typed `wait-changed` event per change (wait id and short
  id, Task id and short id, status, archived, deleted, revision). It keeps no history. With
  `after=<revision>&wait=<seconds>` the same route is a **long poll** answering
  `{revision, epoch, changes}` (a client with no usable cursor is told to `reset`); the mod uses
  that. Whenever it has no cursor, or the server's epoch changed, the mod reads the watched waits
  once (`arlesh_waits.get_many`) and delivers what changed while it was away, then polls on.

**Delivery.** The message is a pointer only, labelled "Arlesh notification: wait W on Task T changed
(released); read it with `arlesh_waits.get`". It never quotes the answer and does not tell a
resolution through MCP from one by hand. The sub-agent that raised the wait gets it while it is
running; once it has finished, the agent that spawned it does, with the sub-agent named.

**Configuration.** The mod reuses the session's `Arlesh` MCP server entry (URL and headers) and
opens the streams on the same origin with the same authentication. It has no settings. It ships as
`plugins/arlesh-notify/`, with `.claude-plugin/marketplace.json` at the repository root.

**How agents learn of it: four layers**, so that only the mod's own note says notifications are
really on, and no agent is promised a wake-up it will not get.

1. The MCP server instructions and tool descriptions carry the protocol and say nothing about whether
   the mod is there: what `watch` does, and "if your session says Arlesh notifications are on, rely
   on them; otherwise don't wait on a wait".
2. `AGENTS.md` carries this repository's policy (*Waiting for the user's answer*): with the mod, end
   the turn after raising a wait you are blocked on and never poll; on a notification read the wait
   and act on the answer (released), stop dependent work (reopened) or treat the question as
   withdrawn (gone). Without it, still raise the wait so the board stays truthful, but ask in the
   conversation and do not wait on it.
3. The orchestrating-agents skill puts the same rules in briefs, and treats a notification as the
   cue to re-read the board.
4. The mod adds one line to the session-start context: "Arlesh notifications are on in this
   session: waits you ask, raise or `arlesh_waits.watch` will notify you when they change; don't
   poll."

Cloud sessions are out of scope: they cannot reach a local Arlesh.

## What the mod API allowed (Claude Code 2.1.318)

Checked against the API, and built as decided except where noted:

- **A long-lived streaming fetch does not exist.** `$.http.fetch` resolves once the body is read,
  and takes no timeout. So the mod **long-polls**: one `$.http.fetch` at a time, which the server
  holds up to 25 seconds (`wait`); the next request resumes from the revision answered. There is no
  `curl` and no `$.process`, so it is not limited to the CLI. If requests fail with a timeout-like
  error before the server could have answered, the wait is halved, down to 5 seconds. Failures
  back off from 1 to 30 seconds, and the third in a row is said once in the transcript.
- **The configured MCP servers cannot be read through `$`.** The mod reads `.mcp.json` and
  `~/.claude.json` (local, project, then user scope) for an `Arlesh` entry and expands `${VAR}` in
  its URL and headers with `printenv`. The catch-up read goes through the engine's own connection
  (`$.mcp.call`). In a git worktree Claude Code applies the *main checkout's* local-scope entry, so
  the mod looks up the worktree root and, with no entry there, the main checkout (the parent of the
  git common directory).
- **`session.start` cannot add context.** The "notifications are on" line is added instead by a
  `classic.SessionStart` hook, to its `additionalContext`, and only after one quick request
  (`wait=0`) to the server succeeded. The stream is started in `session.start`.
- **A hook's `next(e)` for an MCP tool gives the result as a string** (the JSON the model reads),
  not an object: the mod reads that, and skips a result with `isError`.
- **Delivery is `$.prompt.submit`** (a turn of its own once the session is idle; retried while it is
  busy) or `$.session.send` to a running sub-agent. Tried by hand on 2.1.318: an idle main session is
  woken; the parent is woken for a finished sub-agent; a running sub-agent gets `session.send`
  mid-run; a submit while the session is busy was accepted at once and ran as a turn of its own.
  Whether it interrupts or queues behind the running turn is not determined.
- **A sub-agent is notified of a release it made itself** (it raised the wait, so it is its
  notification), and a message that goes to anyone else than the raiser names the sub-agent.

## Consequences

- The app's windows write without announcing to the MCP endpoint, so in Standalone the wait stream
  re-reads the waits every 2 seconds as well as on each agent write. `arlesh-server` hears every
  write and does not poll.
- Standalone's `/events/changes` carries agent writes only; the app has no client for it.
- The mod holds one long poll per session on the server, with up to 25 seconds between answers.
