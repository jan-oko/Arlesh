# Notifying agents when a wait resolves

The user asked on 2026-11-02: *"Extend the MCP to use MCP channels. Let agents subscribe to an
agentic expectation and get a notification when it resolves."* A first draft of this ADR designed a
Claude Code channel carried by a stdio bridge. The user's response was *"Look into alternative
avenues for sending notifications to agents."* This revision compares every avenue the primary
sources document and recommends a layered design. The behaviour is specified in
[MCP Server](../spec/mcp-server.md), *Being told a wait resolved*. Nothing below that depends on an
open question is final until the user answers it.

## Status

proposed (2026-11-02). Not built. Supersedes the same day's channel-bridge draft, which was never
merged.

## Context

An agent hands a Task to the user by raising a question wait (`arlesh_waits.ask`), which puts the
Task in **Review**. Today it learns the answer only by polling `arlesh_waits.get`, and each poll
costs the model a turn and context. The alternative is to stop, and then the user has to restart it
by hand.

**Who waits.** The agents are Claude Code sessions the user runs:

- interactive local sessions (the terminal CLI, the desktop app's Code tab, VS Code);
- local sub-agents spawned with the Agent tool, which run in the **background** by default;
- possibly `claude -p` runs and Agent SDK applications;
- an orchestrator in a **cloud session** (claude.ai/code), with its sub-agents.

**What they reach.** Every one of them reaches Arlesh through its streamable-HTTP MCP endpoint, which
is served by the desktop app (Standalone, `http://127.0.0.1:4747/mcp`, loopback only, no
authentication) or proxied by `arlesh-server` (Client mode, `/mcp` behind a bearer token). Both serve
the same axum router, `arlesh_core::mcp::router`, on rmcp 3.4.

**The cloud gap.** A cloud session runs on Anthropic's infrastructure, so `127.0.0.1:4747` there is
the VM's own loopback, not the user's machine. A cloud session gets MCP servers only from the
repository's `.mcp.json`, which would point at that empty loopback, or from the user's **claude.ai
connectors**, whose traffic goes through Anthropic's servers to a host reachable from the internet.
Arlesh is neither, so **a cloud session cannot raise or read a wait today, and notifying it is moot
until it can**. Decision 9 says what that implies.

### The avenues, from the primary sources

Every fact here is from the pages listed under *Sources*, read on 2026-11-02 (Claude Code docs
current to about v2.1.310).

1. **Background command that exits on resolution (long-poll).** `run_in_background: true` starts a
   Bash command as a background task. The docs state the re-invocation per session kind:
   - **Interactive:** background commands have no time limit in a local terminal, desktop or
     VS Code session. The hooks reference describes a session that has ended its turn as *"paused
     waiting for background work to wake it back up"*, so a command that exits starts a turn.
   - **`-p`:** the run *stays open after its result* while a background command that the main
     conversation started is still running, *"Claude then takes one more turn with the outcome"*.
     In unattended sessions (`-p`, the Agent SDK, CI, cloud) a background command has a **time
     limit**: 30 min by default, or the `timeout` passed, up to **2 h** (10 min for a `-p` prompt
     given as text). At the limit Claude is told it stopped and can start it again.
   - **Background sub-agents:** *"A background subagent can leave a background Bash … command
     running past the end of its turn. When that command ends, Claude Code sends the subagent a
     notification."* A **foreground** sub-agent's background commands stop when its run ends.
   - **The Monitor tool** runs a command and feeds each output line back as an event. A watch has
     a deadline (5 min by default, 30 min at most, 10 min under `-p`), after which Claude is told
     once and can restart it. Background sub-agents keep Monitor. Monitor can also open a
     WebSocket, but it denies URLs that point at *"a private, link-local, or cloud-metadata
     address"*, and Arlesh serves no WebSocket anyway; it can run a command that reaches Arlesh.

   It works wherever there is a shell that can reach Arlesh, needs nothing installed if the
   endpoint is `curl`-able, and costs no model tokens while it waits. Its weakness is that the
   agent has to remember to start it, and to restart it after a time limit.

2. **MCP-native.**
   - **MCP tasks** (public beta, Claude Code v2.1.304 or later). A server may answer a `tools/call`
     with a task handle (`resultType: "task"`). Claude Code then polls `tasks/get` itself at the
     server's `pollIntervalMs` (clamped to 250 ms–30 s, default 2 s), at **no model cost**. When
     the task completes, *"if Claude is idle when the result arrives, Claude starts on it
     unprompted"*. A task on a remote server **survives exiting**: `claude --resume` follows it
     again and delivers a result that arrived meanwhile. The extension's own overview names *"human
     approvals"* as a use. **But** a call becomes a task only if the server is on protocol
     revision **2026-07-28**, the session fetches feature flags (not Bedrock, Vertex or Foundry),
     the call is from the **main conversation, not a sub-agent**, and the surface is the
     **terminal CLI**, an Agent SDK session or GitHub Actions (with `CLAUDE_AUTO_BACKGROUND_TASKS=1`
     for SDK and stream-json runs). The desktop app and the VS Code extension do not get MCP tasks,
     and neither does a one-shot `claude -p "<prompt>"`. rmcp 3.4 implements the extension
     (`model/task.rs`, SEP-2663) and knows revision 2026-07-28.
   - **A blocking tool call.** A main-conversation MCP call still running after 2 min is moved to a
     background task, and its result *"arrives as a task notification when the call settles"*.
     But an HTTP server's call is aborted after **5 min with no response or progress
     notification**, sub-agent calls never move to the background, and `-p` calls only with
     `CLAUDE_AUTO_BACKGROUND_TASKS=1`. Whether Claude Code sends a `progressToken`, which a server
     needs before it may send progress, is not documented.
   - **Resource subscriptions** (`resources/subscribe`, `notifications/resources/updated`) are in
     the MCP specification. Claude Code's MCP page documents resources only as `@` mentions and
     never mentions subscribing, so nothing says Claude Code would subscribe or act on an update.
   - **`notifications/message`** (logging) and **sampling**: Claude Code's MCP page documents
     neither as reaching the model. **Elicitation** is supported, but it asks the *user* a
     question through a dialog. It is not a way to tell the agent anything.
   - **`list_changed`** is acted on, but it refreshes tool lists. It starts no turn.

3. **Claude Code hooks.**
   - `SessionStart` and `UserPromptSubmit` can add context with plain stdout or
     `additionalContext`, and a `Stop` hook can block the stop and sees `background_tasks`. All of
     these run **at a turn boundary**. They wake no idle session.
   - **`asyncRewake: true`** on a command hook runs it in the background, and *"an `asyncRewake`
     hook that exits with code 2 wakes Claude immediately even when the session is idle"*. Its
     stderr is shown to Claude as a system reminder. The hook's `timeout` is enforced (default
     600 s, settable). So a `PostToolUse` hook matching `mcp__Arlesh__arlesh_waits` can long-poll
     each wait as the agent raises it and wake the session when it resolves, with no agent
     discipline at all. Under `-p`, async hooks are killed at teardown. Where the wake lands when
     the matched call was a sub-agent's is not documented.

