# A write the user makes shows on its own node at once, and the server's answer settles it

Task **288** makes the board show some of the user's own changes the moment they act, before the
write has been answered. It is for Client mode, where every write is a round trip to
`arlesh-server` and every press used to wait for it plus a whole-board reload. It runs in both
modes, on one code path. The design was settled with the user on 2026-11-01 (the decided points are
listed under *Context*). The behaviour is specified in [Client Mode](../spec/client-mode.md),
*Pending writes*. This ADR records how it is built and why.

It **reverses, for a defined set of actions, ADR 0010's answer 2** ("Optimistic updates. There are
none, and every write reloads"). Everything outside that set still writes and then reloads.

## Status

proposed (2026-11-01, Task `288`). Decisions 1 to 12 follow what the user settled. The questions
under *Open questions* are the user's to answer; the delivery's second and third pull requests wait
on them.

## Context

Board state is a React `useState` inside `useMindmapData`
(`src/components/MindmapView/use-mindmap-data.ts`): one load builds a `MindmapNode` tree, and the
List, Plan, Steps and Zen views all read that tree (through `useListData`). Every mutation awaits its
write, then calls `reload()`, which reads the whole board again. Refusals are toasts. There is no
rollback, because nothing is shown before the write lands.

Task **9298** (*revision tracking*) lands before this. Write responses and the board read carry the
server's `revision` and `epoch`, the change stream passes the revision to the frontend, and the app
tracks its board's revision: it skips a change-stream reload whose revision is at most its own, and
an epoch change always reloads. In Client mode the gesture bracket folds into one request per write.

What the user decided (2026-11-01), and this ADR does not reopen:

- **Only the touched node's own fields** are patched, at once. Derived values (rollups, Blocked, a
  dependent's *met*, an inherited Plan, the lifecycles) change when the server answers.
- **No new rule copies.** Only a rule already pinned by a `conformance/*.json` corpus may run
  locally.
- **Both modes**, one code path.
- **The v1 actions:** the status step, Started (`Alt+Enter`), the Commitment verdict and the wait
  release (a Compound Task is refused locally); rename and the editors' saves (the editor closes at
  once); creating a child or a sibling, as a placeholder node. Move, reorder, archive, delete and
  Plan stay write-then-reload.
- **A pending cue:** a faint pulse or a dotted outline until the server answers.
- **Rapid actions queue in order:** each one patches on top of the last at once, and the writes go
  out one after another. A refusal rolls back that patch and every later one on the same node, with
  one toast.
- **A new node gets a temporary local id.** Actions queued on it wait for the real id, are rewritten
  and then sent. No server change.
- **Reconcile:** the server wins, and pending patches are re-applied on top of each fresh board. An
  answered write's patch is dropped.
- **Undo while writes are in flight:** if the last action has not been sent, it is cancelled and
  rolled back locally. Otherwise the press waits, then undoes on the server (the per-device stack).

## Decisions

1. **The lane is a Zustand store, one per window.** `usePendingWritesStore`
   (`src/stores/use-pending-writes-store.ts`) holds the window's **pending writes** in the order
   the user made them, and sends them. It is per window, not per tab: a write is about the board,
   and every tab's `useMindmapData` in the window must show the same patches. It holds no transport
   code: each write carries the closure that sends it, built by the hook that made it. *Why:* the
   React rules put cross-component state in a Zustand store per domain, and the writes are made in
   one hook (`useStatusCycle`, the node editor) and drawn by another (`useMindmapData`). Inside
   `useMindmapData` the lane would be one per tab instance, and two tabs in one window would send
   one press twice or show it in one tab only.

