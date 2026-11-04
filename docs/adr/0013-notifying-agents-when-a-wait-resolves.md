# Notifying agents when a wait resolves

The user asked on 2026-11-02: *"Extend the MCP to use MCP channels. Let agents subscribe to an
agentic expectation and get a notification when it resolves."* The first draft designed a Claude
Code channel carried by a stdio bridge. A second draft (also 2026-11-02) compared every avenue
Claude Code documents and proposed layers: a background long-poll (`/waits/await`), MCP tasks, and
an optional plugin hook. In a design session on **2026-11-04** the user settled on one mechanism, a
**Claude Code mod**, and made the decisions recorded below. They are settled. The earlier designs
are kept under *Considered options*.

The behaviour is specified in [MCP Server](../spec/mcp-server.md), *Being told a wait resolved*.

## Status

accepted (2026-11-04). Not built. Supersedes both 2026-11-02 drafts, neither of which was merged.
The open questions are listed in the spec, *Being told: open questions*. Each one is about how
the decisions are carried out, not about whether they stand.

## Context

An agent hands a Task to the user by raising a question wait (`arlesh_waits.ask`), which puts the
Task in **Review**. Today the agent learns the answer only by polling `arlesh_waits.get`, and each
poll costs the model a turn and context. The alternative is to stop, and then the user has to
restart it by hand.

The agents are Claude Code sessions on the user's computer: interactive sessions (terminal, the
desktop app's Code tab, VS Code), their sub-agents, and possibly `claude -p` runs and Agent SDK
applications. They reach Arlesh through its streamable-HTTP MCP endpoint. The desktop app serves it
(Standalone, `http://127.0.0.1:4747/mcp`, loopback only, no authentication), or `arlesh-server`
serves it behind a bearer token (Client mode). Both serve the core's router,
`arlesh_core::mcp::router`.

## Decisions (2026-11-04)

1. **Mechanism.** A Claude Code mod subscribes to an Arlesh Server-Sent Events stream and wakes the
   session when a wait it watches changes. It needs no MCP tasks, no channel and no `/waits/await`
   long-poll.

2. **Which waits a session watches.**
   - Every wait the session raised. The mod sees the results of `arlesh_waits.ask` and
     `arlesh_waits.raise` through a hook.
   - Every wait the agent passes to a new MCP operation, `arlesh_waits.watch(ids)`. On the server it
     only validates the ids and returns their current state. The mod picks the ids up through the
     same hook.
   - A watch lasts as long as the session. Filtering the stream costs nothing.
   - Watches are stored on disk per session id, so they survive a restart and `claude --resume`.
     Stored entries are dropped after about 30 days.

3. **Which changes wake the agent.**
   - The wait is released or answered.
   - The wait is archived or deleted. The agent is told it is gone.
   - The wait is reopened, by undo or by hand.

   Edits to a pending wait (its title or note) do not wake the agent.

4. **Event streams on the server.**
   - `/events/changes` is today's "board changed, revision N" stream under a new name. **It
     replaces `/events` outright.** The apps switch to it in the same PR, and no alias is kept.
   - `/events/expectations?agentic=true` is new. It carries typed wait events (wait id, Task id,
     status, archived or deleted), so the mod filters by id and never re-reads.
   - The desktop app's Standalone HTTP server (beside `/mcp`) and `arlesh-server` both serve both
     streams.

5. **Catching up after a disconnect: read on (re)connect.** The mod keeps the last state it saw of
   each watched wait. On every connect it reads them once (`get_many`), delivers what changed, then
   follows the stream. The server keeps no history.

6. **Delivery.**
   - It behaves as a finished background shell command or sub-agent does today. An idle session is
     woken. A busy one gets it at the next point where the harness surfaces background events.
   - **The message is a pointer only.** It is explicitly labelled as an Arlesh notification, for
     example *"Arlesh notification: wait W-123 on Task 4ab changed (released); read it with
     `arlesh_waits.get`"*. It does not quote the answer, and it makes no difference between a
     resolution made through MCP and one made by hand.
   - **Sub-agents.** The sub-agent that raised the wait gets the notification if it is still
     running. If it has finished, the session that spawned it gets it, with the sub-agent named.

7. **Configuration and distribution.**
   - The mod reuses the session's configured `Arlesh` MCP server entry, its URL and headers, and
     opens the streams on the same origin with the same authentication. It has no settings of its
     own.
   - It ships as `plugins/arlesh-notify/`, with a `.claude-plugin/marketplace.json` in this
     repository.

