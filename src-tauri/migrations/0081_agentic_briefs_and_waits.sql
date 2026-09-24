-- Agentic becomes an object (Arlesh-cz2). Settled with the user on 2026-09-24; see
-- docs/spec/resources.md, "Tasks" and "Expectations".
--
-- 1. **The flag is unchanged** (`tasks.agentic`, three-state, inherited). What is new is the
--    **brief**: the Task's own, never inherited, one row per Task that has one. Priority P0–P4
--    (stored 0–4), Spec, Design, Acceptance criteria and Notes. It is what an agent reads in place
--    of `bd show`, and Spec is what a Task that reads as Agentic must have before it can be
--    started. A separate table rather than columns, like `task_async_templates`: a Task without a
--    brief stores nothing, and the row goes with its Task.
-- 2. **An Expectation can be agentic**: a wait an *agent* raised on a Task it is working — "the
--    agent is waiting on you" — with an optional note carrying its question. Only a child of a
--    Task that reads as Agentic may be one; the write paths refuse anything else. Two columns on
--    `expectations`, which needs no rebuild; its journal triggers are regenerated to carry them.

CREATE TABLE task_agentic_briefs (
    task_id    INTEGER PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
    priority   INTEGER CHECK (priority IS NULL OR priority BETWEEN 0 AND 4),
    spec       TEXT NOT NULL DEFAULT '',
    design     TEXT NOT NULL DEFAULT '',
    acceptance TEXT NOT NULL DEFAULT '',
    notes      TEXT NOT NULL DEFAULT ''
);

ALTER TABLE expectations ADD COLUMN agentic INTEGER NOT NULL DEFAULT 0 CHECK (agentic IN (0, 1));
ALTER TABLE expectations ADD COLUMN agentic_note TEXT;

-- Undo-journal triggers, straight from scripts/generate-undo-triggers.sh
DROP TRIGGER IF EXISTS undo_journal_expectations_insert;
DROP TRIGGER IF EXISTS undo_journal_expectations_update;
DROP TRIGGER IF EXISTS undo_journal_expectations_delete;
CREATE TRIGGER undo_journal_expectations_insert AFTER INSERT ON expectations BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'expectations', new.rowid, 'insert', NULL, json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'status', new.status, 'archival', new.archival, 'position', new.position, 'is_private', new.is_private, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind, 'check_starting', new.check_starting, 'last_check_at', new.last_check_at, 'agentic', new.agentic, 'agentic_note', new.agentic_note), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_expectations_update AFTER UPDATE ON expectations BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'expectations', new.rowid, 'update', json_object('id', old.id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'status', old.status, 'archival', old.archival, 'position', old.position, 'is_private', old.is_private, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind, 'check_every_n', old.check_every_n, 'check_every_kind', old.check_every_kind, 'check_starting', old.check_starting, 'last_check_at', old.last_check_at, 'agentic', old.agentic, 'agentic_note', old.agentic_note), json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'status', new.status, 'archival', new.archival, 'position', new.position, 'is_private', new.is_private, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind, 'check_starting', new.check_starting, 'last_check_at', new.last_check_at, 'agentic', new.agentic, 'agentic_note', new.agentic_note), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_expectations_delete AFTER DELETE ON expectations BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'expectations', old.rowid, 'delete', json_object('id', old.id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'status', old.status, 'archival', old.archival, 'position', old.position, 'is_private', old.is_private, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind, 'check_every_n', old.check_every_n, 'check_every_kind', old.check_every_kind, 'check_starting', old.check_starting, 'last_check_at', old.last_check_at, 'agentic', old.agentic, 'agentic_note', old.agentic_note), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_task_agentic_briefs_insert AFTER INSERT ON task_agentic_briefs BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'task_agentic_briefs', new.rowid, 'insert', NULL, json_object('task_id', new.task_id, 'priority', new.priority, 'spec', new.spec, 'design', new.design, 'acceptance', new.acceptance, 'notes', new.notes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_task_agentic_briefs_update AFTER UPDATE ON task_agentic_briefs BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'task_agentic_briefs', new.rowid, 'update', json_object('task_id', old.task_id, 'priority', old.priority, 'spec', old.spec, 'design', old.design, 'acceptance', old.acceptance, 'notes', old.notes), json_object('task_id', new.task_id, 'priority', new.priority, 'spec', new.spec, 'design', new.design, 'acceptance', new.acceptance, 'notes', new.notes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_task_agentic_briefs_delete AFTER DELETE ON task_agentic_briefs BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'task_agentic_briefs', old.rowid, 'delete', json_object('task_id', old.task_id, 'priority', old.priority, 'spec', old.spec, 'design', old.design, 'acceptance', old.acceptance, 'notes', old.notes), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;