2. **A pending write is plain data; the logic over it is pure.** Its shape:

   ```ts
   /** One action the board shows before the server has answered it. */
   export interface PendingWrite {
     /** Its place in the window's lane; increasing, never reused. */
     seq: number;
     /** The node it touches, by node id: a real one, or a temporary one (decision 8). */
     nodeId: string;
     /** What the board shows meanwhile. */
     patch: NodePatch;
     /** What the user would call it ("rename", "mark done"), for the toast and a local undo. */
     label: string;
     state: "queued" | "sending" | "answered";
     /** Set when the server answered it. */
     answer: WriteAnswer | null;
   }

   export type NodePatch =
     | { kind: "fields"; fields: OwnFields }
     | { kind: "create"; parentId: string; afterId: string | null; node: PlaceholderNode };

   export interface WriteAnswer {
     /** The window's board-read counter when the answer arrived (decision 5). */
     afterRead: number;
     /** From the write response (Task 9298); `null` where a response has none. */
     epoch: string | null;
     revision: number | null;
     /** The node's own fields as the server wrote them, when the response carries the row. */
     fields: OwnFields | null;
     /** A create's real node id. */
     createdId: string | null;
   }
   ```

   `OwnFields` is a `Pick` of `MindmapNode`'s **own** fields, the ones read straight off the
   node's stored row: `title`, `status`, `taskStatus`, `verdict`, `agentic`, `asynchronous`,
   `timeScope`, `plan`, `dueScope`, `onScopeExit`, `tagIds`, `blockReasons`, `delegate`,
   `agenticBrief`, `infoDetails`. Derived fields (`inheritedPlan`, `inheritedAgentic`, `overdue`,
   `timing`, `resolution`, `expired`, every `*Blocked`, `met`, `archived`, Review, a Compound
   Task's status) are not in the type, so no patch can set one. The transitions over the list
   (enqueue, send, answer, refuse, cancel the tail, resolve a temporary id, flush) are a pure
   reducer in `src/utils/pending-writes.ts`. The send closures sit beside the list in the store,
   keyed by `seq`, and never inside it. *Why:* the reducer and the patch can then be unit-tested
   with no store, no React and no transport.

3. **A patch is applied by one pure function over the built tree.**
   `applyPendingWrites(board, stamp, writes, aliases): MindmapNode`
   (`src/utils/apply-pending-writes.ts`) drops the writes the board already reflects (decision 5),
   then applies the rest in `seq` order: a `fields` patch merges into its node, a `create` patch
   inserts its placeholder under its parent after `afterId`. A node it touches is marked
   `pending: true` while its write is unanswered. Only the nodes on the path from the root are
   copied, so an unpatched subtree keeps its identity and its memoised rows. A patch whose node is
   not on the board (deleted elsewhere) is skipped. `useMindmapData` keeps the loaded tree in its
   state, as now, and returns `applyPendingWrites` of it. `latestTree`, which the mutations read to
   resolve a node, holds the **patched** tree, so a second press predicts from the first. *Why:*
   patching the built tree rather than the raw rows means `buildTree`'s derivations never run over
   a patched value. A derived value is never computed locally, which is the user's rule. The pinned
   per-render rules (presets, list sections, Zen contents, the Habit fold) do read the patched tree,
   as they read every tree. They are pinned, and a Task marked Done leaving Start at once is what
   the reload would have done anyway.

4. **One lane per window, one write in flight.** The writes go out in `seq` order, the next once
   the last is answered or refused. Ordering is global, not per node. *Why:* the server serialises
   writes under its per-file lock anyway, so per-node lanes would buy no throughput. They would cost
   a dependency graph: a create, then a rename of the new node, then a child under it, must go in
   that order across what are, until the first answer, three different node ids. One lane also
   makes the refusal rule simple. When a write is refused, no later write on the same node has been
   sent, so "roll back every later one on the same node" never has to take back something already
   on the server.

   **Every write outside the lane waits for it to drain.** Move, reorder, archive, delete, Plan,
   paste, undo and redo `await whenDrained()` before they send. *Why:* a move pressed after a rename
   must not reach the server first, and a write that names a placeholder needs its real id. The
   wait costs nothing when the lane is empty, which is almost always.

5. **A patch is dropped only once a board that reflects its write is on screen.** An answered write
   is reflected by a board when that board's read **began after the answer arrived**
   (`stamp.read > answer.afterRead`, where `read` is a window-wide counter bumped at the start of
   every board read). It is also reflected when the board's revision has reached the write's in the
   same epoch (`stamp.epoch === answer.epoch && stamp.revision >= answer.revision`). The first
   condition holds in both modes and needs no revision. The second lets a reload that was already
   in flight retire the patch early. Until then the answered patch stays applied, with no cue, and
   its fields are **replaced by the server's own** (`answer.fields`) where the response carries the
   written row (`step_task_status` returns the Task, `press_commitment_verdict` the Commitment).
   *Why:* this is what keeps a skipped reload from showing stale state. Dropping a patch on its
   answer, before a board has caught up, would flash the old value for one reload. Keeping a
   predicted value after the server said otherwise would be the board disagreeing with the writer.

   **After an answer the board reloads, unless it already reflects it.** Each `useMindmapData`
   watches the store. When an answered write is not reflected by its board, it reloads. Reloads
   coalesce: at most one in flight and one waiting. For these writes the reload is not skipped by
   Task 9298's post-write rule (*skip when the write's revision is the board's revision + 1*). That
   rule would leave the derived values stale, and the derived values are exactly what the answer is
   waited for (see *Open questions*). A board read that returns after a newer one is discarded.

6. **The store forgets a write once every board has caught up.** Each mounted `useMindmapData`
   reports its stamp to the store, and an answered write that every reported board reflects is
   removed. *Why:* the drop in decision 5 is per board. A write removed from the store while a
   second tab's board still lacks it would make that board show the old value.

7. **Refusals.** Four kinds, each handled once, in the store:
   - **A refusal** (the core's error, or a gesture's `refused` outcome) rolls back that write and
     every later write on the same node, and on any placeholder under it. Those later writes are
     cancelled unsent. One toast, anchored to the node (to its parent if the node was a placeholder
     that is now gone), names the backend's own reason. Writes on other nodes go on.
   - **A confirmation the backend holds** (marking a Habit occurrence done over unfinished
     children) is a refusal without a toast: the patch rolls back and the occurrence prompt opens.
     Confirming enqueues the write again with `confirmed`, patch and all. *Why:* the occurrence
     reads not Done while the question is open, which is the truth. Holding the lane on a prompt of
     indefinite length would hold every other node's writes with it.
   - **The server unreachable** (`not_permitted`, `details.reason = "server_unreachable"`, or a
     transport failure) **flushes the lane**. Every queued and in-flight write rolls back, with one
     toast, and the board goes read-only as ADR 0011 decision 7 says. A write that was in flight may
     have landed. The next board, read once the server is back, shows whether it did.
   - **A read-only board** (offline, or a version mismatch) refuses an action before it is enqueued,
     with the toast it shows today and no patch.

8. **A new node gets a temporary id, and the lane rewrites it.** A create enqueues a `create` patch
   whose placeholder has node id `tmp:<n>` (`n` from a window counter), no row id, the kind and the
   title the user gave, and nothing derived. The write's closure is handed a resolver, and resolves
   every node id it names (its parent, its target) **at send time**. A write queued behind a create
   names the temporary id. By the time the lane reaches it the create has been answered, because
   the lane is in order, and the resolver returns the real id. The store keeps a window-lifetime
   alias map, temporary id to real id, which `findNode` and `rowIdOf` consult, so a callback holding
   a temporary id still works later. On the create's answer, the id-keyed UI state (the selection,
   the node being renamed, the open editor, the collapsed and entered nodes) is rewritten from the
   temporary id to the real one, and the answered `create` patch inserts the real node from the
   response until a board that holds it arrives. Placement is the user's intent (after the sibling,
   or the parent's last child). The server's order replaces it when the board reloads. A create
   whose parent kind may not hold the child kind is refused locally through `isValidDropTarget`,
   pinned by `parenting.json`. *Why:* this needs no server change, and the in-order lane makes
   "wait for the real id" a property of the order, not a mechanism.