8. **How agents learn of it: four layers**, each with its own job. Only the mod's own note says
   that notifications are actually on in a session, so no agent is promised a wake-up it won't get.
   - **The Arlesh MCP server instructions and tool descriptions** carry the protocol, and say
     nothing about whether the mod is present: what `arlesh_waits.watch` does, and "if your session
     says Arlesh notifications are on, rely on them; otherwise don't wait on a wait".
   - **`AGENTS.md`** carries this repository's policy.
   - **The orchestrating-agents skill** covers the orchestrator: briefs carry the same rules to
     sub-agents, and a notification is the cue to re-read the board.
   - **The mod, at SessionStart,** injects one line: *"Arlesh notifications are on in this session:
     waits you ask, raise or `arlesh_waits.watch` will notify you when they change; don't poll."*

9. **What agents do.**
   - *With the mod, after raising a wait it is blocked on:* if it has other unblocked work, it
     carries on. Otherwise it ends the turn and stays idle, and the notification wakes it. It never
     polls `arlesh_waits.get` and never sleeps. A sub-agent reports back and finishes, and the
     parent session gets the notification.
   - *With the mod, on a notification:* it reads the wait with `arlesh_waits.get`, and its Task,
     then acts on the answer as the user's input to that question, within the usual rules. Anything
     ambiguous means it asks again. A **released** wait: it acts on the answer. A **reopened** one:
     it stops any work that depended on it. A **gone** one: it treats the question as withdrawn,
     and asks if that is unclear.
   - *Without the mod:* it still raises the hand-back wait, so the board stays truthful
     (`AGENTS.md`). It does not wait on that wait. It also asks the question in the conversation:
     to the orchestrator, or to the user if it is a top-level session. Then it ends the turn or
     reports back. The answer comes back through the conversation.

10. **Scope.** Cloud sessions are out of scope. They cannot reach a local Arlesh.

## What the mod API allows

Checked on 2026-11-04 against the Claude Code docs (*Use the mods API* and *Mods reference*, which
cover the CLI and the desktop app as of v2.1.290 and VS Code as of v2.1.299) and against the
TypeScript declarations written by Claude Code **v2.1.318** for its own build (`claude-code.d.ts`),
which the docs name as the complete reference. The skill `plugin-authoring` points at both.

| Question | Answer | Source |
| --- | --- | --- |
| Can a mod hold a long-lived streaming HTTP connection? | **Not through `$.http.fetch`.** It "resolves `{ status, ok, headers, text }` once the body is read", one call has a **30 s** limit including the body, and the body is capped at 4 MiB. An SSE stream never ends, so a fetch on it can never deliver an event. **But `$.process.spawn`** "starts a command on the host … and streams what it writes, piece by piece", and the declarations give, as an example, "a child for the session's life: the loop runs on after the hook returns, and ends with the child or with the module". A `curl -N` child therefore holds the stream. The declarations label `$.process` **"CLI only"**. | API: *Reach files, processes, and the network*; Reference: *Limits*; d.ts `http.fetch`, `process.spawn` |
| `$.prompt.submit` | "Submits a prompt … a turn of its own, once the session is idle". It "waits until the session is idle and then starts a new turn", and resolves when that turn starts. It is "never folded into a running turn". Claude reads the text after "a sentence that names your mod as the sender" ("The <name> plugin sent a message: …"). After the user interrupts a turn it resolves `{ drop }`, and the docs show retrying from `turn.complete`. So it **wakes an idle main session**, and it waits out a busy one. | API: *Start a turn from a background job*, *Calls and background work after the user interrupts a turn*; d.ts `PromptOrigin`, `PromptSubmitArgs` |
| Delivering into a **running** turn | `$.session.append({ message: { type: "user", content }, agentId? })` "REALLY appends a user-role row the person does not see as typed … the model reads it", to the main conversation or to **a running sub-agent's**. "The row is in the list at once and in a running turn's requests from the loop's next top." An `agentId` that names no running loop is refused. It starts no turn. | d.ts `session.append`; reference.md (skill) on `session.append` |
| `$.session.send` | The SendMessage tool's own delivery, to `{ sessionId }`, `{ agentId }` (a sub-agent or teammate) or an address. It resolves once queued. **A finished sub-agent "is resumed from its transcript with the message"**: not what decision 6 wants. After an interrupt, a send to a finished sub-agent is refused, and one to a running sub-agent is still received. | API: *Send and receive messages between sessions*; d.ts `SessionSendAddress` |
| Knowing which loop is running | `turn.start`, `turn.step` and `turn.complete` carry `agentId` (absent on the main loop). `$.agent.list()` gives each sub-agent's status: `pending`, `running`, `waiting`, `idle`, `completed`, `failed` or `killed`. | Reference: *Mods API methods*, *Turns* |
| Hooks on MCP tool results | `on("tool.call", { tool }, hook)` sees every tool call. `await next(e)` returns the tool's result. `e.agentId` names the sub-agent's loop (absent on the main loop), and `e.server` gives the MCP server's config key and the **scope it came from** (`user`, `project`, `local`, `dynamic`, `managed`, …). The settings hooks are also hookable as `classic.PostToolUse`. | Reference: *Tools*, *Settings hook events*; d.ts `AgentLoop`, `McpServerProvenance` |
| SessionStart injection | A mod hooks `classic.SessionStart` and answers with `additionalContext`, which SessionStart supports, as do **`SubagentStart`** and `PostToolUse`. `classic.SessionStart` fires on `startup`, `resume`, `clear`, `compact` and `fork`. The mod's own `session.start` fires once per load, "not after `/clear`, `/resume`, or `/branch`". | Reference: *Session*, *Settings hook events*; d.ts `ClassicResult`, `SessionStartHookInput` |
| Persistent per-session storage | `$.store`: "a JSON key-value store of your plugin's own, kept between sessions", which "every session on the machine shares", **4 MiB of JSON in total**. `$.session.id()` is "the transcript file's name". `$.state` is per session and survives a hot reload, not a restart. | API: *Reach files…*; Reference: *Mods API methods*, *Limits* |
| Reading the configured MCP servers | **There is no API for it.** `$.mcp.call(server, tool, args)` calls a tool "with the engine's own connection and credentials", but nothing returns a server's URL or headers. `$.settings.read` reads the `settings.json` sources, which do not hold `mcpServers`. What exists: `$.fs` reads the config files, `$.env.get` reads environment variables, and `e.server.source` on a `tool.call` says which scope the `Arlesh` entry came from. | Reference: *Mods API methods*; API: *Read all settings…* |
| Where mods run | The reference covers the CLI, the desktop app and VS Code. `-p` and the Agent SDK run mods; their refusals are documented. | Reference (intro); API: *Calls refused in `claude -p` runs…* |

