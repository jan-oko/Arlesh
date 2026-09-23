# Derived scopes: a canonical scope is computed from its value key, never stored

A canonical scope (Season, Month, Week, Day, Part of Day) is **derived** from its value — its kind
and start date, and for a Part of Day its band — and is never written to the database. Every column
that pointed at a scope row now holds the scope's **value key**, a canonical string such as
`week:2026-09-20`. That key is the scope's identity: a scope's `id` *is* its key, on the wire and in
every column. Exact scopes, the one kind that is real data rather than calendar, stay rows in
`exact_scopes`, keyed by the same kind of value key, and every column that can hold one carries a
foreign key into that table.

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
2. **The key is the value.** Every scope reference is a canonical string, a pure function of the
   scope, readable in a database dump and stable across restarts:

   | Kind        | Key                                               |
   |-------------|---------------------------------------------------|
   | Season      | `season:2026-09-01` — the season's first day      |
   | Month       | `month:2026-09-01` — the month's first day        |
   | Week        | `week:2026-09-20` — the week's Sunday             |
   | Day         | `day:2026-09-23`                                  |
   | Part of Day | `part_of_day:2026-09-23:morning` — the day it starts on, and the band |
   | Exact       | `exact:2026-09-23T14:00:00/2026-09-23T15:30:00` — start and end, half-open |

   A key always names the scope's **own start**: `week:2026-09-23` is not a key, because the 23rd is
   a Wednesday. Parsing refuses a non-canonical key rather than snapping it, so two equal scopes can
   never be spelled two ways and string equality is scope equality. Snapping a date to the scope
   containing it is a separate, explicit constructor.
3. **Exact scopes stay rows.** An exact window is data the user chose, so it keeps referential
   integrity: `exact_scopes` holds one row per exact window, keyed by its value key, and every column
   that can hold a scope key has a `VIRTUAL` generated companion that is the key when it is exact and
   NULL otherwise, with a foreign key into `exact_scopes`. A canonical key is valid by construction
   and needs no row. The row is registered by the write that first stores the key — the Scope
   Picker's exact selection, a started Flow's exact window, an overlay row on an exact Habit
   iteration — and never by a read: a Habit's exact iteration windows are derived from the key
   exactly as its canonical ones are.
4. **Column names keep `_id`.** A scope's id is its key, so `time_scope_start_id` still names what it
   holds. Renaming seventeen columns, their triggers and their wire fields would have bought nothing
   but churn.
5. **The containment columns are dropped with the table.** Containment is derived from the value
   wherever it is wanted — a Day's Week is `week:` of the Sunday on or before it.

## Considered options

- **Derive, and keep a backend LRU cache.** Rejected on measurement: the cache costs what it saves,
  and invalidating a row cache across a rolled-back transaction is a bug waiting to be written.
- **Keep a row for identity and derive only the fields.** Rejected: a read still has to mint an id
  before an overlay row can name an iteration, so either the read writes, or the wire carries a
  derived key while the column keeps an integer — two representations that must agree forever.
- **A synthetic id minted by a cache.** Rejected: it does not survive a restart, so no persisted
  column can hold it.
- **Value-key the exact kind too, with no table.** Tenable — the key already is the two datetimes —
  but rejected by the user (2026-09-23): the one kind that is real data keeps its referential
  integrity.
- **A `(kind, start_date)` column pair per reference.** Rejected: it doubles seventeen columns and
  still needs a third for the band and two more for exact datetimes. One string covers every kind.

## Consequences

- **No read writes.** Loading the Mindmap, the MCP snapshot and `valid_targets` perform no INSERT.
  `Arlesh-odd` loses its cause rather than being defended against. `ScopeOperator` loses
  `get_or_create` and its containment recursion, and keeps only what touches `exact_scopes`.
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
  (`0046`–`0048`), every journaled table among them had its undo triggers regenerated, and the
  undo journal was emptied, since its images name the old ids and it is session-scoped anyway.
- **Value keys are the foundation of `Arlesh-pnn`.** A derived node's UUID-v5 hashes its
  iteration's start date, which the iteration's key carries, rather than a row id — so it is stable
  across restarts by construction.
