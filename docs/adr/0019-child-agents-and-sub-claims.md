# ADR 0019: child Agents, sub-Claims and sub-tokens

Status: accepted 2026-11-13 (Task `077`). The Spec was ruled by the user on 2026-11-13; the
choices under *Decisions made in design* were not, and are listed there so the user can overrule
any of them. Builds on [ADR 0018](0018-agents-claims-and-account-capacity.md).

## Context

ADR 0018 binds an MCP session to one Agent, and says the subagents of a client "share the
connection and need nothing further". In practice an orchestrating session dispatches subagents,
each to one Task, and every one of them then sees and writes the orchestrator's whole Claim, shows
nowhere in Settings → Agents, and leaves no trace when it stops. The user ruled (2026-11-13):

1. **Identity.** A subagent is a **child Agent**: its own `agents` row with a link to its parent
   Agent, nested under it in Settings → Agents. It uses the parent's account, so capacity and locks
   follow the parent.
2. **Sub-Claim.** A child may claim only inside its parent's Claim, and that **sub-Claim** is not an
   overlap with the parent's.
3. **Views.** The child sees and writes only its sub-Claim, like any Agent. The parent keeps its
   whole Claim, the subtask included, and can still write there.
4. **Telling calls apart.** Subagent calls arrive on the parent's connection. Registering returns
   a **sub-token**; the subagent passes it on each call (an optional argument on every tool) and
   gets its narrowed view. A call without it runs as the parent. A convention, not a security wall.
5. **Registering.** When a subagent starts, the mod registers the child under the session's Agent
   (named from the subagent's description) and hands the subagent its sub-token in its starting
   context. The subagent claims the Task its brief names.
6. **Finish and resume.** When the subagent stops, the mod pauses its sub-Claim; the child stays
   listed as Paused, still naming its Task. When the subagent is resumed, the mod resumes the
   Claim. The child is removed when its Task is set Done or its parent Agent is removed.
7. **TUI.** The Task name shows in Claude Code's existing subagent rows. If a mod cannot change
   those rows, the TUI part is dropped and Settings → Agents is the only place it shows.

## Evidence for the three unknowns

Checked on 2026-11-13 against Claude Code 2.1.323, by experiment where one could be run headless
and from the mod API's own type documentation (the `plugin-authoring` skill's
`types/claude-code.d.ts` for this build) otherwise.

**(a) Can a hook at subagent start add context the subagent itself sees? Yes, two ways.**
*Experiment.* A probe mod (`claude -p --plugin-dir`, a `general-purpose` subagent asked to list
every string starting `SUBTOKEN` in its context) returned
`SUBTOKEN-CTX-…` from a `classic.SubagentStart` hook's `additionalContext`, which it located "in
the SubagentStart hook additional context", and `SUBTOKEN-PROMPT-123` from an `agent.spawn` hook
that rewrote `prompt` before `next(e)`. On a **resume** (SendMessage to the finished subagent) the
`SubagentStart` hook fired again, but the context it returned the second time did **not** reach the
subagent; the first start's context was still in its transcript and it quoted it again. So the
token is handed over once, at the first start, and survives a resume in the subagent's own
transcript. The mod uses `classic.SubagentStart`'s `additionalContext` (the ruled "starting
context"); rewriting the prompt is the documented fallback.

**(b) Are start, stop and resume observable with a stable id? Yes.**
*Experiment, same probe.* `agent.spawn` answered `{agentId: "a86a120ee95e47746"}`;
`classic.SubagentStart` and `classic.SubagentStop` carried `agent_id` with the same value;
`turn.complete` carried `agentId` with it at the end of each run. Resuming with SendMessage raised
`agent.spawn` with `resume: {agentId: "a86a120ee95e47746"}`, then `SubagentStart`, `SubagentStop`
and `turn.complete` again, **all under the same id**. At `SubagentStart`, `$.agent.list()` already
lists the subagent with its `description` (`"probe two"`). The type documentation adds that
`turn.complete` is heard for an aborted run too ("an aborted run's too"), that an ended agent "may
yet resume, under the same id", and that `$.agent.list()` gives `parentId` for a subagent spawned by
a subagent and `teammateId` for a teammate. One caution from the experiment: after a foreground
subagent finished, `$.agent.list()` no longer listed it, so the mod keeps its own record by id and
does not rely on the list after a stop.

