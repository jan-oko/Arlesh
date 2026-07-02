-- Flow item cycles + intra-flow dependencies (Phase 7.3).
--
-- A flow item (flow_goal / flow_task) carries zero or more relative (Cycle Scope, Cycle Plan)
-- pairs. Each pair materialises a separate real item when the flow is started:
--   * Cycle Scope — the `scope_index`-th `scope_kind` subscope of the flow window
--     (1-based; NULL scope_kind = the whole flow scope).
--   * Cycle Plan  — a relative Plan within that cycle scope: the `plan_start`..`plan_end`
--     range of `plan_kind` subscopes (1-based, inclusive; NULL plan_kind = no plan).
-- Indices are stored raw here; they are resolved to concrete Time Scopes / Plans at start time
-- (Phase 7.4), so this migration adds no scope arithmetic.
--
-- Intra-flow dependencies link any two items in the same flow ("dependent waits on depends_on").
-- Both tables carry flow_id so they cascade-delete with the flow; per-item cleanup on item
-- deletion is done in the repository (the item link is polymorphic, so no row-level FK).

CREATE TABLE flow_item_cycles (
    id          INTEGER PRIMARY KEY,
    flow_id     INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    item_type   TEXT NOT NULL CHECK (item_type IN ('flow_goal', 'flow_task')),
    item_id     INTEGER NOT NULL,
    scope_kind  TEXT,
    scope_index INTEGER,
    plan_kind   TEXT,
    plan_start  INTEGER,
    plan_end    INTEGER,
    position    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_flow_item_cycles_item ON flow_item_cycles (item_type, item_id);

CREATE TABLE flow_dependencies (
    id              INTEGER PRIMARY KEY,
    flow_id         INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    dependent_type  TEXT NOT NULL CHECK (dependent_type IN ('flow_goal', 'flow_task')),
    dependent_id    INTEGER NOT NULL,
    depends_on_type TEXT NOT NULL CHECK (depends_on_type IN ('flow_goal', 'flow_task')),
    depends_on_id   INTEGER NOT NULL,
    UNIQUE (dependent_type, dependent_id, depends_on_type, depends_on_id)
);
