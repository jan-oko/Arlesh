-- Flows: templates for a Goal/Task subtree, materialized on demand (Phase 7).
--
-- A Flow has an Instance Type (what its root/children become), a parent (Aspect/Project/Domain/
-- Goal), an optional default Target Node, and a Duration-form flow scope (n + kind, relative —
-- anchored only when started). Flow items live in separate flow_goals / flow_tasks tables; they
-- form a subtree rooted at the flow (parent_type 'flow') and may nest. Cycle (scope, plan) pairs
-- and intra-flow dependencies come in a later migration.

CREATE TABLE flows (
    id                 INTEGER PRIMARY KEY,
    title              TEXT NOT NULL,
    instance_type      TEXT NOT NULL CHECK (instance_type IN ('goal', 'task')),
    parent_type        TEXT NOT NULL CHECK (parent_type IN ('aspect', 'project', 'domain', 'goal')),
    parent_id          INTEGER NOT NULL,
    target_type        TEXT,
    target_id          INTEGER,
    flow_duration_n    INTEGER,
    flow_duration_kind TEXT,
    position           INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE flow_goals (
    id             INTEGER PRIMARY KEY,
    flow_id        INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    title          TEXT NOT NULL,
    parent_type    TEXT NOT NULL CHECK (parent_type IN ('flow', 'flow_goal')),
    parent_id      INTEGER NOT NULL,
    status         TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'achieved', 'frozen', 'archived')),
    blocked_reason TEXT,
    position       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE flow_tasks (
    id             INTEGER PRIMARY KEY,
    flow_id        INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    title          TEXT NOT NULL,
    parent_type    TEXT NOT NULL CHECK (parent_type IN ('flow', 'flow_goal', 'flow_task')),
    parent_id      INTEGER NOT NULL,
    status         TEXT NOT NULL DEFAULT 'todo'
                       CHECK (status IN ('todo', 'in_progress', 'done')),
    blocked_reason TEXT,
    position       INTEGER NOT NULL DEFAULT 0
);