**(c) Can a mod change what Claude Code's existing subagent rows show? Yes, the transcript row;
not the background-task list.** *Documentation.* `ui.render` has a `ToolUse` render site: "A tool
call's row in the transcript (`Bash(ls -la)` and its result) … Raised on every attached surface",
carrying `tool`, `input` and `tool_use_id`, "the id `tool.call` carried for this call", which is
also `agent.spawn`'s `tool_use_id`. A subagent's row in the transcript is its `Agent` tool call's
row, so a hook on `{ component: 'ToolUse' }` for `tool === 'Agent'` can draw the row as it was
(`await next(e)`) with one line under it. The footer's list of background tasks has no render site
(`RenderComponent` lists none), so it cannot be changed. Not verified by experiment: render hooks do
not run headless. The build therefore carries a hand test (H5); if the line does not draw there,
rule 7's fallback applies and the builder removes the render hook (see the build plan, step 9).

Neither (a) nor (b) lacked a working mechanism, so rules 5 and 6 stand as ruled.

## Decision

**A child Agent is an `agents` row with a `parent_id`.** It has its own name (made unique like any),
its own sub-Claim, and a **sub-token** whose SHA-256 digest is kept in `token_sha256` as an agent
token's is. Its `session_uuid` holds the client's id for the subagent (Claude Code's `agentId`),
unique under one parent, so registering the same subagent twice answers the same child. Its
`account` is copied from the parent and never read: capacity is the parent's.

**The parent's Claim plays, for a child, the part the user's MCP roots play for an Agent.** That
one sentence decides the rules:

- A child may claim a node only **inside its parent's Claim** while that Claim gives the parent a
  view (standing Active or Paused); anything else is refused `not_permitted`, worded as a node
  outside the MCP roots is ("… is not inside your parent agent's Claim, so it cannot be claimed").
- **Overlap is judged within a level.** A top-level Agent's Claim is checked against the other
  top-level Agents' Claims only; a child's sub-Claim against its **siblings'** sub-Claims only. A
  sub-Claim is never an overlap with its parent's Claim, and never blocks another top-level Agent
  (its parent's Claim already does). Shadowing is judged the same way: among top-level Agents, and
  among the children of one parent.
- A child's **view** is its sub-Claim, read-only when its standing is Paused, empty unless its
  standing is Active or Paused. Its **standing** is derived each time:

  | Condition, first that holds | Child reads |
  | --- | --- |
  | it holds no sub-Claim | Unclaimed |
  | its parent is Unclaimed, Shadowed or Unreachable, or the sub-Claim's root is not inside the parent's Claim (or not readable through the user's roots) | Unreachable |
  | its own Claim is paused, or its parent's Claim is paused | Paused |
  | an older sibling's active sub-Claim overlaps it | Shadowed |
  | otherwise | Active |

- **Capacity follows the parent.** A child is at capacity exactly when its parent is, for the same
  cause. A child has no lock of its own, and never blocks anything itself: the capacity blocks are
  the parent's Claim, which contains every sub-Claim that is in force.

**The sub-token is a per-call argument, `sub_token`, on every tool.** The handler's single door,
`ServerHandler::call_tool`, takes `sub_token` out of the arguments before anything else reads them,
resolves it to a child of the session's bound Agent, and runs the call as that child; the tools'
own parameter types do not change. Every tool's served input schema gains the optional property.
A call without it runs as the session's Agent. A sub-token is **not an agent token**: attaching with
one is refused as an invalid token, and the wait stream refuses it `401`.

**Removal.** The database removes a child, in the same transaction and the same Gesture as the
write that causes it:

- when its parent's row is deleted (Settings → Remove, or any delete), by a trigger on `agents`;
- when the stored status of the Task its sub-Claim names becomes Done (`done` or `agentic_done`), by
  a trigger on `tasks`, whoever set it: the user in the app, an agent over the MCP, a bulk command.

Both triggers are guarded on `undo_context.suppressed`, as migration 0080's `mcp_roots_forget_*`
triggers are, so an undo or redo replays the journal's own row images instead. Ctrl+Z on the
Gesture that set the Task Done (or removed the parent) brings the child back with it.

**The mod** (`arlesh-notify`) registers, pauses and resumes children, fills in `sub_token` on a
subagent's Arlesh calls, and draws the Task under the subagent's row. Details in the build plan.

### Decisions made in design (the user may overrule any)

1. **Pausing, shadowing, locking or removing the parent.** Derived, never stored on the children.
   A paused parent makes its children read Paused (read-only); a shadowed, unreachable or unclaimed
   parent makes them read Unreachable (they see nothing); a locked or at-capacity parent makes them
   at capacity with its cause; a removed parent removes them. The children's own pause flags are
   untouched, so resuming the parent restores each child as it was. *Why:* the existing model
   derives standing on every call (ADR 0018, question 2) and stores only what an actor chose;
   writing cascaded pauses would have to be undone again on resume and would lose which child had
   been paused by its own subagent.
2. **Overlapping siblings.** Refused, as between any two Agents: one active sub-Claim per node among
   one parent's children, and of two that come to overlap through a move the older keeps its place.
   *Why:* "one active Claim per node" is the rule that keeps two agents out of one subtree, and two
   subagents on one Task are exactly that case; the parent, which may write anywhere, is the one
   exception the Spec makes.
3. **Grandchildren.** No: a child may not register children (`invalid_request`). A subagent started
   by a subagent is not registered; the mod gives it the sub-token of its nearest registered
   ancestor, so it works inside that sub-Claim and appears nowhere of its own. *Why:* nesting one
   level keeps Settings, standing and the overlap rule one step deep, and a nested subagent is
   almost always a helper of the same Task.
4. **The sub-token and its argument.** A random token like an agent token (`secret::random_token`),
   kept only as its SHA-256 digest in `agents.token_sha256`; the argument is named **`sub_token`**,
   after the Spec's own word. The mod keeps the plain token in its store (`children:<session id>`,
   30 days, like the agent token), hands it to the subagent in its starting context, **and fills
   `sub_token` in on any Arlesh call a subagent makes without one** (`tool.call` carries the
   calling subagent's `agentId`). *Why the fill-in:* a model that forgets an optional argument would
   silently act as the parent on the parent's whole Claim; the mod knows which loop is calling, so
   the convention holds without relying on the model's memory. The ruled hand-over in the context
   stays, so a client without the mod can still be told the token.
5. **Undo, and what the user can do to a child.** Child rows are `agents` rows, so they are
   journaled like every Agent (migration 0106 adds `parent_id` to the triggers): the mod's and the
   subagent's own writes go under source `mcp`, off every stack; the user's Settings actions are
   Gestures. In Settings a child offers **Pause, Resume, Release and Remove**, not Lock (capacity
   follows the parent); a Lock sent for a child anyway is refused `invalid_request`. *Why:* the same
   journal and the same doors as an Agent, with only the control the Spec takes away removed.
6. **"Its Task is set Done" when the sub-Claim is not a Task.** Only a sub-Claim rooted at a stored
   **Task** is removed by Done, when that Task's **stored** status becomes `done` or
   `agentic_done`. A sub-Claim on a Goal, Commitment or Domain is never removed by its node's state;
   it goes with its parent or by hand. A Compound Task's derived Done is not a stored status and
   does not remove it either. *Why:* the Spec names "its Task"; a Goal is Achieved, a Commitment
   gets a verdict, and neither is "set Done"; a trigger can only see what is stored, and the brief's
   Task is an ordinary Agentic Task whose Done is stored.
7. **The wait stream and the mod's wake-ups.** Unchanged in shape. The stream still answers only an
   agent token (a sub-token is refused `401`), and a child's waits hang inside its sub-Claim, which
   lies inside the parent's Claim, so the parent session's stream already hears them. The mod
   already routes a wake-up by the `agentId` of the loop that raised the wait: to the subagent while
   it runs, else to its spawner, else the session. *Why:* nothing new is needed, and a second
   stream per subagent would multiply the long polls for no gain.
8. **When the session is not attached, or the app is not running.** The mod registers nothing,
   adds nothing to the subagent's context and fills in no `sub_token`; the subagent's Arlesh calls
   meet the same "not attached" refusal as the session's, or run as the parent if the session is
   attached but registering failed. A failed pause or resume is logged to the debug log and not
   retried: the next start or stop sets it right, and a child left Active by a missed pause is paused
   by hand or removed with its Task. Registering waits for an attach already in flight. *Why:* the
   mod already degrades this way for the session itself; a subagent should not fail its work
   because bookkeeping did.
9. **`claim_name`.** The `arlesh_agents` answers gain `claim_name`, the claimed node's short id and
   title (`"077 Subagents: register under the parent agent, claim a subtask"`), so the mod can draw
   the row without reading the board. *Why:* the row needs words, and the Claim's root is only a
   `(kind, id)` pair.
10. **Teammates and workflow agents** are not registered: only subagents the Agent tool starts
    (`$.agent.list()` lists them, without `teammateId`). *Why:* the Spec is about subagents; a
    teammate is a session of its own.

## Amendments after the first hand test (2026-11-14, same PR)

The user's hand test of the first build found four things; the user accepted a child being able to
re-claim any node inside its parent's Claim as it is (it is what the ruling says), and asked for
the rest:

1. **Undo brings a child back Paused.** The journal's row image has the standing it had when it
   went (Active), so the statement that re-inserts an `agents` row with a `parent_id` writes
   `claim_paused = 1`. No schema change. It reads Active when its subagent resumes.
2. **A child removed by an agent's write is not restored by Ctrl+Z.** Agent writes are journaled
   under the `mcp` source and are on no stack, so there is nothing to restore it from. Left as it
   is and stated: reopening the Task and starting the subagent again finds its sub-token refused,
   registers afresh, and gets a new child and token. (The alternative, putting agent writes on a
   stack, changes ADR 0018's rule that an agent's writes never enter the user's Undo Stack; not
   done.)
3. **A child's refusals say why.** The generic MCP refusal is reworded for a child, after the tool
   has answered (`ArleshMcp::explain_to_child`), by the pure rules in `agents/rules/refusals.rs`: a
   Paused child's write says its Claim is paused and who resumes it; a node outside the sub-Claim
   that the parent's own view can read says it is outside the child's Claim and may be claimed. A
   node the parent cannot read keeps the generic words.
4. **Registering again rotates the token.** `register_child` for a `client_id` that already has a
   child answers it with a **new** sub-token and the old stops, so a mod that lost its record can
   recover. Only the parent can call it. The mod registers only when it has no record (a known
   child is resumed), and it now sets the `sub_token` of the child it works under on every Arlesh
   call, replacing a stale one the subagent remembers.

Settings → Agents folds a parent's children away, closed by default.

## Revision 2026-11-14: the orchestrator starts a subagent already holding its Claim

The user asked whether a mod can add details to Claude Code's subagents pane, and whether the
orchestrator could plausibly start subagents with their Claims; the proposal below was accepted
("sure"), the fallback kept. **This replaces part of ruling 5**: the mod no longer only registers
and leaves the claim to the subagent. When the orchestrator names the Task, the mod registers the
child *with* the Claim and the subagent claims only as a fallback.

What the mod API gives (2.1.323 types): no render site draws the footer's task list, but
`agent.spawn` lets a hook rewrite `description` (documented as "what the task shows as") and
`prompt`, carries the pinned `tool_use_id`, and settles with the new `agentId`; `$.agent.list()`
lists a subagent's `description` as the spawn hook left it. Whether `SubagentStart` fires before
`agent.spawn`'s `next` resolves is not stated, so the mod ties them two ways: the settled `agentId`,
and the rewritten label (unique, since it carries the Task's short id) found in `$.agent.list()`.
Not run against a live terminal: hand test H6.

- **Marker**, strict: `[arlesh:<id>]`, one only, in `description` or `prompt`; a repeated or
  malformed one counts as none (debug log). Grammar and label in `docs/spec/agents.md`.
- **Server**: `register_child` takes an optional `subtree`; the child is created and then claims in
  its own transaction under the checks `claim` applies to a child, and a refusal leaves the child
  registered, unclaimed, with `claim_refused`. No new rule, and no schema change: it is registration
  followed by the existing claim.
- **Fallback** unchanged: no marker, a Task that cannot be read, or a refused Claim register the
  child unclaimed and tell the subagent to claim (with the reason).
- **Guard**: a subagent with no child of its own, calling `claim` or `release` without a
  `sub_token`, would have changed the **session's** Claim (it did, in the first hand test). The mod
  denies those two. `attach` (it would rebind the session), `pause`, `resume`, `lock`, `unlock` and
  `report_usage` have the same exposure and are not guarded yet.
- **Not built**: live Active/Paused in the task list (the label is set once), a pane, and noticing
  a session the model attached by hand (the mod registers children only when the mod attached).

## Consequences

- A subagent dispatched with the mod shows in Settings → Agents under its parent, its Task as its
  Claim, Paused between runs, gone when its Task is Done.
- Every Arlesh tool takes one more optional argument; clients and tests that send none see no
  change.
- A session that can see its own transcript could read a sibling's sub-token. That is allowed: the
  Spec calls this a convention, not a wall. The server still refuses a sub-token that is not a child
  of the calling session's own Agent.
- Settings, the Python models and the app's TypeScript mirror carry `parent_id`.

## Build plan

The builder works through these steps in order, one commit each or a few, in one PR on a branch off
`dev`. Read [Agents](../spec/agents.md) and this ADR first; the spec text is already written.
Migration numbers **0105** and **0106** are this Task's; **0103 and 0104 belong to Task 97f**, in
flight on another branch, which changes `arlesh_waits`, Task cards and the server instructions.
**Do not edit the `instructions = "…"` string in `crates/arlesh-core/src/mcp/mod.rs`, nor
`mcp/params.rs` beyond what step 4 names, nor anything under `mcp/waits.rs`**: 97f edits those, and
the two branches must merge cleanly. Everything a subagent needs to know about `sub_token` goes into
the `arlesh_agents` tool description and the schema property's description.

### Step 1. Schema: migrations 0105 and 0106

`crates/arlesh-core/migrations/0105_child_agents.sql`:

```sql
-- Child Agents (Task 077; ruled with the user 2026-11-13, ADR 0019). A subagent of a session is an
-- Agent row of its own, linked to the session's Agent. No foreign key, as for `mcp_roots`: the
-- children go with their parent by the trigger below, which the undo engine must be able to
-- suppress while it replays.
ALTER TABLE agents ADD COLUMN parent_id INTEGER;

-- One child per subagent: `session_uuid` holds the client's id for it.
CREATE UNIQUE INDEX agents_child_per_client ON agents (parent_id, session_uuid)
    WHERE parent_id IS NOT NULL;

-- A child goes with its parent. Guarded on `undo_context.suppressed`, as migration 0080's
-- `mcp_roots_forget_*` triggers are: an undo or redo replays the journal's own images.
CREATE TRIGGER agents_forget_children AFTER DELETE ON agents
WHEN (SELECT suppressed FROM undo_context WHERE id = 1) = 0 BEGIN
    DELETE FROM agents WHERE parent_id = old.id;
END;

-- A child whose sub-Claim is a Task is done when the Task is: removed when its stored status
-- becomes Done, whoever set it.
CREATE TRIGGER agents_forget_done_task AFTER UPDATE OF status ON tasks
WHEN new.status IN ('done', 'agentic_done') AND old.status NOT IN ('done', 'agentic_done')
     AND (SELECT suppressed FROM undo_context WHERE id = 1) = 0 BEGIN
    DELETE FROM agents WHERE parent_id IS NOT NULL AND claim_kind = 'task' AND claim_id = new.id;
END;
```

`crates/arlesh-core/migrations/0106_child_agents_undo_triggers.sql`: drop and recreate the three
`undo_journal_agents_*` triggers of migration 0102 with `'parent_id', new.parent_id` (and `old.`)
added to every `json_object`, otherwise identical. Never edit 0101 or 0102. Do not touch
`baseline/`: the bot re-cuts it after the merge (AGENTS.md).

Tests: in the undo tests that already cover `agents` (`src-tauri/tests/undo_engine.rs`, and the
core's journaled-table checks), a removed parent with two children comes back with both on Ctrl+Z
and goes again on redo, with no duplicate delete; a Task set Done by a user command removes its
child, and Ctrl+Z restores the Task's status and the child in one step.

### Step 2. Model, rows and store (`crates/arlesh-core/src/agents/`)

- `model.rs`: `Agent` gains `parent_id: Option<AgentId>` (serialised as `parent_id`, `null` for an
  Agent). `AgentAction` is unchanged.
- `rows.rs`: `AgentRow` and `AGENT_COLUMNS` read `parent_id`.
- `store.rs`: `insert_child(parent, name, account, client_id, token_sha256, now) -> AgentId`;
  `child_by_client(parent, client_id) -> Option<Agent>`; `child_by_token(parent, sha256) ->
  Option<Agent>` (matches only `parent_id = parent`); `children(parent) -> Vec<Agent>`. `by_token`
  matches only `parent_id IS NULL`, so a sub-token is never an agent token (attach and the wait
  stream both go through it). `delete` stays one statement; the trigger takes the children.
- `error.rs`: `OutsideParentClaim(NodeKey)` ("{0} is not inside your parent agent's Claim, so it
  cannot be claimed"), `SubTokenInvalid` ("the sub_token names no child agent of this session"),
  both mapped to `not_permitted` in `error/wire.rs`; `NotForChild(&'static str)` (the reason, e.g.
  "a child agent's capacity follows its parent, so it cannot be locked"), mapped to
  `invalid_request`.

### Step 3. Rules (`agents/rules/claims.rs`, pure)

- `Held` gains `parent: Option<AgentId>`.
- `Lineage::within(node, root) -> bool`: `node` is `root` or lies beneath it.
- `check(lineage, candidate, readable, held, agent, parent: Option<AgentId>)`: unchanged refusal for
  `!readable`; the overlap search keeps only `other.agent != agent && other.parent == parent`
  (same level: top-level against top-level, a child against its siblings).
- `shadowed(lineage, held)`: compares only pairs with the same `parent`.
- `child_standing(claim: Option<(ClaimStatus, NodeKey)>, inside_parent: bool, parent:
  AgentStanding, is_shadowed: bool) -> AgentStanding`, by the table in *Decision*; `inside_parent`
  is "readable through the user's roots and within the parent's Claim root".
- Unit tests in `claims/tests.rs`: a child's claim inside its parent's is no overlap; two siblings
  overlapping are refused naming the elder; a top-level agent is not refused by a child's claim
  (only by the parent's); shadowing among siblings keeps the older; every row of the standing
  table, including a paused parent making an active child read Paused and a shadowed parent making
  it Unreachable.

### Step 4. Service (`agents/service.rs`)

- `Ground::held` carries `parent`. `Ground::permit(agent, node)` looks the agent up: a top-level
  agent as today; a child requires its parent's standing Active or Paused and
  `lineage.within(node, parent_root)` and `user_map.can_read(node)`, else `OutsideParentClaim`;
  then `claims::check` with `parent: Some(parent)`.
- `Ground::standing_of` uses `child_standing` for a child (computing the parent's standing first).
- `register_child(db, parent, name, client_id, now) -> (Agent, Option<String>)`: refused
  `NotForChild("a child agent cannot register children")` when `parent` is itself a child; answers
  the existing child with no token when `(parent, client_id)` is known (and touches
  `last_seen_at`); else inserts a child with the parent's account, a new sub-token and
  `names::unique(names::tidy(name))`, and answers the token once.
- `child_for_sub_token(db, parent, token) -> Result<AgentId, AgentError>`: `SubTokenInvalid` unless
  a child of `parent` has that digest.
- `view(db, id)`: for a child, the map is its sub-Claim's (read-only when Paused), empty unless
  Active or Paused, by the derived standing.
- `act`: `Lock` on a child is `NotForChild(…)`. Everything else as today; `Remove` of a parent takes
  the children through the trigger.
- `report_usage` for a child: `NotForChild("a child agent's usage is its parent's account's")`.
- `cause_for` / `overview`: a child's `at_capacity` is its parent's cause. `blocking` skips children.
- `overview` lists children like Agents, oldest first; the frontend nests them.
- Service tests (`service/tests.rs`): register answers a token once and the same child again
  without one; a child claims inside, is refused outside (`OutsideParentClaim`) and refused on a
  sibling's subtree; parent paused → child Paused and read-only; parent re-claims elsewhere → child
  Unreachable and sees nothing; parent locked → child `at_capacity` agent_locked and the child's
  Tasks blocked once (through the parent's Claim), not twice; removing the parent removes the
  children; setting the claimed Task Done (via `tasks` status write, both `done` and
  `agentic_done`) removes the child and leaves a sibling on another Task; a sub-token does not
  attach (`TokenInvalid`) and `agent_for_token` answers `None` for it.

### Step 5. MCP: the per-call `sub_token` (`crates/arlesh-core/src/mcp/`)

- `mod.rs`, `call_tool`: before `admit`, remove the key `sub_token` from `request.arguments`. If it
  was present and is not a string, answer `invalid_request` ("sub_token must be a string"). With
  `Callers::Anyone` it is refused `invalid_request` ("sub_token needs an attached MCP session").
  With a session that is not attached, `admit` refuses as today. Otherwise resolve it with
  `service::child_for_sub_token(binding agent, token)`; a refusal ends the call with the wire error.
  Then run the router with a clone of the handler whose caller is that child for this call only
  (add a field such as `acting: Option<AgentId>` to `ArleshMcp`, set on the clone; the session's
  `Binding` is never changed). `ArleshMcp::call` (the Python host's door) goes through `call_tool`,
  so both hosts get it.
- `caller.rs`: `caller_map` and `admit` read the acting Agent (`acting.or(binding.agent())`).
  `agents.rs`'s `attached()` likewise, so `status`, `claim`, `pause`, `resume`, `release` with a
  `sub_token` act on the child.
- `agents.rs`: with a `sub_token`, `attach`, `register_child`, `lock`, `unlock` and `report_usage`
  are refused `invalid_request` (one message each, naming why). `roots_instructions` stays the
  session's.
- `schema.rs`: a function that adds to every tool's input schema the optional property
  `"sub_token": {"type": "string", "description": "Only for a subagent given a sub-token: the call
  runs as your child agent and sees only its sub-Claim. Leave it out to act as the session's
  agent."}`, called from `ArleshMcp::flattened` after `flatten_tool`. Never `required`.
- Tests (`mcp/agents/tests.rs`, and a new `mcp/sub_token` test file or the existing access tests):
  `tools/list` shows `sub_token` on every tool; `arlesh_snapshot.load` with a child's `sub_token`
  returns only the sub-Claim's nodes and without it the parent's whole Claim (acceptance line 2);
  `arlesh_tasks.update` with the `sub_token` on a Task of the parent's Claim outside the sub-Claim
  is refused `not_permitted`, and the same call without it succeeds (the parent can still write
  there); a sub-token of another session's child is refused `not_permitted`; a non-string
  `sub_token` is `invalid_request`; `arlesh_agents.claim` with the `sub_token` outside the parent's
  Claim is `not_permitted` (acceptance line 5); `arlesh_agents.pause`/`resume` with the `sub_token`
  move the child between Paused and Active.

### Step 6. MCP: `arlesh_agents.register_child` and `claim_name`

`params.rs`: add one variant to `AgentsOperation` (the only edit to that file):

```rust
/// Registers a subagent of this session as a child agent and answers its sub-token, once. The
/// child may claim only inside your Claim, and sees only what it claims. Registering the same
/// `client_id` again answers the same child, without a token.
RegisterChild {
    /// What to call it, e.g. the subagent's description; made unique.
    name: String,
    /// Your client's id for the subagent (Claude Code's agent id).
    client_id: String,
},
```

Request (from the parent session, no `sub_token`):

```json
{"operation": "register_child", "name": "Subagents: register under parent", "client_id": "a86a120ee95e47746"}
```

Answer:

```json
{
  "agent": {"id": 12, "name": "Subagents: register under parent", "account": "default",
            "session_uuid": "a86a120ee95e47746", "parent_id": 7, "claim": null, "locked": false,
            "created_at": "2026-11-13T10:02:11", "last_seen_at": null},
  "standing": "unclaimed",
  "at_capacity": null,
  "sub_token": "q3H…"
}
```

The subagent's claim (by the subagent, or filled in by the mod):

```json
{"operation": "claim", "subtree": {"node_type": "task", "node_id": "077"}, "sub_token": "q3H…"}
```

```json
{
  "agent": {"id": 12, "…": "…", "parent_id": 7,
            "claim": {"root": {"node_kind": "task", "node_id": 4210}, "status": "active",
                      "claimed_at": "2026-11-13T10:02:15"}},
  "standing": "active",
  "at_capacity": null,
  "claim_name": "077 Subagents: register under the parent agent, claim a subtask"
}
```

`Identity` gains `claim_name: Option<String>` (skipped when `None`): the claimed node's short id, a
space, and its title, read from the catalogue the answer already loads. `sub_token:
Option<String>` (skipped when `None`), only on `register_child`'s first answer. Update the
`arlesh_agents` tool description (doc comment in `agents.rs`): replace "Subagents share this
connection and are covered by your attach." with a short paragraph on `register_child`, `sub_token`
and the child's narrowed view.

Tests: register from an unattached session is `not_permitted`; register with a `sub_token` is
`invalid_request`; the first answer carries `sub_token` and the second (same `client_id`) does not
and names the same child; `claim_name` appears once a node is claimed.

### Step 7. Hosts and frontend

- Python (`crates/arlesh-py`): `models.py`'s `Agent` gains `parent_id: int | None`; keep the schema
  check in `src/schema.rs` passing. No new route: `POST /agents/{id}/action` with `lock` for a child
  is refused by the core.
- Tauri: nothing new beyond the model. `src/api/agents.ts`: `Agent.parent_id: number | null`.
- `src/components/SettingsModal/AgentsSection.tsx` / `AgentRow.tsx`: a child row is nested under its
  parent (an indented list inside the parent's `<li>`), on two lines: `name · state · last seen 2h`
  (no account: it is the parent's) and its Claim breadcrumb as for any Agent. Its controls are Pause,
  Resume, Release and Remove (no Lock). A child whose parent is missing from the list (a race) is
  listed at top level. `src/utils/agents.ts` `controlsFor` drops Lock/Unlock for a child.
  New strings go through i18next (the `translating-ui` skill).
- `src/hooks/use-agent-locks.ts` `locksOf`: count only Agents with `parent_id === null`, so a locked
  parent is one padlock count, not one per child.
- Tests: `AgentsSection.test.tsx` renders a child nested under its parent with its Claim and without
  Lock (acceptance line 1, app side); `use-agent-locks.test.ts` counts a locked parent with two
  children once.

### Step 8. The mod (`plugins/arlesh-notify/hooks/`)

New pure module `children.ts` (tested in `children.test.ts`), wired from `register.ts`:

- **Record.** `$.store` key `children:<session id>`: `{ [clientAgentId]: { childId, subToken, name,
  nested?: true, toolUseId?, claimName?, standing?, savedAt } }`, pruned after 30 days like the
  wait book.
- **`agent.spawn`** (not a resume): after `next(e)`, remember `tool_use_id → agentId` for the row.
- **`classic.SubagentStart`**: `id = e.agent_id`. Wait for any attach in flight; if the session is
  not attached, pass through. Find the subagent in `$.agent.list()`; skip it when absent (a workflow
  agent) or a teammate (`teammateId`). If the record has `id`: call `arlesh_agents.resume` with its
  `sub_token` and add no context (resume context does not reach the subagent: evidence (a)). If it
  has a `parentId` whose record (or an ancestor's) exists: store `{ nested: true }` with that
  ancestor's `childId` and `subToken`, and add the context block naming that token. Otherwise
  `register_child({ name: description, client_id: id })`; store the answer; if it carried a
  `sub_token`, add the context block:

  > You are a subagent working on Arlesh as child agent `<name>` of this session's agent. Pass
  > `sub_token: "<token>"` on every Arlesh tool call: it gives you your own view. First claim the
  > Task your brief names with `arlesh_agents.claim` (`subtree: {node_type: "task", node_id:
  > "<its short id>"}`) and the `sub_token`; you can claim only inside the session's Claim. When
  > you stop, your Claim is paused for you; it resumes when you are resumed.

  When the answer carried no token (the child existed), add no block.
- **`tool.call`** on `/^mcp__.+__arlesh_[a-z_]+$/` with `e.agentId` set and no `sub_token` in the
  input: when a record for that `agentId` exists, run `next({ ...e, sub_token })`. When the call is
  `arlesh_agents` and it answered an identity, record `claimName` and `standing` for the row.
- **`turn.complete`** with `agentId` whose record exists and is not `nested`: call
  `arlesh_agents.pause` with its `sub_token`. A `not_permitted` answer (the child was removed: its
  Task is Done or its parent went) drops the record; any other failure is logged to debug.
- **Row line (rule 7).** A `ui.render` hook on `{ component: 'ToolUse' }`: for `tool === 'Agent'`
  whose `tool_use_id` maps to a recorded child, draw `await next(e)` with one dim line under it,
  `Arlesh · <claimName> · <Active|Paused>`; any other row is `next(e)` untouched. Kept in `$.state`
  per the `plugin-authoring` skill (with the `types/index.d.ts` contract), so a write redraws.
- Tests (`claude plugin test plugins/arlesh-notify`): SubagentStart on an attached session calls
  `register_child` with the description and the agent id, and its `additionalContext` holds the
  token; a second SubagentStart for the same id calls `resume` and adds nothing; `turn.complete`
  for it calls `pause` with the `sub_token`; a subagent's Arlesh call without `sub_token` reaches the
  server with it, and the main loop's does not; a nested subagent gets its ancestor's token and is
  not registered; a teammate is not registered; an unattached session registers nothing; a
  `not_permitted` pause drops the record. Run `claude plugin validate` too.
- README: already written (this commit); keep it true to what was built.

### Step 9. Hand tests, then the PR

With the desktop app built from the branch (`scripts/branch-instance.sh`) and a session with the
mod (`claude --plugin-dir plugins/arlesh-notify`) that claimed a Project with two Agentic Tasks:

- **H1** Dispatch a subagent whose brief names Task A. Settings → Agents shows it nested under the
  session's Agent, Active, its Claim Task A.
- **H2** Let it finish. The child reads Paused, still naming Task A. Send it a message (resume). It
  reads Active again. No step by the orchestrator.
- **H3** From the subagent, ask it to load the snapshot: it sees Task A's subtree only. From the
  session, the whole Project. Ask the subagent to claim Task B's parent Project: refused.
- **H4** Set Task A Done in the app: the child disappears. Ctrl+Z: it comes back, Paused, naming
  Task A. Dispatch a second subagent on Task B, then remove the parent Agent in Settings: both go;
  Ctrl+Z restores them.
- **H5** In the terminal, the subagent's `Agent(…)` row shows `Arlesh · <A's short id and title> ·
  Active`, then `· Paused` after it stops. **If no line draws**, remove the render hook and its
  README line (rule 7: "Drop the TUI part"), and say so in the PR.

Then open the PR against `dev`, with a changelog fragment under `changelog.d/added/`, and drive CI
green. Acceptance, line by line: H1 and step 7's test (nested, Task as Claim); step 5's tests and H3
(view with and without the sub-token); step 8's tests and H2 (Paused and Active with no
orchestrator step); step 4's tests, step 1's undo tests and H4 (Done and parent removal); step 5's
test and H3 (claim outside refused); CI green.
