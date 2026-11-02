# An agent learns that its wait resolved through a Claude Code channel, carried by a stdio bridge

The user asked on 2026-11-02: *"Extend the MCP to use MCP channels. Let agents subscribe to an
agentic expectation and get a notification when it resolves."* This ADR records the design and the
constraint that shapes it. The behaviour is specified in [MCP Server](../spec/mcp-server.md),
*Channels: being told a wait resolved*. Several product questions are left to the user; they are
listed at the end and nothing below that depends on one is final until they are answered.

## Status

proposed (2026-11-02). Not built.

## Context

An agent hands a Task to the user by raising a question wait (`arlesh_waits.ask`), which puts the
Task in **Review**. Today it learns the answer only by polling `arlesh_waits.get`, and each poll
costs the model a turn and context. Or it stops and the user has to restart it by hand.

**Claude Code channels** are the push mechanism. They are a research preview. Here is the protocol
as published on 2026-11-02, from the primary sources listed at the end:

- **Capability.** The server declares `capabilities.experimental["claude/channel"] = {}` in its
  `initialize` result. That is what makes Claude Code register a listener.
- **Notification.** The server sends `notifications/claude/channel` with `params.content` (a
  string, the event body) and an optional `params.meta` (`Record<string, string>`). Each meta key
  becomes an attribute of the `<channel source="<server name>" …>` tag the model sees. Keys must be
  identifiers (letters, digits, underscores). Other keys are **dropped silently**.
- **No acknowledgement.** The notification promise resolves when the message is written to the
  transport, not when Claude has seen it. If the session has not loaded the server as a channel, or
  policy blocks it, the event is **dropped silently** and the server gets no error. Events that
  arrive while Claude is busy are queued and delivered together on the next turn.
- **Transport: stdio.** The reference says a channel *"runs on the same machine as Claude Code.
  Claude Code spawns it as a subprocess and communicates over stdio"*, and lists *"Connect over
  stdio transport"* as a requirement. Nothing documents an HTTP server as a channel.
- **Opt-in, per session.** A server in `.mcp.json` is not enough. It must also be named at launch,
  with `claude --channels plugin:<name>@<marketplace>` (allowlisted plugins only) or
  `claude --dangerously-load-development-channels server:<name>` (anything, after a warning dialog).
  During the preview `--channels` accepts only plugins on Anthropic's allowlist
  (`claude-plugins-official`), or on an organization's `allowedChannelPlugins` (Team and
  Enterprise). **A custom channel such as Arlesh's runs only under the development flag.**
- **Interactive only for the development flag.** Under `-p` or the Agent SDK, Claude Code *ignores*
  `--dangerously-load-development-channels` and the channel does not register.
- **Policy and auth.** Channels need claude.ai or Console API-key authentication (not Bedrock,
  Vertex or Foundry). claude.ai Team and Enterprise block them until an Owner sets
  `channelsEnabled`. Pro, Max and Ultra users without an organization skip that check.
- **Protocol revision.** On Claude Code's v2 MCP client runtime, a channel server that negotiates
  MCP revision **2026-07-28** is not registered, because that revision cannot carry channel
  messages. Claude Code asks stdio servers for that revision by default. The server must answer
  with an earlier revision, or the user sets `MCP_PROTOCOL_NEGOTIATION=legacy`.

Arlesh's endpoint is **streamable HTTP**, hosted by the desktop app (Standalone) or reached through
`arlesh-server`'s `/mcp` proxy (Client mode, ADR 0011 decision 9). Both serve the same Rust router
(`arlesh_core::mcp::router`, rmcp 3.4). Claude Code connects to it as an HTTP server and does not
spawn it, so **as it stands it cannot be a channel.**

## Decisions

1. **A stdio bridge, `arlesh-channel`, is the channel.** It is a small process that Claude Code
   spawns. Towards Claude Code it is a stdio MCP server that declares `claude/channel`. Towards
   Arlesh it is an MCP client of the existing HTTP endpoint (`--url`, plus `--token` for
   `arlesh-server`). It **proxies every `arlesh_*` tool unchanged**: `tools/list` and `tools/call`
   are forwarded, and the upstream's `initialize` instructions are passed on with one paragraph
   about channels added. The user registers it *in place of* the HTTP entry, under the same name
   `Arlesh`, so the tool prefix stays `mcp__Arlesh__`.
   *Why:* stdio is the only documented channel transport. A full proxy, rather than a second
   one-way server beside the HTTP one, means the bridge sees the agent's own `ask` and `raise`
   calls, so it knows which waits are its session's without any correlation key. The agent also
   keeps one server, not two.

