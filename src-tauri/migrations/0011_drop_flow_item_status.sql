-- Drop `status` from flow items (Phase 7.4 follow-up).
--
-- A flow item is a template, not a live task/goal — a default status has no meaning, and
-- materialised instances start fresh (todo/active). Rebuild flow_goals / flow_tasks without the
-- status column. Nothing holds an inbound FK to these tables (cycles/dependencies/instance-nodes
-- reference items polymorphically, without row-level FKs), so a plain rebuild is safe.

PRAGMA defer_foreign_keys = ON;

CREATE TABLE flow_goals_new (
    id             INTEGER PRIMARY KEY,
    flow_id        INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    title          TEXT NOT NULL,
    parent_type    TEXT NOT NULL CHECK (parent_type IN ('flow', 'flow_goal')),
    parent_id      INTEGER NOT NULL,
    blocked_reason TEXT,
    position       INTEGER NOT NULL DEFAULT 0
);
INSERT INTO flow_goals_new (id, flow_id, title, parent_type, parent_id, blocked_reason, position)
    SELECT id, flow_id, title, parent_type, parent_id, blocked_reason, position FROM flow_goals;
DROP TABLE flow_goals;
ALTER TABLE flow_goals_new RENAME TO flow_goals;

CREATE TABLE flow_tasks_new (
    id             INTEGER PRIMARY KEY,
    flow_id        INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    title          TEXT NOT NULL,
    parent_type    TEXT NOT NULL CHECK (parent_type IN ('flow', 'flow_goal', 'flow_task')),
    parent_id      INTEGER NOT NULL,
    blocked_reason TEXT,
    position       INTEGER NOT NULL DEFAULT 0
);
INSERT INTO flow_tasks_new (id, flow_id, title, parent_type, parent_id, blocked_reason, position)
    SELECT id, flow_id, title, parent_type, parent_id, blocked_reason, position FROM flow_tasks;
DROP TABLE flow_tasks;
ALTER TABLE flow_tasks_new RENAME TO flow_tasks;
