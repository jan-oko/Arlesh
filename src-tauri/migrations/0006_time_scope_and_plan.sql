-- Split a task/goal's single scope_id into a Time Scope (relevance window) and, for tasks
-- only, a Plan (the scope it is scheduled into).
--
-- A Time Scope is stored as a resolved boundaries window (start/end scope ids; equal ids mean
-- a single scope). When it originated from the Duration form, its parameters are also kept
-- (duration_n + duration_kind) so the UI can stay duration-shaped after snapshotting.
--
-- The former scope_id becomes the Time Scope: migrate it to start_id = end_id = scope_id.

PRAGMA defer_foreign_keys = ON;

ALTER TABLE tasks ADD COLUMN time_scope_start_id      INTEGER REFERENCES scopes(id);
ALTER TABLE tasks ADD COLUMN time_scope_end_id        INTEGER REFERENCES scopes(id);
ALTER TABLE tasks ADD COLUMN time_scope_duration_n    INTEGER;
ALTER TABLE tasks ADD COLUMN time_scope_duration_kind TEXT;
ALTER TABLE tasks ADD COLUMN plan_scope_id            INTEGER REFERENCES scopes(id);

UPDATE tasks SET time_scope_start_id = scope_id, time_scope_end_id = scope_id
    WHERE scope_id IS NOT NULL;

ALTER TABLE tasks DROP COLUMN scope_id;

ALTER TABLE goals ADD COLUMN time_scope_start_id      INTEGER REFERENCES scopes(id);
ALTER TABLE goals ADD COLUMN time_scope_end_id        INTEGER REFERENCES scopes(id);
ALTER TABLE goals ADD COLUMN time_scope_duration_n    INTEGER;
ALTER TABLE goals ADD COLUMN time_scope_duration_kind TEXT;

UPDATE goals SET time_scope_start_id = scope_id, time_scope_end_id = scope_id
    WHERE scope_id IS NOT NULL;

ALTER TABLE goals DROP COLUMN scope_id;
