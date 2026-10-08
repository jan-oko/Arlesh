-- Drop `blocked_reason` from flow items (Phase 7.4 follow-up).
--
-- Like status, a block reason is runtime state of a live task/goal — a template step is never
-- "blocked waiting on X". Rebuild flow_goals / flow_tasks without it. Nothing holds an inbound FK
-- to these tables, so a plain rebuild is safe.

PRAGMA defer_foreign_keys = ON;

CREATE TABLE flow_goals_new (
    id          INTEGER PRIMARY KEY,
    flow_id     INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    parent_type TEXT NOT NULL CHECK (parent_type IN ('flow', 'flow_goal')),
    parent_id   INTEGER NOT NULL,
    position    INTEGER NOT NULL DEFAULT 0
);
INSERT INTO flow_goals_new (id, flow_id, title, parent_type, parent_id, position)
    SELECT id, flow_id, title, parent_type, parent_id, position FROM flow_goals;
DROP TABLE flow_goals;
ALTER TABLE flow_goals_new RENAME TO flow_goals;

CREATE TABLE flow_tasks_new (
    id          INTEGER PRIMARY KEY,
    flow_id     INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    parent_type TEXT NOT NULL CHECK (parent_type IN ('flow', 'flow_goal', 'flow_task')),
    parent_id   INTEGER NOT NULL,
    position    INTEGER NOT NULL DEFAULT 0
);
INSERT INTO flow_tasks_new (id, flow_id, title, parent_type, parent_id, position)
    SELECT id, flow_id, title, parent_type, parent_id, position FROM flow_tasks;
DROP TABLE flow_tasks;
ALTER TABLE flow_tasks_new RENAME TO flow_tasks;
