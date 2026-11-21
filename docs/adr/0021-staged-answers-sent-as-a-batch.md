# ADR 0021: staged answers, sent as one batch

Status: accepted 2026-11-21 (Task `de16`). The behaviour was ruled by the user on 2026-11-20 and is
not reopened here (*Ruled*, below). This ADR settles how it is built. The four points the rulings
left open were answered by the user on 2026-11-21 (*Open questions*, below, now *Decided*) and are
built in slices 8 to 10.

## Context

Today the user answers an agent's question, or gives a review its verdict, one wait at a time. Each
**Send** releases its wait in its own write, and the `arlesh` plugin wakes the agent once for each
wait that changed (ADR 0013, `plugins/arlesh/hooks/register.tsx`'s `flush`). When the user works
through several questions, the agents start acting on the first answer while the user is still
writing the others. An agent that raised three waits is woken three times.

**Ruled (the user, 2026-11-20 and 2026-11-21; not reopened here).**

- The answer field has two buttons, **Stage** and **Send**. Stage toggles. `Ctrl+Enter` stages;
  `Ctrl+Enter` again in a staged field sends.
- **Send** sends every staged answer on the board, the current one included. Send is the field's
  button, the second `Ctrl+Enter`, or a Send option in the agent status's click menu in the top bar.
- Question answers and review verdicts (a verdict with its note) can be staged.
- Staging is stored on the server and syncs across devices. On a draft, the last save wins.
- A staged wait still reads Review, and is marked staged. The agent sees nothing until the batch is
  sent: not through the MCP, and not through the events stream.
- Each agent is woken once for the whole batch.
- If a draft has gone stale by the time it is sent (its wait was already released, or is gone), the
  rest are sent and a toast names the one skipped.
- Sending is undoable. One `Ctrl+Z` undoes the whole sent batch, and its answers go back to staged.
- Surfaces: the desktop app, the phone app, the server, and the `plugins/arlesh` plugin.

## Decisions

### 1. A draft is a row of its own table, keyed by the wait's id (migration 0110)

```sql
-- crates/arlesh-core/migrations/0110_answer_drafts.sql
CREATE TABLE answer_drafts (
    wait_id  TEXT PRIMARY KEY NOT NULL,      -- the wait's NodeId: a stored UUID or a derived (v8) one
    answer   TEXT,                           -- a question's answer; a review's note (optional there)
    verdict  TEXT CHECK (verdict IS NULL OR verdict IN ('approved', 'changes_requested')),
    saved_at TEXT NOT NULL,                  -- when the last save landed (UTC, ISO 8601)
    CHECK (answer IS NOT NULL OR verdict IS NOT NULL)
);
-- then the three undo_journal triggers for answer_drafts (insert, update, delete), exactly as
-- scripts/generate-undo-triggers.sh prints them for this table.
```

- **A row means "staged".** There is no `staged` flag. Stage writes the row, unstage deletes it, and
  Send deletes the rows it sent.
- **A question's draft** has `answer` (not blank, trimmed) and no `verdict`. **A review's draft**
  has `verdict`, and `answer` holds the user's note or is NULL. The same field names are used as on
  `expectations` (`agentic_answer`, `agentic_verdict`) and in `UpdateExpectationRequest`.
- **It is a rowid table** (not `WITHOUT ROWID`), because the undo journal keys rows by rowid.
- **It is journaled** (decision 6) and is not on `undo::EXCLUDED_TABLES`. The schema test that
  checks every journaled table has its three triggers covers it once the triggers exist.
- **There is no foreign key and no cascade trigger.** An agentic wait can be a derived row (a
  spawned wait, a delegation wait or an occurrence's wait, with its agentic fields in
  `expectation_overlays`), so `wait_id` cannot reference `expectations`. A draft whose wait has gone
  is dropped when the next batch is sent (decision 3). Ids are UUIDs and are never reused, so a
  draft left behind cannot attach to a different wait.

*Why a table rather than columns on `expectations`.* The MCP reads `expectations` through the shared
`Expectation` model and serialises it whole in the snapshot, `get`, `get_many` and `list`. Draft
columns there would need an exclusion in every agent path, and the wait stream's diff would have to
learn to ignore them. A separate table that the agent paths never load keeps the drafts away from
agents by construction. It also covers derived waits, which have no `expectations` row.

### 2. The drafts reach devices as a collection of the app's board, never through the MCP's board

- **Model.** `AnswerDraft { wait_id: NodeId, answer: Option<String>, verdict:
  Option<ReviewVerdict>, saved_at: NaiveDateTime }` is a domain type with no `sqlx` derive. Its row
  struct lives in persistence and converts with `From` (ADR 0010, decision 8).
- **The app's board carries them.** `MindmapLoad` gains `answer_drafts: Vec<AnswerDraft>`. Only
  `mindmap::board` fills it, as it fills `agent_activity`. `load_blocked` and `BoardSources` never
  do. The MCP's `Board::read`, the snapshot and the wait stream's `read_waits` all go through
  `load_blocked`, so they see no drafts.
- **Sync** is ADR 0020's: `Collection::AnswerDrafts` (`"answer_drafts"`), one entry per draft keyed
  `draft-<wait id>`, diffed and hashed like every other collection, in Rust (`mindmap/rules/
  changes.rs`) and in TypeScript (`src/utils/board-changes.ts`). The corpus
  `conformance/board-changes.json` gains cases for it. A draft saved on the phone reaches the
  desktop as a changed-nodes event, as any write does. "Last save wins" is an upsert with no
  compare-and-set.
- **Derived from the drafts** in `mindmap/rules/facts.rs`, which receives them with the load:
  - a wait is **staged** when it has a draft and is an open question or review
    (`tasks::rules::review::is_open_question`: agentic, question, pending, live). A draft on any
    other wait is **stale** and marks nothing;
  - `NodeFacts.staged_questions: Vec<NodeId>`: the Task's `open_questions` that are staged. The
    Task's own mark is read from it (decision 7; the Task is marked only when all its open questions
    and reviews are staged);
  - `AgentActivity.staged: usize`: how many staged waits the whole board holds. The top bar's send
    button reads it.
