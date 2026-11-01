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
- **The top bar** shows the mode: *This device*, or *Server* with a dot for whether the server is
  reachable and its URL on hover. The phone's top bar does not carry it ([Touch](touch.md)).
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
windows as the same Tauri `board-changed` event a Standalone write raises, now carrying the event's
`revision` and `epoch`. After a reconnect it reloads if the revision jumped.

**What a write costs, and the revision.** The server stamps `/board` and every other answer with
its revision and epoch ([Revision](http-api.md#revision-on-every-answer-and-gzip)). The Tauri
`load_mindmap` returns the board with that stamp as `revision`, and each window keeps the stamp of
the board it holds in one place, `src/stores/board-revision-store.ts`. Standalone has no server, so
its loads carry none and its events carry none, and a window with none reloads on every event as it
always has. The rules, in `src/hooks/use-board-changed.ts`:

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
several times over. `/events` is not.

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
android|desktop [--host host[:port]]`; the registry is per user, in
`$XDG_CONFIG_HOME/arlesh/box-devices.json`, never in the repo. Without a target, `run` reuses the last
one. An Android host without a port is found in `adb mdns services`.

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
  are patched for the build and restored). Firebase, per branch, when
  `ARLESH_BOX_FIREBASE_PROJECT` is set (`--no-firebase` skips it).
- `clean <branch>` also removes that branch's Firebase app and uninstalls the package from the
  registered Android devices; `prune [<device>]` does so for every `com.atai.arlesh.box.*` whose
  worktree is gone.

## Not in phase 1

Postgres (later, through portable SQL), offline writes, and the server's container image.
