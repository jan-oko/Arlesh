# ADR 0020: writes and change events carry changed nodes, checked by a board hash

Status: proposed (2026-11-13, Task `2d9`, steps 2 and 3). The shape was ruled by the user on
2026-11-06 (below, *Ruled*); the points the Task left open are settled here, each with its reason,
for the user to overrule. Step 1 (the `/board` profile) is recorded on the Task, and its quick wins
landed as #195.

## Context

Every write ends in a whole-board reload. The window that wrote reloads on the way back from its
command (`await reload()` in about thirty places, and the pending-writes lane's reload after each
answer, ADR 0012 decisions 5 and 15), and every other window and device reloads on the
`board-changed` signal (ADR 0011, [Window and tray](../spec/window-tray.md)). `/board` is 1.6 MB, and
from the production server its first byte comes after about 650 ms at the median. A status step
changes 2 nodes at the median and 10 at most, about 380 bytes.

Step 1 measured where `/board` goes on the server. The core's call (read, derive, facts, short ids,
JSON) is about half; derive alone is 49-59 ms on the desktop and about 200 ms on the NAS. The rest
was the Python models' round trip (removed by #195) and gzip. Derive is too slow to sit inside each
write's answer on the NAS.

**Ruled (the user, 2026-11-06; not reopened here).** After a committed write the server derives the
board, compares it with the previous one, and publishes only the changed nodes, tagged with the
revision and epoch. Other devices update from the event alone. The frontend applies changed nodes
to the board it holds, by a path that does not care where the changes come from, because Task
`ccc` (ADR 0017, the client board replica) will feed it from a local replica. A revision gap or a
new epoch falls back to a full reload. `/board` stays for full loads, agents and scripts. The
server also publishes a content hash of the board, which the client compares periodically and when
idle; a mismatch forces a full reload and logs a bug. The optimistic lane keeps working as it does.
No UUIDs, Change Log or Replica here. Settled by step 1: a write answers first and the diff follows
on the stream, and the diff works on the core's values, never the Python models.

## Decisions

### The eight points on the Task

1. **A write answers at once; the diff follows on the stream, in both modes.** On the server this
   was settled by step 1. **Standalone does the same**: the command returns as soon as its
   transaction commits, and the board is derived and diffed afterwards by the same publisher
   (decision 9), which emits the changes to the windows as an event (about 50-60 ms later on the
   desktop). *Why:* one frontend path for both modes is the goal (point 5), and a write that waited
   for the derive in Standalone would be a second path that only Standalone takes. The writer does
   not wait blind: it **settles** on its write's revision (decision 13).

2. **The server keeps one derived board: the latest publication, in memory, beside the change
   feed.** The publisher lives in the per-file shared state the bindings already keep
   (`crates/arlesh-py/src/shared.rs`, which holds the revision), so every open of the file and
   every client shares it. It holds the latest **publication** only: the derived board, its
   sequence number, revision, `now`, hash and per-collection sums, and that board's JSON once it
   has been asked for. It keeps no board per revision. For a device that reconnects it also keeps
   a **ring of the last 64 change events** (at most 4 MiB), so a dropped stream is caught up with
   the events it missed instead of a full load. **A restart** loses all of it and starts a new
   epoch, and every client reloads, as an epoch change already makes it do. **A time boundary**
   needs nothing special: the minute tick (point 3) derives and publishes like a write. *Why not
   per revision:* a client is only ever told how to go from the publication before to the next
   one; nothing asks for an older board, and a reconnect that is further behind than the ring
   costs one full load.

