# Client Mode

*One area of the [Arlesh design specification](../../SPEC.md).*

The installed app runs in one of two **modes**. **Standalone** uses the local SQLite file, as the
app always has. **Client** makes the app a client of [`arlesh-server`](http-api.md) over HTTP, so
several devices share one board. This is phase 1 of multi-device (Task `9f0`, settled with the user
on 2026-10-30). The decisions and the reasons for them are in
[ADR 0011](../adr/0011-client-mode.md).

## Installing and switching

There is one install per operating system, and both modes are always built in. The SQLite side sits
behind the cargo feature `standalone`, which is on by default.

- **The first-run chooser** asks *This device only* (Standalone) or *Connect to a server* (Client).
- **Settings → Server** switches later. It asks for the server's URL and a token, tests them
  against `/health` and the API version, and then switches, with no reinstall. A server this app
  cannot write to is refused at the test, naming the side to update.
- **Switching restarts the app.** The choice is saved in `mode.json` in the app's data directory,
  and the app relaunches into it, so each run is wholly one mode: a Standalone run holds the
  database and serves the MCP, a Client run does neither, and nothing is torn down in between.
- **The top bar** shows the mode: *This device*, or *Server* with a dot for whether the server is
  reachable and its URL on hover.

The chooser is asked only on a device with no mode saved and no local database. An install from
before Client mode existed has a database and no setting: it is Standalone, and nobody is asked.
Until the chooser is answered the app runs Standalone, which is its first answer.

A device connects with a pasted URL and a token issued by `arlesh-server token add <device>`.
Pairing codes and a Devices page are a separate, later feature.

## The Backend port

The seam is a Rust **Backend port** (`src-tauri/src/backend/`). Every Tauri command that reads or
writes the board is a thin adapter that calls the `Backend` the app manages. There are two
implementations:

- **`SqliteBackend`**: the in-process `arlesh-core` over the local file. This is Standalone mode, and
  what the app always was.
- **`HttpBackend`**: reqwest calls to `arlesh-server`. This is Client mode.

The port is split by domain, one trait per command module, and `Backend` is all of them together,
so an implementation that misses an operation does not compile. The frontend keeps its single
`invoke` transport and is otherwise unchanged: it cannot tell which backend answers.

**What stays out of the port** is the shell, which is the same in both modes: windows, tabs, the
tray, close-to-tray, the window session, the local MCP endpoint's settings, and the pure scope
computations (`scope_containing`, `resolve_scope` and the rest), which need no board. Telling the
other windows that the board changed is the shell's as well: a backend reports *whether* a gesture
wrote, and the command announces it.

**`now` is the device's for reads.** A read that derives the board at an instant (the board, the
lists, the lifecycles, the dependency picker) is sent the device's clock in the device's time zone,
so a server in another time zone still answers for the user's day. A write is stamped by the
server's clock, as it would be by any other writer, so the server should run in the user's time
zone (`TZ`).

## REST parity

