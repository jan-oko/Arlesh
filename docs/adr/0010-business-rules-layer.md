# Every business rule lives in a pure Rust layer; a frontend copy is kept only when pinned

Rust encodes **all** of Arlesh's business logic, in one layer that is independent of Tauri and of
the database: a `rules` module per domain, holding pure functions over values. That layer is the
single authority. The frontend may keep its own copy of a rule where UX or speed needs one:
filtering on every keystroke, highlighting a drop target during a drag, or an optimistic update.
Every copy it keeps is **pinned** to the Rust definition by a shared conformance corpus, the way
`conformance/preset-filters.json` pins the status presets today. Any rule the frontend does not
need synchronously, it reads from the backend instead of computing.

This is Task **`122`** ("Formalize business rules and put them in a business layer"), which the
user confirmed on 2026-10-02 is the same work as `197`: "the idea for the rust is the same task as
the business logic layer - some logic can stay on frontend for UX and speed reasons, but rust
should encode all of the business logic in a clean independent layer". `122`'s spec already
decides the mechanism: a `rules.rs` per domain module, purity checked in CI, and the extraction
from `tasks/mod.rs` and `flows/mod.rs`. This ADR records that decision with its rationale. It also
adds what the spec lacks: an inventory of the logic in `src/`, a verdict on each frontend copy,
and one order. Those are in the plan,
[`docs/superpowers/plans/2026-10-02-business-rules-layer.md`](../superpowers/plans/2026-10-02-business-rules-layer.md).

The layer is also the foundation for two later, separate Tasks. **`a77`** moves it into a Tauri-free
crate and binds it to Python. **`2bd`** serves those bindings over FastAPI. Both build on this
layer, and neither is part of this decision.

## Status

accepted (2026-10-03, Task `122`). The user answered the open questions on 2026-10-02: "Yes to
all. All folding is in 122 for now." Questions 1 to 7 are decided as recommended. Question 8 was
decided differently: the domain and database models are separated (decision 8). Phases 3 to 7 stay
inside `122`, with no follow-up Tasks.

## Context

The backend already owns most of the model. The board load (`rs:mindmap/`) derives scope
lifecycles, Habit occurrences, compound status, Review, waits and the capacity lock. Short ids come
from `rs:mcp/ids.rs`, and the status presets are defined in `rs:filters/`. But the rules are not a
layer yet:

- **The pure rules are not separated from persistence.** `rs:filters/`, `tasks/lifecycle.rs`,
  `tasks/review.rs`, `flows/habits.rs` and `flows/cooldown.rs` are pure. But `tasks/scope_rules.rs`,
  `tasks/compound.rs`, `flows/occurrences.rs` and `nodes/table.rs` take a `Db` session, and the
  board load interleaves reads with derivation. Many rules are inline in `tasks/mod.rs` (1,793
  lines) and `flows/mod.rs` (4,014 lines).
- **Some rules exist only in TypeScript.** These include the List View's pills, row flattening and
  sections, the Zen contents, the agent-activity counts, the status cycle, the Habit fold, the Plan
  View's triage and the parenting table. An agent cannot ask the questions those rules answer
  (`docs/spec/mcp-server.md`, *What is deliberately absent*), and a Python host would have nothing
  to bind.
- **Some rules exist twice.** The frontend re-derives facts the backend already computes:
  dependency blocks and their "Blocked by …" text, Agentic and Time Scope inheritance, the Review
  question, and MCP visibility. These copies are not pinned. They agree today because someone kept
  them in step by hand.