9. **Undo with writes pending.** `Ctrl+Z` first asks the lane. If the newest write is still
   **queued**, it is cancelled: its patch, and everything that depended on it if it was a create, is
   removed, and the undo toast names it ("Undid rename"). Nothing is sent, and each press cancels
   one more. Otherwise the press waits for `whenDrained()` and undoes on the server, as today. When
   the write it waited for was **refused**, the press is spent on it, because the refusal already
   took the change back, and nothing is sent. Without that, the server would undo the gesture before
   it. A cancelled write never reached the server's stack, so it cannot be redone. `Ctrl+Shift+Z`
   always waits for the lane and asks the server.

10. **The cue comes from the patched tree.** `applyPendingWrites` sets `pending: true` on every
    node with an unanswered write, and each view puts `data-pending` on that node's element (the
    Mindmap node, a List row, a Steps row, a Zen card). The style is a CSS Module rule: a faint
    opacity pulse, and a dotted outline instead under `prefers-reduced-motion`, with its colour and
    timing as tokens in `src/styles/tokens.css`. It starts after a short delay (an
    `animation-delay`, a token), so a Standalone write, answered in milliseconds, never flickers.
    *Why:* reading the cue off the node keeps one source. A separate selector would have to agree
    with the applier about which writes the board already reflects.

