-- A Task's Plan becomes a boundaries window (start + end scope), like its Time Scope, so a task
-- can be planned across a span (e.g. W45–W49), not just a single scope. Migrate the old single
-- plan_scope_id to start_id = end_id = plan_scope_id.

PRAGMA defer_foreign_keys = ON;

ALTER TABLE tasks ADD COLUMN plan_start_id INTEGER REFERENCES scopes(id);
ALTER TABLE tasks ADD COLUMN plan_end_id   INTEGER REFERENCES scopes(id);

UPDATE tasks SET plan_start_id = plan_scope_id, plan_end_id = plan_scope_id
    WHERE plan_scope_id IS NOT NULL;

ALTER TABLE tasks DROP COLUMN plan_scope_id;