4. **Cloud and remote sessions.**
   - **`claude -p "<message>" --cloud <session-id>`** is documented: it queues one message into a
     running cloud session from any machine where the user ran `claude auth login`, and exits
     without waiting. It needs an Anthropic account (not Bedrock, Vertex or Foundry) and the
     organization's `allow_remote_sessions` policy. The message arrives as the user's own.
   - **Cross-session messaging** (`SendMessage`, v2.1.224 or later): a message to an **idle**
     session *"starts a new turn"*. On the same machine it goes over a per-session **inbox socket**
     (`CLAUDE_CODE_MESSAGING_SOCKET`). The docs invite *"a script or hook to post into a session"*,
     but they document only the optional first line (`{"type":"auth","token":…}`), **not the frame
     that carries the message**. A message from a process that is not the session's child is a
     peer message: delivered to a session that prompts for permissions, **held for approval** in
     one that bypasses them. `-p` sessions bind a socket too. To reach a cloud session the sender
     must itself be a session connected to Remote Control.
   - **Scheduled-task API triggers** (`POST …/routines/<id>/fire`, research preview): the
     documented behaviour *"starts a new session"*; it does not wake an existing one. The token is
     made on the web only.
   - **Running the thread on the user's computer.** A claude.ai Project can run a thread *"on your
     computer"* through Remote Control. That thread is a local session and uses the local MCP
     servers, so everything local above applies.