11. **Epoch change and reconnect.** An epoch change reloads (Task 9298). Revisions are compared only
    within one epoch, so after a server restart a write is retired by the read-order rule alone (a
    board read after its answer), which holds across a restart because a committed write survives
    it. Queued writes carry on to the restarted server. A reconnect after the server was unreachable
    finds an empty lane, since decision 7 flushed it, and reloads.

12. **The local rules are only the pinned ones.** The v1 actions need these rules, and these are
    the corpora:

    | Action | Rule it needs locally | Pinned by |
    | --- | --- | --- |
    | Wait release | Pending ↔ Released, decided in `useExpectationActions` today | nothing needed: no rule |
    | Goal toggle (the status step on a Goal) | Active ↔ Achieved, decided in `useStatusCycle` today | nothing needed: no rule |
    | Status step on a Task | `next_status`, the Compound refusal (`status_after`) | **none** (`task-status.json` pins only the model conversion) |
    | Started (`Alt+Enter`) | `alt_step` and its Agentic refusal | **none** |
    | Commitment verdict | `verdict_after` | **none** |
    | Rename | none | - |
    | Editor save | the form's own values. When the Agentic flag changes, the status it leaves | `task-status.json` (`convertedStatus`, which the editor already shows) |
    | Create child or sibling | may this kind hold that one | `parenting.json` (`isValidDropTarget`) |

    The other corpora (`preset-filters`, `list-sections`, `zen-contents`, `habit-fold`) are the
    per-render rules that read the patched tree. `scope-keys` already formats the Time Scope an
    editor patch shows. `plan-triage`, `flow-cycles`, `cooldown` and `client-mode` are not touched.
    **The three status-family gestures have no pinned copy.** `tasks::rules::gestures` decides them
    in Rust alone (ADR 0010 decision 6). How they patch is open question 1.

## Considered options

- **The lane inside `useMindmapData`.** It is closer to the state it patches, with no store.
  Rejected: it is one lane per tab instance, and the writes are made in other hooks.
- **Patch the loaded rows, then rebuild the tree.** Every derived value would follow the patch at
  once. Rejected: that computes derived values locally from unpinned rules, which the user ruled
  out, and a refused write would have shown wrong rollups as well as a wrong status.
- **One lane per node.** Writes on different nodes would go in parallel. Rejected: the server
  serialises them anyway, and temporary ids would need a cross-lane dependency graph (decision 4).
- **Drop a patch on its answer.** Simpler, with no read counter. Rejected: it shows the old value
  between the answer and the next board, and forever if the reload is skipped (decision 5).
