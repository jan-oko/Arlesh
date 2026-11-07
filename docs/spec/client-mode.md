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
  On Android the restart is `MainActivity.restartApp` (a relaunch through `RestartActivity`), called
  from Rust over JNI; a release build keeps that method by name (`proguard-rules.pro`), and when the
  call fails the person gets an error naming the fix (close and reopen the app), not a silent
  no-op. Switching the backend in place was weighed and not chosen: the database, the MCP
  endpoint, the undo log and the change stream are all set up once at start-up.
- **The top bar carries no mode indicator** (decided with the user, 2026-11-02: it had been *This
  device*, or *Server* with a dot for whether the server is reachable and its URL on hover, and
  the phone's bar already dropped it, [Touch](touch.md)). Where the server cannot be reached, or
  speaks another API version, the *Server unreachable* / version banner (`ServerBanner`, below the
  bar) says so and why the board is read-only; the rest lives on Settings → Server.
- **Settings → Server has a status line**: the mode and, in Client mode, the server's URL, whether
  it answers, when the board was last synced and whether the server's version suits this app.

The chooser is asked only on a device with no mode saved and no local database. An install from
before Client mode existed has a database and no setting: it is Standalone, and nobody is asked.
Until the chooser is answered the app runs Standalone, which is its first answer.

A device connects either by **pairing** (below) or with a pasted URL and a token issued by
`arlesh-server token add <device>`.

## Pairing a device

*Task 289, settled with the user 2026-11-01.* The server runs on a LAN or a tailnet, so pairing is
deliberately simple, not RFC 8628's device-code flow. A new device gets its own token without anyone
copying one.

1. **The connect screen** takes the server's URL and a **device name**. On Android that is the first
   run (the *Connect to a server* step); on the desktop it is Settings → Server. The name defaults to
   the host name, or the phone's model on Android, and can be edited.
2. The device calls `POST /pair` (no token). The server answers a **six-digit PIN**, valid for ten
   minutes and usable once, and a secret `id`. The device shows the PIN large and keeps the `id`.
3. The device **polls** `POST /pair/poll` with the `id` and the PIN about every five seconds.
   It answers `pending` until the PIN is approved.
4. **Approval** is either the command line, `arlesh-server pin approve <pin> [--name <n>]` (with
   `arlesh-server pin list` showing the PINs waiting), or a signed-in device in **Settings →
   Devices → Approve a device**. Both show the name the device suggested and let the approver change
   it.
5. The next poll answers `approved` with the device's own long-lived token, **exactly once**. The
   device keeps it as any token (the keychain on the desktop, a file on Android) and restarts in
   Client mode, through the same path as *Connect and Restart*.

**The poll carries the request's `id` as well as the PIN.** A six-digit PIN is guessable, and
whoever polls with a PIN would take the token; the `id` is 256 random bits that only the asking
device knows, so a PIN seen or guessed on the network claims nothing. (The user's wording was
*polls with the PIN*; the `id` is added beside it.)

**Names.** A device's name is its client name, which the undo journal records, so it follows the
core's rule: ASCII letters, digits, `.`, `_` and `-`, at most 64. The server reduces any name given
(runs of other characters become one `-`, so *Pixel 8* is `Pixel-8`; an empty result is `device`),
both the one a device suggests and the one an approver types, and answers the result. **Names are
unique**, compared without regard to case: a name already held by a token, or already approved for
another waiting device, gets the next free `-2`, `-3` … suffix. The approval answers the final name.
A name taken in the moment between approval and the poll is suffixed then.

**Safeguards.**

- `POST /pair` is **rate limited per address**: ten requests in ten minutes, then 429
  (`not_permitted`, `details.reason = "rate_limited"`, with `Retry-After`). At most twenty requests
  wait for approval at once (429, `too_many_pending`).
- **An attempt** is a poll that names a known request `id` with a PIN other than that request's.
  The fifth wrong PIN invalidates the request (`pin_invalidated`); before that each answers 403
  `wrong_pin` with `details.remaining`. A right PIN does not reset the count. Approving or looking
  up a PIN that no request holds answers 404 `unknown_pin` and counts for nothing: it needs a token
  (or the command line), so it is no way in.
- A request lasts **ten minutes from its creation**, approved or not. Expired, used and invalidated
  requests are deleted: every call purges the lapsed ones first, so the table holds only live ones.
  A request that is gone answers 404, `details.reason = "unknown_pairing"`, whichever way it went.
- The PIN store is the server-only table `pairing_pins` (migration 0098, beside `server_tokens`):
  not read by the desktop app, not journaled. The poll's `id` is kept as a SHA-256 digest. No token
  is stored there: the token is made, and recorded in `server_tokens`, by the poll that claims it.

**Box builds are pre-bound.** The PIN flow is for real devices, such as the release APK. A branch
build started by `npm run box` (see *Trying it*) is handed its server and token by the launcher and
comes up connected, so it never shows the connect screen or a PIN.

### Settings → Devices

Shown in Client mode. It lists the server's devices with their **name and when each was last seen**
(the current device marked), and lets the user:

- **Approve a device**: type the PIN the other device shows; the page fetches the name it suggested,
  lets it be edited, and approves. The result names the device as it was saved.
- **Revoke** any device **except the current one**, after a confirmation. A revoked token stops
  working at once. The server refuses to revoke the asking device's token (403, `current_device`),
  so a device cannot lock itself out.

*Last seen* is the time of the device's last request, written at most once a minute per device
(`server_tokens.last_seen_at`); a device not seen since the column existed has none.

## The Backend port

The seam is a Rust **Backend port** (`crates/arlesh-backend/src/`). Every Tauri command that reads or
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

## The Backend crate and Python

*[ADR 0016](../adr/0016-shared-backend-crate-and-python-backends.md). Built: the crate, and
`HttpBackend` from Python. Python's `SqliteBackend` is the existing `arlesh.open` path, not yet the
shared Rust one.*

**The port and both backends live in their own crate, `arlesh-backend`** (`crates/arlesh-backend`),
which the app and the Python package both depend on. It has two cargo features, `sqlite` and `http`,
both on by default. The app's `standalone` feature turns on `sqlite`, so a Client-only build (Android,
`--no-default-features`) compiles no `SqliteBackend`. The crate knows nothing of Tauri: it reports a
change of the server's status and a change of the board through callbacks, and the app's callbacks
tell the windows. The change-stream follower runs on a tokio runtime handle its host gives it. What
stays in the app is everything that knows what a window is: `AppBackend`, the commands, `mode.json`,
the token vault, suspend and resume, the local MCP endpoint, windows, tabs and the tray.

