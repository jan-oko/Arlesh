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
local config), Arlesh running (the desktop app, or `arlesh-server`), and `curl` on the machine. It
has no settings: it follows the same URL with the same headers the session's MCP connection uses.

## What it does

- Records every wait the session passes through `arlesh_waits.ask`, `raise` or `watch`, per session
  (kept in the mod's store for 30 days, so a restart or `claude --resume` still watches them).
- Holds `/events/expectations?agentic=true` open with `curl`, and on every (re)connect reads the
  watched waits once (`arlesh_waits.get_many`) to catch up on what changed while it was away.
- Wakes the session with the pointer message. A sub-agent that raised the wait gets it while it is
  running; once it has finished, the agent that spawned it does, with the sub-agent named.
- Tells the model, in the system prompt, "Arlesh notifications are on in this session" (only when an
  `Arlesh` server is configured).

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