### Where the API meets the decisions

- **The stream (decision 1, 4).** Possible, but not the way the decisions assumed. A mod cannot read
  an SSE response through `$.http.fetch`, so it runs `curl` as a child process for the session's
  life with `$.process.spawn` and parses its output. `curl` ships with macOS, Linux and Windows 10
  (1803) or later. The declarations mark `$.process` "CLI only", and the docs' own background
  example calls `$.process.run` with no such caveat, so **whether the desktop app's Code tab and
  VS Code allow it is unverified**. The spike (Delivery, PR 1) answers it, and OQ 1 holds the
  fallback.
- **Reading the `Arlesh` entry (decision 7).** Not possible through an API. The nearest workable
  way is to read the same configuration files Claude Code reads, choosing the file by the scope
  that `e.server.source` names (OQ 2). The catch-up read needs no URL at all, because `get_many`
  goes through `$.mcp.call` on the session's own MCP connection.
- **Delivery to a busy session (decision 6).** `$.prompt.submit` alone would wait for the turn to
  end. `$.session.append` reaches a running turn at its next model request, which is where Claude
  Code surfaces background events. So the mod uses both: it appends into a running loop, and it
  submits to an idle one. An append is confirmed by the loop's next `turn.step`. If the loop ends
  first, the mod re-routes. See the spec, *Delivery*.
- **Sub-agents (decision 6).** Possible. The mod records the `agentId` of the call that raised the
  wait, then reads `$.agent.list()`. If the sub-agent is running or waiting, the mod appends into
  it. An idle teammate is sent the notification with `$.session.send`, which wakes it. A
  sub-agent that has finished is **not** sent anything, because `$.session.send` would resume it.
  The main conversation gets the notification instead, naming the sub-agent.
- **The SessionStart note (decision 8).** Possible, through `additionalContext` on
  `classic.SessionStart`. The same line also goes to every sub-agent through `classic.SubagentStart`,
  because a sub-agent does not see the main conversation's context.
- **Per-session storage (decision 2).** Possible. The mod stores one `$.store` key per session id.
  `$.store` is shared by every session on the machine and capped at 4 MiB, so the 30-day pruning is
  a real need, not a nicety.

## Considered options