**A Python script picks a backend the way the app does.**

```python
import arlesh

async with arlesh.Arlesh(backend=arlesh.HttpBackend(url, token=token)) as board:
    load = await board.board()
    async for change in board.changes():
        load = await board.board()

async with arlesh.Arlesh(backend=arlesh.SqliteBackend("arlesh.db", client="notebook")) as board:
    ...
```

- `arlesh.SqliteBackend(path, *, client=None, force=False)` and `arlesh.HttpBackend(url, *,
  token)` describe a backend and do no I/O. `Arlesh` opens it on `async with` or `await
  ….open()`: the file is opened as `arlesh.open` always has (read-only without a `client`), and a
  server is asked `/health`.
- `Arlesh` implements the existing `arlesh.Database` port, with the same method names, every one a
  coroutine, answering the same pydantic models and raising the same `arlesh.errors`.
  `arlesh.open(path, client=…, force=…)` is a shortcut for an `Arlesh` over a `SqliteBackend`, and
  `arlesh.SqliteDatabase` is another name for `Arlesh`, so existing scripts do not change.
- Over HTTP a script gets what Client mode gets: the revision headers (`board.board_revision`),
  gzip, the version handshake, and the board last loaded, read-only, while the server cannot be
  reached (`board.server_status` says so; a write is refused with `server_unreachable`).
- `board.changes()` is an async iterator over the board's changes: the server's `/events` stream
  over HTTP, the process's own write counter over SQLite. It yields the newest revision only, never a
  backlog, and holds a connection only while someone is iterating.
- Two reads the port lacks are answered by the Python layer: `get_info` from the list of infos, and
  `board(at_capacity=…)` is refused over HTTP.
- Operations only a local file has (`serve_mcp`, `stop_mcp`, `reset_undo`, `arlesh.hold`) are
  refused over HTTP with `not_permitted`, `details.reason = "not_in_client_mode"`.
- `await arlesh.pairing.start(url, name)` asks for a PIN to show, and `await
  arlesh.pairing.wait(url, started)` returns the token once a signed-in device approves it. The
  package stores no token.

`arlesh-server` runs on SQLite only, never on an `HttpBackend`: a server over a
server is a relay, which could loop back on itself and would write every device's change as its own
client (see the ADR, decision 8).

## REST parity

