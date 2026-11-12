# arlesh-notify

A Claude Code mod that makes a session an Arlesh **agent** and wakes it when an Arlesh wait it
raised or watches changes: released (answered), reopened, archived or deleted. The message is a pointer only ("Arlesh notification:
wait 7c0 on Task 9a1 changed (released); read it with `arlesh_waits.get`"), so the agent reads the
wait itself.

## Install

```
/plugin install arlesh-notify --marketplace jan-oko/Arlesh
```

or, from a checkout, for one session:

```
claude --plugin-dir plugins/arlesh-notify
```

It needs an `Arlesh` HTTP server in the session's MCP configuration (`.mcp.json`, or your user or
local config; in a git worktree the main checkout's local entry counts, as for Claude Code), and
Arlesh running (the desktop app, or `arlesh-server`). It has no settings: it follows the same URL
with the same headers the session's MCP connection uses. On a server, that header is the **connect
token** (`arlesh-server connect-token`), put in `.mcp.json`; the mod reads it from there. Optional
environment variables:

| Variable | Meaning |
| --- | --- |
| `ARLESH_ACCOUNT` | The account label the session works under, so usage is tracked per account (default `default`). |
| `ARLESH_CLAIM` | A subtree to claim on attach, as `node_type:node_id`, e.g. `project:ARL`. |
| `ARLESH_DOOR_PORT` | The desktop app's loopback door port when the server is not on this machine (default 4747). |

## What it does

- **Attaches the session as an agent**, with no action from the agent. Arlesh's MCP endpoint lets
  an unattached session call only `arlesh_agents.attach`, so at session start the mod asks for a
  one-time PIN from the PIN door (`POST /agents/pin`): the Arlesh server's own origin when that is
  this machine (the desktop app's local endpoint), else the desktop app's loopback door on
  `http://127.0.0.1:4747`, which asks the server it is connected to. It then attaches through
  `$.mcp.call` with the session id, a name made from the project directory, the account and, if set,
  the subtree to claim. The agent token the server answers is kept per session (30 days), so
  `claude --resume` and a server restart attach again with the token, not a PIN; a server that
  turns the session away as "not attached" gets an attach again. If no door answers the session
  stays unattached and its start-of-session context says so and what to do: ask for a PIN in
  Settings → Agents and call `arlesh_agents.attach` with it.
- **Reports plan usage** (`$.session.usage()` rate limits: percent used and reset time per window)
  at session start and whenever `session.measure` shows a window moved a whole point, at most once
  every five minutes otherwise, so the server holds back the agents of an account at its limit and
  frees them at the reset.

- **Registers each subagent as a child agent** of the session's agent, when the session is
  attached. When a subagent starts (`SubagentStart`), the mod calls `arlesh_agents.register_child`
  with the subagent's description as its name and Claude Code's agent id as its `client_id`, keeps
  the **sub-token** it answers (per session, 30 days), and adds to the subagent's starting context
  who it is, its `sub_token`, and that it should claim the Task its brief names with
  `arlesh_agents.claim`. The child shows in Settings → Agents nested under the session's agent,
  with its Task as its Claim. Every Arlesh call a subagent makes without a `sub_token` gets its own
  filled in, so it acts on its sub-Claim only; the session's own calls carry none and act on its
  whole Claim.
  - When the subagent **stops**, the mod pauses its Claim (`arlesh_agents.pause` with the
    sub-token): the child reads Paused, still naming its Task. When it is **resumed**, the mod
    resumes the Claim. Nothing is asked of the orchestrating agent.
  - The child is removed by Arlesh when its Task is set Done or the session's agent is removed;
    the mod then forgets it.
  - A subagent started by a subagent is not registered: it gets the sub-token of the subagent that
    started it. Teammates and workflow agents are not registered.
  - In the terminal, the subagent's `Agent(…)` row gets one dim line under it,
    `Arlesh · <Task short id and title> · Active` (or `Paused`). Claude Code's list of background
    tasks cannot be changed by a mod and shows nothing of it.
  - When the session is not attached, or Arlesh is not running, nothing is registered and the
    subagent is told nothing: its Arlesh calls behave as the session's would.
- Records every wait the session passes through `arlesh_waits.ask`, `raise` or `watch`, per session
  (kept in the mod's store for 30 days, so a restart or `claude --resume` still watches them).
- Long-polls `/events/expectations?agentic=true&after=<revision>&wait=25` with `$.http.fetch` (sending the session's agent token, so it hears only of waits inside its Claim; an unattached session does not poll), one
  request at a time: the server answers as soon as a wait changes, else empty after the wait. With
  no cursor, or after the server restarted, it reads the watched waits once
  (`arlesh_waits.get_many`) to catch up on what changed while it was away. If requests time out
  early the wait is halved, down to 5 seconds. After three failures in a row it says once in the
  transcript that Arlesh cannot be reached, and keeps trying with a backoff.
- Wakes the session with the pointer message. A sub-agent that raised the wait gets it while it is
  running; once it has finished, the agent that spawned it does, else the session, with the
  sub-agent named either way. A sub-agent is also notified of a release it made itself.
- Tells the model, at session start, "Arlesh notifications are on in this session" and a short block:
  that the session tracks work on Arlesh, whether and as whom it is attached, what it has claimed,
  and how to claim, pause, resume or release a subtree (a Claim is its whole view). Added to the
  session-start context only after one quick request to the server succeeded; the Arlesh server's
  own instructions hold the rest.

## Try it

1. Start Arlesh and a session with the plugin loaded.
2. Ask the agent to claim a Task and `arlesh_waits.ask` you something, then end its turn.
3. Answer in the app (Review card). The idle session wakes with the notification.

Cloud sessions cannot reach a local Arlesh and are out of scope.

## Develop

```
claude plugin validate plugins/arlesh-notify
claude plugin test plugins/arlesh-notify
```
