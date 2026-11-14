# ADR 0018: agents, subtree Claims and capacity per account

Status: accepted 2026-11-07 (Task `7a0`), settled with the user in a design session.
Subagents are no longer covered by their session's attach alone: see
[ADR 0019](0019-child-agents-and-sub-claims.md) (child Agents, 2026-11-13).

## Context

Until now the MCP had one set of roots for every session, one global capacity lock with no
expiry (removed in this ADR, see *Decision*), and no notion of which agent was which. Two agents could write the same subtree, a
session saw the whole of the user's roots, and on 2026-10-03 every agent hit the usage limit at
once with nothing to say which of them was blocked or when it would lift. Device tokens, which
name a *device*, were also the only credential the server's `/mcp` took, so an agent held a
device's full authority.

## Decision

**An MCP session attaches as an Agent, and is bound to it.** An unattached session may call one
tool operation, `arlesh_agents.attach`. A one-time **PIN** from a signed-in client (or the agent
**token** an earlier attach answered) makes or restores an **Agent**: a name, an **account** label,
a session id and at most one **Claim**. The binding is made once per session and covers every
call over it, so the subagents of a client, which share its connection, need nothing further.

*Why a bound session and not per-session headers.* A mod cannot change an MCP server's headers
(checked in the Claude Code documentation on 2026-11-07), and the headers of `.mcp.json` are the
same for every session of a project. The MCP session is the one identity the connection already
has. It costs the server a session id: the Python `/mcp`, which was stateless, now issues an
`Mcp-Session-Id` at `initialize` and keeps the binding behind it, and the desktop endpoint uses
`rmcp`'s per-session handler factory, one handler (and one binding) per session. The binding is
**in memory**: a server restart drops it, the client starts a new session, and the agent attaches
again with the agent token it was given (the arlesh-notify mod does this unprompted).

**A Claim is a subtree and it is the agent's whole view.** Reads and writes are limited to it as
if it were the agent's own MCP root, inside the user's roots, with private nodes hidden. Only one
**active** Claim may cover any node, ancestors and descendants included.

*Why until released, with pause.* An expiry would lose the work of an agent that is simply
thinking; a heartbeat would make a closed laptop release a subtree. A Claim therefore lasts until
released. To keep one agent from sitting on a subtree for good, a Claim can be **paused** by the
agent or by hand: another agent may then claim the subtree while the first keeps its token, and
resuming is refused while an active Claim overlaps. A paused Claim is **read-only**.

**Usage is per account.** An agent declares an account label; a mod reports percent used and reset
time for each plan limit window (`$.session.usage()` and the `session.measure` event). An agent is
at capacity while any window of its account sits at 100% before its reset, or while it or its
account is locked by hand. This is *derived* from the last reports and `now`, so it lifts at the
reset by itself, across a restart, with no timer to miss. At capacity, the agent's claimed Agentic
Tasks read blocked (the derived reason "Agents at capacity"); other agents' do not. Accounts are declared labels and are not authenticated against Claude:
no usage API is documented as of 2026-11-07.

**The doors.**

- *PIN.* Eight digits, one use, five minutes, at most ten pending; five wrong PINs within ten
  minutes shut the door for a while and empty the pending PINs. Issued from Settings → Agents, or
  through the desktop's loopback door (`POST /agents/pin`, loopback only, any request carrying an
  `Origin` header refused). In Client mode the desktop forwards to the server with its device token.
  An agent token cannot mint a PIN, so an agent cannot approve another.
- *Connect token.* One low-privilege token per server (table `connect_tokens`), issued with
  `arlesh-server connect-token`. It admits a session to `/mcp` and lets it call the attach tool,
  nothing else. **Device tokens stop working on `/mcp`.** The desktop's own loopback endpoint needs
  no connect token.

**Storage.** The tables are migration 0101: `agents`, `agent_pins`, `agent_pin_failures`,
`agent_accounts`, `agent_account_usage`, `connect_tokens`. `agent_pins`, `agent_pin_failures`,
`agent_account_usage` and `connect_tokens` are not journaled (`undo::EXCLUDED_TABLES`): operational
state, not choices to take back. `agents` and `agent_accounts` are journaled from migration 0102
(next section). Secrets are kept as SHA-256 digests. The rules (overlap,
shadowing, standing, capacity, PIN lifetime) are pure functions in `agents/rules/` (ADR 0010); the
persistence and the composite operations are in `agents/store.rs` and `agents/service.rs`; both
hosts, the app and `arlesh-server`, use them.

### The design questions

