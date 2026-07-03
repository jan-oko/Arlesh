-- Feature A: On-exit behavior for scoped Tasks and Goals.
-- Once an item's Time Scope has fully passed while still unfinished, it either drops from the
-- active view (archive -> derived Lapsed) or stays, flagged (keep -> derived Overdue). The value is
-- present iff the item is explicitly scoped; inherited-scope items inherit the ancestor's behavior.

ALTER TABLE tasks ADD COLUMN on_scope_exit TEXT
    CHECK (on_scope_exit IS NULL OR on_scope_exit IN ('archive', 'keep'));
ALTER TABLE goals ADD COLUMN on_scope_exit TEXT
    CHECK (on_scope_exit IS NULL OR on_scope_exit IN ('archive', 'keep'));

-- Backfill existing explicitly-scoped items to the current implicit behavior (Keep), preserving the
-- invariant "explicitly scoped <-> on-exit set".
UPDATE tasks SET on_scope_exit = 'keep' WHERE time_scope_start_id IS NOT NULL;
UPDATE goals SET on_scope_exit = 'keep' WHERE time_scope_start_id IS NOT NULL;