- **Two copies are already pinned.** The presets are pinned by `conformance/preset-filters.json`,
  and scope keys and windows by `conformance/scope-keys.json`. They keep the per-render filter
  synchronous (`docs/spec/filtering-logic.md`: "an IPC round trip in front of every selection move
  would be a regression") without letting the two languages drift.

## Decision

1. **A `rules` module per domain, and nothing else in it.** `tasks/rules.rs`, `flows/rules.rs`,
   `scopes/rules.rs`, `nodes/rules.rs`, `domains/rules.rs` and `filters/` (already pure), split into
   submodules as size demands. A rules module may import values (models, keys, `chrono` types) and
   other rules. It may not import a session (`Db`, `SessionMode`), `sqlx`, `tauri`, `tokio`, or
   anything that does I/O, and it is told `now` rather than reading a clock. A CI check enforces
   this, so purity is structural, as `122` decides. The check is on a rules module's own imports.
   Until the separation in decision 8 lands, some value types still implement `sqlx`'s traits
   beside their definition (for example `ScopeKey` in `rs:scopes/key.rs`). The rules never call
   those impls, so the check allows them in the meantime.
2. **The board is derived by a pure function of its rows.** The load becomes two steps. The first
   gathers the stored rows (persistence, in the domain's `mod.rs`). The second is
   `rules::derive_board(rows, now, capacity)`, which returns the derived board. The steps that take
   a session today (scope lifecycles, Habit occurrences, compound settling, added edges) are split
   the same way. That makes the whole derivation testable from plain values, replayable from a
   corpus, and callable from Python without a database.
3. **Write-time checks call the same rules.** Containment, parenting, status transitions, the
   Backlog invariant and cooldown fit are each one rule function, called by the writer that
   enforces it and by any query that previews it.
4. **The backend sends what it derived.** Facts the frontend needs once per load are computed in
   the rules layer and sent on the board. They are not re-derived in TypeScript. The facts are:
   - whether a node is blocked, and its block reasons as **structured values** (`dependency` with
     the target's kind, id, short id and title; `cooldown` with its instant; `compound`;
     `capacity`; `explicit` with its text). The frontend words them, so i18n stays where it is,
     and the MCP words them in English;
   - the effective Agentic flag and the inherited Time Scope;
   - the open question, MCP visibility, and whether a Commitment is Expired;
   - the agent-activity counts;
   - what each node allows (its **capabilities**).
5. **A frontend copy is allowed only for UX or speed, and only pinned.** A rule may be copied into
   TypeScript when the frontend must answer it synchronously and often: per render, per keystroke,
   or per pointer move. Each kept copy is pinned by a corpus under `conformance/`. A corpus is
   written from the spec, generated by neither side, and replayed by a Rust test and a vitest. A
   rule the frontend needs only at load time, or only at a write, is never copied. The frontend
   reads the backend's answer, or sends the gesture and lets the backend decide.
6. **Gestures go to the backend.** The status cycle, `Alt+Enter`, the Agentic toggle, the verdict
   cycle and paste are decided in Rust. The frontend sends what the user did and renders the
   outcome, including refusals and the backend's questions. Every write already ends in a reload
   and there is no optimistic UI today, so moving these costs no latency.
7. **The layer is what `a77` binds.** Nothing in a rules module may need Tauri or a session, so the
   rules move into `a77`'s core crate unchanged, and Python can call them over plain values. The
   persistence and use-case code that wraps them moves with them, since it is Tauri-free too (except
   `rs:icon.rs`, which stays in the app crate).
8. **Domain models and database models are separate.** Decided by the user on 2026-10-02 ("mostly
   puritan on business logic"). Domain types carry no `sqlx` derive or impl. That covers `Task`,
   `Goal`, `Flow`, `ScopeKey`, the status enums, the `sqlx::Type` enums in `domains/model.rs`, and
   the `FromRow` models in `domains/`, `flows/`, `knowledge_base/` and the rest of `tasks/` and
   `nodes/`.
   - **Persistence owns row structs.** Each derives `FromRow` and converts to and from its domain
     type. A malformed row fails at that conversion, as a typed error, not inside a rule.
   - **Value types stored directly** get a zero-cost newtype in persistence, such as
     `DbScopeKey(ScopeKey)`, which implements `Encode`, `Decode` and `Type`. The newtype is needed
     because once the core is its own crate (`a77`), the orphan rule forbids implementing `sqlx`'s
     traits for a type from another crate.
   - **The purity check grows** from "a rules module imports no `sqlx`" to "the domain types and
     rules do not depend on `sqlx`".
   - **No meaningful runtime cost.** A newtype has its inner type's layout. A row-to-domain
     conversion moves the fields it already decoded, and the compiler usually elides the move.
     Every read already decodes each column once, and that stays true.
   - **WebAssembly is not the reason.** Purity is.

## Considered options

- **Delete every TypeScript copy and make each filter toggle a round trip.** Considered first under
  `197`. Rejected by the user's clarification: UX and speed may justify a copy. The pinning keeps
  the copy honest, and the per-render filter stays synchronous.
- **Leave the rules where they are, and document the split.** This is the cheapest option.
  Rejected, as `122` rejects it: rules stay buried in persistence code, and the rules that live only
  in TypeScript stay out of reach of the MCP and of Python.
- **One top-level `business/` module.** Rejected, as `122` rejects it: it cuts across the
  domain-first layout that `.claude/rules/rust.md` mandates.
- **Generate the TypeScript copies from Rust**, through WebAssembly or code generation. This gives
  one implementation with no corpus. Rejected for now: it adds a build target to the frontend and
  loses the corpus as a readable specification. Reconsider it if the number of pinned copies grows
  past what hand-written corpora can carry.

## Consequences

- **Every rule has one authority**, and every copy shows its pin. A rule changed in Rust and not in
  the pinned copy turns that copy's vitest red on the case it broke.
- **The MCP can reach every rule.** It gains the List View's pills once they are in the rules layer,
  and `docs/spec/mcp-server.md` drops them from *deliberately absent*.
- **The frontend loses its derivations, not its speed.** The re-derived facts and the gesture
  decisions are deleted from TypeScript. The per-render rules (presets, pills, sections, Zen
  contents, the Habit fold, triage and drop targets) stay as pinned copies.
- **The corpora grow.** One corpus per family of kept copies. The plan names them.
- **The rules moves touch every Rust path.** Each extraction runs one module per PR, when no other
  Rust PR is touching that module, and `a77`'s crate split runs after them, so that the tree is not
  moved twice under in-flight work.
- **The model map changes with each phase.** Every pointer for a moved rule names its `rules`
  module, and the *conformance pair* card becomes a card about pinned copies in general.

## Answers to the open questions

These were raised with the user under `122` (wait `921`) and answered on 2026-10-02.

1. **Which copies to keep.** As recommended. Keep and pin only the per-render and per-pointer rules:
   presets, pills, list sections, Zen contents, the Habit fold, Plan triage, scope windows and drop
   targets. Move everything else.
2. **Optimistic updates.** As recommended. There are none, and every write reloads. A gesture gains
   a pinned optimistic copy only if it later feels slow.
3. **How copies are pinned.** As recommended. Hand-written JSON corpora, one per rule family,
   generated by neither side.
4. **The purity check.** As recommended. A CI step refuses `Db`, `SessionMode`, `sqlx`, `tauri`,
   `tokio` and `std::fs` in any rules module. Decision 8 extends it.
5. **A pure board derivation.** Yes, inside `122`.
6. **Sequence.** `122` → `a77` → `2bd`. `a77`'s crate split waits for `122`'s Rust moves, including
   the model separation.
7. **Amending `122`'s brief.** Yes. The amended text is in the plan, section 6.
8. **Database independence.** Decided differently from the recommendation: the domain and
   database models are separated (decision 8). This is its own phase, after the rules are extracted
   from persistence and before `a77`'s crate split.

Also decided: phases 3 to 7 stay inside `122`, with no follow-up Tasks.
