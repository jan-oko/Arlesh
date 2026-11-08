# Agents

*One area of the [Arlesh design specification](../../SPEC.md).*

Who is calling the MCP, what each caller may see, and when it must stop. Settled with the user on
2026-11-07 (Task `7a0`); the reasoning is in [ADR 0018](../adr/0018-agents-claims-and-account-capacity.md).
The terms (Agent, Claim, Account, connect token, PIN, attach) are in `CONTEXT.md`.

## Agents

An **Agent** is an MCP session that attached. It has a name (unique among Agents; a name taken
gets `-2`, `-3`), an **account** label (`default` if it gives none), the client's session id and
at most one **Claim**, plus a manual lock. Agents are rows of `agents`, in the database of the
app or the server, **not journaled**. They are listed in **Settings → Agents**, apart from the
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
connection and need nothing further. The binding is in memory only. A session whose Agent was
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
derived reason of the global lock ("Agents at capacity"); other Agents' Tasks do not. A paused,
shadowed or unreachable Claim blocks nothing. The **global lock** ([MCP § Agent
capacity](mcp-server.md#agent-capacity)) stays as a master switch over everything.

Settings → Agents shows each Agent's name, subtree, account, status and usage, and can pause,
resume, release, lock, unlock and remove an Agent, and lock an account. Accounts are labels the
agents declare; they are not authenticated against Claude, because no Pro or Max usage API is
documented (checked 2026-11-07).

## Nothing outside the Claim

Under an agent token nothing outside the Claim is visible, on any route or tool. The tools read
through the agent's view. The wait stream, `GET /events/expectations`, answers only a request that
carries an agent token (`X-Arlesh-Agent-Token`, beside the connect token on a server) and tells
that agent only of waits hanging under a node inside its Claim; a wait is judged by the node it
hangs under, so a deleted wait is still told to the agent whose Claim held it. A request with no
agent token, or one no agent holds, is refused `401`. A claim by id is refused one way whether the
id is unknown, ambiguous or of another kind. The one thing an attach or claim tells an agent about
the others is the name of the agent whose Claim overlaps its own.

## What is not done

- No heartbeat or expiry on Claims.
- No per-Claim read/write split beyond Agentic: inside a Claim, Agentic Tasks are writable and
  the rest is read-only, as inside a root.
- A "held by" mark on the node antenna is not built.