- **Review is unchanged.** A staged wait is still pending, so its Task still reads Review, and the
  presets, Start and Do treat it exactly as before.
- **Who else can read drafts.** A device token can read them, through `GET /board`, `/board/current`
  and `arlesh-server`'s `/events/changes`. The ruling names the MCP and the events stream as the
  agent's surfaces: the MCP, and the wait poll `/events/expectations` that the plugin follows. The
  device stream and `/board` are a device's data, as the database file is. The plugin opens neither,
  and neither the MCP instructions nor the plugin points an agent at them.

### 3. Three server operations, each one transaction and one Gesture

| Operation | Core (`arlesh_core::tasks::answer_drafts`) | Backend method | Route (`arlesh-server`) | Tauri command |
| --- | --- | --- | --- | --- |
| Save a draft | `save_draft(db, &wait_id, DraftRequest{answer?, verdict?}, now)` | `save_answer_draft` | `PUT /waits/{id}/draft` | `save_answer_draft` |
| Clear a draft | `clear_draft(db, &wait_id)` | `clear_answer_draft` | `DELETE /waits/{id}/draft` | `clear_answer_draft` |
| Send the batch | `send_drafts(db, SendRequest{shown}, now)` | `send_answer_drafts` | `POST /drafts/send` | `send_answer_drafts` |

**Save** checks the wait and the content with the pure rule `tasks::rules::answer_drafts::check`
(below), then upserts the row with `saved_at = now`. It answers the stored `AnswerDraft`. The
wait is looked up in the Expectation virtual table, the same lookup that
`nodes::write::update_expectation` uses, so derived waits work too. It is refused (`invalid_request`,
writing nothing) when:

- the wait is not an open question or review;
- a question has a blank answer;
- a question has a `verdict`;
- a review has no `verdict`.

These are the release path's own rules (`ExpectationWrite::require_release_answer`), applied early,
so a draft that saved can be sent.

**Clear** deletes the row, and is idempotent: clearing a wait that has no draft passes and writes
nothing.

**Send** runs in one transaction, as the calling client's write, source `user`:

1. Read every row of `answer_drafts`. This is "every staged answer on the board": drafts saved on
   any device are sent, not only the ones the caller knew of.
2. For each draft, resolve its wait (`check_sendable`, pure):
   - **sendable** (an open question or review): release it through
     `nodes::write::update_expectation` with `status: released` and the draft's `answer` and
     `verdict`. This is the same write a single Send makes today, so every rule and every derived
     consequence (Review clears, `released_at` is set) is the existing one;
   - **stale, `released`**: the wait is already released;
   - **stale, `gone`**: the wait no longer exists, is archived, or is no longer an agentic question.
