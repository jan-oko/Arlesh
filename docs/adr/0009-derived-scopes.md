# Derived scopes: a scope is computed from its value key, never stored

A scope — Season, Month, Week, Day, Part of Day or Exact window — is **derived** from its value and
never written to the database. Every column that pointed at a scope row now holds the scope's
**value key**: a small discriminated-union JSON object such as `{"kind":"week","date":"2026-09-20"}`,
stored as its canonical text. That key is the scope's identity: a scope's `id` *is* its key, on the
wire and in every column. There is no scope table of any kind.

## Status

accepted (2026-09-24, `Arlesh-9o1`)

## Context

`scopes` held one row per calendar cell anything had ever touched, and every column of every row was
a pure function of `(kind, start_date)`: the label, the end date and the four containment columns
(`week_id`, `month_id`, `season_id`, `day_id`). Part-of-Day was no exception — its bands are
constants. The table was a materialised calendar, filled in lazily **as a side effect of reading**:
deriving a Habit's iterations minted a scope row per iteration window, so one read of one daily Habit
over 120 days inserted 503 rows, and 182 ms of a 215 ms cold Mindmap load was the app writing a
calendar. That write inside a read is what made the load contend for the write lock (`Arlesh-odd`),
made the MCP snapshot a write, and made `valid_targets` too dangerous to expose over MCP.

Nothing relational used the rows. No query joined `scopes`; every read was a by-id point lookup
handed to the pure resolver. The containment columns were written on every insert and read by
nothing: containment moved to interval arithmetic in ADR 0001. The seventeen foreign keys into the
table did identity work only.

Measured: deriving a Day window is 126 ns; selecting its row is 192 µs.

## Decision

1. **Canonical scopes are derived.** `Scope` is computed from a `ScopeKey` by arithmetic — label,
   start and end date, bounds. There is no cache: at 126 ns a lookup costs as much as recomputing,
   and a row cache populated inside a transaction that later rolls back would go on serving a scope
   that no longer exists. A derived value cannot be a phantom.
2. **The key is the value, as a discriminated union.** Every scope reference is a JSON object
   tagged by `kind`, a pure function of the scope, readable in a database dump and stable across
   restarts:

   | Kind        | Key                                                                   |
   |-------------|-----------------------------------------------------------------------|
   | Season      | `{"kind":"season","date":"2026-09-01"}` — the season's first day      |
   | Month       | `{"kind":"month","date":"2026-09-01"}` — the month's first day        |
   | Week        | `{"kind":"week","date":"2026-09-20"}` — the week's Sunday             |
   | Day         | `{"kind":"day","date":"2026-09-23"}`                                  |
   | Part of Day | `{"kind":"part_of_day","date":"2026-09-23","part":"morning"}` — the day it starts on, and the band |
   | Exact       | `{"kind":"exact","start":"2026-09-23T14:00:00","end":"2026-09-23T15:30:00"}` — half-open |

   The field names are the frontend's calendar-cell reference (`ScopeRef`) exactly, so on the client
   a key *is* a cell reference in canonical form. `date` rather than `start` for the canonical
   kinds, because for them the one date is the whole value; `start`/`end` only where there are two.

   A key always names the scope's **own start**: `{"kind":"week","date":"2026-09-23"}` is not a key,
   because the 23rd is a Wednesday. Deserialising refuses a non-canonical key rather than snapping
   it, and writing one refuses it too; snapping a date to the scope containing it is a separate,
   explicit constructor. An Exact window must end after it starts and carries whole seconds.
3. **One canonical text.** A key is stored, compared, grouped and hashed as its **canonical
   serialisation**: `kind` first, then the fields in the order above, no whitespace, dates as
   `YYYY-MM-DD` and datetimes as `YYYY-MM-DDTHH:MM:SS`. It is produced in one place in Rust — serde
   over the `ScopeKey` enum (`#[serde(tag = "kind")]`), whose field order is fixed by the type — and
   by one function in TypeScript (`scopeKeyText` in `src/utils/scope-key.ts`); the shared
   `conformance/scope-keys.json` holds both to the same bytes. Because every key is re-serialised
   from its parsed value on the way in, any spelling a caller sends is normalised before it is
   stored, so text equality in SQL is scope equality. Each column carries
   `CHECK (col IS NULL OR json_valid(col))`; no generated `kind` column, since nothing queries scope
   columns by kind — every read resolves the key in Rust.
