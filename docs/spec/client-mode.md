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
  against `/health` and the API version, and then switches, with no reinstall.
- **The top bar** shows the mode and, in Client mode, whether the server is reachable.

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

**`now` is the device's.** A command that needs the current time takes it from the device's clock in
the device's time zone, in both modes. `HttpBackend` sends it to the server with the request, so a
server in another time zone still answers for the user's day.

## REST parity

Every `Backend` method maps to one REST route in the [existing style](http-api.md#routes). A test
fails if a port method has no route or has no `HttpBackend` implementation.

**People and the knowledge base are out of Client scope.** That means people, events, threads and
knowledge-base links. There are no routes for them, `HttpBackend` refuses those calls as not
available in Client mode, and the UI hides them. Their code and tables stay as they are.

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

The gesture operations so far: **delete nodes** (`POST /gestures/delete-nodes`), a multi-selection
or an expanded subtree, all or nothing. The other multi-command gestures — paste and duplicate,
moves with their scope clamps, insert parent, the Plan View and quick-plan moves, quick dependency,
and the editors' saves — still run as a run of commands in Standalone; each gets its operation
next (Task 9f0).

## Offline

When the server cannot be reached, the app shows the last board it loaded, **read-only**, under a
*Server unreachable* banner with the time of the last sync. A write is refused with a toast, and
nothing is queued. Offline writes are a later feature.

## Shared and local state

- **Shared, on the server:** the board, and the **agent capacity lock**, which has its own routes.
- **Local to each device:** preferences, and the window and tab session.

## MCP

In Client mode the app serves **no** MCP endpoint. Agents talk to the server's `/mcp` directly, each
with its own token. This is the [HTTP Server](http-api.md)'s *the app serves none*.

## Tokens on the device

The token is kept in the OS keychain through the `keyring` crate. If the keychain is not available,
the app falls back to a file readable by its owner only (mode 0600), but only once the user agrees.

## Versions

`/health` reports `api_version`, an integer bumped only on a breaking change, and the build commit.
On a mismatch the app goes read-only and says which side to update. When a newer app finds a route
missing, it hides that feature rather than failing.

## Data

There is no sync between a device's local database and a server. A device switched to Client keeps
its local database untouched, and switching back finds it as it was. A server is seeded by copying
`arlesh.db` into its volume.

## Not in phase 1

Pairing codes and the Devices page, Postgres (later, through portable SQL), offline writes, and the
server's container image.