- **A server-side client id for creates** (the app mints the node's id). It removes the rewriting.
  Rejected by the user: no server change.

## Consequences

- **The board can show an own field the server has not written yet**, but never a derived value
  that it did not compute. The model map's *A truthful board* says so.
- **Every write outside the lane is ordered behind it.** A move can wait one round trip longer than
  before, and only while the lane is busy.
- **Editor refusals change place.** A refused save used to keep the editor open with the reason on
  its error line. With the editor already closed, it becomes a toast and a rollback (open question
  2).
- **The answer, not the reload, ends the cue.** The derived values follow one reload later, as
  before.
- **The write's own response is used.** Settling a patch from the returned row means a prediction
  that differs from the server's is corrected before the reload, not after.

## Delivery

Four pull requests, stacked, each green on its own, landed bottom-up. Each one's scope, files and
acceptance criteria are below, written to be pasted into a brief. All four follow `AGENTS.md` and
`.claude/rules/`: Zustand for the store, a pure module for the logic, hooks in `src/hooks/`, `@/`
imports, no `any` and no `as`, every new string through i18n (the `translating-ui` skill), one
changelog fragment per pull request that changes behaviour, and no snapshot tests.

### PR 1: the lane, the reconcile and the cue (no action uses it yet)

- **Scope.** The pure reducer and applier, the store and its sender, the board integration in
  `useMindmapData`, the barrier, the refusal handling, the undo integration, the read-only and
  unreachable paths, and the cue in all four views. No action is moved onto it. Its consumers in
  the tests are fakes.
- **Files.** New: `src/utils/pending-writes.ts` (types and reducer) and its test;
  `src/utils/apply-pending-writes.ts` and its test; `src/stores/use-pending-writes-store.ts`
  (state, `enqueue`, the sender, `whenDrained`, `cancelTail`, `reportBoard`, the alias map) and its
  test; `src/hooks/use-pending-write.ts` (the hook actions use to enqueue, with the toast wiring)
  and its test. Changed: `use-mindmap-data.ts` (keeps the loaded tree and its stamp, returns the
  patched tree, `latestTree` patched, reloads on an unreflected answer, coalesced, and reports its
  stamp); `use-undo.ts` (cancel the queued tail; wait; spend a press on a refused write); the
  write-then-reload paths (`use-node-actions.ts`, `use-plan-move.ts`, `use-hand-archive.ts`,
  `use-list-delete.ts`, `multi-node-gestures.ts`'s callers, paste) await `whenDrained()`; the node,
  row and card components and their CSS Modules (`data-pending`); `src/styles/tokens.css` (cue
  colour, pulse duration, delay); `MindmapNode` gains `pending?: true`; `docs/spec/client-mode.md`
  if the build differs from the spec.
- **Acceptance.**
  - `applyPendingWrites`: a fields patch changes only its node and only own fields, and the copy is
    structurally shared; patches apply in `seq` order; an answered write is dropped by
    `read > afterRead` or by same-epoch revision, and kept otherwise; `answer.fields` replaces the
    predicted fields; a patch for a missing node is skipped; `pending` is set only while unanswered.
  - The reducer: one write in flight; refusal removes that write and every later one on the same
    node, and leaves others; the queued tail can be cancelled, a sending one cannot; flush empties
    the lane.
  - The store: writes are sent strictly in order; one toast per refusal; a confirmation refusal
    calls its handler and shows no toast; unreachable flushes with one toast; `whenDrained`
    resolves when the lane empties; a write is forgotten once every reported board reflects it.
  - `useMindmapData`: a fresh board re-applies the unanswered patches; an answered write triggers
    one reload (coalesced) unless the board already reflects it; an older read returning late is
    discarded.
  - Undo: a queued tail is cancelled with no call to `undo`; with a write in flight, `undo` is
    called only after it answers; after a refused write, the press calls nothing.
  - An integration test per view: a node with a pending write carries `data-pending`, and loses it
    on the answer.
  - `npx tsc --noEmit`, the touched tests, and lint pass.

### PR 2: the status family

- **Waits on open question 1.** The scope below assumes answer (a). Under (b) or (c) the brief
  shrinks to what the answer allows.
- **Scope.** The status step (click, `Enter`) on Tasks and Goals, `Alt+Enter`, the verdict
  (Kept, Broken, the cycle key) and the wait release go through the lane. A Compound Task's step and
  `Alt+Enter` on Agentic work that is not Doing are refused locally, with today's toasts and no
  write. The occurrence guard uses the confirmation path. The Backlog-cleared toast is read off the
  answer, as now.
- **Files.** `src/hooks/use-status-cycle.ts`, `use-commitment-verdict.ts`,
  `use-expectation-actions.ts`, `use-occurrence-completion.ts` and their tests; under answer (a),
  a new pinned copy `src/utils/task-gestures.ts`, the corpus `conformance/task-gestures.json`, its
  replay `src/utils/task-gestures-conformance.test.ts` and
  `src-tauri/tests/operations/task_gestures_conformance.rs`; the model map's *conformance pair*
  card; `docs/adr/0010-business-rules-layer.md` decision 6's note.
- **Acceptance.**
  - A press shows the new status (or verdict, or release) before the write resolves, with the cue;
    two quick presses show two steps and send two writes in order.
  - A refused step rolls back that press and every later one on the node, with one toast; a press
    on another node in between survives.
  - A Compound Task's press writes nothing and shows the existing toast.
  - Completing an occurrence over open children rolls back, opens the prompt, and on Confirm shows
    Done again and sends `confirmed`.
  - The status shown after the answer is the returned row's, even where the prediction differed.
  - Under answer (a), the corpus is replayed green on both sides.

### PR 3: rename and editor saves

- **Waits on open questions 2 and 4.**
- **Scope.** The inline rename, and the Save of the Task, Goal, Commitment, wait, Project, simple
  (Domain and Tag) and Info editors. The editor closes as soon as its own prompts (the Plan clamp)
  are answered. The patch is the form's own fields (decision 2). The reads that build the request
  (the containment conflicts that become clamp steps) run in the write's closure at send time. A
  changed Agentic flag patches the status through `convertedStatus`. A Task that stays Compound gets
  no status patch. The Flow and flow-item editors stay write-then-reload, pending question 4.
- **Files.** `src/components/MindmapView/use-node-editor.ts`, the `renameNode` path in
  `use-mindmap-data.ts` and its callers (`use-node-actions.ts`, `use-list-data.ts`), the editor
  modals' close-on-save, and tests.
- **Acceptance.**
  - A rename shows at once with the cue and settles on the answer; a refused rename restores the
    old title with one toast.
  - Save closes the editor before the write resolves; the node shows the saved own fields at once;
    derived fields (inherited Plan, Overdue, Blocked) change only after the reload.
  - A refused save rolls back every field it patched, with the behaviour question 2 decides.
  - A save queued behind a pending status step on the same node is sent after it.

### PR 4: create with temporary ids

- **Scope.** Creating a child (`Tab`) or a sibling (`Enter`), in every view that offers it, as a
  `create` patch with a `tmp:<n>` id, for every kind whose create is one write with no prompt
  (`createNode`'s single-call branches; anything else stays write-then-reload). The
  `isValidDropTarget` check refuses a kind locally. The resolver in each write's closure, the alias
  map in `findNode` and `rowIdOf`, and the rewrite of id-keyed UI state on the answer. A
  refused create removes the placeholder and cancels every write on it or under it, with one
  toast. A cancelled (undone) queued create does the same with no toast.
- **Files.** `use-mindmap-data.ts` (`createNode`), `use-create-editors.ts`, `use-list-create.ts`,
  `src/utils/node-identity.ts` (alias-aware lookups), the tab stores holding selection, editing and
  collapse (`src/stores/tab-stores.ts` and its users), and tests.
- **Acceptance.**
  - `Tab` then typing a title then `Tab` again shows two nested placeholders at once, and sends
    the create, the rename and the child create in order, each naming the real ids.
  - After the answers, the selection and the inline editor are on the real node, with no flicker
    and no duplicate node.
  - A refused parent create removes both placeholders and sends nothing more, with one toast.
  - `Ctrl+Z` on a still-queued create removes the placeholder and calls nothing.
  - A kind the parent may not hold is refused before any patch.

## Open questions

1. **The status-family gestures have no pinned copy.** `task-status.json` pins only the conversion
   between the two status models, not the step. `next_status`, `alt_step`, the Compound refusal and
   `verdict_after` exist in Rust alone (ADR 0010 decision 6), so under *no new rule copies* the
   status step, `Alt+Enter` and the verdict cannot predict what they write. The options:
   (a) pin them: a new corpus `conformance/task-gestures.json` and a TypeScript copy, which is the
   "pinned optimistic copy" ADR 0010's answer 2 left room for; (b) the cue only: those three show
   the pulse at once and the new value on the answer, and only the wait release and the Goal toggle,
   which need no rule, patch a value; (c) leave the three write-then-reload. The recommendation is
   (a).
2. **A refused editor save, once the editor has closed.** Either a toast and a rollback only, which
   loses what the user typed; or the same, plus the editor reopening with the user's input and the
   backend's reason on its error line, as before. The recommendation is to reopen.
3. **Task 9298's post-write skip.** As written ("skip a post-write reload when the write's revision
   is the board's revision + 1"), it would leave a write's derived values (rollups, Blocked) stale
   even without this feature, unless the write response carries them. This design opts its own
   writes out and reloads unless the board already reflects the answer. Should 9298's rule be read
   that way for every write?
4. **The Flow and flow-item editors.** Their saves reshape the occurrences a Habit derives, so they
   have few own fields worth showing early. The recommendation is to keep them write-then-reload in
   v1.