4. **Exact windows are values too.** An exact window is its two datetimes, so it is keyed like every
   other kind and has no row. It loses the registry integrity a row gave it — a column can no
   longer name an exact window that "does not exist" and be refused for it — and that is
   acceptable because there is nothing left for a key to fail to exist *as*: the key is the whole
   window, and the checks that matter (it parses, it ends after it starts) run on every write. A
   registry would only have made each write that stores an exact key register it first, the one
   write a read must never do.
5. **Column names keep `_id`.** A scope's id is its key, so `time_scope_start_id` still names what it
   holds. Renaming seventeen columns, their triggers and their wire fields would have bought nothing
   but churn.
6. **The containment columns are dropped with the table.** Containment is derived from the value
   wherever it is wanted — a Day's Week is the week key of the Sunday on or before it.

## Considered options

- **Derive, and keep a backend LRU cache.** Rejected on measurement: the cache costs what it saves,
  and invalidating a row cache across a rolled-back transaction is a bug waiting to be written.
- **Keep a row for identity and derive only the fields.** Rejected: a read still has to mint an id
  before an overlay row can name an iteration, so either the read writes, or the wire carries a
  derived key while the column keeps an integer — two representations that must agree forever.
- **A synthetic id minted by a cache.** Rejected: it does not survive a restart, so no persisted
  column can hold it.
- **Keep Exact windows as rows in an `exact_scopes` registry,** with generated-column foreign keys
  from every scope column. Built first, then dropped by the user (2026-09-24): once the key is the
  window's own value, the row is a copy of it and the only thing it can enforce is that someone
  wrote the copy first.
- **A `(kind, start_date)` column pair per reference.** Rejected: it doubles seventeen columns and
  still needs a third for the band and two more for exact datetimes. One value covers every kind.
- **A flat string key (`week:2026-09-20`).** The first cut. Replaced by the JSON union (user,
  2026-09-24) so that a key has the same structured shape on the wire, in a column and in the
  frontend's cell reference, with no bespoke parser on either side.

## Consequences

- **No read writes.** Loading the Mindmap, the MCP snapshot and `valid_targets` perform no INSERT.
  `Arlesh-odd` loses its cause rather than being defended against. `ScopeOperator` goes entirely:
  nothing about a scope touches the database.
- **The calendar conventions are now code, not history.** Weeks start on Sunday, Winter is
  December–February and a Day runs 02:00 → 02:00; a stored row would have kept the old reading of a
  past window if any of those changed, and a derived scope reinterprets every past window at once.
  They are constants today, so nothing is lost. If the calendar ever becomes configurable, this
  decision has to be revisited: the key would need to carry the convention, or the convention would
  have to be versioned.
- **A week's label comes from its Sunday.** The week spanning New Year always reads `Week 53 YYYY`
  (or 54), where it used to depend on which of its days was touched first. That is the stable half
  of `Arlesh-8zf`; which number it *should* read stays deferred there.
- **The MCP surface resolves nothing.** A key names its dates, so a snapshot is readable without a
  round trip; `arlesh_scopes` stays for the bounds and the active flag, and `get` no longer touches
  the database.
- **A wide migration.** Seventeen columns across nine tables were rewritten from integer ids to keys
  (`0046`–`0047`), every journaled table among them had its undo triggers regenerated, and the
  undo journal was emptied, since its images name the old ids and it is session-scoped anyway.
- **The undo journal is emptied on upgrade** (accepted by the user): its images name the old ids.
- **Value keys are the foundation of `Arlesh-pnn`.** A derived node's UUID-v5 hashes the
  **canonical text** of its iteration's key — a date rather than a row id — so it is stable across
  restarts by construction.
