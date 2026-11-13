# Agents

*One area of the [Arlesh design specification](../../SPEC.md).*

Who is calling the MCP, what each caller may see, and when it must stop. Settled with the user on
2026-11-07 (Task `7a0`); the reasoning is in [ADR 0018](../adr/0018-agents-claims-and-account-capacity.md).
The terms (Agent, Claim, Account, connect token, PIN, attach, child Agent, sub-Claim, sub-token)
are in `CONTEXT.md`. Child Agents were added on 2026-11-13 (Task `077`,
[ADR 0019](../adr/0019-child-agents-and-sub-claims.md)).

## Agents

An **Agent** is an MCP session that attached. It has a name (unique among Agents; a name taken
gets `-2`, `-3`), an **account** label (`default` if it gives none), the client's session id and
at most one **Claim**, plus a manual lock. Agents are rows of `agents`, in the database of the
app or the server. The `agents` and `agent_accounts` rows are **journaled** (migration 0102): the user's edits in Settings → Agents are undoable Gestures, and an agent's own writes are journaled under source `mcp` and stay off every stack ([Undo](undo.md), *Agents and Claims*); PINs, usage reports and the connect token are not journaled. They are listed in **Settings → Agents**, apart from the
Devices list: a device is a person's machine with a token; an Agent is a session of an AI client.

## Attaching

Every MCP session starts **unattached**: it sees nothing, and every tool but `arlesh_agents`
refuses with `not_permitted`, naming the way in. `arlesh_agents.attach(session_id, pin | token,
name?, account?, subtree?)`:

- With a **PIN** it makes a new Agent and answers its **agent token**, once. The token is a
  stored digest; keep it.
- With the agent **token** it brings the same Agent back, with its Claim, under a new session id
  (a restarted server, `claude --resume`).
- `subtree` claims in the same call. A refused claim does not lose the token: the answer carries
  `claim_refused` beside the Agent.

The session is then bound to the Agent for the rest of the connection. Subagents share the
connection; each is told apart by a **sub-token** (see *Child Agents*), and a call without one runs
as the session's Agent. The binding is in memory only. A session whose Agent was
removed by hand is turned away at its next call.

**PINs.** Asked for by a signed-in client, never by an agent token: from Settings → Agents (*New
PIN*), or from the desktop app's loopback door. Eight digits, valid five minutes, used once; at
most ten wait at once. Five wrong PINs within ten minutes shut the door for a while and empty the
pending PINs, so even the right PIN is refused until it has passed.

**The loopback door** is `POST /agents/pin` on the desktop's loopback endpoint, answering the PIN
and when it lapses. It answers only loopback connections and refuses any request carrying an
`Origin` header, so no web page can reach it. In Client mode, where the desktop serves no MCP
endpoint, it serves the door alone and forwards to the server as the signed-in device. The
arlesh-notify mod uses it to attach unprompted.

**The connect token** is the server's one credential for `/mcp`: low-privilege, admitting a
session and the attach tool and nothing else, issued with `arlesh-server connect-token` (issuing
replaces the old one). Device tokens do not work on `/mcp`. The desktop's own endpoint is loopback
and needs none.

## Claims

A **Claim** is a stored node (a Domain, Goal, Task, Commitment …) and its subtree. It is the
Agent's **whole view**: every tool reads, writes and creates as if the Claim were the agent's own
MCP root, and a request naming a node outside it is refused `not_permitted`, as a node that does
not exist is.

- **Inside the user's roots.** A node not readable through the user's MCP roots (outside them,
  private, deleted) cannot be claimed. Private nodes stay hidden inside a Claim.
- **One active Claim per node.** Claiming a node that is, or contains, or lies inside another
  Agent's active Claim is refused, naming that Agent. An Agent claiming again replaces its Claim.
  A child Agent's sub-Claim inside its parent's is the one exception (*Child Agents*).
- **Until released.** No expiry. `release` lets go; the Agent stays attached and sees nothing.
- **Pause.** `pause` (the agent) or **Pause** in Settings (the user) sets the Claim aside. Another
  Agent may then claim the subtree; the first keeps its token. A paused Claim **reads and writes
  nothing new**: it is read-only. `resume` makes it active again and is refused while another
  active Claim overlaps.
- **Judged afresh on every call.** The view is built from the board as it stands, so a node moved
  into or out of a Claim changes the agent's next call. The agent cannot move a Task out of its
  Claim (the new parent is outside its view). If a move by the user makes two active Claims
  overlap, the **older** keeps its place and the younger is **shadowed**.
