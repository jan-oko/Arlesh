# Database sessions: a factory, typed sessions, and per-resource operators

Repositories stop holding the connection pool. A **session factory** owns the pool at bootstrap and hands out a **session** that owns exactly one connection — `connect()` for a pooled session, `begin()` for a transactional one. The session exposes a **resource operator** per domain resource (goals, tasks, scopes, flows, …), each carrying the CRUD that lives on today's repository structs. Operators are temporaries borrowed from the session per call, never stored. The two session modes are distinguished by a zero-cost type marker, so an operation that requires atomicity says so in its signature and cannot be handed a pooled session.

## Status

accepted

## Context

Every multi-write operation in the backend was non-atomic. Only `block_reasons` opened a transaction; `start`, `fork_flow`, `convert_to_flow`, `set_iteration_done` and the subtree deletes all ran statement-by-statement against the pool. `convert_to_flow` deletes the original subtree after ~150 lines of inserts, so a failure part-way leaves both a partial template and a half-deleted subtree — with no test covering the path.

The cause is structural rather than local. A pool's contract is "give me *any* free connection", while a transaction is a claim on *one* connection: a `BEGIN` on one connection has no authority over writes sent to another. So atomicity requires the connection to be chosen once, at the operation's boundary, and passed down to every write beneath it. No arrangement in which each repository independently reaches into the pool can be atomic, which is why this could not be fixed one operation at a time.

## Considered options

- **Repositories store a connection instead of a pool.** The conventional repository shape. Rejected: a connection is exclusively borrowed, and `start` (`flows/mod.rs:1606-1608`) and `convert_to_flow` (`:1164-1166`) each keep three repositories alive and interleaved across ~150 lines. Both would need restructuring into take-turns blocks, the largest behavioural rewrite of any option and the highest risk of drift.
- **Share one connection behind a runtime guard.** Smallest diff by far — roughly 11 sites rather than 153 — and no restructuring. Rejected: overlapping use becomes a panic in front of the user instead of a compile error, discarding precisely the guarantee this change exists to buy.
- **Thread the executor through every method signature.** Either as a concrete connection or as a generic "anything a connection can be acquired from". Workable, but spreads sqlx's executor vocabulary — lifetimes, where-clauses, reborrows — across all 84 repository methods, and in the concrete form adds boilerplate to ~80 Tauri commands that never wanted a transaction.
- **A full database port** with query building and row mapping, leaving repositories storage-agnostic. Rejected on "one adapter is a hypothetical seam, two is a real one": there is one database and no plan for a second. The wide surface would also make the port a shallow module — an interface nearly as large as the sqlx it wraps.
- **Every session transactional, committed by a closure.** The factory runs the operation's body and commits on success. Strongest guarantee — the commit cannot be forgotten. Rejected: it nests ~80 command bodies, requires all seven domain error enums to absorb a database error, and puts an async closure holding a borrow across await points at the centre of the design, which is the least approachable code in the codebase when its lifetimes go wrong.

## Consequences

- Repositories become **stateless**. The exclusivity problem disappears because nothing holds a connection: `db.goals().create(…)` borrows the session for the duration of one call and releases it. `start`'s control flow is untouched — the three `let` bindings are deleted and each call site gains a prefix.
- Operators **must be used inline**. Two cannot be bound simultaneously. The compiler enforces this, but the resulting diagnostic ("cannot borrow as mutable more than once") is among Rust's least readable, and it will be met during the migration.
- Helpers that today accept a **single** repository keep that precision: `offset_scope`, `resolve_pair`, `habit_slots`, `resolve_window` and `resolve_flow_window` all take only `&ScopeRepository` today and take only the scopes operator afterwards. A helper needing **two** resources would have to take the session instead, since two operators cannot borrow it at once — none do today, and a helper that starts to is a signal to reconsider its shape.
- **Nested composite operations must join the caller's session, never open their own.** A composite operation takes a session; only the outermost caller decides the boundary. This is a standing rule, not something the type system enforces.
- `Db<Pooled>` and `Db<Transactional>` are distinct types. `commit()` exists only on the transactional one, and operations requiring atomicity demand it in their signature, so non-atomic use of `start` is a compile error rather than a silent correctness bug.
- A forgotten `commit()` still rolls back silently, since sqlx rolls back a dropped transaction. This is confined to composite operations — pooled sessions have nothing to commit — but it remains the sharpest edge of the design.
- All 11 repositories migrate in one pass, including the Phase 4 knowledge-base ones that have no composite operations today, so a single convention holds everywhere rather than two coexisting.
- This unblocks the atomicity requirements of the `retype_node` command and the `flows::materialize` renderer, both of which are otherwise unimplementable as single operations.