- **A. A channel through a stdio bridge** (the first draft, 2026-11-02). Rejected. A custom channel
  registers only under `--dangerously-load-development-channels`, with a dialog on every launch, in
  interactive sessions only. Off that flag it needs an allowlisted plugin: Anthropic's list, or
  `allowedChannelPlugins` in a Team or Enterprise organization's managed settings. Events carry no
  acknowledgement. A channel is not registered on MCP revision 2026-07-28. The draft's
  `arlesh-channel` design stays in git history (commit `b2560319`).
- **B. A background long-poll, `GET /waits/await`** (the second draft's universal surface). An
  agent started `curl …/waits/await?ids=…` as a background command after raising a wait.
  Rejected on 2026-11-04. It depended on each agent remembering to start the waiter and restart
  it after a time limit (30 min to 2 h in unattended sessions). The mod watches every wait the
  session raises without the agent's help.
- **C. MCP tasks, `arlesh_waits.await`.** Rejected on 2026-11-04. It reached only the terminal
  CLI's main conversation and the Agent SDK: not sub-agents, not the desktop app, not VS Code. It
  needed the endpoint to move to revision 2026-07-28.
- **D. An `asyncRewake` `PostToolUse` command hook** (the second draft's optional plugin). It is
  superseded by the mod, which can do the same and also route to a sub-agent and inject the
  SessionStart note. Its async hooks were also killed when a `-p` run ended, and where a sub-agent's
  wake would land was not documented.
- **E. Posting into the session's inbox socket** (`CLAUDE_CODE_MESSAGING_SOCKET`). Rejected: the
  message frame is not documented, and a session that bypasses permissions holds such messages for
  approval.
- **F. Resource subscriptions, logging notifications, sampling.** Rejected: Claude Code documents
  none of them as reaching the model.
- **G. Scheduled-task API triggers.** Rejected: a fire starts a new session, and does not wake the
  one that waits.
- **H. Server-side history, or durable subscriptions in the database.** Rejected by decision 5. The
  mod keeps what it last saw, and a reconnect reads the current state, so the server needs neither.
- **I. The mod polling `get_many` on a timer** (`$.clock.every` and `$.mcp.call`). It is not chosen,
  because the decisions call for a stream. It is the fallback for a surface where `$.process` is
  refused (OQ 1). It costs no model turn either way.

## Consequences

- Every local session with the mod installed is woken when a wait it raised or watched changes,
  with nothing for the agent to remember. A session without the mod behaves exactly as today, and
  the instructions say so instead of promising a wake-up.
- The server gains two SSE routes, a change feed in the core (so the desktop app has a revision
  too), a wait-change differ, and two read operations (`get_many`, `watch`). It keeps no history.
- `/events` disappears. Every app and server version moves together. Because the route is part of
  Client mode's contract, its `api_version` goes up (OQ 6).
- The repository gains a plugin and a marketplace, which is the first plugin code it holds. The
  plugin is TypeScript, tested with `claude plugin test`.
- Cloud sessions remain unserved. That follows from where Arlesh runs, not from this design.
- No model-map change. A watch is a session's interest, kept by the mod, not a concept of the
  board, and the streams are transport.

## Sources

Read on 2026-11-04:

- Use the mods API: <https://code.claude.com/docs/en/plugins/mods/api> (sections *Run work in the
  background*, *Start a turn from a background job*, *Calls and background work after the user
  interrupts a turn*, *Send and receive messages between sessions*, *Reach files, processes, and
  the network*).
- Mods reference: <https://code.claude.com/docs/en/plugins/mods/reference> (*Events* → *Tools*,
  *Turns*, *Session*, *Subagents*, *Settings hook events*; *Mods API methods*; *Limits*).
- Claude Code's TypeScript declarations for mods, as written by v2.1.318 for its own build
  (`claude-code.d.ts`, which the reference names as the complete reference; public copy:
  <https://github.com/anthropics/claude-code/blob/main/mods/types/claude-code.d.ts>). The entries
  used are `$.http.fetch` and `HttpResponse`, `$.process.spawn`, `$.prompt.submit` and
  `PromptOrigin`, `$.session.append`, `$.session.send` and `SessionSendAddress`, `AgentLoop`,
  `McpServerProvenance`, `ClassicResult`, `SessionStartHookInput`, `$.store`, and `$.mcp`.
- The `plugin-authoring` skill's `reference.md` (same build), on `session.append` and on work that
  outlives a dispatch.

For the considered options, the 2026-11-02 sources still apply: the tools reference, interactive
mode, headless runs, sub-agents, MCP (tasks and revision 2026-07-28), hooks (`asyncRewake`),
channels and the channels reference, cross-session messaging, and scheduled tasks, all under
<https://code.claude.com/docs/en/>.
