# The app reaches the board through a Backend port, and Client mode is an HTTP implementation of it

Multi-device phase 1 (Task `9f0`) makes the installed app able to run as a client of
`arlesh-server`. The design was settled with the user in an interview on 2026-10-30. The behaviour
is specified in [Client Mode](../spec/client-mode.md). This ADR records the decisions and why each
was taken.

## Status

accepted (2026-10-30, Task `9f0`).

## Context

`arlesh-server` (Task `2bd`, [HTTP Server](../spec/http-api.md)) already serves the board over HTTP
through the Python bindings, with a bearer token per client and the core's own errors. The desktop
app still talks to its local SQLite file directly: about 120 Tauri commands each open a session
from the `SessionFactory` and call the core. To share one board between devices, the app has to be
able to send those same operations to a server instead.

## Decisions

1. **Two modes in one install.** The app runs either **Standalone** (the local file, as today) or
   **Client** (a server over HTTP). Both are always built in, and the SQLite side sits behind a
   cargo feature `standalone`, on by default. A first-run chooser picks the mode, and Settings →
   Server switches it later with no reinstall. *Why:* one install per OS keeps distribution simple,
   and a user who tries a server can go back without losing anything.

2. **The seam is a Rust Backend port, below the commands.** Tauri commands call a `Backend` trait.
   `SqliteBackend` is the in-process core, and `HttpBackend` calls the server with reqwest. The
   port is split into one trait per command module, and `Backend` is their union, so an
   implementation missing an operation does not compile. *Why:* the frontend keeps its single
   `invoke` transport and does not change at all, and shell concerns (windows, tabs, the tray,
   close-to-tray) stay in Rust where they are. A seam in the frontend instead would have meant a
   second transport, and every component would have had to learn about it.

   The commands' bodies moved into `SqliteBackend` unchanged, as a pure refactor, before any
   `HttpBackend` exists. The pure scope computations stay outside the port: they need no board, and
   the same compiled rule runs on either side. Announcing a change to the other windows stays in
   the commands, since only the shell knows what a window is.

3. **REST parity, enforced by a test.** Every `Backend` method maps to one REST route in the
   server's existing style. A test fails when a method has no route, or has no `HttpBackend`
   implementation. *Why:* a method without a route is a feature that silently stops working in
   Client mode. The gaps (undo and redo, events, capacity, MCP roots, the missing scope and filter
   reads) are filled on the server.

4. **People and the knowledge base stay Standalone-only.** There are no routes for people, events,
   threads or knowledge-base links. `HttpBackend` refuses them as not available in Client mode,
   and the UI hides them. Their code and tables are unchanged. *Why:* the user scoped phase 1 to the
   board; leaving them out keeps the server's API to what Client mode actually needs.

5. **Live sync over Server-Sent Events.** `GET /events` sends `board-changed` with a revision for
   each committed write, and supports `Last-Event-ID`. `HttpBackend` relays it as today's Tauri
   `board-changed` event, and reloads after a reconnect if the revision jumped. *Why:* the windows
   already reload on that event, so a write from another device needs no new path in the frontend.
   SSE is one-way, plain HTTP, and resumable, which is all a "reload now" signal needs.

6. **Undo is per device, and a Gesture never crosses a request.** Each device's token is its own
   client, so the journal already tells devices apart. `POST /undo` and `POST /redo` act on the
   calling client's stacks, with today's conflict refusals. Every write request is one Gesture of
   its client, opened and closed by the server under a per-file write lock. A gesture that issues
   several commands on the desktop becomes **its own operation and its own endpoint** (ruled by the
   user on 2026-10-30: *REST should support an endpoint per gesture*): the whole gesture runs
   server-side as one request, one transaction, one undo step, and the app calls the same operation
   in Standalone mode. *Why:* Ctrl+Z on a laptop must never take back what was done on a phone.
   The ambient Gesture is one row for the whole database, so a Gesture held open across requests
   would take in another device's writes, and one abandoned by a device that died would take in
   everyone's. A Gesture id carried on each request (the alternative weighed) would have kept the
   frontend's command runs, but at the price of server state that outlives a request.

7. **Offline is read-only.** With the server unreachable, the app shows the last board it loaded,
   read-only, with a *Server unreachable* banner and the last sync time. Writes are refused with a
   toast, and nothing is queued. *Why:* queued writes need conflict resolution, which is its own
   feature. A read-only board is honest and still useful.

8. **Shared and local state.** The agent capacity lock moves to the server and gets routes, because
   every agent must see the same lock. Preferences and the window and tab session stay on each
   device, because they describe that device's screen.

9. **No MCP from the app in Client mode.** Agents use the server's `/mcp` directly, each with its own
   token. *Why:* there is one writer, the server. An app-side endpoint would be a second door to the
   same board with a different identity.

10. **Tokens in the OS keychain.** The `keyring` crate stores the token. If no keychain is
    available, the app falls back to a 0600 file, but only once the user agrees. Until pairing codes
    exist, a device connects with a pasted URL and a token from `arlesh-server token add <device>`.

11. **Versions by handshake.** `/health` reports an integer `api_version`, bumped only on breaking
    changes, and the build commit. On a mismatch the app goes read-only and says which side to
    update. A newer app that finds a route missing hides that feature. *Why:* the app and the server
    are updated separately, and a mismatch must never become a wrong write.

12. **Server configuration.** `ARLESH_DATABASE_URL` (`sqlite:///…` for now), with
    `ARLESH_DATABASE_URL_FILE` for secrets. `--db <path>` stays as shorthand. Tokens move from the
    `<db>.tokens` file into a server-only table in the database. *Why:* one URL is what a container
    and, later, Postgres expect, and a token table travels with the database it guards.

13. **No data sync.** A device switched to Client keeps its local database untouched. A server is
    seeded by copying `arlesh.db` into its volume. *Why:* a two-way sync is a different product.
    Copying a file once is enough for a single user moving to a server.

## Delivery

Three stacked pull requests, each green on its own and landed bottom-up: (1) the Backend port and
`SqliteBackend`, a pure refactor, with this ADR and the area file; (2) server parity; (3) Client
mode in the app.

## Not decided here

Pairing codes and a Devices page, Postgres, offline writes, and the server's image are later Tasks.