Every `Backend` method maps to one REST route in the [existing style](http-api.md#routes). A test
fails if a port method has no route or has no `HttpBackend` implementation.

**People and the knowledge base are out of Client scope.** That means people, events, threads and
knowledge-base links. There are no routes for them, `HttpBackend` refuses those calls as not
available in Client mode (`not_permitted`, `details.reason = "not_in_client_mode"`), and the UI
does not ask for them: a delegate Person is drawn unnamed. Their code and tables stay as they are.

The mapping is `conformance/client-mode.json`, tested from both sides: the app's
`crates/arlesh-backend/src/tests.rs` fails when a port method is in neither its `routes` nor its `standalone_only`,
and the server's `test_server_parity.py` fails when a listed route is not served.

## Live sync

(The agents' wait stream, `GET /events/expectations`, is a long poll that answers JSON, served by the FastAPI server behind the same bearer token (it has no Server-Sent Events form); see [MCP](mcp-server.md), *Being told a wait resolved*.)

The server streams changes over Server-Sent Events. `GET /events/changes` sends `board-changed` with a
**revision** for each committed write, and honours `Last-Event-ID`. `HttpBackend` relays it to the
windows as the same Tauri `board-changed` event a Standalone write raises, now carrying the event's
`revision` and `epoch`. After a reconnect it reloads if the revision jumped.

**What a write costs, and the revision.** The server stamps `/board` and every other answer with
its revision and epoch ([Revision](http-api.md#revision-on-every-answer-and-gzip)). The Tauri
`load_mindmap` returns the board with that stamp as `revision`, and each window keeps the stamp of
the board it holds in `src/stores/board-revision-store.ts`.

**One load per window.** The window holds one copy of the board, in `src/stores/use-board-store.ts`,
with one tracker, one listener for `board-changed` and a single-flight `load()`. The views (the
list, the filter display, the Mindmap, Steps) are views over that copy: each derives its own tree
from it, and none loads or listens. So four views mounted together cost one fetch, and one event
from another device costs one fetch for all of them, each of which then shows it. A reload asked
while a fetch is in flight (a write's own reload, an event) waits for it and shares one follow-up,
since the fetch under way may have been read before the news. Standalone takes the same path, with no revision to compare. Standalone has no server, so
its loads carry none and its events carry none, and a window with none reloads on every event as it
always has. The rules, in `src/stores/watch-board-changes.ts`:

- An event whose revision is **at or below** the one the window holds is skipped. A device's own
  write is announced to it too, and after its own reload it already holds that revision, so it
  costs one board fetch, not two.
- An event is judged after a short wait (150 ms), and, if a load is in flight, when that load ends:
  the echo can beat the write's response across the Tauri bridge, before the write's own reload has
  started.
- **An epoch change always reloads**: the server restarted and its numbers start again.
- An event carrying no revision always reloads.
- **The reload after a write stays.** A write's response carries the node it wrote, not the board,
  and the board derives more than that (rollups, what blocks what, inherited Plans), so applying it
  locally would leave those stale. It is the echo that is skipped, never the reload. A later change
  (optimistic UI, Task `288`) builds on the stored revision.

A response over 1 KB is gzipped (the client asks for it, reqwest's `gzip`); the board shrinks
several times over. The event streams are not.

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
  only pair up; it sends nothing for them (`local` in the parity contract). Since they pair up and
  nothing else, a window that has read that it is a Client does not call them at all
  (`setGestureBracketing`, `src/api/gesture.ts`), so a write is **one** Tauri call, not three.

The gesture operations:

- **Delete nodes** (`POST /gestures/delete-nodes`): a multi-selection or an expanded subtree.
- **The listed-writes gestures**, each `POST /gestures/<name>` with the gesture's writes as its body:
  `paste` (copies or moves), `insert-parent`, `move-node` (a drag, with the clamps it asked about),
  `plan-tasks` (quick plan), `plan-move` (the Plan View), `save-task`, `save-goal`,
  `save-commitment`, `save-project`, `save-wait` (the wait editor's Save and its Create),
  `save-flow` (the Flow and Habit editor, its *Archive & new* included), `save-flow-item`, and
  `new-flow` (a new Flow or Habit), and `archive-nodes` (a hand archive or unarchive of Tasks,
  Commitments and Domains: it admits only their three updates). The writes run in order in one transaction; a later write names
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
change stream reconnecting, makes the board writable again. Writes already pending when the server
drops are rolled back, not kept (see *Pending writes*, below).

## Pending writes

*Task `288`, [ADR 0012](../adr/0012-optimistic-own-field-rendering.md). This section describes both
modes: Standalone runs the same path, only faster.*

A few actions show their result **on the node at once**, before the write is answered, instead of
waiting for the write and a reload. Until the answer comes, the board holds a **pending write**: the
action's **patch**, a set of the node's own fields, drawn over the loaded board.

### Which actions

- **The status family:** the status step (a click on the glyph, `Enter`) on a Task or a Goal,
  `Alt+Enter`, the Commitment verdict (Kept, Broken, the cycle key) and the wait release. A
  Compound Task's step is refused locally, with today's toast and no write. The step, `Alt+Enter`,
  the Compound refusal and the verdict are predicted by a TypeScript copy pinned to the Rust rules
  by `conformance/task-gestures.json` (ADR 0012, decision 13).
- **Rename and the editors' Save:** the Task, Goal, Commitment, wait, Project, Domain, Tag and Info
  editors. The editor closes as soon as its own prompts are answered. The Flow and flow-item
  editors stay write-then-reload in v1 (ADR 0012, decision 16).
- **Create a child or a sibling:** a placeholder node, for every kind whose create is one write
  with no prompt.
- **Planning in the Plan View:** planning an item into the scope being filled, or into one of its
  parts, and taking it out (a swipe on the phone, the move-across key, a drag between the panes).
  Only the row's own Plan is patched; which pane it sits in is read from it by the pinned triage
  rule. A batch is still one gesture and one undo step, and a step the backend refuses puts that
  row back with a toast. When the Plan would leave Tasks below outside it, the row goes back and
  the clamp-or-cancel prompt opens, as for a completion that needs a confirmation (ADR 0012,
  decision 17). The quick plan picker and the editor's Plan field are as before.

Move, reorder, archive, delete, Plan elsewhere, paste, the Agentic key and every other write stay
**write-then-reload**.

### What a patch may change

Only the touched node's **own** fields, the ones read straight off its stored row: its title,
status, verdict, wait status, Agentic flag, Asynchronous flag, Time Scope, Plan, due, on scope exit,
tags, block reasons, delegate, brief and notes. Nothing **derived** is patched: not an inherited
Plan or Agentic reading, Timing, Overdue, Resolution, Expired, Archived, Review, a Compound Task's
status, a rollup, Blocked, or a dependent's *met*. Those change when the server answers and the
board reloads. A patch is worked out locally only from a rule already pinned by a corpus under
`conformance/` (ADR 0012, decision 12). The views' per-render rules (the presets, the list
sections, Zen's contents, the Habit fold) read the patched board as they read any board, so a Task
marked Done leaves Start at once. The focus exemption still keeps the selected node on screen.

### The cue

A node with an unanswered write shows a **faint pulse**, or a **dotted outline** under reduced
motion, on the Mindmap node, the List and Steps row, and the Zen card alike. It starts after a short
delay, so a write answered within it never flickers, and it stops when the server answers.

### Order

The window's pending writes form one **lane**, in the order the user acted. Each action patches on
top of the ones before it at once, so two quick presses show two steps. The writes go out **one at a
time, in order**, the next when the last is answered. A write outside the lane (a move, an archive,
undo) **waits for the lane to empty** before it is sent, so it never overtakes an earlier action.

### When the server answers

- **Written.** The node's cue stops. Where the response carries the written row, its own fields
  replace the predicted ones, so the server's value shows even before the reload. The board then
  reloads for the derived values, unless the board on screen already reflects the write.
- **Reconcile: the server wins.** Each fresh board is drawn with the still-pending patches applied
  over it. An answered write's patch is dropped once a board that reflects it is on screen: one whose
  read began after the answer, or whose revision has reached the write's in the same epoch. Until
  then it stays, so a reload that was skipped or still in flight never shows the old value.
- **Refused.** That write's patch, and every later one on the **same node**, are rolled back. Those
  later writes are never sent. **One toast**, at the node, names the backend's reason. Writes on
  other nodes carry on. A refused editor **Save** also reopens the editor with what the user typed and the backend's
  reason on its error line (ADR 0012, decision 14).
- **Asks first.** Marking a Habit occurrence done over unfinished children rolls back quietly and
  opens the occurrence prompt. Confirming applies the patch again and sends the write with the
  confirmation.
- **Unreachable.** Every pending write in the window is rolled back, with one toast, and the board
  goes read-only (*Offline*, above). A write that was in flight may have landed, and the next board
  says whether it did. A write the server had already answered stays until a board reflects it. While the
  board is read-only no action is patched at all.
- **A new epoch** (the server restarted) reloads the board, as every epoch change does. Queued
  writes carry on to the restarted server.

### New nodes

A created node is drawn at once as a **placeholder** with a temporary id: the kind and title the
user gave and nothing derived, placed where the gesture meant (after the sibling, or as the
parent's last child). A kind the parent may not hold is refused before anything is drawn. Actions
on the placeholder, a rename or a child of its own, queue behind its create. When the create is
answered, they are rewritten to the real id and sent. The selection, the inline editor and any other
place the temporary id was held move to the real node, and the server's position replaces the
placeholder's when the board reloads. A refused create removes the placeholder and everything queued
on it or under it, with one toast. Nothing about this reaches the server: it only ever sees real
ids.

### Undo

See [Undo](undo.md), *Undo with writes pending*. In short, `Ctrl+Z` cancels the newest action
locally while it is still queued, and otherwise waits for the lane and undoes on the server.

## Shared and local state

- **Shared, on the server:** the board, and the **agent capacity lock**, which has its own routes.
- **Local to each device:** preferences, and the window and tab session.

## MCP

In Client mode the app serves **no** MCP endpoint, and Settings → Agents shows no endpoint section;
the MCP roots and the capacity lock there are the server's. Agents talk to the server's `/mcp` directly. This is
the [HTTP Server](http-api.md)'s *the app serves none*.

**Agents** (2026-11-07, Task `7a0`; see [Agents](agents.md)). `/mcp` no longer takes a device token: every
session connects with the server's one low-privilege **connect token** (`arlesh-server connect-token`),
then attaches as an Agent with a one-time PIN. Settings → Agents lists the server's Agents, their Claims,
accounts and usage, and asks for PINs, apart from the Devices list; the Agents are the server's, shared
by every device. Pairing stays device-only: its six-digit PIN and an agent's eight-digit PIN are
different things. Although the app serves no MCP endpoint in Client mode, it still serves the **loopback
PIN door** (`POST /agents/pin`, loopback only, no `Origin`), which forwards the request to the server with
the device's token, so an agent on the same machine can attach without anyone copying a PIN.

## Tokens on the device

The token is kept in the OS keychain through the `keyring` crate (the macOS Keychain, the Windows
Credential Manager, the Secret Service on Linux), filed under the server's URL. If no keychain is
available, Settings → Server says so and offers to keep the token in `server-token` in the app's
data directory, readable by its owner only (mode 0600); it is not stored until the user ticks that.

## Android

The Android app (Task `3d6`) is the Client-mode app on a phone, built with the cargo `standalone`
feature **off**: it has no SQLite core and no local MCP endpoint, and agents use the server's
`/mcp`. It ships as `arlesh-android-arm64.apk` on the GitHub release, signed with the project's
release key; there is no Play Store.

- **First run** goes straight to *Connect to a server*. There is no Standalone option, and the
  setting cannot be dismissed until a server is chosen.
- **The token** is kept in `server-token` in the app's private storage, which no other app can read.
  Android has no keychain the `keyring` crate reaches, so the vault always uses the file there and
  asks for no consent.
- **One window.** No tabs to tear off, no tray, no close-to-tray: those commands answer with the
  single window (`commands/mobile_shell.rs`).
- **System back** closes the topmost sheet; otherwise leaves the stepped-into node; otherwise goes
  up a scope in the Plan View; and only at the root leaves the app. It never deselects.
- **Foreground only.** When the app is suspended the change stream is dropped, so no connection is
  held in the background. When it resumes the stream is opened again, `/health` is checked and the
  windows reload.
- **The soft keyboard** shrinks the page (the activity pads its content by the keyboard's inset),
  so sheets resize above it. Enter confirms in the editors, as on the desktop.
- **Box builds** (`com.atai.arlesh.box.*`, from `npm run box`) are handed their server and token by
  the launcher and start connected; the release app takes no such input (*Trying it*).
- **The touch layout** is a separate Task (`201`); this one only builds and wires the platform.

## Running the server

*Decided with the user 2026-11-04.* Every release (a `dev` → `master` merge, or a `vX.Y.Z` tag)
ships the server two ways, both on the GitHub release or in ghcr.io:

- **The container image** `ghcr.io/jan-oko/arlesh-server`, for linux/amd64 and linux/arm64, tagged
  `latest`, the version and `sha-<short>`. It runs as a non-root user, keeps the database on the
  volume `/data` (`ARLESH_DATABASE_URL=sqlite:////data/arlesh.db`), listens on `0.0.0.0:4750`
  inside the container, and has a `HEALTHCHECK` on `/health`. Built from `docker/server.Dockerfile`.
- **Python wheels** for linux x86_64 and aarch64 (manylinux), on the release page:
  `pip install "arlesh-<version>-…whl[server]"`, then `arlesh-server --db ~/arlesh.db`.

```sh
docker run -d --name arlesh-server -p 4750:4750 -v arlesh-data:/data \
  ghcr.io/jan-oko/arlesh-server:latest

# the first token, printed once (or pair a device, below)
docker exec arlesh-server arlesh-server token add phone
```

```yaml
# compose.yaml
services:
  arlesh-server:
    image: ghcr.io/jan-oko/arlesh-server:latest
    restart: unless-stopped
    ports:
      - "4750:4750"
    volumes:
      - arlesh-data:/data
volumes:
  arlesh-data:
```

The server reads `ARLESH_DATABASE_URL` (default `sqlite:////data/arlesh.db`) and `ARLESH_SERVER__PORT`
(default 4750, the port inside the container); `ARLESH_DATABASE_URL_FILE` takes the URL from a file
(a Docker secret) instead. The `/data` folder must be writable by uid 10001.

Then `docker compose exec arlesh-server arlesh-server token add phone`, and paste the URL and the
token into Settings → Server. To **pair** instead, enter only the URL on the new device, which shows
a PIN, and run `docker exec arlesh-server arlesh-server pin approve <pin> --name phone`
(`pin list` shows those waiting). An existing `arlesh.db` is seeded by copying it into the volume
(*Data*, below). The image speaks plain HTTP and binds every interface: put it behind a tailnet, a
LAN you trust or a TLS proxy, or pass `--tls-cert` and `--tls-key` (mount them and add the flags
after the image name). The image is private until the package is made public in GitHub's package
settings; `docker login ghcr.io` with a token that can read packages until then.

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

`npm run box -- …` (the single-file Python tool `scripts/box.py`, run with `uv run --script`, stdlib
only) runs a branch's server as well as its app, so any app branch can be tried against any server
branch — the version handshake included:

```
npm run box -- server start 9f0-client-mode                 # arlesh-server from that worktree
npm run box -- run 201-client-gaps desktop --server 9f0-client-mode
npm run box -- run some-app desktop --standalone            # the local board, no server
npm run box -- run 201-client-gaps pixel                    # the Android build on a registered phone
npm run box -- stop all                                     # apps and servers
```

`run <branch> [<target>]` builds only when the worktree changed (a hash of `HEAD` plus the
uncommitted diff, per branch and OS, kept in `$XDG_STATE_HOME/arlesh/box/`), installs on an Android
device only when that device lacks this build or the package, and always launches. The target is
`desktop` (this machine, built in) or a name registered with `devices add <name> --os
android|desktop [--host host[:port]] [--serial S] [--ssh [user@]host[:port]]`; the registry is per user, in
`$XDG_CONFIG_HOME/arlesh/box-devices.json`, never in the repo. Without a target, `run` reuses the last
one.

**Settings file.** `box` reads `$XDG_CONFIG_HOME/arlesh/box.env` (beside `box-devices.json`, never in
the repo) before any subcommand, so the Firebase step and every `box server` it starts inherit it. A
missing file does nothing. The format is `KEY=value` per line; blank lines and `#` comments are
ignored; an `export ` prefix and surrounding single or double quotes are accepted; `$HOME`, `${HOME}`
and a leading `~` in a value are expanded. A variable already set in the real environment wins over
the file. A malformed line stops box with its line number, never its value, and values are never
logged. Keys it is for: `ARLESH_BOX_FIREBASE_PROJECT`, `ARLESH_FCM_CREDENTIALS_FILE`, and where they
apply `ARLESH_BACKUP_TOKEN` and `ARLESH_BOX_SEED_URL`.

**An Android `run` uses the CI build when one matches, and every box APK is signed with one shared
key** (decided with the user, 2026-11-02):

- *Source.* For an Android target, if the worktree is clean (no uncommitted or untracked,
  non-ignored changes), `HEAD` equals `origin/<branch>`, and a successful `bundles.yml` run (box
  mode, `workflow_dispatch`) exists for exactly that commit with its artifact
  `arlesh-box-<segment>-<sha7>-android-apk`, `run` downloads that APK (`gh run download`) instead of
  building, then installs, pre-binds and launches as usual. Otherwise it builds locally. `--local`
  forces the local build. `--ci` uses CI regardless: with no build for `HEAD` it triggers
  `bundles.yml` with `box=true, publish=false` on the branch, waits with progress output, then
  downloads; on a dirty or unpushed tree it is an error that says why. Without `gh` on `PATH` or
  authenticated, `run` builds locally with a one-line notice and `--ci` fails. The download is cached
  per commit in `$XDG_STATE_HOME/arlesh/box/ci/`, so a rerun does not fetch again; `clean <branch>`
  removes it. The built stamp of a CI APK is `ci:<stamp>`, so a local and a CI build of one commit
  are never taken for each other. `run` prints which source it used. Desktop targets always build
  locally (`--ci` there is an error).
- *Signing.* `keystore init` generates a box-only keystore at `$XDG_CONFIG_HOME/arlesh/box.keystore`
  (alias `arlesh-box`, 10000 days; a debug-grade key for `com.atai.arlesh.box.*`) under a random
  password (`secrets.token_urlsafe(24)`). No password is written in the repo: it is stored locally
  beside the keystore, in `box.keystore.password` (mode 600), and the command uploads two repo
  secrets with `gh secret set`, values on stdin: `ARLESH_BOX_KEYSTORE_B64` (the keystore, base64)
  and `ARLESH_BOX_KEYSTORE_PASSWORD`. keytool and apksigner receive the password only as
  `-storepass:file` / `--ks-pass file:` (or `env:`), so it appears in no process list, and the
  command never prints it. It refuses to replace an existing keystore without `--force`, and warns
  that replacing the key means every installed box app has to be reinstalled. GitHub secrets cannot
  be read back, so CI can sign with them but no one can fetch them from there: the local files are
  the copy of record. A keystore made before passwords were random has a fixed one; `keystore
  rotate-password` moves it onto a random one with `keytool -storepasswd` and `-keypasswd` (the same
  key, so installed box apps stay update-compatible), writes the password file and re-uploads both
  secrets. Only that command knows the old value; normal signing never falls back to it, and with
  the keystore but no password file it stops and says to run `rotate-password` (or `init`). Local
  builds sign with the keystore when it exists, else with `~/.android/debug.keystore` (its password
  is the SDK's documented one, passed by environment variable) and a notice that CI and local
  builds are not update-compatible until `keystore init`. `bundles.yml` in box mode signs with the
  secrets when set (only the signing step reads them, through a file, nothing echoes them); the
  keystore secret without the password secret fails with a message naming the fix; with neither,
  it uses a fresh `keytool` key under a password generated in the job, and a `::warning::`.
- *Mismatch.* `adb install` failing with `INSTALL_FAILED_UPDATE_INCOMPATIBLE` stops `run` with a
  message that names the cause and offers `--reinstall`, which uninstalls the box app first (box
  re-provisions the token anyway). Nothing is uninstalled without the flag.

**Every worktree has its own `node_modules`.** Box runs `npm ci` in a worktree when its `node_modules`
is missing or its `package-lock.json` differs from the one it was installed from (the lockfile's hash
is kept in `node_modules/.arlesh-lock-stamp`, so deleting the folder also forces a reinstall). It is
checked before every desktop or Android build and when a worktree is created. Nothing is shared with
the main checkout: an `npm ci` there cannot pull dependencies (or Vite's `.vite` cache) out from under
another box's running dev server, and a branch that adds a devDependency gets it. A worktree made by
an older box, whose `node_modules` is a symlink to the main checkout's, has the link removed and is
installed on its next run. `prune` removes the folder with the worktree (it is git-ignored).

**A branch needs no worktree made by hand.** `run`, `server start`, `server token` and `server pin`
create `.claude/worktrees/<dir>` when it is missing: `git fetch origin <branch>`, then `git worktree
add -b <branch> --track origin/<branch>` (a local branch of that name is used as it is, with a notice
if it is behind or has diverged), with its own `node_modules` (above). A branch that exists neither
locally nor on origin is an error; the tool never makes a branch off master. `<dir>` is the branch
with `/` replaced by `-` (`qa/2026-11-round` is `qa-2026-11-round`), through one helper that also names
the instance, the server and the Android package. Either spelling is accepted: `qa-2026-11-round` is
mapped to `qa/2026-11-round` when that folder holds it, and a folder holding an unrelated branch is an
error that names the branch to use. `list` shows the branch beside the directory when they differ.

**`run` never builds a stale commit.** Before choosing between a CI and a local build it fetches
`origin/<branch>`. A worktree that is behind and clean is fast-forwarded (`git merge --ff-only`) and
`run` says so; one that is behind and dirty, or has diverged, is refused with the reason and the
fix, unless `--stale-ok` builds the current `HEAD` anyway. A worktree that is ahead (unpushed)
builds locally as before. `--server <branch>`'s worktree is never touched.

**Finding an Android device.** The first look is `adb devices -l`, for a transport that is already
connected: an `adb-<serial>-…._adb-tls-connect._tcp` (mDNS auto-connect) transport by serial, an
`ip:port` transport by any address the registered host resolves to (`phone.local` matches by its LAN
address), and, with a serial known and nothing else matching, each transport's
`adb shell getprop ro.serialno`. A matched transport is used as it is. Otherwise the phone is
discovered: `adb mdns services`, then, when that is empty (adb's mdns shares port 5353 with avahi,
systemd-resolved and Chromium) or missing, `avahi-browse -rpt _adb-tls-connect._tcp` (the IPv4 `=`
lines, with the TXT `serial=`). Discovery matches by serial first, then by address. The wireless
debugging port changes on every toggle, so the port is always the discovered one.

The hardware serial is stored in the registry the first time a device is connected, read with
`adb shell getprop ro.serialno` (over Wi-Fi `get-serialno` answers with the transport name); an address
or transport name is never stored. `devices add <name> --os android --serial <serial>` registers it up
front, so a tailnet name can be matched by serial alone.

*Off the LAN / tailnet hosts.* adbd listens on every interface, so when the host resolves to a tailnet
address (100.64.0.0/10) and discovery gives a port, box connects to `<tailnet-ip>:<port>` first, then
to the LAN address. On the first run with no serial known, nothing can match the LAN listing, so box
tries `adb connect <tailnet-ip>:<port>` for each discovered port (at most three, each bounded to 8 s): a
connect that answers proves it is the same phone, and its serial and port (`last_port`) are stored.
With no discovery at all (off the LAN there is no mDNS), box tries the registered `host:port`, then
`host:<last_port>`. When all of that fails the error says to run `adb tcpip 5555` once over USB (or
from Termux) and register `host:5555`, which does not change. Box never pairs.

*Termux/SSH fallback (opt-in).* `devices add <name> --os android --host … --ssh [user@]host[:port]`
(Termux sshd listens on 8022). When adb cannot reach the device and `--ssh` is set, `run` builds or
fetches the APK as usual, `scp`s it to `~/storage/downloads/arlesh-<branch>.apk` and runs
`ssh … termux-open` on it, which opens Android's installer for the person to confirm. It needs sshd
with the key authorised, `termux-setup-storage` run once, and Termux:API. `ssh` and `scp` run with
`BatchMode=yes` and never prompt. Over this path the app cannot be pre-bound to a server (that needs
the `am start` extras, which need adb), nothing is recorded as installed, and box says so, and how to
pair adb (`adb pair <host>:<pairing port>`).

The server URL handed to the app is this machine's tailnet address (`tailscale ip -4`) or, without one,
its LAN address.

**Server lifecycle.** `server start` records `server.pid` only once the server answers, so a failed
start (the database held by another writer, say) leaves the previous record alone and prints the pid
that holds `data/arlesh.db.lock` (from `lsof`, else `fuser`), with `box server stop <branch>` or
`kill <pid>`. `server stop` SIGTERMs the server's process group (it starts in its own session), waits
up to 10 s, SIGKILLs the group, then does the same to anything still holding the lock, and checks the
port and the lock are free. arlesh-server itself bounds uvicorn's graceful shutdown
(`timeout_graceful_shutdown`, 5 s) and ends `/events` streams as soon as shutdown begins, so a
connected desktop no longer keeps a stopped server alive. Children started inside a worktree's project
run without `uv run --script`'s `VIRTUAL_ENV`, which made uv warn on every start.

**Every `run` comes up already connected**, on desktop and Android alike, to the branch's own server
(started if it is not up; the first start in a fresh worktree builds arlesh-py and says so).
`--server <other>` picks another branch's server and `--standalone` opts out: the desktop instance
runs on the local board, the Android build opens unbound on its connect screen. A server runs its
worktree's own code (its bindings built into that worktree's venv) on its own port, over a copy of
the real database taken read-only (`sqlite3` backup API, opened `mode=ro`), seeded once and kept.
`list` shows the servers and targets too.

**The token's client name is the box device name**: the registry name (`pixel`), or `desktop` for
this machine, reduced to the server's name alphabet. A client holds one token and its text is never
stored, so a run re-mints (`token revoke`, then `token add`) unless the connection still holds: the
instance was bound to this server at this URL, the server still lists the client, no other
instance has taken that client's token since (box keeps who holds it in its state file) and the app
has data on the device. `--force` always re-mints. Two branches sharing a device name on one
server therefore take the token from each other, and the one that lost is re-bound on its next
`run`. The token is never printed.

- **Desktop.** The instance gets a `mode.json` and a `server-token` file (0600) in its own data
  directory before it launches.
- **Android.** A phone cannot reach loopback, so the server must listen publicly: a server that is up
  on loopback is restarted on `0.0.0.0` with a notice (the port, database and tokens are kept; every
  request still needs a token). The URL is this machine's tailnet address when it has one (`tailscale ip -4`; Tailscale routes over the LAN when it can), otherwise its LAN address. The URL and token are handed to the app
  with no PIN flow: `run` force-stops the app and starts it with
  `adb shell am start -n <pkg>/com.atai.arlesh.MainActivity --es arlesh_box_url … --es
  arlesh_box_token …`. `MainActivity` reads the extras **only when its applicationId starts with
  `com.atai.arlesh.box.`**, so the release app ignores them and no intent can bind it to a server,
  and leaves them in `box-provision.json` in the app's private data directory. Before the mode is
  read, the Rust startup (`client_mode::provision`, Android only) validates the file (an `http(s)`
  URL, a non-empty token), keeps the token as *Connect and Restart* does (the token file), saves
  Client mode and deletes the file, so the first run is already connected and no restart is needed.
  A bad file is deleted and ignored. When the app is already bound to that URL with a live token,
  `run` only launches it. No JNI is involved, so R8 has nothing to strip.
- A token in `adb shell` argv is visible to `ps` on the phone for an instant. That is acceptable
  for a debug box build on the developer's own phone, and the reason the release app takes no extras.

More of the tool, for trying pairing and the phone build:

- `server start <name> --public` binds `0.0.0.0` (the server's `--host`) and prints the LAN and
  tailnet URLs a phone can reach.
- `server pin <name> approve <pin> [--name <d>]` and `server pin <name> list` run
  `arlesh-server pin approve|list` against that server's database. They are for pairing real
  (non-box) devices, such as the release APK; box builds are pre-bound.
- An Android `run` builds a debug-signed APK that installs beside the real app as
  `com.atai.arlesh.box.<branch>`, labelled "Arlesh (<branch>)" (the two files that carry the name
  are patched for the build and restored; the backups live under `$XDG_STATE_HOME/arlesh/box/backups/`,
  never beside the files, because the resource merger rejects a stray `strings.xml.box-orig`). Firebase, per branch, when
  `ARLESH_BOX_FIREBASE_PROJECT` is set (`--no-firebase` skips it).
- **A CI box APK** (`bundles.yml`, dispatched with `box` on, from the branch to test) is the same
  app built by GitHub Actions for a machine that cannot build Android: `box.py ci-patch <branch>`
  applies the same patch, it is signed with a debug key generated in the job (never the release
  key), and the artifact is `arlesh-box-<segment>-<sha>-android-apk`. It is **not pre-bound**: no
  `am start` extras are sent, so it opens on the connect screen. Pair it with a PIN
  (`server pin <name> approve <pin>`). `box run` has no install-only or provision-only mode, so
  binding an installed app to a server the box way means building it locally.
- `clean <branch>` also removes that branch's Firebase app and uninstalls the package from the
  registered Android devices.
- **`list` is driven by open PRs, `prune` by their absence.** `list` asks `gh pr list --state open`
  on origin's repository and prints one row per open-PR branch: PR number, title, base and draft
  flag; the worktree (if any) and whether it is ahead of or behind origin; the desktop and Android
  build (`fresh` when the recorded stamp equals the worktree's current one, `stale` when not, `-`
  when never built); each device's installed build (`fresh` or `stale`); the server (port) and
  whether an app instance is running. After a separator come `dev`, `master` and every worktree with
  no open PR, marked "no open PR (prunable)". `--json` prints the same rows. Without an
  authenticated `gh`, `list` says so in one line and shows the plain worktree table.
- `prune [<device>] [-y | --dry-run]` prints its plan, then asks `Proceed? [y/N]`; anything but `y`/`yes`
  aborts with nothing changed. `-y`/`--yes` applies without asking; `--dry-run` only prints. With no
  terminal on stdin and no `-y`, it prints the plan and exits non-zero ("re-run with -y to apply"),
  never blocking on input. It plans
  every worktree whose branch has no open PR except: the main checkout, `dev`, `master`, the
  current directory's worktree, a detached one, and any with uncommitted changes ("kept: dirty") or
  unpushed commits ("kept: N unpushed commits"; no `origin/<branch>` counts every commit that is
  on no remote). For each it stops the branch's server and app, runs the `clean <branch>` cleanup
  (Firebase app, device installs, cached CI APK and state), then `git worktree remove` (never
  `--force`). The local branch is deleted only when it is merged into `origin/dev` or `origin/master`,
  or `gh pr list --state merged --head <branch>` finds a PR; otherwise it is kept and the output says
  so. Remote branches are never deleted. Box apps in Firebase or on a device whose worktree is
  gone are listed in the plan and pruned too. Without `gh`, box cannot know which PRs are open,
  so it skips the worktree part and prunes only those apps.

## Not in phase 1

Postgres (later, through portable SQL), offline writes, and the server's container image.