1. **Session binding on both paths.** Python `/mcp`: a session id issued at `initialize`, a
   registry in the core, `404` for an unknown id so the client starts over. Desktop: `rmcp`'s
   per-session factory. After the server loses the binding, the client re-attaches with its
   agent token; the Agent and its Claim outlive the session.
2. **Moved subtrees.** Nothing is cached: the view is rebuilt on every call, so a node moved out
   of a Claim is gone from that agent's next call, and a move out of the Claim by the agent itself
   is refused (the new parent is outside its view). A user's move can make two Claims overlap; the
   **older Claim keeps its place** and the younger is **shadowed**: it sees nothing and is shown as
   such until the overlap goes.
3. **A paused Claim.** Read-only inside the Claim.
4. **A Claim's root archived, deleted or moved.** Archived: the Claim stays, the Tasks read
   archived. Deleted, made private, or taken out of the user's MCP roots: the agent sees nothing
   and Settings shows the Claim as unreachable. Moved: the Claim follows the node.
5. **The loopback PIN door, both modes.** Served by the desktop on loopback in Standalone and in
   Client mode; reachable by local processes only and by no web page. In Client mode it forwards
   to the server as the signed-in device.
6. **An agent's own Tasks.** A Task created under a node of the Claim hangs under a visible parent
   inside the Claim, so it is visible and writable at once.
7. **Which agent holds a subtree.** Settings → Agents lists every Agent with its Claim, standing,
   account and usage, beside (and apart from) the Devices list. A "held by" mark on the node's
   antenna tooltip is not part of this decision.

**Undo (decided 2026-11-08, from the user's hand test).** First cut: no agent table was journaled,
on the reasoning that Ctrl+Z must not revoke an Agent. The user asked for Claim management to be
undoable instead, so `agents` and `agent_accounts` are journaled by their triggers (migration
0102, a new migration, since 0101 had run in real databases). Every Settings → Agents action —
pause, resume, release, lock, remove, account lock — is a command through the ordinary door, so one
Gesture on the user's stack; Ctrl+Z / Ctrl+Shift+Z reverse and reapply it, and the Settings modal
carries its own undo binding while it is open (deferring to the field inside an input). Chosen over
a command journal because the journal is trigger-written row images: two sets of triggers, no new
mechanism, no inverse per command. An agent's own writes are journaled under source `mcp` and stay
off every stack. A removed agent's token digest sits only in the session-scoped journal. Undo
restores the row as it was, which can leave two active Claims overlapping if another agent claimed
meanwhile; the shadowing rule (older keeps its place, younger sees nothing) tolerates it, so undo
needs no check. See [Undo](../spec/undo.md), *Agents and Claims*.

**The app-wide capacity lock is removed (2026-11-08).** The `agent-capacity.json` file, the
`arlesh_capacity` MCP tool, `GET`/`PUT /capacity`, the `agent_capacity` / `set_agent_capacity`
commands and backend methods, the `agent-capacity-changed` event, the Settings switch and the
`at_capacity` parameter of the board load are gone. Capacity is per agent and account; an agent
locks itself with `arlesh_agents.lock` / `unlock`, the user locks an agent or an account in
Settings. The derived block reason stays (`derived: "agent_capacity"`, "Agents at capacity") but is
produced only for the Agentic Tasks in the Claim of an agent at capacity. A client calling
`arlesh_capacity` is answered `tool not found`: the breaking change the user asked for. The status
bar's padlock shows for any agent at capacity, and opens Settings on the Agents section.

## Consequences

- An existing `/mcp` user on a server has to move to a connect token, and each session has to
  attach. **Rollout for a server:** run `arlesh-server connect-token` where the server runs, put
  the printed token in the `Authorization` header of the project's `.mcp.json` in place of the
  device token, and install or update the arlesh-notify mod so attaching is automatic; without
  the mod, give the agent a PIN from Settings → Agents. Revoke nothing: the device tokens keep
  working for the app, only not on `/mcp`.
- Every board read on a bound session rebuilds the agent's view: one catalogue read and a pass
  over the Claims.
- Agents are identified by what they declare. The account label is trust, not proof.
- The wait stream (`/events/expectations`) is scoped by the same view. It answers only a request that carries an agent token (`X-Arlesh-Agent-Token`, beside the connect token on a server), and tells that agent only of waits hanging under a node inside its Claim. A wait is judged by the node it hangs under, so a deleted wait is still told to the agent whose Claim held it. A caller with no agent token, or one no agent holds, is refused 401; under an agent token nothing outside the Claim is visible on any route or tool. A claim by id answers one way for an id that is unknown, ambiguous or of another kind, so it cannot be used to probe what exists outside the view.
