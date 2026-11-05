# arlesh-notify

A Claude Code mod that wakes a session when an Arlesh wait it raised or watches changes: released
(answered), reopened, archived or deleted. The message is a pointer only ("Arlesh notification:
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
with the same headers the session's MCP connection uses, and needs nothing else on the machine.

## What it does

- Records every wait the session passes through `arlesh_waits.ask`, `raise` or `watch`, per session
  (kept in the mod's store for 30 days, so a restart or `claude --resume` still watches them).
- Long-polls `/events/expectations?agentic=true&after=<revision>&wait=25` with `$.http.fetch`, one
  request at a time: the server answers as soon as a wait changes, else empty after the wait. With
  no cursor, or after the server restarted, it reads the watched waits once
  (`arlesh_waits.get_many`) to catch up on what changed while it was away. If requests time out
  early the wait is halved, down to 5 seconds. After three failures in a row it says once in the
  transcript that Arlesh cannot be reached, and keeps trying with a backoff.
- Wakes the session with the pointer message. A sub-agent that raised the wait gets it while it is
  running; once it has finished, the agent that spawned it does, else the session, with the
  sub-agent named either way. A sub-agent is also notified of a release it made itself.
- Tells the model, at session start, "Arlesh notifications are on in this session" (added to the
  session-start context, and only after one quick request to the server succeeded).

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