Every `Backend` method maps to one REST route in the [existing style](http-api.md#routes). A test
fails if a port method has no route or has no `HttpBackend` implementation.

**People and the knowledge base are out of Client scope.** That means people, events, threads and
knowledge-base links. There are no routes for them, `HttpBackend` refuses those calls as not
available in Client mode (`not_permitted`, `details.reason = "not_in_client_mode"`), and the UI
does not ask for them: a delegate Person is drawn unnamed. Their code and tables stay as they are.

The mapping is `conformance/client-mode.json`, tested from both sides: the app's
`backend/tests.rs` fails when a port method is in neither its `routes` nor its `standalone_only`,
and the server's `test_server_parity.py` fails when a listed route is not served.

## Live sync

The server streams changes over Server-Sent Events. `GET /events` sends `board-changed` with a
**revision** for each committed write, and honours `Last-Event-ID`. `HttpBackend` relays it to the
windows as the same Tauri `board-changed` event a Standalone write raises. After a reconnect it
reloads if the revision jumped.

## Undo

Undo is **per device**. Each device's token is its own client, so its writes are journaled under its
own name (see [Undo](undo.md), *Clients, and a second writer*). `POST /undo` and `POST /redo` act on
the calling client's stacks only, and today's conflict refusals still apply.

**A Gesture never crosses a request** (ruled by the user, 2026-10-30: *REST should support an
endpoint per gesture*). The ambient Gesture is one row the whole database shares, so one held open
between requests would take in another device's writes, and one left open by a device that died
would take in everyone's. Instead:

- **Every write request is one Gesture** of the calling client: the server opens it, runs the write
  in its own transaction, and closes it, under a per-file write lock so no other client's write
  lands inside it. A lone command is one undo step, as on the desktop.
- **Every gesture that issues several commands on the desktop is its own operation**, with its own
  Backend method and its own route under `/gestures`. The operation runs the whole gesture
  server-side as one request: one transaction, one Gesture, one undo step. The app calls the same
  operation in Standalone mode, so both modes run one implementation (`arlesh_core::nodes::gestures`).
- `HttpBackend` keeps the frontend's `open_gesture` and `close_gesture` on the device, where they
  only pair up; it sends nothing for them (`local` in the parity contract).

The gesture operations:

- **Delete nodes** (`POST /gestures/delete-nodes`): a multi-selection or an expanded subtree.
- **The listed-writes gestures**, each `POST /gestures/<name>` with the gesture's writes as its body:
  `paste` (copies or moves), `insert-parent`, `move-node` (a drag, with the clamps it asked about),
  `plan-tasks` (quick plan), `plan-move` (the Plan View), `save-task`, `save-goal`,
  `save-commitment`, `save-project`, `save-wait` (the wait editor's Save and its Create),
  `save-flow` (the Flow and Habit editor, its *Archive & new* included), `save-flow-item`, and
  `new-flow` (a new Flow or Habit). The writes run in order in one transaction; a later write names
  the node an earlier one made as `{"step": n}`, or the node a Habit fork replaced as
  `{"step": n, "forked": <kind>, "id": <old id>}`. Each gesture admits only the writes it makes,
  and refuses any other before writing. A write marked `may_be_refused` is taken back alone
  inside a savepoint and answered `{"refused": <error>}`: the two plan gestures mark every write,
  so one Task that cannot take the Plan does not stop the others, as before. Every other refusal
  refuses the whole gesture.

The frontend's prompts (the clamp-or-cancel question, the Plan clamp, the reconcile question) are
asked before the request, from reads, so the request carries the answers. Quick dependency is one
write already, and needs no operation of its own.

## Offline

When the server cannot be reached, the app shows the last board it loaded, **read-only**, under a
*Server unreachable* banner with the time of the last sync. A write is refused, writing nothing,
with `not_permitted` and `details.reason = "server_unreachable"`, which the window shows as any
refusal; nothing is queued. Offline writes are a later feature. Any call that gets through, or the
change stream reconnecting, makes the board writable again.

## Shared and local state

- **Shared, on the server:** the board, and the **agent capacity lock**, which has its own routes.
- **Local to each device:** preferences, and the window and tab session.

## MCP

In Client mode the app serves **no** MCP endpoint, and Settings → Agents shows no endpoint section;
the MCP roots and the capacity lock there are the server's. Agents talk to the server's `/mcp` directly, each
with its own token. This is the [HTTP Server](http-api.md)'s *the app serves none*.

## Tokens on the device

The token is kept in the OS keychain through the `keyring` crate (the macOS Keychain, the Windows
Credential Manager, the Secret Service on Linux), filed under the server's URL. If no keychain is
available, Settings → Server says so and offers to keep the token in `server-token` in the app's
data directory, readable by its owner only (mode 0600); it is not stored until the user ticks that.

## Versions

`/health` reports `api_version`, an integer bumped only on a breaking change, and the build commit.
On a mismatch the app goes read-only and says which side to update. `/health` is checked when the app
starts following the server and on every reconnect of the change stream, so a server upgraded
underneath a running app is noticed. A route the server lacks answers 404 with `details.reason =
"unknown_route"`, which the window shows as a refusal of that one action rather than a failure of
the board.

## Data

There is no sync between a device's local database and a server. A device switched to Client keeps
its local database untouched, and switching back finds it as it was. A server is seeded by copying
`arlesh.db` into its volume.

## Trying it: branch instances

`scripts/branch-instance.sh` runs a branch's server as well as its app, so any app branch can be
tried against any server branch — the version handshake included:

```
scripts/branch-instance.sh server start 9f0-client-mode              # arlesh-server from that worktree
scripts/branch-instance.sh start 201-client-gaps --server 9f0-client-mode
scripts/branch-instance.sh run some-app --standalone                 # back to the local board
scripts/branch-instance.sh stop all                                  # apps and servers
```

A server runs its worktree's own code (its bindings built into that worktree's venv) on its own
port, over a copy of the real database taken read-only (`sqlite3 -readonly … .backup`), seeded once
and kept. `--server` mints the app instance a token and writes its `mode.json` and its token file,
so the instance comes up connected; the token is never printed. `list` shows the servers too.

## Not in phase 1

Pairing codes and the Devices page, Postgres (later, through portable SQL), offline writes, and the
server's container image.