3. Delete every draft it read, the sent ones and the stale ones.
4. For each id in `shown` (the waits the caller's screen showed as staged when Send was pressed)
   that had no draft in step 1, report it as skipped: `released`, `gone`, or `unstaged` (the wait is
   still open, but its draft was cleared on another device).
5. Answer `{ sent: [{wait_id, task_id}], skipped: [{wait_id, task_id?, title?, reason}] }`.

The client toasts `skipped` (decision 7). A release refused for any other reason refuses the whole
send, writes nothing, and names the wait.

*Why `shown`.* Without it the server cannot tell the caller about a wait that another device
answered or unstaged after this screen drew it. The ruling asks for a toast naming each one
skipped, and a bulk operation that skips items never does so silently.

*Why the field's Send is two calls when its text is not staged.* The field's **Send** on text that
is not staged yet first **saves** it (one Gesture), then **sends** (a second Gesture). If staging
and sending were one Gesture, undoing it would take the newly staged draft back out as well, and the
current answer would not return to staged as the ruling asks. As two Gestures, the first `Ctrl+Z`
undoes the send and every answer, the current one included, is staged again; a second `Ctrl+Z`
unstages the current one. If the save lands and the send fails, the answer is left staged, which
is visible and can be sent again.

**In Client mode** each operation is one request, and so one Gesture of the calling client
(client-mode.md, *Undo*). It needs no `/gestures` route of its own. **In Standalone** each is one
Tauri command, inside the per-command Gesture `src/api/gesture.ts` opens. The parity contract
`conformance/client-mode.json` maps the three methods to their routes.

All three writes are write-then-settle (ADR 0012): the screen changes when the write's changed
nodes arrive. A draft is not a node's own field, so the pending-writes lane does not patch it.
Like any other write outside the lane, Send waits for the lane to empty.

### 4. One wake-up per agent: the server sends the batch as one change, and the plugin coalesces

**Server side: nothing new on the wire.** Send releases every wait in one transaction. The wait log
(`mcp/events/log.rs`) diffs whole readings of the waits, and a reading sees a committed transaction
whole, so every `released` change of the batch is stamped with the **same revision** and arrives in
**one** long-poll answer. The `catchUp` path (`get_many` after a `reset`) sees the batch whole for
the same reason. Saving or clearing a draft changes no wait state, so `/events/expectations`
reports nothing for it: the agent sees nothing until the send.

The change shape (`{change, wait_id, short_id, task_id, task_short_id, status, archived, question,
deleted, revision, epoch}`) gains no field. *Why no `batch` id:* the plugin groups what it owes at
the moment it delivers (below). Grouping by batch would add nothing, and an unchanged shape keeps
every client compatible both ways.

**Plugin side: a flush delivers one message per recipient.** Today `flush` takes the first owed
change and delivers it, then the next. Instead:

1. Take the **head** owed change of **every** entry in the book (`owedHeads(book)`, in `book.ts`).
2. Route each entry with `routeTo(entry.via, agents)`, as today, and group the entries by
   recipient: the session, or one running agent.
3. Deliver **one message per group**. A group with one entry gets today's text, word for word
   (`notificationText`). A group with several gets `batchNotificationText` (`rules.ts`):

   > Arlesh notification: 3 waits changed: wait 1ab on Task de1 (released), wait 2cd on Task de1
   > (released), wait 9f0 on Task 77a (released); read them with `arlesh_waits.get_many`.

   When the message goes to anyone other than the sub-agent that raised a wait, that wait's item
   names the sub-agent (`— raised by the sub-agent "…"`), the per-item form of `namesRaiser`.
4. If a sub-agent does not take its group's message (`isDelivered: false`), its entries join the
   session's group in the same flush, each one naming the sub-agent, as today's fallback does.
5. **Settle per entry.** A delivered group settles the head change of each entry in it. A failed
   group counts one failed attempt on each of its entries (`failedOnce`), and the flush stops, as
   today. `MAX_ATTEMPTS`, the debug log and the give-up line stay per entry.

Everything else in the delivery stays as it is: nothing is submitted while a turn runs, the flush
waits for `turn.complete`, there is one flush at a time, and a change is owed until its prompt
enters. A batch is therefore one wake-up per agent even when it arrives during a turn: it waits,
owed, and goes out as one message when the turn completes. An entry that owes two changes
(released, then reopened) sends them in two successive flushes, because they are two events.

**Compatibility.** An older plugin, which does not know batches, gets the same changes and sends one
prompt per wait, as it does today. A newer plugin against an older server never sees a batch and
groups only what arrives together. The plugin's one-wait text is unchanged, so an agent that only
knows the old form still reads every message that has one wait in it.

### 5. What the agent sees

| Moment | `arlesh_waits.get` / snapshot | `/events/expectations` | Plugin |
| --- | --- | --- | --- |
| Stage, edit or unstage a draft | `pending`, `answer: null`, no `verdict` | no change | nothing |
| Send | `released`, with the answer, or the verdict and the note | one `released` per wait, at one revision | one message per agent |
| `Ctrl+Z` on the send | `pending` again, `answer: null` | one `reopened` per wait, at one revision | one message per agent |
| `Ctrl+Shift+Z` (redo) | `released` again | one `released` per wait | one message per agent |

The `reopened` notification is today's. An agent that already acted on an answer and then hears
"reopened" stops the work that depended on it (AGENTS.md, *Waiting for the user's answer*). The
coalescing above makes that one message per agent for the whole batch, too.

### 6. Undo: the send is one Gesture, and its inverse is the row images

The send's journal entries are the `expectations` (or overlay and spawned-wait) updates that
released each wait, and the `answer_drafts` deletes. **Undo** replays them in reverse, in one
transaction:

- each draft is re-inserted from its before image, at its original rowid, so the answers are staged
  again;
- each wait's before image (pending, no answer, no verdict, no `released_at`) is written back, so
  the waits read Review again, and staged.

Nothing new is needed in the undo engine. **Redo** re-applies the after images: the waits are
released and the drafts deleted. Saving and clearing a draft are Gestures too, because every
command is (`src/api/gesture.ts`). So `Ctrl+Z` after Stage unstages, and `Ctrl+Z` after an
unstage stages again.

- **Undo is per device** (client-mode.md, *Undo*): the device that sent the batch undoes it, even
  when some of the drafts were staged on another device. The rows come back whichever device wrote
  them.
- **Stale drafts come back too.** The send deleted them, so the undo restores them. They still mark
  nothing, and the next send skips them and toasts them again, which is true.
- **The name** is the frontend's: `withGesture("send N answers", …)`, so the toast reads "Undid:
  send 3 answers". From another window it falls back to row counts (undo.md).
- **Push** (ADR 0014) is not changed. Undoing a send makes `question:<wait>` facts hold again, so
  the phone may be told again, exactly as it is after undoing a single answer today.

### 7. The UI: the shared answer controls, on every view, both bars

The answer controls are shared by the Zen card, the List row and the Task editor, and the phone
runs the same React components. So the change is made once:

- `src/components/AnswerField/AnswerField.tsx`: a question's field.
- `src/components/AnswerField/ReviewAnswer.tsx`: a review's controls. The verdict buttons only
  **select** a verdict; the same **Stage** and **Send** as a question follow (decided, question 2).
- `src/components/AnswerField/OpenWaits.tsx`: the list of a Task's open waits. It passes each wait
  its draft and the board-wide staged count.
- `src/components/TopBar/AgentStatus.tsx`: the top bar's agent status. The Send menu line and the staged icon
  sit here. The desktop top bar (`TopBar.tsx`) and the phone's (`PhoneTopBar.tsx`)
  both render `AgentStatus`, so both get the button.
- The Task's staged mark is drawn where its answer controls are, which every view that draws Review
  uses: `OpenWaits` heads its list with it (the List row, the Zen card and the Task editor's agentic
  section), and the Mindmap node's hover says it. It shows only when **every** open question and
  review of the Task is staged (decided, question 3); each wait carries its own Staged mark either way.

**The question's field.** Its states:

| State | Field | Stage | Send |
| --- | --- | --- | --- |
| Not staged, empty | editable | disabled | enabled only if something else on the board is staged |
| Not staged, with text | editable | enabled | enabled: stages this answer (one call), then sends the batch (a second call) |
| Staged | shows the draft's text, **locked** (read only), with a **Staged** mark on the field and its title (decided, question 1) | pressed (`aria-pressed="true"`); a press unstages and keeps the text in the field, to edit and stage again | enabled: sends the batch |
| Sending | as it was | disabled | disabled |

- **Moving between answer fields** (ruled 2026-11-21, after the first trial): `Alt+Down` / `Alt+Up` in
  an answer field (a question's, or a review's note, or its controls) move focus to the next /
  previous answer field in the order shown, question and review alike; `Tab` keeps its meaning; at the
  last or first field they do nothing (no wrap). `Escape` in a field **leaves it**, back to the view,
  so the view's keys and `Ctrl+Z` work again; it unstages, clears and sends nothing. In the Task editor
  the first `Escape` moves focus to the editor (which takes focus for it) and the second closes it, as
  `Escape` did before. These take precedence inside a field over any binding on the chord (the
  Mindmap's `Alt+Down` / `Alt+Up` reorder is the only one on the tables, and no answer field is on
  its canvas). **The jump into a field:** `Q` (provisional; the user has not named a key) in the List
  and Zen Views selects the Task of the next answer waiting for you, an open question or review that is
  not staged, and focuses its field; again, it goes on to the next, wrapping at the end; with none it
  shows a toast. It looks among the answer fields the view draws. The keys are in `answer-focus.ts`,
  `list/waiting.ts` (a registry binding, so the cheat-sheet and the palette list it) and the cheat-sheet's
  "Answer fields" tab.
- **Keyboard.** In a field that is not staged, `Ctrl+Enter` stages when there is text and does
  nothing when it is empty. In a staged field, `Ctrl+Enter` sends. The chord is the field's own and
  is stopped there, as today.
- **After a send lands** the sent waits are released and leave `OpenWaits`, so the field unmounts.
  Focus must go back to the view: otherwise the next `Ctrl+Z` lands in a text field, where the
  browser's own undo answers it, not the board's (undo.md, *What the user sees*). In the Task
  editor, which holds the keyboard, `Ctrl+Z` reaches the board only once the editor is closed, as
  for a single answer today.
- **A draft from another device** shows in the field as soon as its changed nodes arrive. The text
  shown while staged is always the board's draft, because the last save wins.
- **Phone.** The same buttons, at the touch layout's target sizes (touch.md). There is no chord.
  Undo is the action bar's Undo button.

**The top bar's send entry** is a line of the agent status's click menu (`AgentStatus`), present only
while something is staged: "N staged answers, not sent yet" with a **Send** action. Choosing it sends
the batch, with `shown` set to the waits the board shows as staged. While anything is staged the agent
status also draws a **staged icon** in the row of its status icons (the head is drawn for it too), and
the count is in its tooltip, as for the other icons. There is no standalone button (the user replaced
the button of the first ruling, 2026-11-21). The status follows the "Show agent status in the top bar"
setting, so with it off there is no icon and no menu; the field's Send and the command palette are the
ways to send. Sending the batch also has a **command-palette entry**, and no hotkey beyond `Ctrl+Enter`
in the field (decided, question 4). The palette is the touch sheet, so on the desktop the menu line is
the board-wide entry.

**Toasts.** A send that skipped anything raises one anchored toast, at the first skipped wait's
Task, naming each skipped wait by title and reason ("already answered", "gone", "unstaged on
another device"). A send that was refused raises the usual refusal toast, and nothing changes. A
send with nothing skipped raises no toast: the waits visibly leave Review.

**Strings** go through i18next (`expectation` and `common` namespaces), per the `translating-ui`
skill.

### 8. The model map: "Staged" is a new derived state, and the draft a new stored concept

The implementer adds, in the same PR as the code:

- **`docs/model-map.md`**:
  - a row in *The derivation graph* table: **Staged** | Reads: answer draft, Review's open
    questions (agentic, question, pending, live) | Rule: a wait with a draft that is an open
    question or review; a Task's staged waits are its open questions with a draft; a draft on any
    other wait is stale and marks nothing | Code: `rs:tasks/rules/answer_drafts.rs`,
    `rs:mindmap/rules/facts.rs` (`staged_questions`, `AgentActivity.staged`);
  - in *2. What's derived* › *Review*, a bullet: an answer can be **staged** (an Answer draft) and
    sent with the others as one batch; the wait still reads Review; agents never see a draft;
  - in *8. Keeping it honest* › *The undo journal*: `answer_drafts` is journaled, and one `Ctrl+Z`
    undoes a sent batch.
- **`src/data/model-map.ts`**: the matching card text for *Review*, plus a concept card **Answer
  draft** (Is / Why / Without / Lives / Spec, in the existing shape). Why: so an answer can wait
  for the others, and every agent wakes once. Without: each answer goes out as it is written, and
  agents act on half a set of answers.
- **`src/data/derivation-graph.ts`**: a node **Staged**, with edges from *Answer draft* and *Review*
  to it.

## Alternatives considered

- **Draft columns on `expectations`**: rejected (decision 1). They would need an exclusion in every
  agent path, and derived waits would need them in `expectation_overlays` too.
- **A `staged` flag that keeps the draft row after the send, marked sent**: rejected. Undo would
  have to tell a sent draft from a staged one, and the deleted row's before image already holds
  exactly what has to come back.
- **A `batch` id on each change, so the plugin groups by batch**: not needed (decision 4). Grouping
  what is owed at delivery time covers it, and also folds in changes that arrive together for other
  reasons.
- **The field's Send as one Gesture that both stages and sends**: rejected (decision 3), because
  undoing it would not stage the current answer again.

## Delivery

One Sonnet implementer, on branch `109-plugin-rename` (PR #216), in this order. Each slice commits
and pushes on its own. Locally, run only the targeted tests named (`CARGO_INCREMENTAL=0`, `-j 3`);
CI is the gate.

1. **Migration and the rule.** `crates/arlesh-core/migrations/0110_answer_drafts.sql` (the table,
   plus the triggers from `scripts/generate-undo-triggers.sh`). `crates/arlesh-core/src/tasks/
   rules/answer_drafts.rs` (+ `answer_drafts/tests.rs`): `check` (save) and `check_sendable` (send),
   pure, over `&Expectation` and the request. Declared in `tasks/rules.rs`. *Tests:*
   `cargo test -p arlesh-core answer_drafts`, and the undo trigger schema test
   (`every_journaled_table_has_its_three_triggers`, where it lives).
2. **Core operations.** `crates/arlesh-core/src/tasks/answer_drafts.rs` (+ `answer_drafts/
   tests.rs`): the model, the row and `From`, and `save_draft`, `clear_draft` and `send_drafts` as
   decision 3 describes. Exported from `tasks/mod.rs`. *Tests:* save and clear on a question, a
   review and a derived wait; each refusal; send with sendable, released, gone and unstaged drafts,
   checking the answer's `sent` and `skipped`; the whole send rolls back when one release is
   refused.
3. **The board.** `MindmapLoad.answer_drafts` (`mindmap/model.rs`), filled in `mindmap::board`;
   `NodeFacts.staged_questions` and `AgentActivity.staged` in `mindmap/rules/facts.rs`;
   `Collection::AnswerDrafts` in `mindmap/rules/changes.rs`; cases in
   `conformance/board-changes.json`. *Tests:* `cargo test -p arlesh-core facts`, `… changes`.
4. **Agents see nothing; one revision per batch.** In `crates/arlesh-core/src/mcp/events/
   routes_tests.rs` and `mcp/` tests: a saved draft leaves `get`, `get_many`, `list` and the snapshot
   unchanged and makes no `/events/expectations` change; a send of three drafts answers one poll
   with three `released` changes at one revision; undoing it answers one poll with three
   `reopened`. Tests only, unless a test finds a leak. *Tests:* `cargo test -p arlesh-core
   mcp::events`.
5. **Backend port and both hosts.** `crates/arlesh-backend/src/expectations.rs` (trait),
   `sqlite/expectations.rs`, `http/expectations.rs`; `src-tauri/src/commands/expectations.rs` and
   its registration in `src-tauri/src/lib.rs`; `conformance/client-mode.json`; `crates/arlesh-py/
   src/request.rs`, `backend_calls.rs`, `python/arlesh/models.py`, `_native.pyi` if it lists
   requests, and the FastAPI router `server/entrypoints/fastapi/routers/waits.py`, plus a router for
   `POST /drafts/send`. *Tests:* `cargo test -p arlesh-backend` (targeted to the parity test),
   `src-tauri/tests/tasks/expectations.rs` (one case per command), and one undo case in
   `src-tauri/tests/undo_engine.rs` (send, undo: drafts back and waits pending; redo);
   `crates/arlesh-py/tests/server/integration/test_server_waits_infos_domains.py` (the three routes)
   and `test_server_undo.py` (undo of a send).
6. **The plugin.** `plugins/arlesh/hooks/book.ts` (`owedHeads`), `rules.ts`
   (`batchNotificationText`, per-item naming), `register.tsx` (`flush` and `deliver` per group,
   `settle` per entry). *Tests:* `delivery.test.ts` (three owed waits for the session: one submit;
   waits of two running sub-agents: one `session.send` each; a sub-agent that refuses: its entries
   go to the session in the same flush; a failed group counts an attempt on each entry; mid-turn:
   nothing until `turn.complete`, then one message), and `logic.test.ts` (the texts). Run with
   `claude plugin test plugins/arlesh` (vitest excludes `plugins/**`).
   Also update `AGENTS.md` (*Waiting for the user's answer*): a notification may name several waits.
7. **Frontend data.** `src/api/answer-drafts.ts` (`saveAnswerDraft`, `clearAnswerDraft`,
   `sendAnswerDrafts`); the board types in `src/api/mindmap.ts`; `src/utils/board-changes.ts`
   (apply and hash the collection); the draft attached to the wait node's `agentWaiting`
   (`src/utils/tree-layout.ts`) and the staged waits to the Task (`openQuestionIds`'
   neighbour); `src/hooks/use-answer-drafts.ts` (stage, unstage, send with `withGesture` names and
   the skipped toast); `src/utils/agent-activity.ts` (`staged`). *Tests:* `npx vitest run
   src/utils/board-changes src/hooks/use-answer-drafts src/utils/agent-activity`.
8. **The question's field and the top bar.** `AnswerField.tsx` and its CSS module, `OpenWaits.tsx`,
   `AgentStatus.tsx` and its CSS module, the palette entry, and i18n strings.
   *Tests:* `AnswerField.test.tsx` (the state table and the chord), `AgentStatus.test.tsx` (the
   staged icon and the menu's Send line show only while something is staged, and it sends the shown ids).
9. **The review's controls and the Task's mark.** `ReviewAnswer.tsx` (+ test), and the mark in
   `OpenWaits.tsx` (which the List row, the Zen card and the Task editor share) and the Mindmap hover.
10. **Docs and changelog.** The model map (decision 8), and one `changelog.d/added/<NNNN>-staged-
    answers.md` fragment.

## Open questions: decided by the user, 2026-11-21

1. **Can a staged answer be edited?** **No: it is locked.** Stage toggles: pressing it again
   unstages, which keeps the text in the field to edit, and Stage again stages the new text. There is
   no re-save on edit, so an edit is not an undo step of its own, and two devices cannot overwrite
   each other's typing in a staged field.
2. **How is a review staged?** The verdict buttons (**Approve**, or **Approve and merge** when the
   review has a PR link, and **Request changes**) only **select** a verdict; they no longer send. The
   same **Stage** and **Send** as a question follow. `Ctrl+Enter` in the note stages the selected
   verdict with its note; a second `Ctrl+Enter` in the staged note sends the batch. With no verdict
   selected, Stage and Send are disabled and `Ctrl+Enter` does nothing. **Approve and merge** is a
   selectable verdict like the others and keeps its meaning on send: the user's word to merge the PR.
   This changes what the verdict buttons did before (they sent at once). **Hotkeys (ruled
   2026-11-21):** `Alt+Y` selects Approve (Approve and merge, when that is the option shown) and
   `Alt+N` selects Request changes. They act while focus is anywhere in a review item, its note or
   its controls, and take **precedence** there over any global binding on the same chord (the
   review marks itself `data-owns-keys`, so a view's binding stands aside, and its own handler
   stops the event). Outside a review they do nothing new. They only select; they are ignored in a
   staged (locked) review; they type nothing into the note. They are shown as the options'
   `title` and `aria-keyshortcuts`, and on the cheat-sheet in a "Review answers" tab (`REVIEW_KEYS`,
   `src/utils/hotkeys/review-keys.ts`, listed like the Scope Picker's keys: not registry bindings).
   Neither chord is bound globally today.
3. **The Task's staged mark.** The Task is marked staged **only when all** of its open question and
   review waits are staged, so the mark means "nothing left for you but Send". Each wait is marked on
   its own either way.
4. **The top bar's send entry.** First ruled as a button shown only while something is staged, with
   the number staged, even with the agent status off. **Replaced by the user, 2026-11-21:** it is an
   **option in the agent status's click menu** ("Send staged answers", with the count), present only
   while something is staged, and the agent status shows a **staged icon** while there are staged
   answers. With "Show agent status in the top bar" off there is no icon and no menu. Sending the batch
   also has a **command-palette entry**. There is **no hotkey** beyond `Ctrl+Enter` in the field.
