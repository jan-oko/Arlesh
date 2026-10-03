-- The flow ROOT is itself a virtual instance of a Habit iteration (not just an aggregate of its
-- items) — so its per-iteration status is stored the same way as an item's: a Modification row.
-- Widen item_type to allow the 'flow_root' sentinel (item_id carries the flow id, so root rows stay
-- unique per flow on a shared iteration scope). SQLite can't alter a CHECK, so rebuild the table.
CREATE TABLE habit_instance_modifications_new (
    id                 INTEGER PRIMARY KEY,
    flow_id            INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    item_type          TEXT NOT NULL CHECK (item_type IN ('flow_goal', 'flow_task', 'flow_root')),
    item_id            INTEGER NOT NULL,
    iteration_scope_id INTEGER NOT NULL REFERENCES scopes(id),
    status             TEXT,
    title              TEXT,
    blocked_reason     TEXT,
    tombstone_kind     TEXT CHECK (tombstone_kind IN ('deleted', 'archived', 'missed')),
    resolved_at        INTEGER,
    UNIQUE (item_type, item_id, iteration_scope_id)
);

INSERT INTO habit_instance_modifications_new
    (id, flow_id, item_type, item_id, iteration_scope_id, status, title, blocked_reason, tombstone_kind, resolved_at)
SELECT id, flow_id, item_type, item_id, iteration_scope_id, status, title, blocked_reason, tombstone_kind, resolved_at
FROM habit_instance_modifications;

DROP TABLE habit_instance_modifications;
ALTER TABLE habit_instance_modifications_new RENAME TO habit_instance_modifications;
CREATE INDEX idx_habit_mods_item ON habit_instance_modifications (item_type, item_id);