5. **Channels.** As the first draft found, and confirmed: a custom channel is a stdio server that
   registers only under `--dangerously-load-development-channels`, with a confirmation dialog, in
   an **interactive** session, and is ignored under `-p` and the Agent SDK. An **allowlisted**
   plugin, named with `--channels plugin:…`, does work under `-p`. The allowlist is Anthropic's
   (`claude-plugins-official`), or `allowedChannelPlugins` in **managed settings of a Team or
   Enterprise organization**. Pro, Max and Ultra accounts without an organization skip the
   organization checks but have no allowlist of their own, so for them the only route off the
   development flag is Anthropic listing an Arlesh plugin, for which no process is documented. A
   channel is also **not registered on revision 2026-07-28**, the revision MCP tasks need, so one
   connection cannot have both. Events carry no acknowledgement and are dropped silently when the
   session has not loaded the channel.

6. **Other mechanisms.**
   - **Mods** (plugins with a hooks module, on by default from v2.1.287): a mod can run a timer
     (`$.clock.every`), call an MCP tool (`$.mcp.call`) or fetch over HTTP (`$.http.fetch`), and
     **start a turn when the session is idle** (`$.prompt.submit`). It can also deliver to one of
     the session's sub-agents (`$.session.send({ to: { agentId } })`). Mods run in the CLI, the
     desktop app, VS Code, `-p` and the SDK, and in a cloud session the plugin reaches. This is
     the most capable push, at the cost of the newest API.
   - **Plugin monitors** (`monitors/monitors.json`): a command that runs for the whole session and
     whose output lines reach Claude as notifications. They are not started under `-p`.
   - **Agent SDK streaming input:** the host application can push a user message into a running
     session at any time. Arlesh could only use it as a library; it is the SDK host's business.
   - **`claude -p --resume <id> "<prompt>"`** from a watcher process continues a session that is
     *not* running. On a running session the two processes interleave into one transcript. It is
     a way to restart a finished `-p` worker, not to notify a live one.

## Comparison

"Bg sub-agent" is a sub-agent running in the background, the default. A foreground sub-agent can
simply block on a foreground command. "Cloud" assumes the cloud session can reach Arlesh at all,
which it cannot today (decision 9).

| Avenue | Interactive | `-p` | SDK | Bg sub-agent | Cloud | User setup | Latency | Busy / offline | Arlesh builds |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Background long-poll** (`curl` in `run_in_background`, or Monitor) | yes, no time limit | yes, ≤2 h then restart | yes, ≤2 h then restart | yes | yes, if reachable | none | ~1 s | Busy: queued to the next turn. Offline: nothing runs; re-read on restart | the waiter, one HTTP route |
| **MCP task** (`arlesh_waits.await`) | CLI main conversation only (not desktop app, not VS Code) | stream-json only, with an env var | yes, with an env var | no | not listed | none (beta, v2.1.304+) | poll interval, ~5 s | Busy: queued. Exit: resumed with `--resume` | task answers, `tasks/get`, revision 2026-07-28 |
| **`asyncRewake` hook** | yes | no (killed at teardown) | yes | unverified | if the plugin reaches it | install a plugin or add a hook | ~1 s | Busy: next turn. Session end: lost; re-read on restart | hook script |
| **Mod** (`$.prompt.submit`) | yes | while the run lives | yes | via `$.session.send` | if the plugin reaches it | install a plugin | the mod's timer | Busy: waits for idle | a mod |
| **Plugin monitor** | yes | no | unverified | no | if the plugin reaches it | install a plugin | ~1 s | Busy: queued | a monitor command |
| **Turn-boundary hooks** (`UserPromptSubmit`, `Stop`) | next prompt only | next turn only | next turn only | no | if reachable | add a hook | until the next turn | never wakes | a summary read |
| **Channel** (stdio bridge) | dev flag + dialog each launch | no | no | no | no | bridge binary, launch flag | ~10 s (bridge timer) | Busy: queued. Not loaded: dropped silently | a bridge crate |
| **`--cloud` push** | n/a | n/a | n/a | n/a | yes | claude.ai login on the machine | seconds, plus VM resume | queued in the session | run `claude` on resolution; record the target |
| **Inbox socket** (local) | yes | yes | unverified | no | no | none | ~1 s | queued; held if bypassing permissions | undocumented frame |
| **Polling `get`** (today) | yes | yes | yes | yes | if reachable | none | the agent's pace | n/a | nothing |

