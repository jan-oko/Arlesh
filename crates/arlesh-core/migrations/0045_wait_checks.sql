-- One row per completed check on a wait. Ruled by the user on 2026-09-23: a completed check stays
-- on the board as a done task, so each completion has to be stored, not just the time of the last.
--
-- `wait_kind` says which kind of wait the check belongs to — a stored Expectation (`wait_id` is
-- its id) or the wait an Asynchronous Task spawned (`wait_id` is the Task's id). There is no
-- foreign key for the same reason `task_dependencies` has none: the parent is polymorphic. The
-- rows are deleted with their wait by the delete paths in code.
--
-- `due_at` is when the check fell due, which names it; `resolved_at` when it was completed. The
-- next check is due one Check every after the latest `resolved_at`, so un-completing the latest
-- check — deleting its row — brings it back as the one due, and undo/redo is the journal's
-- ordinary insert and delete.
--
-- `expectations.last_check_at` and `spawned_waits.last_check_at` (0044) are superseded: each
-- recorded check is carried over as one row, due and resolved at that time, and the columns are
-- then left unread until the next rebuild of either table.

CREATE TABLE wait_checks (
    id          INTEGER PRIMARY KEY,
    wait_kind   TEXT NOT NULL CHECK (wait_kind IN ('stored', 'spawned')),
    wait_id     INTEGER NOT NULL,
    due_at      TEXT NOT NULL,
    resolved_at TEXT NOT NULL,
    UNIQUE (wait_kind, wait_id, due_at)
);

INSERT INTO wait_checks (wait_kind, wait_id, due_at, resolved_at)
    SELECT 'stored', id, last_check_at, last_check_at FROM expectations WHERE last_check_at IS NOT NULL;
INSERT INTO wait_checks (wait_kind, wait_id, due_at, resolved_at)
    SELECT 'spawned', task_id, last_check_at, last_check_at FROM spawned_waits WHERE last_check_at IS NOT NULL;
UPDATE expectations SET last_check_at = NULL;
UPDATE spawned_waits SET last_check_at = NULL;

-- Undo-journal triggers, straight from scripts/generate-undo-triggers.sh
DROP TRIGGER IF EXISTS undo_journal_wait_checks_insert;
CREATE TRIGGER undo_journal_wait_checks_insert AFTER INSERT ON wait_checks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'wait_checks', new.rowid, 'insert', NULL, json_object('id', new.id, 'wait_kind', new.wait_kind, 'wait_id', new.wait_id, 'due_at', new.due_at, 'resolved_at', new.resolved_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_wait_checks_update;
CREATE TRIGGER undo_journal_wait_checks_update AFTER UPDATE ON wait_checks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'wait_checks', new.rowid, 'update', json_object('id', old.id, 'wait_kind', old.wait_kind, 'wait_id', old.wait_id, 'due_at', old.due_at, 'resolved_at', old.resolved_at), json_object('id', new.id, 'wait_kind', new.wait_kind, 'wait_id', new.wait_id, 'due_at', new.due_at, 'resolved_at', new.resolved_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_wait_checks_delete;
CREATE TRIGGER undo_journal_wait_checks_delete AFTER DELETE ON wait_checks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'wait_checks', old.rowid, 'delete', json_object('id', old.id, 'wait_kind', old.wait_kind, 'wait_id', old.wait_id, 'due_at', old.due_at, 'resolved_at', old.resolved_at), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;