3. **Time is a publisher of its own: a tick every minute, with the hash taken over the derived
   board at the publication's own `now`.** The publisher derives on every committed write **and**
   once a minute, aligned to the wall clock (fired half a second past each minute). A tick that
   changes nothing publishes nothing; one that changes something (a Task gone Overdue, a Habit
   occurrence appearing, a lock's `until` passing) is a publication like a write's, with its own
   sequence number, and reaches every client as changed nodes. Each publication is derived at one
   `now`, the host's clock when the derive began, carried in the publication. **The hash covers the
   derived board** (what clients hold and draw), not the stored rows, and **it is compared only at
   equal sequence numbers**: a client compares its hash with the hash of the publication it has
   applied, never with a board derived at another instant. So a time boundary cannot raise a false
   alarm: a client that has not yet received the tick's event is *behind* (a lower sequence), which
   is a different finding with a grace period (decision 15), not a mismatch. *Why a minute:* the
   NAS derive is about 200 ms, so a tick costs about 0.3 % of one core; a computed next boundary
   would miss second-granular `until` timestamps and exact windows, and five minutes (the push
   notifier's period) leaves a lifted lock showing for too long. *Why not stored rows:* the client
   holds no stored rows, and the hash exists to prove the client holds what the server published.

4. **The canonical form is each entry's compact JSON, and the digest runs on both sides: Rust on
   the producer, TypeScript on the client.** The board is cut into **entries** (decision 11: a row,
   a group of rows, or a map entry, each with a key). An entry's **digest** is FNV-1a 32-bit over
   the UTF-8 bytes of `collection + "\0" + key + "\0" + json`, where `json` is the entry's value as
   compact JSON exactly as the core serializes it (`serde_json::to_string`), and on the client
   `JSON.stringify` of the value it holds. The **board hash** is the sum of every entry's digest,
   wrapping at 2^32; a **sum per collection** is kept beside it for diagnosis. *Why per entry and a
   sum:* it is incremental, so a client checks every event in O(changed entries) and only the idle
   check walks the whole board; and it is order-free, so a client that keeps rows in a different
   order (decision 12) agrees. *Why JSON text and not a Rust value walk:* the board lives in JS, and
   `JSON.stringify(JSON.parse(s)) === s` holds for the core's compact JSON of these types (no
   floats, no integer-like object keys, no integers above 2^53, no lone surrogates); a corpus pins
   it with every escape that could differ (build plan, step 2). *Why not wasm:* ADR 0017 drops the wasm
   build, and the digest is twelve lines. *Why FNV-1a 32:* trivially identical in both languages,
   needs no dependency, and a collision only delays detection of a missed event until the next
   check. Measured: digesting a synthetic 2.4 MB board of 16 000 entries in Node took 19-30 ms on
   the loaded desktop; a phone is perhaps four times slower, which is why the full recompute runs
   only when idle (decision 15). **The client never trusts the producer's digest of a value it
   holds:** it computes its own, so the check covers what it applied, not only its bookkeeping.
   **To keep the JSON identical** the client must hold the producer's JSON as it is: the full load
   and the events cross `HttpBackend` as raw JSON (`serde_json::value::RawValue`), never through
   the app's Rust structs, so an app and a server one field apart still agree.

5. **Standalone runs the same publisher in process, and the frontend cannot tell the modes apart.**
   `SqliteBackend` owns a `BoardPublisher` over its own `ChangeFeed`; it records a write itself
   when a Gesture that wrote closes or aborts, on undo and redo, for every MCP write (the endpoint's
   `Announce`), and for the few writes the journal does not see (decision 18). The publisher emits
   each change event to every window as the Tauri `board-changed` event, with the same JSON as a
   server's. `load_mindmap` answers the latest publication. In Standalone the epoch and revision,
   which were absent, now exist (the feed's), so the windows' rules have no "no revision" branch.

6. **Every window applies every event, the writer included, and a settled patch retires in the
   same update that brings the server's value.** Each window keeps one copy of the board
   (`use-board-store.ts`, unchanged); its tabs and views read that copy. Every window receives
   every change event, in both modes: Standalone no longer leaves out the window that wrote,
   because that window no longer reloads. A window applies an event to its copy and then retires,
   in the same synchronous step, every answered pending write the new copy reflects (decision 14),
   so React renders the board with the server's value and without the patch at once, never the
   old value in between. Several windows apply the same event independently; a window that missed
   one finds the gap at the next event or at its next head check, and reloads alone.

7. **A removal is a key; a move is the moved row set again; a tree view needs nothing else.**
   Changes name entries by key: `set` carries `[key, value]` pairs (an addition or a replacement)
   and `del` carries keys. There is no move operation. The board's rows carry their own parent
   (`parent_type`, `parent_id`) and `position`, and every view builds its tree from the rows on
   every board it is given (`use-mindmap-data.ts` sorts each parent's children by position), so a
   moved node is its row set again with its new parent and position, together with whatever else
   the move changed (siblings' positions, its lifecycle, inherited Plans and other facts), each as
   its own entry. A deleted subtree is one `del` per entry of every node in it. *Why:* a
   move operation would be a second description of a change the rows already describe, and the
   tree is derived from rows anyway; re-parenting is the rows' business.

8. **The diff compares the core's values with `PartialEq`, and serializes only what changed.**
   Every type the board holds derives `PartialEq` (most `Eq` too; there are no floats). The diff
   indexes the previous board by entry key, walks the new board, compares each entry with `==`, and
   serializes only the entries that differ: their JSON goes on the wire and into their digest. The
   whole board is serialized only for the first publication of a run, to seed the digests, and
   when a full load asks for its JSON. *Why:* the measured serialized diff was 21 ms on the desktop
   and about 20 ms of it was serialization; comparing values in memory is a fraction of that.
   **A field added to the board cannot be forgotten:** the diff and the digest seeding destructure
   `MindmapLoad` exhaustively (no `..`), so a new field fails to compile until it is given a
   collection, and a new nested type fails until it derives `PartialEq`.

### The rest

9. **One publisher, in the core, for every host.** `arlesh_core::mindmap::publisher::BoardPublisher`
   runs over a `SessionFactory` and a `ChangeFeed` on a Tokio runtime its host hands it, and tells
   a sink about each change event. The Python server, the desktop's Standalone backend, and later
   `ccc`'s replica each start one. The pure parts (entries, keys, the diff, the digest) are a
   rules module, `mindmap::rules::changes`, under ADR 0010's purity check. Its loop: wait for the
   feed to move past the last revision published, or for the minute tick; read the revision `r`;
   derive the board at `now` (the agents' blocking, then `mindmap::board`, in one read
   transaction: the same function `/board` uses); diff against the latest publication; if the
   trigger was a write or the diff is not empty, publish with the next sequence number. Writes
   that land while it derives are taken by its next turn, so writes close together cost one derive.
   A derive that fails is logged and retried at the next trigger; the latest publication stays.

10. **A publication has a sequence number as well as a revision.** The **revision** keeps its
    meaning, the count of committed writes, and every answer's `X-Arlesh-Revision` header still
    carries it. The **sequence** (`seq`) counts publications within an epoch, one per publication,
    so a tick has one without being a write. Gaps are judged by `seq` (an event applies only to the
    publication just before it); a writer's wait is judged by `revision` (decision 13). The
    revision is read **before** the derive's transaction begins, and the feed is bumped only after
    a write commits, so a publication's board holds at least the writes its revision counts: a
    window may learn of a write early, never late.

11. **The board is cut into entries by collection, each with a key both sides compute.** One
    collection per `MindmapLoad` field, named as the field:

    | Collection | Entry | Key |
    | --- | --- | --- |
    | `domains`, `infos`, `flows`, `flow_goals`, `flow_tasks`, `flow_commitments`, `flow_expectations`, `flow_cycles`, `flow_dependencies` | a row | its `id` |
    | `tasks`, `goals`, `commitments`, `expectations` | a row | the board key, `<kind>-<id>` (`task-12`, `task-<uuid>`), as `short_ids` and `facts` are keyed |
    | `lifecycles`, `flow_instance_nodes` | a row | `<node_type>-<node_id>` |
    | `habits` | a row | its `flow_id` |
    | `block_reasons` | all the reasons of one owner, in board order | `<owner_type>-<owner_id>` |
    | `task_dependencies` | all the edges of one Task, in board order | `task-<task_id>` |
    | `short_ids`, `facts` | a map entry | the map's key |
    | `agent_activity` | the one value | `agent_activity` |

    `plans` and `derived_in_progress` are never sent and are not entries. *Why groups for block
    reasons and dependencies:* neither has a unique key of its own (a derived block reason has no
    row), and both are read per owner; a group is replaced whole when any of it changes, which is
    what an owner's list is.

12. **The client's apply is a pure function, and order inside a collection does not matter.**
    `applyBoardChanges(board, changes)` in `src/utils/board-changes.ts` takes the board a window
    holds (the `MindmapLoad` and its per-entry digests) and a set of changes, and returns a new
    board: a replaced entry keeps its place, a new one is appended, a deleted one is dropped, and
    collections without changes keep their identity. It knows nothing of events, revisions or
    Tauri, so `ccc` can feed it from anywhere. Nothing on the client may depend on a collection's
    order except through a field (a position, `flow_id`); the build audits that (step 9 of the
    build plan).

13. **A writer settles on its write's revision; the whole-board reload after a write goes.** The
    backend keeps a **fence**: the newest revision it knows a write reached (`board_fence`, a local
    call: in Client mode the highest `X-Arlesh-Revision` of any answer in the current epoch, in
    Standalone the feed's revision). Every place that ran `await reload()` after a write now runs
    `await settle()`, which reads the fence and resolves once the window's board has reached that
    revision in that epoch. If it has not within 5 s, it falls back to one full load and resolves
    (a bug is behind that, so it logs a warning). `load()`, the full load, stays for the first view,
    a gap, an epoch change, a hash mismatch and that fallback.

14. **The lane retires a patch by revision.** An answered write takes its revision from its
    response when it carries one, and otherwise from the fence read as the answer arrives. Its patch
    is retired once the board's revision reaches it in the same epoch. Across an epoch change it is
    retired by a full load begun after the answer (a committed write survives a restart, ADR 0012
    decision 11). The old "a read began after the answer" rule is dropped for one epoch: a full load
    now serves the latest publication, which can predate a write already answered. If the fence
    cannot be read, the answer has no revision, and its patch retires at the first board the window
    takes in (an event applied or a full load) at least 5 s after the answer. The lane no longer
    asks the board to reload after an answer (ADR 0012 decisions 5 and 15 are amended).

15. **The hash is checked on every event, and the head is checked periodically and when idle.**
    - **On every event**, after applying it, a window compares its running board hash with the
      event's `hash`. A mismatch reloads and reports a bug.
    - **The head** is the latest publication's `{epoch, seq, revision, hash, sums}`. A window reads
      it with `board_head`, a local call: in Standalone from the publisher, in Client mode from what
      `HttpBackend` last heard on the stream, which now sends the head as a `board-head` event in
      place of each 15-second keepalive comment, so the check costs no request. A window checks the
      head every 60 s and 5 s after the last event it applied, while a view is mounted and the window
      is visible. A head with another epoch reloads. A head ahead of the window's `seq` is noted;
      ahead still at a check 10 s or more later, the window missed an event, and it reloads with a
      warning. A head at the window's `seq` with another hash reloads and reports a bug.
    - **The full recompute**, every entry digested again from the values held rather than the
      running sum, runs when the window becomes visible and every 10 minutes, and is compared the
      same way.
    - **Right after a full load** the window compares its computed hash with the load's. They can
      only differ through a canonical-form defect, not a missed event, so it reports that bug once
      and stops comparing hashes in that window until the app restarts (sequence checks go on), so
      a defect never becomes a reload loop.
    - **A bug report** is `report_board_divergence`, a Tauri command that writes a
      `tracing::error!` to the app's log with the window, the epoch, both sequences and hashes and
      the collections whose sums differ, and `console.error` in the window.

16. **The change event: one shape, from the server's stream to the windows, kept small.** The
    stream's `board-changed` event, the Tauri `board-changed` event and the ring hold one JSON shape:
    `{epoch, seq, revision, now, hash, changes}`, with `changes` mapping a collection to
    `{set: [[key, value], …], del: [key, …]}` and leaving out collections that did not change.
    The event's SSE id is `<epoch>:<seq>`. It stays small because it carries only changed entries,
    each once, as compact JSON; **when a publication's changes would exceed 256 KiB** (a large
    paste, an import, a subtree deleted) the event carries `"reload": true` instead of `changes`,
    and the clients do one full load. The events are not gzipped (a compressor holds a stream back).
    `revision` and `epoch` stay where they were, so an app that knows only revisions still reloads
    on each event as before.

17. **Catch-up after a dropped stream replays the ring.** A reconnect that sends `Last-Event-ID:
    <epoch>:<seq>` of this epoch is sent the events after `seq` from the ring, in order. If they are
    no longer all there, or the id is another epoch's or unreadable, it is sent one event with
    `"reload": true` at the current publication. `HttpBackend`'s follower keeps the last event id
    across suspend and resume, so **Android** catches up on resume from the ring instead of
    reloading every window: on resume it reconnects, checks `/health`, and relays what it is sent.

18. **MCP writes, undo, redo and the journal's blind spots all go through the feed.** On the server
    nothing changes: every write request (undo and redo included) bumps the feed after it commits,
    and so does every MCP write. In Standalone the backend records a write where the shell used to
    announce one (a Gesture that wrote closing or aborting, a failed abort, undo and redo that
    applied, the MCP endpoint's `Announce`), and also after the writes the journal does not see but
    the board reads: the MCP roots, an agent's Claim and the capacity lock. The minute tick is the
    safety net for one that is missed: the board is at most a minute behind, and a window settles by
    the fence, which such a write never moves.

19. **`/board` stays; the app's full load is `GET /board/current`.** `/board?now=` still derives a
    fresh board at the asked `now`, for agents, scripts and the MCP, and its answer is unchanged.
    `GET /board/current` answers the latest publication as it is: its JSON (the core's own, nulls
    included, as the events carry it) with `X-Arlesh-Seq`, `X-Arlesh-Revision` (the publication's
    revision, not the current one), `X-Arlesh-Epoch`, `X-Arlesh-Hash` and `X-Arlesh-Board-Now`.
    It derives nothing, so it is cheaper than `/board`. The shared board is therefore derived at the
    **server's** clock, not the device's: the server must run in the user's time zone, which the
    spec already asks of it for writes.

20. **`api_version` is not bumped.** Everything is additive. An app that knows only revisions
    ignores the new fields and the `board-head` event and reloads on each `board-changed`, as now.
    An app talking to a server without `/board/current` gets 404 `unknown_route` and falls back to
    `/board?now=` with no sequence or hash, and then treats every event as a reload, as now; its
    writes still settle, because a reload's revision header reaches the fence.

21. **One pull request.** The server half alone would cost the NAS a derive a minute and show
    nothing, and every hand test needs both halves; the user's route names "the PR". The build plan
    orders it in commits that each compile.

22. **No migration, no new dependency, and no change to the model map.** The publication, the
    sequence and the hash are how the board travels, not concepts of the board, so
    `docs/model-map.*` and `docs/model-graph.html` stay; `CONTEXT.md` gains the terms.

## Considered options

- **Diff by serializing both boards to JSON and comparing text.** Measured at 21 ms on the desktop,
  20 of it serialization, and about four times that on the NAS for every publication. Rejected for
  `PartialEq` (point 8).
- **Applying the write locally from its answer.** A write's answer carries its own row, but the
  board derives rollups, blocks and inherited Plans from it; this is why the reload after a write
  existed (ADR 0012 decision 15).
- **Keeping the derive inside the write's answer.** About 200 ms more per write on the NAS. Ruled
  out by step 1.
- **Hash in Rust only**, with the client's Rust side holding a copy of the board to hash. It would
  verify a copy the windows do not draw, and in Client mode it would need the Rust side to apply
  every event too: the replica `ccc` builds. Rejected for this Task.
- **Per-entry digests sent by the server.** The full load would grow by 15-20 % (one digest per
  entry, about 16 000 of them), and the client would only check its bookkeeping, not what it holds.
- **A move operation in the diff.** A second description of what the rows already say (point 7).
- **One sequence for writes and ticks (bumping the revision on a tick).** A tick that bumped the
  write count could stamp a board older than a write committed during its derive, unless ticks took
  every writer's lock, and MCP writes do not take the server's. Two counters avoid the race.
- **Ticks only at scope boundaries.** Misses second-granular `until` and exact windows; the minute
  is cheap enough.
- **Two pull requests (server, then app).** Each would merge alone, but the first shows nothing,
  costs a derive a minute, and blocks the builder on a merge.

## Consequences

- A write costs its own request and one small event per device; the 1.6 MB board moves only at
  start-up, after a gap, an epoch change or a mismatch. Another device sees a change about one
  derive after it commits (about 200 ms on the NAS, 50 ms on the desktop) plus the link.
- The NAS derives once per write burst and once per minute, and serves `/board/current` without
  deriving. The push notifier still derives on its own looks; reading the publisher's board instead
  is a separate improvement (not in this Task).
- The window's board is derived at the server's clock; a server in another time zone shows the
  server's day.
- `board-changed` now carries a payload. [Window and tray](../spec/window-tray.md)'s "a signal,
  not a diff" is reversed: the payload is not a second description written beside each command but
  a comparison of two derived boards, so it cannot drift from the writes either.
- ADR 0012 decisions 5, 6, 11 and 15 are amended by decisions 13 and 14 above: no reload after an
  answer, retirement by revision.
- `ccc` reuses the apply path, the change event, the digest and the hash. Its replica runs a
  `BoardPublisher` locally; the server's diff then serves only clients without a replica.
- The windows' board order can drift from a fresh load's order (decision 12); a fresh load restores
  it, and nothing may read meaning into it.

## Build plan

One PR, branch `2d9-changed-nodes`, targeting `dev`. Commit after each step; each step compiles
and its tests pass. Rules that bind every step: `.claude/rules/` (no `unwrap`/`expect` outside
tests, `thiserror`/`anyhow`, `tracing`, docs on every `pub` item, tests in sibling `tests.rs`
files, no `any` or `as` in TypeScript, named exports, `@/` imports), no full local test suite
(targeted tests with `CARGO_INCREMENTAL=0 -j 3`; CI is the gate), and the spec as written in this
commit is authoritative. A changelog fragment, `changelog.d/changed/<NNNN>-changed-nodes.md`, goes
in the last step (user-visible: writes and other devices' changes show without a reload, and
time-based changes appear within a minute).

**Lands first, and the diff must cover.** Task `97f` (PR #201) adds `review: Option<Review>` to
`Expectation` with new types (`Review`, `ReviewLink`, `ReviewVerdict`, `ReviewDetails`) and
`open_questions: Vec<NodeId>` to `NodeFacts`: each new type derives `PartialEq` (and `Eq`), and the
corpus (step 2) gets an expectation with a review and facts with `open_questions`. Task `077`
(child Agents) changes the agents' model; if it adds a field to any board type or to
`AgentActivity`, the same applies. The exhaustive destructure (step 2) makes a missed field a
compile error, so rebase onto `dev` before step 2 if either has landed, and again before the PR.

### Step 1. `PartialEq` on every board type

Files: `crates/arlesh-rules/src/**/model.rs` and every type reachable from `MindmapLoad`
(`crates/arlesh-core/src/{domains,infos,block_reasons,tasks/rules/lifecycle,mindmap/model}.rs`,
`flows`, `nodes::id`, `capacity`, `plan_inheritance::PlanConflict`, `gestures::SubItems`,
`capabilities::Capabilities`, and the rest the compiler names). Add `PartialEq` (and `Eq` where
every field allows) to each derive list. No behaviour changes. Test: compiles.

### Step 2. The pure rules: entries, keys, diff, digest

New `crates/arlesh-core/src/mindmap/rules/changes.rs`, its tests in `changes/tests.rs`, declared
from `mindmap/rules.rs`.

- `pub enum Collection` with one variant per entry collection of decision 11, `as_str()` giving
  the field name, and `ALL`.
- `pub fn entries(load: &MindmapLoad) -> Entries<'_>`: every entry as `(Collection, key, &value)`,
  grouping `block_reasons` by owner and `task_dependencies` by Task in board order. It destructures
  `MindmapLoad` with no `..` (`plans: _`, `derived_in_progress: _` named), so a new field is a
  compile error.
- `pub fn digest(collection: Collection, key: &str, json: &str) -> u32`: FNV-1a 32 (offset basis
  `0x811c9dc5`, prime `0x01000193`) over `collection`, a zero byte, `key`, a zero byte, `json`.
- `pub struct BoardDigests { by_entry: HashMap<(Collection, String), u32>, sums: BTreeMap<Collection, u32>, total: u32 }`
  with `seed(load) -> Result<Self, serde_json::Error>` (serializes every entry once) and
  `apply(&mut self, changes: &BoardChanges)` (wrapping subtract the old digest, add the new).
- `pub struct BoardChanges { by_collection: BTreeMap<Collection, CollectionChanges> }`,
  `CollectionChanges { set: Vec<(String, String /* compact JSON */)>, del: Vec<String> }`, with
  `is_empty()`, `wire_len()` (bytes of its JSON) and `to_json()` in the decision 16 shape (values
  written raw, not re-escaped).
- `pub fn diff(prev: &MindmapLoad, next: &MindmapLoad) -> Result<BoardChanges, serde_json::Error>`:
  index `prev`'s entries by key, walk `next`'s: missing in `prev` or `!=` means `set` (serialize
  that value), left in `prev` means `del`. Both sides destructured exhaustively, as `entries`.

Tests (`changes/tests.rs`): the same board diffs to empty; a status change gives the task row, its
lifecycle and its facts and nothing else; a move gives the moved row and the siblings whose
positions changed; a delete gives `del` for every entry of the subtree; a block reason edited
replaces its owner's group; `BoardDigests::seed(next)` equals `seed(prev)` after `apply(diff)` (the
property, over every case); `digest` of the corpus's entries equals the corpus (below); a value
serialized and digested matches the corpus's `json`. `scripts/check-rules-purity.sh` passes.

New corpus `conformance/board-changes.json` (hand-written; digests computed once by the Rust test,
which prints the expected values on a mismatch): `entries`, a list of `{collection, key, value,
json, digest}` covering every collection, a Habit occurrence (a UUID key), strings holding `"`,
`\`, `/`, a tab, `\u0001`, `\u001f`, `\u007f`, `é`, an emoji, U+2028 and U+2029, an empty
string, an absent and a null option; and `cases`, a list of `{name, before, after, changes}` where
`before` and `after` are small `MindmapLoad`s (a status step, a create, a move, a delete of a
two-level subtree, a block reason edit, a dependency added, a short id lengthened by a new node,
`agent_activity` changing, a tick turning a Task Overdue). The Rust test asserts `diff(before,
after)` equals `changes` (each collection's `set` and `del` compared as sets), and that every
entry's value deserializes into its Rust type and serializes back to `json`.

### Step 3. The publisher

New `crates/arlesh-core/src/mindmap/publisher.rs`, tests in `publisher/tests.rs`. Not a rules
module (it reads the database and runs on Tokio).

- Move the body of `SqliteBackend::load_mindmap` into `pub async fn mindmap::current(db, now) ->
  Result<MindmapLoad, AppError>` (the agents' blocking, then `board`), and call it from there, from
  the Python bindings' `Request::Board` and from the publisher, so all three derive alike.
- `pub struct Publication { epoch: Arc<str>, seq: u64, revision: u64, now: NaiveDateTime, hash: u32,
  sums: BTreeMap<Collection, u32>, load: MindmapLoad, json: OnceLock<Arc<str>> }` with
  `fn json(&self) -> Result<Arc<str>, serde_json::Error>` (the whole load, plain `serde_json`,
  serialized once) and `fn head(&self) -> BoardHead`.
- `pub struct BoardHead { epoch, seq, revision, hash, sums }` (`Serialize`, `Deserialize`).
- `pub struct ChangeEvent { seq: u64, data: Arc<str> }`: `data` is the decision 16 JSON.
- `pub type Sink = Arc<dyn Fn(&ChangeEvent) + Send + Sync>`.
- `pub trait Clock: Send + Sync { fn now(&self) -> NaiveDateTime; fn next_tick(&self) -> Pin<Box<dyn Future<Output = ()> + Send>>; }`
  with `LocalClock` (local wall clock, fires 500 ms past each minute) and a test clock.
- `pub struct BoardPublisher` (cheap `Clone`, an `Arc` inside):
  - `start(factory: SessionFactory, feed: ChangeFeed, clock: Arc<dyn Clock>, sink: Sink, runtime: &tokio::runtime::Handle) -> Self`
    spawns the loop of decision 9. First turn: derive, `BoardDigests::seed`, publication `seq = 1`,
    no event. Each later turn: `r = feed.revision()` **before** `factory.begin()`; derive at
    `clock.now()`; `diff`; skip when the trigger was the tick and the changes are empty; else
    `seq += 1`, apply the changes to the digests, build the event (or the `reload` form when
    `wire_len() > 256 * 1024`), push it on the ring (64 events, 4 MiB; drop the oldest), store the
    publication, call the sink, and wake waiters. A derive or serialization error is
    `tracing::error!`-logged; the loop carries on at the next trigger.
  - `record_write(&self)`: `feed.bump()`.
  - `fence(&self) -> BoardRevision`: the feed's epoch and revision.
  - `async fn current(&self) -> Arc<Publication>`: the latest, waiting for the first.
  - `head(&self) -> Option<BoardHead>`.
  - `async fn after(&self, seq: u64, wait: Duration) -> Vec<ChangeEvent>`: the ring's events
    after `seq` when they are all there; one synthesized `reload` event at the current publication
    when they are not (so `after(0, …)` always answers the reload event, since publication 1, the
    first board of a run, has no event); waits up to `wait` for the next event when there is none;
    empty on timeout.
  - `epoch(&self) -> Arc<str>`: the feed's.

Tests, with a temporary database and the test clock: a write then `record_write` publishes one
event with `revision` 1, `seq` 2 and the written task; three writes before the loop runs again
publish one event; a tick with nothing changed publishes nothing; **a time-based change**: a Task
due today with the clock moved past midnight, a tick publishes its lifecycle with `overdue` and the
event's `hash` equals `BoardDigests::seed` of a fresh `mindmap::current` at the same `now`; an
oversized change publishes `reload`; `after` replays from the ring, and synthesizes `reload` once
the ring has dropped the asked `seq`; the publication's revision is never above the writes its
board holds (a write committed during the derive is in the next publication).

### Step 4. The Python server

Files: `crates/arlesh-py/src/{shared.rs,lib.rs,request.rs}`,
`crates/arlesh-py/python/arlesh/{database.py,_native.pyi}`,
`crates/arlesh-py/python/arlesh/server/business_logic/board.py`,
`.../entrypoints/fastapi/{app.py,revision.py,routers/board.py,routers/events.py,logging/lifespan.py}`,
`conformance/client-mode.json`, the server tests.

- `Shared` gains `publisher: OnceLock<BoardPublisher>`. `NativeDatabase` gains
  `start_publisher()` (starts it once per file, over this open's factory, the shared `changes`
  feed, `LocalClock` and a sink that does nothing: the stream pulls with `after`),
  `board_current()` (awaitable: `(bytes, head JSON)`), `board_events_after(after: int, wait:
  float)` (awaitable: `list[tuple[int, str]]`), `board_head()` (`str | None`) and an `epoch`
  getter (the feed's).
- `arlesh.Database` gains `start_publisher`, `board_current`, `board_events_after`, `board_head`;
  `SqliteDatabase` implements them through the native calls; the `HttpBackend` façade raises
  `not_permitted` with `details.reason = "not_in_client_mode"`; the unit tests' fake implements them.
- `Board.epoch` returns the native epoch instead of its own UUID, so the headers, the stream and the
  publications name one run.
- The lifespan calls `start_publisher()` once the database is held.
- `GET /board/current` (`routers/board.py`): the body as it is (`application/json`), headers
  `X-Arlesh-Seq`, `X-Arlesh-Revision` (the publication's), `X-Arlesh-Hash`, `X-Arlesh-Board-Now`.
  `RevisionHeadersMiddleware` leaves an `X-Arlesh-Revision` the route set. Declare it before
  `GET /board` so the path is not read as `?now`.
- `GET /events/changes` (`routers/events.py`): on connect, a `Last-Event-ID` of this epoch replays
  `board_events_after(seq, 0)`; another epoch's or an unreadable one sends the reload event
  `board_events_after(0, 0)` answers; no id sends nothing. Then `board-head` once, then loop: `board_events_after(last,
  wait=0.5)`, each event written as `id: <epoch>:<seq>` / `event: board-changed` / `data: <data>`,
  and a `board-head` event (`data`: the head JSON) after 15 s with none, in place of the keepalive
  comment. Shutdown is checked between waits, as now.
- `conformance/client-mode.json`: `current_board` → `GET /board/current`; `board_fence`,
  `board_head` under `local`; `streams.changes` notes the `board-head` event.

Tests (`crates/arlesh-py/tests/server/`): `GET /board/current` answers the board with the four
headers and its revision header is the publication's; **a write reaches the stream as changed
nodes** (`test_server_live_sync.py`: client A sets a Task Done; the stream's next `board-changed`
has `changes.tasks.set` holding that Task with `status` done and `seq` one past the head, and no
`/board` request is made); two writes close together arrive in order with consecutive `seq`;
`Last-Event-ID` of the epoch replays the missed events; one past the ring or of another epoch gets
`reload`; an MCP write and `POST /undo` each produce a `board-changed` with changes; a quiet stream
sends `board-head`; the parity test lists the new route.

### Step 5. The Backend crate

Files: `crates/arlesh-backend/src/{revision.rs,mindmap.rs,sqlite/mod.rs,sqlite/mindmap.rs,sqlite/undo.rs,sqlite/access.rs,sqlite/agents.rs,http/mod.rs,http/mindmap.rs,http/events.rs,tests.rs}`,
`crates/arlesh-py/src/http_backend.rs`.

- `revision.rs`: `BoardHead` (re-exported from the core); `CurrentBoard { load: Box<RawValue>,
  revision: Option<BoardRevision>, seq: Option<u64>, now: Option<String>, hash: Option<u32> }`
  (`Serialize`; the window reads `load`); `BoardChange { epoch: String, seq: Option<u64>, revision:
  u64, now: Option<String>, hash: Option<u32>, changes: Option<Box<RawValue>>, reload: bool }`
  (`Serialize` and `Deserialize`, absent fields skipped), parsed from a stream event's data or
  built from the publisher's `ChangeEvent`.
- `BoardPort` gains `async fn current_board(&self) -> Result<CurrentBoard, WireError>`,
  `fn board_fence(&self) -> Option<BoardRevision>` and `fn board_head(&self) -> Option<BoardHead>`.
  `load_mindmap(now)` stays (Python scripts read through it).
- `SqliteBackend::new(factory, stacks, sink, runtime)` starts a `BoardPublisher` over a new
  `ChangeFeed` with `LocalClock`, and exposes `write_recorder() -> arlesh_core::board::Announce`
  (a closure calling `record_write`) for the MCP endpoint. It calls `record_write()` itself where
  the shell announced: in `close_gesture` when the Gesture wrote, in `abort_gesture` when it wrote
  or its reversal failed, in `undo` and `redo` when they applied, and after the writes the journal
  does not see: setting or removing an MCP root, the agents' Claims and the capacity lock (find
  them from the tables `src-tauri/tests/undo_journal.rs` exempts and the commands that write
  `agent-capacity.json`). `current_board` answers the publication (its cached JSON as `RawValue`,
  revision, seq, now, hash); `board_fence` the publisher's fence; `board_head` its head.
- `HttpBackend`: `send_stamped` records the newest stamp in a `fence` (a new epoch replaces it).
  `current_board` sends `GET /board/current`, reads the body as `RawValue` and the headers, keeps it
  as the offline board, and on 404 `unknown_route` sends `GET /board?now=<device now>` and answers
  it with `seq`, `now` and `hash` absent. `head` is a `Mutex<Option<BoardHead>>` the follower sets.
- `http/events.rs`: `Announce` becomes `Arc<dyn Fn(BoardChange) + Send + Sync>`. A `board-changed`
  is parsed into `BoardChange` (an event whose data has no `seq` gives `seq: None`, which windows
  treat as a reload) and sets the head's epoch, seq, revision and hash; a `board-head` sets the
  head. The last event id moves into `Follower`, kept across `suspend` and `resume`.
- `arlesh-py/src/http_backend.rs` adapts to the new `Announce` and keeps publishing revisions only.

Tests: the parity test (`tests.rs`) passes with the new methods; the follower relays a change
event's `changes` as raw JSON and makes no `GET /board/current`; a `board-head` event sets
`board_head()`; the last event id survives `suspend` and `resume`; `current_board` falls back to
`/board` on `unknown_route`; the fence takes the newest revision and resets on a new epoch; in
Standalone, a Gesture that wrote moves the fence by one and a sink receives the event; a read-only
Gesture moves nothing.

### Step 6. The Tauri shell

Files: `src-tauri/src/lib.rs`, `src-tauri/src/commands/{board.rs,mindmap.rs,undo.rs,mobile_shell.rs}`
(and wherever suspend/resume reloads the windows), `crates/arlesh-core/src/board.rs` (the
`crate::board` module and its docs), the command registration and capabilities, `src-tauri/tests/board_changed.rs`.

- `commands/board.rs`: `emit_board_change(app, &BoardChange)` sends to **every** window (no origin
  exclusion). `announce`, `announce_revision` and `announcer` go; `recipients` goes from
  `crate::board`, and its module docs are rewritten to this ADR.
- `setup_standalone`: build `SqliteBackend` with a sink that turns each `ChangeEvent` into a
  `BoardChange` and emits it; give the MCP endpoint `backend.write_recorder()`.
- `setup_client`: the follower's `Announce` emits the `BoardChange`.
- `commands/undo.rs`: drop the `announce` calls (the backend records the writes).
- `commands/mindmap.rs`: `load_mindmap` takes no `now` and answers `backend.current_board()`.
- New commands `board_fence`, `board_head` and `report_board_divergence(report)` (the last one
  `tracing::error!` with every field of the report, answers nothing).
- On resume (Android), stop reloading the windows: the follower reconnects and replays.

Tests: `src-tauri/tests/board_changed.rs` rewritten: a Standalone Gesture that wrote reaches every
window, the writer included, as a `BoardChange` with `changes`; undo and an MCP write do too.

### Step 7. The frontend apply path

New `src/utils/board-changes.ts` and `board-changes.test.ts`; new
`src/utils/board-changes-conformance.test.ts`.

- `COLLECTIONS` (the decision 11 table), `keyOf(collection, item)`, `entriesOf(load)` (grouping as
  the Rust side does), `entryDigest(collection, key, value)` (`JSON.stringify`, `TextEncoder`,
  FNV-1a 32 with `Math.imul`, `>>> 0`).
- `interface HeldBoard { load: MindmapLoad; digests: BoardDigests }`, `BoardDigests { byEntry:
  Map<string, number> /* "<collection>\0<key>" */; sums: Record<string, number>; total: number }`.
- `indexBoard(load): HeldBoard`, `applyBoardChanges(held, changes): HeldBoard` (decision 12;
  digests updated from the values it applies; collections without changes keep identity),
  `recomputeHash(load)`, `differingCollections(a, b)`.

Tests: the conformance test replays `conformance/board-changes.json`: every entry's `keyOf`,
`JSON.stringify(value) === json` and `entryDigest` match; every case's `applyBoardChanges(before,
changes)` equals `after` per collection as multisets, and its hash equals `indexBoard(after)`'s.
Unit tests: a replaced row keeps its index; identity is kept for untouched collections; a group
replace drops the old group's rows.

### Step 8. The window's board, the lane and the checks

Files: `src/api/board.ts`, `src/api/mindmap.ts`, `src/stores/use-board-store.ts`,
`src/stores/watch-board-changes.ts`, `src/stores/board-revision-store.ts`,
`src/stores/use-pending-writes-store.ts`, `src/utils/pending-writes.ts`, their tests,
`use-mindmap-data.*.test.ts`.

- `src/api/board.ts`: `BoardChange` and its guard; `onBoardChanged(handler: (change: BoardChange |
  null) => void)`; `boardFence()`, `boardHead()`, `reportBoardDivergence(report)`.
  `src/api/mindmap.ts`: `loadMindmap(): Promise<CurrentBoard>` (no `now`).
- The board store: `SharedBoard` gains `digests` and its stamp becomes `{ read, epoch, seq,
  revision }` (`read` counts every board the window takes in, load or event). `now` is the
  publication's (`localNowIso()` only when a legacy load has none). New `applyChange(change)` and
  `settle()`; the subscriptions that reloaded after a lane answer and on an MCP roots change go.
  After an apply it refreshes the agent-activity store when `agent_activity` changed, and re-reads
  people's names (Standalone) when a set Task delegates to a Person it cannot name.
- `watch-board-changes.ts` (the 150 ms settle wait goes, there is no echo to wait for): a change
  with no `seq`, or `reload`, or another epoch, or a `seq` more than one past the window's → full
  load; `seq` at or below → skip; one past → apply, then compare the running hash with `hash`
  (mismatch → report and full load). Events arriving during a full load are buffered and applied
  after it in order (those at or below its `seq` dropped).
- Head checks per decision 15: 60 s interval and 5 s after the last applied event while a view is
  mounted and `document.visibilityState === "visible"`; the full recompute on `visibilitychange`
  to visible and every 10 minutes; the post-load canonical check that disables hash comparison for
  the window on a mismatch.
- The lane (`pending-writes.ts`, the store): `WriteAnswer` keeps `afterRead`, now the board-intake
  counter, and gains `answeredAt`; `isReflected` per decision 14; the store fills a missing
  revision from `boardFence()` before `markAnswered`; the board store calls `reportBoard(stamp)` in
  the same synchronous step as `set({ board })`.
- `settle()` per decision 13 (5 s, then one full load and a `console.warn`).

Tests: **a write no longer reloads** (`use-mindmap-data.pending.test.ts`, `.sync.test.ts`,
`.create.test.ts`): a status step, a create and an editor Save make no second `loadMindmap`; the
step's `settle` resolves when a change event with the fence's revision is applied; **another
device's change applies from the event alone** (an event with `changes` updates the drawn tree and
`loadMindmap` is not called); **a dropped event is repaired**: a `seq` gap reloads; a head ahead for
two checks 10 s apart reloads (fake timers); a head at the same `seq` with another hash reloads and
calls `reportBoardDivergence`; an event whose `hash` disagrees after apply does too; **time-based
changes raise no false alarm**: a head one `seq` ahead at one check and caught up by an event before
the next does not reload or report; **no flicker**: subscribe to the drawn title through a pending
rename, apply the event that reflects it, and assert the titles seen are only the patched one; the
canonical check reports once and stops comparing hashes; an epoch change reloads; a legacy event
(no `seq`) reloads as before.

### Step 9. Callers: settle instead of reload, and the order audit

Files: `src/components/MindmapView/use-mindmap-data.ts` and every caller of its `reload`
(`use-node-editor.ts`, `MindmapView.tsx`, `use-task-*.ts`, `use-quick-plan.ts`,
`use-wait-editor.ts`, `use-touch-board-commands.ts`, `use-create-editors.ts`,
`use-answer-question.ts`, `use-undo.ts`, `use-quick-dependency.ts`, `use-hand-archive.ts`, and any
other the type checker names). Rename the hook's `reload` to `settle` and point it at the store's
`settle`. Leave the Devices page's own `reload` (the device list) alone.

Audit every reader of a `MindmapLoad` collection for reliance on array order rather than a field;
fix any by keying or sorting on the field (`habits` by `flow_id`, children by `position`). Test:
a board built by applying the corpus cases renders the same tree (`buildTree` output) as a fresh
load of `after`.

### Step 10. Docs that describe code, and the fragment

Update code comments that say "a signal to reload, not a diff" or "the window that made the change
is not told" (`crates/arlesh-core/src/board.rs`, `src/api/board.ts`, `watch-board-changes.ts`,
`board-revision-store.ts`). The spec is already written (this commit). Add the changelog fragment.
Then open the PR against `dev`, with the hand tests below in its description, and drive CI green.

### Hand tests

Run with `npm run box`:

1. **Client, two devices.** `box run 2d9-changed-nodes desktop` and the Android build on a phone,
   both on the branch's server. Step a Task's status on the phone: the desktop shows it within a
   second, and the server's log shows no `GET /board` or `/board/current` from either device after
   their start-up. Create, rename, move (drag) and delete a subtree: both devices agree.
2. **Standalone, two windows.** `box run 2d9-changed-nodes desktop --standalone`, tear a tab into a
   second window, write in one: both update, neither reloads (no `load_mindmap` in the dev tools'
   IPC log after start-up).
3. **Agents and undo.** Change a Task through the MCP and press `Ctrl+Z` on a device: every window
   on every device updates.
4. **Time.** A Task due in the current part of day: when the part ends it turns Overdue within a
   minute with no write, and no divergence is logged.
5. **A dropped stream.** Turn the phone's Wi-Fi off for 20 s and on, write on the desktop meanwhile:
   the phone catches up without a full load (server log: no `/board/current`). Switch the app to the
   background for a minute and back: the same.
6. **A restart.** Restart the server: every device reloads once (new epoch) and carries on.
7. **A large change.** Paste a subtree of 300 nodes: clients do one full load (the event says
   `reload`), nothing else.
8. **Divergence.** In the dev tools, alter a node in the board store by hand and wait a minute: the
   window reloads and the app log holds one `board divergence` error naming the collection.