## Decisions

1. **One core waiter, no subscription state.** The core gains a pure rule that turns a wait's
   `(seen, current)` state into zero or one **resolution** (decision 5), and a waiter,
   `await_waits(ids, timeout)`, that returns as soon as any named wait has resolved relative to
   *pending*, or answers `pending` at the timeout. It wakes by re-reading the named waits once a
   second (one indexed read), and moves to the board revision once Task 9298 lands it. *Why:* a
   wait resolves through many paths (the Review card, the Task editor, the wait's editor, `Enter`
   in any view, another agent's `release`, a REST route, undo and redo, archive and delete
   cascades). A re-read catches all of them and cannot drift as paths are added. Because the caller
   states what it last saw, there is nothing to store: a waiter lost to a restart, a time limit or
   a `--resume` is simply started again, and a resolution that happened meanwhile is answered at
   once. This removes the first draft's subscription lifetime and identity questions.

2. **The universal surface is an HTTP long-poll beside `/mcp`.** `GET /waits/await?ids=…&timeout=…`
   is served on the same listener as the MCP endpoint, under the same rules: loopback `Host` only
   and any `Origin` refused in Standalone; behind the bearer token in Client mode, where
   `arlesh-server` proxies it as it proxies `/mcp`. The MCP instructions tell an agent to start
   it with `run_in_background: true` (or under Monitor) right after it raises a wait, and to start
   it again when a time limit stops it. *Why:* it is the only avenue that reaches interactive
   sessions on every surface, `-p`, the SDK and background sub-agents, with nothing to install.
   `curl` is enough. One route on the core's router serves both modes.

