-- Regenerate the undo-journal triggers for the two tables that gained a column after 0030.
--
-- A journal trigger names every column of its table by hand (0030), so a column added afterwards
-- is not in the row image. Undo then restores that column to whatever the *other* columns' image
-- happened to carry — silently, with no error and no missing entry to notice. Two columns were in
-- that state:
--
--   * `tasks.agentic`                         (0031) — insert, update and delete
--   * `habit_instance_modifications.cycle_id` (0029) — insert, update and delete
--
-- Both are dropped and recreated below with the full current column set, straight from
-- scripts/generate-undo-triggers.sh. The other 69 triggers are untouched: their tables have not
-- changed since 0030 generated them.
--
-- Why this is a separate migration and not an edit to 0030 — whose own header argues against
-- exactly this shape. Migrations run in number order, and 0030 runs *before* 0031. On a fresh
-- database `tasks.agentic` does not exist yet when 0030 runs, so a trigger written there cannot
-- name it: CREATE TRIGGER would fail on the unknown column and the database would never open.
-- That is a different case from the one 0030 rules out. It rejects a migration that only
-- re-issues what the migration before it could perfectly well have said; this one says what 0030
-- *cannot* say at the point it runs. Regenerated triggers have to live after every column they
-- name, which for `agentic` means after 0031, and `cycle_id` rides along rather than splitting one
-- regeneration across two files.
--
-- So: when you add a column to a journaled table, its `ALTER TABLE` is not the whole change. Add
-- a second migration after it holding the three regenerated triggers for that table — never edit
-- 0030, whose triggers are pinned to the schema as it stood at 0030. The guard in
-- tests/undo_journal.rs compares every column against every trigger and fails until you do.
--
-- Each trigger is dropped before it is created, the same as in 0030: a trigger cannot be replaced
-- in place, and DROP ... IF EXISTS keeps this migration re-runnable rather than failing on a name
-- that is already taken.

DROP TRIGGER IF EXISTS undo_journal_habit_instance_modifications_insert;
CREATE TRIGGER undo_journal_habit_instance_modifications_insert AFTER INSERT ON habit_instance_modifications BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'habit_instance_modifications', new.rowid, 'insert', NULL, json_object('id', new.id, 'flow_id', new.flow_id, 'item_type', new.item_type, 'item_id', new.item_id, 'iteration_scope_id', new.iteration_scope_id, 'cycle_id', new.cycle_id, 'status', new.status, 'title', new.title, 'blocked_reason', new.blocked_reason, 'tombstone_kind', new.tombstone_kind, 'resolved_at', new.resolved_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_habit_instance_modifications_update;
CREATE TRIGGER undo_journal_habit_instance_modifications_update AFTER UPDATE ON habit_instance_modifications BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'habit_instance_modifications', new.rowid, 'update', json_object('id', old.id, 'flow_id', old.flow_id, 'item_type', old.item_type, 'item_id', old.item_id, 'iteration_scope_id', old.iteration_scope_id, 'cycle_id', old.cycle_id, 'status', old.status, 'title', old.title, 'blocked_reason', old.blocked_reason, 'tombstone_kind', old.tombstone_kind, 'resolved_at', old.resolved_at), json_object('id', new.id, 'flow_id', new.flow_id, 'item_type', new.item_type, 'item_id', new.item_id, 'iteration_scope_id', new.iteration_scope_id, 'cycle_id', new.cycle_id, 'status', new.status, 'title', new.title, 'blocked_reason', new.blocked_reason, 'tombstone_kind', new.tombstone_kind, 'resolved_at', new.resolved_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_habit_instance_modifications_delete;
CREATE TRIGGER undo_journal_habit_instance_modifications_delete AFTER DELETE ON habit_instance_modifications BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'habit_instance_modifications', old.rowid, 'delete', json_object('id', old.id, 'flow_id', old.flow_id, 'item_type', old.item_type, 'item_id', old.item_id, 'iteration_scope_id', old.iteration_scope_id, 'cycle_id', old.cycle_id, 'status', old.status, 'title', old.title, 'blocked_reason', old.blocked_reason, 'tombstone_kind', old.tombstone_kind, 'resolved_at', old.resolved_at), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_tasks_insert;
CREATE TRIGGER undo_journal_tasks_insert AFTER INSERT ON tasks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tasks', new.rowid, 'insert', NULL, json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'status', new.status, 'delegate_to', new.delegate_to, 'position', new.position, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'plan_start_id', new.plan_start_id, 'plan_end_id', new.plan_end_id, 'on_scope_exit', new.on_scope_exit, 'is_private', new.is_private, 'beads_id', new.beads_id, 'archival', new.archival, 'agentic', new.agentic), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_tasks_update;
CREATE TRIGGER undo_journal_tasks_update AFTER UPDATE ON tasks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tasks', new.rowid, 'update', json_object('id', old.id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'status', old.status, 'delegate_to', old.delegate_to, 'position', old.position, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind, 'plan_start_id', old.plan_start_id, 'plan_end_id', old.plan_end_id, 'on_scope_exit', old.on_scope_exit, 'is_private', old.is_private, 'beads_id', old.beads_id, 'archival', old.archival, 'agentic', old.agentic), json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'status', new.status, 'delegate_to', new.delegate_to, 'position', new.position, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'plan_start_id', new.plan_start_id, 'plan_end_id', new.plan_end_id, 'on_scope_exit', new.on_scope_exit, 'is_private', new.is_private, 'beads_id', new.beads_id, 'archival', new.archival, 'agentic', new.agentic), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_tasks_delete;
CREATE TRIGGER undo_journal_tasks_delete AFTER DELETE ON tasks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tasks', old.rowid, 'delete', json_object('id', old.id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'status', old.status, 'delegate_to', old.delegate_to, 'position', old.position, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind, 'plan_start_id', old.plan_start_id, 'plan_end_id', old.plan_end_id, 'on_scope_exit', old.on_scope_exit, 'is_private', old.is_private, 'beads_id', old.beads_id, 'archival', old.archival, 'agentic', old.agentic), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;
