-- Asynchronous: whether doing a Task starts a wait rather than finishing something.
--
-- Send the email, order the part, kick off the build. Doing one of those first means the wait runs
-- while you work on everything else; leaving it to the end wastes the day. The flag is what lets
-- the List View float that work to the top of its run.
--
-- A plain boolean, NOT NULL DEFAULT 0 — deliberately unlike `agentic` (0031), which is a nullable
-- three-state column because it inherits. This one does **not** inherit, and the third state only
-- exists to carry an inherited value: "starts a wait" is a property of one concrete action, and a
-- subtask of an asynchronous Task is usually the work you do *after* the wait, so inheriting would
-- flag exactly the wrong rows. With nothing to inherit there is nothing for NULL to mean, and the
-- column says yes or no.
--
-- Tasks only, on the narrower version of 0031's reasoning: only a Task is *done*, and only doing it
-- starts a wait. A Goal is a desired state and a Commitment is kept rather than done, so neither
-- table gets this column.
--
-- Independent of Blockers and Dependencies, which model the wait itself — who or what is being
-- waited on, and what cannot start until it ends. This column says only that doing the Task begins
-- one.
--
-- The CHECK is what keeps the column a boolean rather than an integer with opinions.
ALTER TABLE tasks ADD COLUMN asynchronous INTEGER NOT NULL DEFAULT 0 CHECK (asynchronous IN (0, 1));

-- Regenerate the three undo-journal triggers on `tasks`, now that the column above exists.
--
-- A journal trigger names every column of its table by hand (0030), so a column added afterwards is
-- not in the row image, and undo restores it to whatever the *other* columns' image happened to
-- carry — silently, with no error and no missing entry to notice. `tests/undo_journal.rs`'s
-- `every_column_of_every_journaled_table_appears_in_its_triggers` compares every column against
-- every trigger and fails until this is done.
--
-- One file, where 0031 and 0032 were two. 0032 had to be separate because the triggers it replaced
-- were written in 0030, which runs *before* 0031: on a fresh database `tasks.agentic` does not yet
-- exist when 0030 runs, so a trigger written there cannot name it. Nothing like that applies here —
-- the ALTER above runs first, in this same file, and by the time the CREATE TRIGGER statements are
-- prepared the column is part of the schema. Regenerated triggers have to live after every column
-- they name; the file boundary is not what provides that, statement order is.
--
-- The other 69 triggers are untouched: their tables have not changed since 0030 and 0032 generated
-- them. Output taken straight from scripts/generate-undo-triggers.sh.
--
-- Each trigger is dropped before it is created, the same as in 0030 and 0032: a trigger cannot be
-- replaced in place, and DROP ... IF EXISTS keeps this migration re-runnable rather than failing on
-- a name that is already taken.

DROP TRIGGER IF EXISTS undo_journal_tasks_insert;
CREATE TRIGGER undo_journal_tasks_insert AFTER INSERT ON tasks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tasks', new.rowid, 'insert', NULL, json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'status', new.status, 'delegate_to', new.delegate_to, 'position', new.position, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'plan_start_id', new.plan_start_id, 'plan_end_id', new.plan_end_id, 'on_scope_exit', new.on_scope_exit, 'is_private', new.is_private, 'beads_id', new.beads_id, 'archival', new.archival, 'agentic', new.agentic, 'asynchronous', new.asynchronous), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_tasks_update;
CREATE TRIGGER undo_journal_tasks_update AFTER UPDATE ON tasks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tasks', new.rowid, 'update', json_object('id', old.id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'status', old.status, 'delegate_to', old.delegate_to, 'position', old.position, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind, 'plan_start_id', old.plan_start_id, 'plan_end_id', old.plan_end_id, 'on_scope_exit', old.on_scope_exit, 'is_private', old.is_private, 'beads_id', old.beads_id, 'archival', old.archival, 'agentic', old.agentic, 'asynchronous', old.asynchronous), json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'status', new.status, 'delegate_to', new.delegate_to, 'position', new.position, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'plan_start_id', new.plan_start_id, 'plan_end_id', new.plan_end_id, 'on_scope_exit', new.on_scope_exit, 'is_private', new.is_private, 'beads_id', new.beads_id, 'archival', new.archival, 'agentic', new.agentic, 'asynchronous', new.asynchronous), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_tasks_delete;
CREATE TRIGGER undo_journal_tasks_delete AFTER DELETE ON tasks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tasks', old.rowid, 'delete', json_object('id', old.id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'status', old.status, 'delegate_to', old.delegate_to, 'position', old.position, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind, 'plan_start_id', old.plan_start_id, 'plan_end_id', old.plan_end_id, 'on_scope_exit', old.on_scope_exit, 'is_private', old.is_private, 'beads_id', old.beads_id, 'archival', old.archival, 'agentic', old.agentic, 'asynchronous', old.asynchronous), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;