3. **`arlesh_waits.await(ids)` is the MCP face of the same waiter.** For a client that declares the
   tasks extension, it answers with an **MCP task**, and `tasks/get` answers from the waiter: the
   resolution when it has one, `working` until then, with `pollIntervalMs` 5000. For any other
   client it answers at once with the current states and the exact background command to run. It
   never blocks. *Why:* where MCP tasks work (the CLI's main conversation, the SDK), they are
   zero-setup, token-free, and survive `--resume`, which nothing else does. A blocking call
   instead would depend on undocumented progress handling and would hang sub-agents.
   **This needs the endpoint on revision 2026-07-28** (OQ 2). `ask` and `raise` stay immediate,
   because the agent needs the wait's id and the Task must read Review at once.

4. **Automation is an optional Arlesh plugin, not a requirement.** A Claude Code plugin, published
   from a marketplace of the user's own, carries a `PostToolUse` hook on `mcp__Arlesh__arlesh_waits`
   with `asyncRewake: true`. On each `ask` or `raise` result it long-polls that wait and exits 2
   with the resolution, which wakes an idle session even when the agent forgot to start a waiter.
   The plugin also carries a short skill. *Why:* it closes the "agent forgot" gap for interactive
   and SDK sessions at the cost of one install, with no launch flag and no allowlist. Plugins need
   no allowlisting; only channels do.

5. **What "resolved" means.** It is the first draft's table, unchanged:
   - `answered`: a question wait went pending → released. It carries the answer.
   - `released`: a non-question wait went pending → released.
   - `archived`: it was archived while pending.
   - `gone`: it can no longer be read (deleted, its Task deleted, out of the roots, made private).
     These are indistinguishable by design, as `not_permitted` is.
   - `reopened`: released → pending. Only a caller that passes `seen=released` can see it
     (OQ 4).

   A lapsed Time Scope makes a wait Overdue, which is not a resolution. Waits do not expire.

6. **Every surface carries the same event.** A resolution is a small JSON object with `wait_id`,
   `wait_short_id`, `task_id`, `task_short_id`, `resolution`, `answer`, `released_at` and
   `released_by`, plus a readable `text` line. The HTTP route returns it as JSON, or as the text
   line with `format=text` (what a background command's output should be). The MCP task's result
   carries both. `released_by` is the journal source of the release: `desktop`, a Client-mode
   device's name, or `mcp`.

7. **The answer is data, and the event says who wrote it.** An answer released by `mcp` came from
   an agent with write access to the Task, not from the user, and the instructions say so. Through
   a background command, the answer reaches the model as tool output, which it treats as data. That
   is a better footing than a channel event or a pushed user message. Whether agent-written answers
   should be delivered at all is OQ 5.

8. **Channels are not built now.** They are kept below as a rejected option. *Why:* every property
   they would add for an interactive session, a push that wakes an idle session, is available
   without a launch flag, a warning dialog or a bridge binary through decisions 2–4. Channels reach
   fewer kinds of session than the long-poll, have no acknowledgement, and cannot share a
   connection with MCP tasks. Revisit if Anthropic lists an Arlesh channel plugin.

9. **Cloud sessions: reach first, push second.** No notification design helps a session that cannot
   read the board. The cheap, supported route is to **run threads that wait on Arlesh on the
   user's computer** (a Project's "Work locally", or Remote Control), where decisions 2–4 apply
   unchanged. Putting Arlesh itself in reach of the cloud means serving `arlesh-server` on the
   internet as a claude.ai custom connector, which is a security step the Access model never
   took. Once a cloud session can reach Arlesh, the documented push is
   `claude -p "<event>" --cloud <session-id>`, run on the user's machine by the app when a wait
   that names a cloud session resolves. Both are deferred to OQ 6.

10. **Polling stays.** `arlesh_waits.get` and the snapshot answer exactly as before. Every
    surface's instructions tell the agent to call `get` when it is unsure.

## Considered options

- **A. A channel through a stdio bridge** (the first draft). Rejected for now; see decision 8. The
  draft's design (a proxying `arlesh-channel` binary that declares `claude/channel`, answers
  `initialize` on a revision before 2026-07-28, and diffs subscribed waits on a 10 s timer) stays in
  the git history (commit `b2560319`) if the allowlist changes.
- **B. A blocking `arlesh_waits.await` MCP tool.** Rejected: an HTTP tool call is aborted after
  5 min without progress, Claude Code's `progressToken` behaviour is undocumented, and sub-agent
  calls never move to the background, so a sub-agent would hang in it.
- **C. Resource subscriptions**, one resource per wait. Rejected: nothing in Claude Code's
  documentation says it subscribes or acts on `notifications/resources/updated`.
- **D. Posting into the session's inbox socket** from the app. Promising, since it wakes idle
  sessions of every local kind, `-p` included, with no setup. Deferred: the message frame is not
  documented, and a session that bypasses permissions holds such messages for approval. The spike
  (Delivery, PR 1) may record the frame. Building on it waits for Anthropic to document it.
- **E. A mod instead of the hook.** Deferred: it is the most capable (it can wake a sub-agent), but
  the API is the newest. The plugin of decision 4 can gain one later without changing the core.
- **F. Scheduled-task API triggers.** Rejected: a fire starts a new session; it does not wake the
  one that waits.
- **G. Durable subscriptions in the database.** Rejected: decision 1 needs none.

## Consequences

- Interactive sessions on every surface, `-p`, the SDK and background sub-agents can all be woken
  with nothing installed, as long as the agent starts the waiter. The CLI's main conversation and
  the SDK need not even do that, once MCP tasks are confirmed. The plugin removes the remaining
  reliance on the agent's discipline.