- **Standing.** Shown in Settings: *Unclaimed*, *Active*, *Paused*, *Shadowed* (overlaps an older
  Claim) or *Unreachable* (the root was deleted, went private or left the user's roots). A
  shadowed or unreachable Claim sees nothing.
- **Its own Tasks.** A Task an agent creates hangs under a visible parent inside the Claim, so it
  stays visible and writable.

## Child Agents

A subagent of a session is a **child Agent**: an Agent row of its own with a link to the session's
Agent (`agents.parent_id`), nested under it in Settings → Agents. Ruled with the user on
2026-11-13; the reasoning and the choices made in design are in
[ADR 0019](../adr/0019-child-agents-and-sub-claims.md).

**Registering.** The session's Agent calls `arlesh_agents.register_child(name, client_id)`; the
answer carries the child and its **sub-token**, once. `client_id` is the client's own id for the
subagent (Claude Code's agent id), kept in the child's `session_uuid`. Registering it again answers
the same child with a **new** sub-token and the old one stops working: only the parent can ask, and
it asks when it has lost the token. A mod that still has its record resumes the child instead and
never registers again, so it does not rotate the token. A child cannot register children. The arlesh-notify mod does all of
this when a subagent starts, names the child from the subagent's description, and hands the
subagent its sub-token in its starting context; the subagent then claims the Task its brief names.

**The sub-token** is an optional argument, `sub_token`, on **every** tool. A call carrying it runs
as that child: it sees and writes only the child's **sub-Claim**. A call without it runs as the
session's Agent. The server accepts it only from the session whose Agent is the child's parent,
and refuses any other `not_permitted`. It is a convention between the session and its subagents,
not a security wall. It is not an agent token: attaching with it is refused, and the wait stream
answers it `401`. With a `sub_token`, `arlesh_agents` refuses `attach`, `register_child`, `lock`,
`unlock` and `report_usage` (`invalid_request`).

**The sub-Claim.** For a child, the parent's Claim plays the part the user's MCP roots play for an
Agent:

- A child may claim only **inside its parent's Claim**, while the parent's standing is Active or
  Paused; anything else is refused `not_permitted`.
- A sub-Claim is **not an overlap** with its parent's Claim, and blocks no other top-level Agent
  (the parent's Claim already does). Overlap is judged **within a level**: a child against its
  siblings, an Agent against the other top-level Agents. Two siblings may not hold overlapping
  active sub-Claims; of two that come to overlap by a move, the older keeps its place and the
  younger is shadowed.
- The **parent keeps its whole Claim**, the sub-Claims included, and still writes there.

**A child's standing** is derived each time, the first that holds:

| Condition | Standing |
| --- | --- |
| no sub-Claim | *Unclaimed* |
| the parent is Unclaimed, Shadowed or Unreachable, or the sub-Claim's root is not inside the parent's Claim | *Unreachable* (sees nothing) |
| its own Claim is paused, or its parent's is | *Paused* (reads, writes nothing) |
| an older sibling's active sub-Claim overlaps it | *Shadowed* (sees nothing) |
| otherwise | *Active* |

Nothing is written to the children when their parent pauses, is shadowed or is locked, so resuming
the parent restores each child as it was.

**Capacity follows the parent.** A child uses its parent's account; it is at capacity exactly when
its parent is, with the same cause, and has no lock of its own. Its Tasks are blocked through the
parent's Claim, which contains them.

**What a child is told when refused.** The generic "not inside the MCP roots" refusal hides two
causes a child can act on, so a child's refusal says them: a **Paused** child's write is refused
saying its Claim is paused and that its parent or the user resumes it; a node **outside the
sub-Claim but inside the parent's Claim** is refused saying it is outside the child's Claim and that
it may claim it with `arlesh_agents.claim` (which replaces its own). A node outside the parent's
Claim, or outside the MCP roots, keeps the generic words, so a child learns nothing its parent
could not see. A child may claim anything inside its parent's Claim, including nodes its siblings
do not hold.

**Finish and resume.** When the subagent stops, the mod pauses its sub-Claim (`arlesh_agents.pause`
with the `sub_token`); the child stays listed as Paused, still naming its Task. When the subagent is
resumed, the mod resumes it. Neither needs a step by the session's agent.

**Removal.** A child is removed, in the same write and the same Gesture:

- when its **parent is removed**, by hand or otherwise;
- when the **stored status of the Task its sub-Claim names becomes Done** (`done` or
  `agentic_done`), whoever set it. A sub-Claim on a Goal, Commitment or Domain is not removed by its
  node's state, and a Compound Task's derived Done does not remove it.

Both are database triggers, suppressed while undo replays, so Ctrl+Z on the Gesture brings the
child back with the Task's status or the parent. A child that comes back through undo is always
**Paused**, whatever it was when it went: it becomes Active when its subagent actually resumes.
Settings → Remove removes a child by hand.

An agent's writes are not on the undo stack (they are journaled under the `mcp` source), so a child
removed because an **agent** set its Task Done is **not** restored by the user's Ctrl+Z. That is
safe: if the Task is moved off Done again and the same subagent starts again, the mod finds its old
sub-token refused, registers the subagent afresh and hands it a new sub-token and a new child, and
it works as before.

**In Settings → Agents** the children of an Agent are folded under it, closed by default, with a
control that shows how many there are; an Agent with no children has no control. The open state is
not remembered.

**Nested subagents** (a subagent's own subagents) are not registered: the mod gives one the
sub-token of its nearest registered ancestor, so it works in that sub-Claim. Teammates and workflow
agents are not registered at all.

## Capacity per account

The agent reports its account's plan limits with `arlesh_agents.report_usage(windows)`, each
`{kind, percent_used, resets_at}`; the arlesh-notify mod does it on its own from the session's
usage (`session.measure`). The server keeps the last report of each window per account.

An Agent is **at capacity** when, at `now`:

1. it is locked by hand, or
2. its account is locked by hand, or
3. a window of its account is at 100% or more and its `resets_at` is still ahead.

This is derived on every load, so it lifts **at the reset** with no timer, across a restart. While
an Agent is at capacity, the Agentic Tasks inside its **active** Claim read blocked, with the
derived reason "Agents at capacity" (`derived: "agent_capacity"`); other Agents' Tasks do not. A paused,
shadowed or unreachable Claim blocks nothing. There is **no app-wide lock** any more (removed
2026-11-08, with `arlesh_capacity`, `GET`/`PUT /capacity` and `agent-capacity.json`): an Agent locks
itself with `arlesh_agents.lock` / `unlock`, and the user locks an Agent or an account in Settings
([MCP § Agent capacity](mcp-server.md#agent-capacity)).

Settings → Agents shows each Agent on two lines: `name · state · Account · last seen 2h` (dot
separators; the account as a name, the last seen short), and its Claim as one breadcrumb,
ancestors then the claimed node (`Growth › CODE › ARLESH › Bugfixes`), with no kind label. It can
pause, resume, release, lock, unlock and remove an Agent, and lock an account. A **child Agent** is
listed indented under its parent, as `name · state · last seen 2h` (the account is the parent's)
and its sub-Claim's breadcrumb; it can be paused, resumed, released and removed, not locked. The
padlock counts top-level Agents only, so a locked parent counts once. The Accounts list
collapses. Every one of those edits is undoable (see [Undo](undo.md)). The status bar's padlock
shows for any Agent at capacity, and opens this section. The Settings modal has a fixed frame, about its
former size, that scrolls inside rather than growing with a section. Accounts are labels the
agents declare; they are not authenticated against Claude, because no Pro or Max usage API is
documented (checked 2026-11-07).

## Nothing outside the Claim

Under an agent token nothing outside the Claim is visible, on any route or tool; under a
`sub_token`, nothing outside the sub-Claim. The tools read
through the agent's view. The wait stream, `GET /events/expectations`, answers only a request that
carries an agent token (`X-Arlesh-Agent-Token`, beside the connect token on a server) and tells
that agent only of waits hanging under a node inside its Claim (a child's waits hang inside its
sub-Claim, so its parent's stream tells them); a wait is judged by the node it hangs under, so a deleted wait is still told to the agent whose Claim held it. A request with no
agent token, or one no agent holds, is refused `401`. A claim by id is refused one way whether the
id is unknown, ambiguous or of another kind. The one thing an attach or claim tells an agent about
the others is the name of the agent whose Claim overlaps its own.

## What is not done

- No heartbeat or expiry on Claims.
- No per-Claim read/write split beyond Agentic: inside a Claim, Agentic Tasks are writable and
  the rest is read-only, as inside a root.
- A "held by" mark on the node antenna is not built.
