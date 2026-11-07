# Clients hold a replica of the board and run the real core on it

ADR 0012 made a press paint at once with a frontend lane of per-action patches, and it deliberately
left derived values to the server's answer. Showing derived values too needs the board's sources on
the client, and every optimistic write would need a prediction paired with it, written and kept
correct by hand. So a client now holds a **Replica**: the real `arlesh-core` over its own copy of the
board, behind a wrapper implementing the `Backend` port. A write runs on the Replica, then the same
request goes to the server. There is one implementation of the business logic, so a prediction cannot
drift from the server, and the port's traits make it impossible to add a write the wrapper misses.

## Status

proposed (2026-11-05, Task `ccc`). Settled with the user. It supersedes ADR 0012 once the Replica
lands. Timings for the press cycle, `invoke` and the phone are still being taken, and they gate the
third step of the delivery below.

## Decisions

1. **The whole board.** In Client mode every board read comes from the Replica and every board write
   runs on it first, so every write is optimistic, with no list of which ones are.
2. **The server is the only truth.** The Replica is a disposable cache plus unconfirmed predictions.
   Fetching a snapshot repairs anything.
3. **A local refusal sends nothing.** The user sees it and retries once the board has synced. The
   server can still refuse what the Replica accepted.
4. **A gap is detected, not hoped against.** Each change carries its revision and only the next one
   is applied. A gap means catch-up, or a snapshot if the server no longer has those changes; a new
   epoch always means a snapshot. A content hash of the board, compared periodically and when idle,
   catches a change that was never announced.
5. **A trigger-written Change Log feeds sync**, holding after-images per revision and including undo
   and redo. Like the Undo Journal, it cannot be forgotten by a command that does not know it exists.
   The journal itself cannot do this job: it is truncated at startup, capped, and written by neither
   undo nor redo.
6. **Hold until settled.** While writes are pending, incoming server changes are buffered. When the
   queue drains, the Replica rolls back its predictions and applies the buffered rows. A correct
   prediction changes nothing on screen, a wrong one loses to the server, and rows made by triggers
   need no handling of their own.
7. **A refused write re-runs the queue behind it** on the rolled-back Replica. What now fails locally
   is dropped, never sent, and told in one toast.
8. **A lost connection rolls back.** Pending predictions go, the app goes read-only, and catch-up
   shows the truth, including a write that did land. There is no retry and no offline queue.
9. **UUIDs are the stored identity**, as TEXT keys on every replicated table with a surrogate id.
   Existing rows keep their `full_id`, so short ids and links survive. New ids are client-generated
   UUIDv7, which is what lets the same request create the same node on both sides. The id stays
   optional for agents and scripts. Rows a write creates indirectly derive their ids from the request
   where that is practical; otherwise a press on one waits until settled.
10. **Undo is not predicted.** An unsent action is cancelled locally. Otherwise Ctrl+Z waits for the
    queue to settle and goes to the server, because after settling the Replica no longer holds a
    journal for confirmed writes.
11. **One frontend path.** Rust emits changed derived nodes as sequenced events in both modes; in
    Standalone the same pipeline runs with no server and no prediction. The pending-writes lane and
    the whole-board reload on a write go.
12. **The Replica is a file in app-private storage**, so the app opens at once and can show the last
    board with no connection. Android therefore ships the core and SQLite, with no local-board mode.
13. **Client and server must share a schema version.** On a mismatch the app is read-only and says
    which side to update. A rule change without a schema change is tolerated: the server's answer
    corrects the prediction.
14. **No wasm.** Rust sends what the UI needs as data, so the frontend holds no rules and the build
    step goes. The `arlesh-rules` crate stays.

## Considered Options

- **Keeping the logic in the frontend through wasm.** It solves a rule disagreeing with the server,
  but every write would still need a hand-paired optimistic patch, and that pairing has nothing to
  check it. Crossing the JS and wasm boundary also cost far more than the rules themselves.
- **A pure `apply(write, sources)` per write.** It needs no database on the client, but it is a
  second implementation of every write, including what triggers and cascades do. It would need a
  conformance test to stay honest, and a Replica needs neither.
- **Client-chosen random integer ids.** This needs no migration, since row ids are plain integers,
  and it was rejected for a single identity across stored and derived rows. Reserved id blocks were
  rejected for the same reason, and because they add a route and bookkeeping.
- **Rebasing predictions on every incoming change.** Other devices' changes would show sooner, but
  each event would cost a rollback and replay. Two databases were cleaner still, at the cost of a
  full copy per rebuild.

## Consequences

- Every server migration blocks writes on a client until that client is updated. On a phone that
  means installing a new build.
- Delivery is three pull requests in order, none stacked: UUID identity, then the server's sync
  surface (Change Log, device snapshot, content hash), then the Replica and the frontend switch.
- `/board` stays for agents and scripts, so its response time is still worth improving separately.