- Cloud sessions are not served until OQ 6 is answered. That is a property of where Arlesh runs,
  not of the notification design.
- The core gains `get_many`, the resolution rule, the waiter, `released_at` and `released_by` on
  wait answers, one HTTP route on the MCP router, and task support on one tool. No new binary.
- No model-map change. A waiter is a request in flight, not a concept of the board.

## Sources

Claude Code documentation, read 2026-11-02:

- Tools reference (background commands, time limits, Monitor, WebSocket source):
  <https://code.claude.com/docs/en/tools-reference>
- Interactive mode, *How backgrounding works*: <https://code.claude.com/docs/en/interactive-mode>
- Run Claude Code programmatically, *Background tasks at exit*, resuming:
  <https://code.claude.com/docs/en/headless>
- Subagents (background sub-agents' tools and background-command notifications):
  <https://code.claude.com/docs/en/sub-agents>
- MCP (client runtimes, revision 2026-07-28, automatic backgrounding, time limits, MCP tasks, MCP
  tasks for server authors, elicitation, resources): <https://code.claude.com/docs/en/mcp>
- Hooks reference (`async`, `asyncRewake`, Stop input, timeouts):
  <https://code.claude.com/docs/en/hooks>
- Channels and the channels reference (allowlist, `allowedChannelPlugins`, the development flag
  under `-p` and the SDK): <https://code.claude.com/docs/en/channels>,
  <https://code.claude.com/docs/en/channels-reference>
- Cross-session messaging (delivery to idle sessions, inbox socket, inbound controls):
  <https://code.claude.com/docs/en/cross-session-messaging>; the socket variables:
  <https://code.claude.com/docs/en/env-vars>
- Use Claude Code in the cloud (*Send follow-ups from the CLI*, `--cloud`):
  <https://code.claude.com/docs/en/claude-code-on-the-web>; cloud environments (connectors,
  `.mcp.json`): <https://code.claude.com/docs/en/cloud-environments>
- Projects (*Run a thread on your own computer*, connectors for cloud threads):
  <https://code.claude.com/docs/en/claude-projects>
- Remote Control: <https://code.claude.com/docs/en/remote-control>
- Scheduled tasks (API trigger, `/fire`): <https://code.claude.com/docs/en/routines>
- Mods (timers, `$.prompt.submit`, `$.session.send`, where mods run):
  <https://code.claude.com/docs/en/plugins/mods/api>,
  <https://code.claude.com/docs/en/plugins/mods/overview>
- Plugin monitors: <https://code.claude.com/docs/en/plugins/components>,
  <https://code.claude.com/docs/en/plugins/manifest-reference>
- Agent SDK streaming input: <https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode>

The MCP specification and the tasks extension:

- **`modelcontextprotocol.io` is blocked by this session's network policy** (the proxy refuses the
  CONNECT with 403). The same documents were read from the specification's source repository
  instead: resources and subscriptions
  <https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-11-25/server/resources.mdx>,
  streamable HTTP
  <https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-11-25/basic/transports.mdx>,
  and the tasks extension overview
  <https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/extensions/tasks/overview.mdx>
  (canonical: <https://modelcontextprotocol.io/extensions/tasks/overview>). The full tasks
  specification lives in `modelcontextprotocol/ext-tasks`, which was not read.
- rmcp 3.4.0's source (`src/model/task.rs`, `src/model.rs` `ProtocolVersion::KNOWN_VERSIONS`), from
  the local cargo registry.

Not verified, and left to the spike: the scheduled-task `/fire` reference on platform.claude.com
(not fetched); whether a `--cloud` message resumes a cloud session whose VM was reclaimed; the
inbox socket's message frame; where an `asyncRewake` wake lands for a sub-agent's tool call.

## Open questions

The open questions are listed in [MCP Server](../spec/mcp-server.md), *Being told: open
questions*, so the spec and this ADR cannot drift apart. The user's answers will be recorded here.