2. **The endpoint does not change transport, and no channel capability is declared over HTTP.**
   *Why:* nothing documents a channel over HTTP. Declaring it there would do nothing at best. The
   bridge's design does not stop the core from emitting `notifications/claude/channel` itself later
   (see *Considered options*, B), if Claude Code ever accepts HTTP channels.

3. **One implementation serves both modes.** The bridge talks to whichever endpoint it is given:
   the app's `http://127.0.0.1:4747/mcp` in Standalone, or `https://<server>/mcp` with a device
   token in Client mode. The core's tools serve both, so any core change lands in both at once.
   *Why:* the desktop app in Client mode serves no MCP (ADR 0011, decision 9), so the server's
   `/mcp` is the only endpoint there. It is the same router, so nothing is written twice.

4. **The bridge holds the subscriptions, in memory, for the life of its Claude Code session.**
   A subscription is a wait id plus the last state the bridge saw. *Recommended, pending the user's
   answer to open question 3.* *Why:* a channel event can only reach the session that spawned the
   bridge, and the bridge lives exactly as long as that session. A subscription stored in the
   database would outlive the only receiver that could use it, and it would add an identity for
   "which session" that Arlesh does not have (there is no agent identity in Standalone, and in
   Client mode a token names a device, not a session).

5. **Resolution is detected by re-reading, not by instrumenting each write path.** On each wake, the
   bridge reads its subscribed waits in one call (`arlesh_waits.get_many`, new) and compares each
   with what it last saw. A pure rule turns `(previous, current)` into zero or one event. It wakes
   on a timer (default 10 s), and in Client mode also on each `board-changed` from `GET /events`.
   *Why:* a wait resolves through many paths: the app's Review card, the Task editor, the wait's
   editor, `Enter` in any view, another agent's `release`, a REST route, undo and redo, and archive
   or delete cascades. A diff on read catches all of them and cannot drift as paths are added. The
   timer is the floor, because Standalone has no event stream an external process can hear. A few
   loopback reads every 10 s cost nothing next to the model polling, which is what this replaces.

6. **What "resolved" means.** A subscribed wait produces an event on these transitions, and on no
   others:
   - `answered`: a question wait went pending → released. It carries the answer.
   - `released`: a non-question wait went pending → released.
   - `archived`: it was archived while pending. It was set aside unanswered.
   - `gone`: it can no longer be read (deleted, its Task deleted, a root removed, or made private).
     `get` cannot tell these apart, deliberately (`not_permitted`), so neither can the event.
   - `reopened`: released → pending again (the user took the release back, or undid it). *Pending
     the user's answer to open question 5.*

   A Time Scope that lapses makes a wait **Overdue**, not resolved. Waits have no expiry, so there
   is no `expired`. After `answered`, `released`, `archived` or `gone`, the subscription ends,
   unless `reopened` is kept, in which case it stays until the agent unsubscribes or the Task is
   done.

7. **At-least-once from Arlesh to the bridge. At-most-once into the conversation. Dedup in the
   bridge.** Each event has an `event_id`: the wait's full id, the resolution, and `released_at` (or
   the archive or reopen instant). The bridge sends an id once per process. Claude Code gives no
   acknowledgement, so whether the model saw the event cannot be known. If the session did not load
   the bridge as a channel, the event is lost silently. *Why:* that is the channel contract, and
   nothing on Arlesh's side can make it stronger. The board stays the truth. `arlesh_waits.get`
   still answers, and the instructions tell the agent to use it whenever it is unsure.

8. **Reconnects lose nothing the board still shows.** If the upstream session expires (rmcp's
   `LocalSessionManager` is in memory, so an app or server restart drops it) or the connection
   fails, the bridge initializes a new upstream session and re-reads every subscription at once.
   A resolution that happened while it was disconnected therefore still produces its event. A wait
   that resolved and was then reopened while the bridge was away produces nothing, because the
   bridge compares states and not histories.

