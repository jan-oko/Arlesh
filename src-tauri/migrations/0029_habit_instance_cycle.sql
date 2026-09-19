-- A Habit instance is identified by its cycle pair as well as its item.
--
-- SPEC has always said "a flow item with N pairs produces N items", and `start` has always obeyed
-- it. A Habit's *virtual* instances did not: every iteration drew one node per flow item, whatever
-- its pair count. Now they do, which means `(item_type, item_id, iteration_scope_id)` no longer
-- names one instance — three morning/noon/evening pairs on one item are three separate things to
-- complete on the same day, and each needs its own Modification row.
--
-- So the Modification key gains the pair: `cycle_id`, the `flow_item_cycles` row the occurrence
-- came from. It is NOT NULL with a `0` sentinel for "this item has no pairs", rather than a
-- nullable column, because SQLite treats NULLs as distinct in a UNIQUE index — a nullable
-- `cycle_id` would let an unpaired item accumulate unlimited duplicate rows for one iteration and
-- would break every `ON CONFLICT` upsert that writes them. It carries no REFERENCES for the same
-- reason `item_id` never has: the sentinel points at no row, and the id it holds may belong to
-- either flow-item table.
--
-- Existing rows are remapped to the item's FIRST pair (lowest position), not to the sentinel: a
-- one-pair item — by far the common case — keeps every completion it had, because the single node
-- it used to draw is exactly the single node it still draws. An item with several pairs keeps its
-- history on the first occurrence and starts the rest empty, which is the honest answer: the
-- others were never separately completable before now.
--
-- SQLite cannot alter a UNIQUE constraint, so the table is rebuilt. `habit_instance_modifications`
-- is referenced by nothing, so the rebuild fires no cascades.
CREATE TABLE habit_instance_modifications_new (
    id                 INTEGER PRIMARY KEY,
    flow_id            INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    item_type          TEXT NOT NULL CHECK (item_type IN ('flow_goal', 'flow_task', 'flow_root')),
    item_id            INTEGER NOT NULL,
    iteration_scope_id INTEGER NOT NULL REFERENCES scopes(id),
    -- The cycle pair this occurrence came from; 0 when the item has none (and always, for the root).
    cycle_id           INTEGER NOT NULL DEFAULT 0,
    -- Free text, and deliberately so: it already held a task status or a goal status, and now
    -- holds a commitment's `kept`/`broken` verdict for one iteration as well.
    status             TEXT,
    title              TEXT,
    blocked_reason     TEXT,
    tombstone_kind     TEXT CHECK (tombstone_kind IN ('deleted', 'archived', 'missed')),
    resolved_at        INTEGER,
    UNIQUE (item_type, item_id, iteration_scope_id, cycle_id)
);

INSERT INTO habit_instance_modifications_new
    (id, flow_id, item_type, item_id, iteration_scope_id, cycle_id,
     status, title, blocked_reason, tombstone_kind, resolved_at)
SELECT m.id, m.flow_id, m.item_type, m.item_id, m.iteration_scope_id,
       COALESCE((
           SELECT c.id FROM flow_item_cycles c
           WHERE c.item_type = m.item_type AND c.item_id = m.item_id
           ORDER BY c.position, c.id LIMIT 1
       ), 0),
       m.status, m.title, m.blocked_reason, m.tombstone_kind, m.resolved_at
FROM habit_instance_modifications m;

DROP TABLE habit_instance_modifications;
ALTER TABLE habit_instance_modifications_new RENAME TO habit_instance_modifications;
CREATE INDEX idx_habit_mods_item ON habit_instance_modifications (item_type, item_id);
