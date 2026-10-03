-- Habits (Phase 8.1): a Habit is a Flow with a Recurrence. Its presence in flow_recurrences marks
-- the flow as a habit; deleting the row demotes it back to a plain flow. Instances are virtual —
-- rendered from the template per iteration — with only divergences persisted as Modification rows.

-- Recurrence = Repetition (Start anchor, optional Gap, optional end) + Consumption (a config tree).
-- One row per flow (PK flow_id). The Gap is the idle span between one iteration window's end and the
-- next's start; NULL gap_n = continuous tiling. NULL end_scope_id = open-ended.
CREATE TABLE flow_recurrences (
    flow_id          INTEGER PRIMARY KEY REFERENCES flows(id) ON DELETE CASCADE,
    start_scope_id   INTEGER NOT NULL REFERENCES scopes(id),
    gap_n            INTEGER,
    gap_kind         TEXT CHECK (gap_kind IN ('day', 'week', 'month', 'season')),
    end_scope_id     INTEGER REFERENCES scopes(id),
    consumption_kind TEXT NOT NULL CHECK (consumption_kind IN ('destructive', 'accumulating')),
    blocking_mode    TEXT CHECK (blocking_mode IN ('overlapping', 'blocking')),
    catchup_policy   TEXT CHECK (catchup_policy IN ('all_pending', 'next', 'latest')),
    -- Gap magnitude and kind travel together.
    CHECK ((gap_n IS NULL) = (gap_kind IS NULL)),
    -- Consumption tree: blocking_mode is set iff Accumulating; catch-up is set iff Blocking.
    CHECK ((consumption_kind = 'accumulating') = (blocking_mode IS NOT NULL)),
    CHECK (catchup_policy IS NULL OR blocking_mode = 'blocking'),
    CHECK (blocking_mode IS NOT 'blocking' OR catchup_policy IS NOT NULL)
);

-- A virtual instance's divergence from the template render, keyed by (flow item, iteration scope).
-- An absent row renders purely from the template. tombstone_kind: 'deleted' (by the user),
-- 'archived' (unfinished when its iteration passed), 'missed' (skipped by a latest-catch-up).
CREATE TABLE habit_instance_modifications (
    id                 INTEGER PRIMARY KEY,
    flow_id            INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    item_type          TEXT NOT NULL CHECK (item_type IN ('flow_goal', 'flow_task')),
    item_id            INTEGER NOT NULL,
    iteration_scope_id INTEGER NOT NULL REFERENCES scopes(id),
    status             TEXT,
    title              TEXT,
    blocked_reason     TEXT,
    tombstone_kind     TEXT CHECK (tombstone_kind IN ('deleted', 'archived', 'missed')),
    UNIQUE (item_type, item_id, iteration_scope_id)
);

-- Per-iteration dependency divergences: an edge added for this iteration (added = 1) or a template
-- edge suppressed for it (added = 0). Dependencies otherwise remap per iteration from the template.
CREATE TABLE habit_instance_dependencies (
    id                 INTEGER PRIMARY KEY,
    flow_id            INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    iteration_scope_id INTEGER NOT NULL REFERENCES scopes(id),
    dependent_type     TEXT NOT NULL CHECK (dependent_type IN ('flow_goal', 'flow_task')),
    dependent_id       INTEGER NOT NULL,
    depends_on_type    TEXT NOT NULL CHECK (depends_on_type IN ('flow_goal', 'flow_task')),
    depends_on_id      INTEGER NOT NULL,
    added              INTEGER NOT NULL CHECK (added IN (0, 1)),
    UNIQUE (iteration_scope_id, dependent_type, dependent_id, depends_on_type, depends_on_id)
);

CREATE INDEX idx_habit_mods_item ON habit_instance_modifications (item_type, item_id);
CREATE INDEX idx_habit_deps_flow ON habit_instance_dependencies (flow_id, iteration_scope_id);