9. **Visibility is the only gate. A subscription sees what `get` sees.** Subscribing needs read
   access to the wait, as `get` does, not write access to its Task. *Recommended, pending the user's
   answer to open question 4.* *Why:* an event carries nothing `get` would not return, so it reveals
   nothing new. In Client mode the bridge's token is the agent's device token, and the server
   applies that client's roots as it does for every tool.

10. **The answer is user text, and the event says who wrote it.** The answer reaches the model as
    channel content, and the channel documentation calls an ungated channel a prompt-injection
    vector. Here the only writers are the user's own app and agents with write access to that Task,
    and the second is a real path: another agent can `release` a question with an answer it made
    up. So the event carries `released_by`, the journal source of the gesture that released it:
    `desktop`, a named Client-mode device, or `mcp`. The bridge's instructions say that an answer
    from `mcp` came from an agent, not from the user. Whether such answers should be delivered at all is
    open question 7.

11. **Clients without channels poll, as today.** Nothing about `arlesh_waits.get` changes. An HTTP
    client, a bridge run without the channel flag, a `-p` session and a cloud session all keep
    working exactly as now.

## Considered options

- **A. HTTP endpoint declares `claude/channel` and notifies on the session's GET stream.** The
  smallest change, but nothing documents it working. Rejected unless the spike (Delivery, PR 1)
  shows Claude Code accepts it. If it does, decisions 5–9 still hold, with the core in the bridge's
  place.
- **B. A subscription registry in the core, pushing a custom `notifications/arlesh/wait_resolved`
  on the upstream session, which the bridge translates.** Lower latency, and any HTTP MCP client
  could use it. But it needs a commit signal that every writer in the process raises. The desktop
  has none on master: app commands emit `board-changed` to windows, and only MCP writes reach the
  MCP's `Announce`. The revision that Task 9298 adds (PR #158, unmerged) is that signal. Deferred:
  the bridge's wake source can switch to it once it lands, without changing the event.
- **C. A one-way channel server beside the HTTP one.** The agent would pass a correlation key from
  the bridge's instructions into each `ask`. Rejected: it is fragile and needs two server entries.
- **D. Durable subscriptions in the database.** See decision 4 and open question 3.

## Consequences

- The feature works only in an **interactive** Claude Code session started with
  `--dangerously-load-development-channels server:Arlesh`, which shows a warning dialog at each
  launch. It does not work under `-p`, through the Agent SDK, or in cloud sessions. That covers the
  orchestrator's own sub-agents, which are where much of the waiting happens today. This lasts until
  Anthropic allowlists the plugin or an organization adds it to `allowedChannelPlugins`, so it is
  worth saying plainly to the user before it is built (open question 1).
- A new binary to ship: `arlesh-channel`, in a new workspace crate. Where it is installed from is
  open question 6.
- The core gains one read (`arlesh_waits.get_many`) and two fields on every wait answer
  (`released_at`, `released_by`). Nothing else in the core changes.
- No model-map change. A subscription is state of a bridge process, not a concept of the board.

## Sources

- Claude Code, *Push events into a running session with channels*:
  <https://code.claude.com/docs/en/channels> (research preview, opt-in flags, allowlists,
  `channelsEnabled` and `allowedChannelPlugins`, auth requirements).
- Claude Code, *Channels reference*: <https://code.claude.com/docs/en/channels-reference>
  (capability, notification format, meta key rule, no acknowledgement, queuing, stdio, the
  development flag ignored under `-p` and the SDK, permission relay).
- Claude Code, *MCP*, "Push messages with channels" and "MCP client runtimes":
  <https://code.claude.com/docs/en/mcp> (no channel on revision 2026-07-28 under the v2 runtime,
  `MCP_PROTOCOL_NEGOTIATION=legacy`).
- The MCP specification (modelcontextprotocol.io) could not be fetched from the design session,
  because its host is outside the session's allowed network. The streamable-HTTP facts above
  (sessions, the GET stream) are from rmcp's behaviour as Arlesh already uses it.

## Open questions

The open questions are listed in [MCP Server](../spec/mcp-server.md), *Channels: open questions*,
so the spec and this ADR cannot drift apart. The user's answers will be recorded here.
