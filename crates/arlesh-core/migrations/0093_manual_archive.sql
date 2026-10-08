-- **Manual archive** (Task 269, ruled with the user 2026-10-03).
--
-- A Task's stored Archival gains a third value: Live / Backlog / **Archived**, the three mutually
-- exclusive — one column, so a Task can never be both set aside and archived. Archiving writes
-- that Task alone; everything beneath it reads as archived through inheritance on every board
-- load, and unarchiving puts it back to Live with the subtree untouched.
--
-- A **Commitment** gains the same stored archive (`live` / `archived`), on top of the archival
-- its verdict and Verdict Window derive. Goals already archive through their status, and a
-- Habit occurrence through its tombstone, so neither table changes.
--
-- `tasks` is rebuilt to widen its CHECK — 0088's hazard and 0088's answer: its dependents are
-- copied aside and put back, the undo journal is suppressed while rows move, and each trigger is
-- recreated as it stood (the column set is unchanged, so the journal's images still fit).
-- `commitments` takes the column in place, and its undo triggers are recreated naming it.

UPDATE undo_context SET suppressed = 1 WHERE id = 1;

-- 1. Copy aside every row the drop of `tasks` would cascade away.
CREATE TABLE carry_tags_on_tasks AS SELECT task_id, tag_id FROM tags_on_tasks;
CREATE TABLE carry_task_knowledge_base_links AS SELECT task_id, entity_type, entity_id FROM task_knowledge_base_links;
CREATE TABLE carry_task_dependencies AS SELECT task_id, dependency_type, dependency_id FROM task_dependencies;
CREATE TABLE carry_task_async_templates AS SELECT task_id, title, time_scope_n, time_scope_kind, check_every_n, check_every_kind FROM task_async_templates;
CREATE TABLE carry_tags_on_async_templates AS SELECT task_id, tag_id FROM tags_on_async_templates;
CREATE TABLE carry_spawned_waits AS SELECT task_id, status, archival, last_check_at, released_at FROM spawned_waits;
CREATE TABLE carry_derived_dependencies AS SELECT id, flow_id, dependent_id, dependent_key, target_type, target_id, target_key, added FROM derived_dependencies;
CREATE TABLE carry_task_agentic_briefs AS SELECT task_id, priority, spec, design, acceptance, notes FROM task_agentic_briefs;

-- 2. Rebuild `tasks`, its Archival widened to the third value.
CREATE TABLE tasks_new (
    id                       INTEGER PRIMARY KEY,
    title                    TEXT NOT NULL,
    parent_type              TEXT NOT NULL
                                 CHECK (parent_type IN ('project', 'goal', 'domain', 'task', 'commitment')),
    parent_id                INTEGER NOT NULL,
    status                   TEXT NOT NULL DEFAULT 'todo'
                                 CHECK (status IN ('todo', 'in_progress', 'started', 'done', 'agentic_todo', 'on_agent', 'doing', 'agentic_done')),
    delegate_kind            TEXT CHECK (delegate_kind IN ('person')),
    delegate_id              INTEGER REFERENCES people(id),
    position                 INTEGER NOT NULL DEFAULT 0,
    time_scope_start_id      TEXT,
    time_scope_end_id        TEXT,
    time_scope_duration_n    INTEGER,
    time_scope_duration_kind TEXT,
    plan_start_id            TEXT,
    plan_end_id              TEXT,
    on_scope_exit            TEXT CHECK (on_scope_exit IS NULL OR on_scope_exit IN ('archive', 'keep')),
    is_private               BOOLEAN NOT NULL DEFAULT 0,
    archival                 TEXT NOT NULL DEFAULT 'live' CHECK (archival IN ('live', 'backlog', 'archived')),
    agentic                  INTEGER NULL CHECK (agentic IN (0, 1)),
    asynchronous             INTEGER NOT NULL DEFAULT 0 CHECK (asynchronous IN (0, 1)),
    done_at                  TEXT,
    due_scope_start_id       TEXT CHECK (due_scope_start_id IS NULL OR json_valid(due_scope_start_id)),
    due_scope_end_id         TEXT CHECK (due_scope_end_id IS NULL OR json_valid(due_scope_end_id)),
    compound                 INTEGER NOT NULL DEFAULT 0 CHECK (compound IN (0, 1)),
    CHECK (time_scope_start_id IS NULL OR json_valid(time_scope_start_id)),
    CHECK (time_scope_end_id IS NULL OR json_valid(time_scope_end_id)),
    CHECK (plan_start_id IS NULL OR json_valid(plan_start_id)),
    CHECK (plan_end_id IS NULL OR json_valid(plan_end_id)),
    CHECK (
        (delegate_kind IS NULL     AND delegate_id IS NULL)
     OR (delegate_kind = 'person'  AND delegate_id IS NOT NULL)
    )
)
;
INSERT INTO tasks_new (id, title, parent_type, parent_id, status, delegate_kind, delegate_id, position, time_scope_start_id, time_scope_end_id, time_scope_duration_n, time_scope_duration_kind, plan_start_id, plan_end_id, on_scope_exit, is_private, archival, agentic, asynchronous, done_at, due_scope_start_id, due_scope_end_id, compound)
SELECT id, title, parent_type, parent_id, status, delegate_kind, delegate_id, position, time_scope_start_id, time_scope_end_id, time_scope_duration_n, time_scope_duration_kind, plan_start_id, plan_end_id, on_scope_exit, is_private, archival, agentic, asynchronous, done_at, due_scope_start_id, due_scope_end_id, compound FROM tasks;
DROP TABLE tasks;
ALTER TABLE tasks_new RENAME TO tasks;

CREATE TRIGGER undo_journal_tasks_insert AFTER INSERT ON tasks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tasks', new.rowid, 'insert', NULL, json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'status', new.status, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'position', new.position, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'plan_start_id', new.plan_start_id, 'plan_end_id', new.plan_end_id, 'on_scope_exit', new.on_scope_exit, 'is_private', new.is_private, 'archival', new.archival, 'agentic', new.agentic, 'asynchronous', new.asynchronous, 'done_at', new.done_at, 'due_scope_start_id', new.due_scope_start_id, 'due_scope_end_id', new.due_scope_end_id, 'compound', new.compound), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END
;

CREATE TRIGGER undo_journal_tasks_update AFTER UPDATE ON tasks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tasks', new.rowid, 'update', json_object('id', old.id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'status', old.status, 'delegate_kind', old.delegate_kind, 'delegate_id', old.delegate_id, 'position', old.position, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind, 'plan_start_id', old.plan_start_id, 'plan_end_id', old.plan_end_id, 'on_scope_exit', old.on_scope_exit, 'is_private', old.is_private, 'archival', old.archival, 'agentic', old.agentic, 'asynchronous', old.asynchronous, 'done_at', old.done_at, 'due_scope_start_id', old.due_scope_start_id, 'due_scope_end_id', old.due_scope_end_id, 'compound', old.compound), json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'status', new.status, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'position', new.position, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'plan_start_id', new.plan_start_id, 'plan_end_id', new.plan_end_id, 'on_scope_exit', new.on_scope_exit, 'is_private', new.is_private, 'archival', new.archival, 'agentic', new.agentic, 'asynchronous', new.asynchronous, 'done_at', new.done_at, 'due_scope_start_id', new.due_scope_start_id, 'due_scope_end_id', new.due_scope_end_id, 'compound', new.compound), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END
;

CREATE TRIGGER undo_journal_tasks_delete AFTER DELETE ON tasks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tasks', old.rowid, 'delete', json_object('id', old.id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'status', old.status, 'delegate_kind', old.delegate_kind, 'delegate_id', old.delegate_id, 'position', old.position, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind, 'plan_start_id', old.plan_start_id, 'plan_end_id', old.plan_end_id, 'on_scope_exit', old.on_scope_exit, 'is_private', old.is_private, 'archival', old.archival, 'agentic', old.agentic, 'asynchronous', old.asynchronous, 'done_at', old.done_at, 'due_scope_start_id', old.due_scope_start_id, 'due_scope_end_id', old.due_scope_end_id, 'compound', old.compound), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END
;

CREATE TRIGGER mcp_roots_forget_task AFTER DELETE ON tasks
WHEN (SELECT suppressed FROM undo_context WHERE id = 1) = 0 BEGIN
    DELETE FROM mcp_roots WHERE node_kind = 'task' AND node_id = old.id;
END
;

-- 3. Put the dependents' rows back. `task_async_templates` before its tags, since clearing it
--    cascades to them.

DELETE FROM tags_on_tasks;
INSERT INTO tags_on_tasks (task_id, tag_id) SELECT task_id, tag_id FROM carry_tags_on_tasks;
DROP TABLE carry_tags_on_tasks;
DELETE FROM task_knowledge_base_links;
INSERT INTO task_knowledge_base_links (task_id, entity_type, entity_id) SELECT task_id, entity_type, entity_id FROM carry_task_knowledge_base_links;
DROP TABLE carry_task_knowledge_base_links;
DELETE FROM task_dependencies;
INSERT INTO task_dependencies (task_id, dependency_type, dependency_id) SELECT task_id, dependency_type, dependency_id FROM carry_task_dependencies;
DROP TABLE carry_task_dependencies;
DELETE FROM task_async_templates;
INSERT INTO task_async_templates (task_id, title, time_scope_n, time_scope_kind, check_every_n, check_every_kind) SELECT task_id, title, time_scope_n, time_scope_kind, check_every_n, check_every_kind FROM carry_task_async_templates;
DROP TABLE carry_task_async_templates;
DELETE FROM tags_on_async_templates;
INSERT INTO tags_on_async_templates (task_id, tag_id) SELECT task_id, tag_id FROM carry_tags_on_async_templates;
DROP TABLE carry_tags_on_async_templates;
DELETE FROM spawned_waits;
INSERT INTO spawned_waits (task_id, status, archival, last_check_at, released_at) SELECT task_id, status, archival, last_check_at, released_at FROM carry_spawned_waits;
DROP TABLE carry_spawned_waits;
DELETE FROM derived_dependencies;
INSERT INTO derived_dependencies (id, flow_id, dependent_id, dependent_key, target_type, target_id, target_key, added) SELECT id, flow_id, dependent_id, dependent_key, target_type, target_id, target_key, added FROM carry_derived_dependencies;
DROP TABLE carry_derived_dependencies;
DELETE FROM task_agentic_briefs;
INSERT INTO task_agentic_briefs (task_id, priority, spec, design, acceptance, notes) SELECT task_id, priority, spec, design, acceptance, notes FROM carry_task_agentic_briefs;
DROP TABLE carry_task_agentic_briefs;

-- 4. A Commitment's own archive, and its undo triggers recreated naming it.

ALTER TABLE commitments ADD COLUMN archival TEXT NOT NULL DEFAULT 'live'
    CHECK (archival IN ('live', 'archived'));

DROP TRIGGER undo_journal_commitments_insert;
DROP TRIGGER undo_journal_commitments_update;
DROP TRIGGER undo_journal_commitments_delete;

CREATE TRIGGER undo_journal_commitments_insert AFTER INSERT ON commitments BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'commitments', new.rowid, 'insert', NULL, json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'verdict', new.verdict, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'verdict_window_n', new.verdict_window_n, 'verdict_window_kind', new.verdict_window_kind, 'position', new.position, 'is_private', new.is_private, 'verdict_at', new.verdict_at, 'archival', new.archival), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END
;

CREATE TRIGGER undo_journal_commitments_update AFTER UPDATE ON commitments BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'commitments', new.rowid, 'update', json_object('id', old.id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'verdict', old.verdict, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind, 'verdict_window_n', old.verdict_window_n, 'verdict_window_kind', old.verdict_window_kind, 'position', old.position, 'is_private', old.is_private, 'verdict_at', old.verdict_at, 'archival', old.archival), json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'verdict', new.verdict, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'verdict_window_n', new.verdict_window_n, 'verdict_window_kind', new.verdict_window_kind, 'position', new.position, 'is_private', new.is_private, 'verdict_at', new.verdict_at, 'archival', new.archival), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END
;

CREATE TRIGGER undo_journal_commitments_delete AFTER DELETE ON commitments BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'commitments', old.rowid, 'delete', json_object('id', old.id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'verdict', old.verdict, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind, 'verdict_window_n', old.verdict_window_n, 'verdict_window_kind', old.verdict_window_kind, 'position', old.position, 'is_private', old.is_private, 'verdict_at', old.verdict_at, 'archival', old.archival), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END
;

UPDATE undo_context SET suppressed = 0 WHERE id = 1;
