-- Habit clocks (Task #245, part 3 of #241): a Habit's Consumption tree is replaced by a **clock**.
--
-- - **Window** — iterations tile from the Start anchor as before, each with a **miss policy** for
--   the one that passes unfinished: `archive` (it lapses and archives; was Destructive), `owed` (it
--   stays open and comes due at its own window; was Accumulating + Overlapping) or `overdue` (it
--   archives as Missed, and the open iteration carries it, due at the first missed window; was
--   Accumulating + Blocking, whatever its catch-up policy).
-- - **Interval** — one open instance at a time; the next one's window starts the unit after the one
--   the last was completed in, plus the Gap. An Interval Habit's flow may be Unscoped.
--
-- Blocking and its catch-up policies are removed from the model: every row that had them becomes
-- Window + Overdue. Nothing else is rewritten — the overlays, relations and attached children of
-- every Habit stay exactly where they are, keyed as they were (docs/spec/habits.md, "Clocks").
--
-- A Habit occurrence's **due** is now its miss policy's to derive, and an explicit due set on one
-- lands in its overlay, stored as a Task's is (migration 0085): two scope keys, NULL for none,
-- where none means "the default its Habit derives".

CREATE TABLE flow_recurrences_new (
    flow_id                  INTEGER PRIMARY KEY REFERENCES flows(id) ON DELETE CASCADE,
    start_scope_id           TEXT NOT NULL,
    gap_n                    INTEGER,
    gap_kind                 TEXT CHECK (gap_kind IN ('day', 'week', 'month', 'season')),
    end_scope_id             TEXT,
    clock                    TEXT NOT NULL CHECK (clock IN ('window', 'interval')),
    miss_policy              TEXT CHECK (miss_policy IN ('archive', 'overdue', 'owed')),
    CHECK (start_scope_id IS NULL OR json_valid(start_scope_id)),
    CHECK (end_scope_id IS NULL OR json_valid(end_scope_id)),
    CHECK ((gap_n IS NULL) = (gap_kind IS NULL)),
    CHECK ((clock = 'window') = (miss_policy IS NOT NULL))
);

INSERT INTO flow_recurrences_new
    (flow_id, start_scope_id, gap_n, gap_kind, end_scope_id, clock, miss_policy)
SELECT flow_id,
       start_scope_id,
       gap_n,
       gap_kind,
       end_scope_id,
       'window',
       CASE
           WHEN consumption_kind = 'destructive' THEN 'archive'
           WHEN blocking_mode = 'overlapping' THEN 'owed'
           ELSE 'overdue'
       END
  FROM flow_recurrences;

-- Dropping the table drops its three undo triggers with it; they are rebuilt below.
DROP TABLE flow_recurrences;
ALTER TABLE flow_recurrences_new RENAME TO flow_recurrences;

ALTER TABLE task_overlays ADD COLUMN due_scope_start_id TEXT
    CHECK (due_scope_start_id IS NULL OR json_valid(due_scope_start_id));
ALTER TABLE task_overlays ADD COLUMN due_scope_end_id TEXT
    CHECK (due_scope_end_id IS NULL OR json_valid(due_scope_end_id));

-- The undo journal's images name every column, so the `task_overlays` triggers are rebuilt with
-- the two new ones, and the `flow_recurrences` ones with the clock in place of the Consumption.
DROP TRIGGER undo_journal_task_overlays_insert;
DROP TRIGGER undo_journal_task_overlays_update;
DROP TRIGGER undo_journal_task_overlays_delete;

CREATE TRIGGER undo_journal_flow_recurrences_insert AFTER INSERT ON flow_recurrences BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_recurrences', new.rowid, 'insert', NULL, json_object('flow_id', new.flow_id, 'start_scope_id', new.start_scope_id, 'gap_n', new.gap_n, 'gap_kind', new.gap_kind, 'end_scope_id', new.end_scope_id, 'clock', new.clock, 'miss_policy', new.miss_policy), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_recurrences_update AFTER UPDATE ON flow_recurrences BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_recurrences', new.rowid, 'update', json_object('flow_id', old.flow_id, 'start_scope_id', old.start_scope_id, 'gap_n', old.gap_n, 'gap_kind', old.gap_kind, 'end_scope_id', old.end_scope_id, 'clock', old.clock, 'miss_policy', old.miss_policy), json_object('flow_id', new.flow_id, 'start_scope_id', new.start_scope_id, 'gap_n', new.gap_n, 'gap_kind', new.gap_kind, 'end_scope_id', new.end_scope_id, 'clock', new.clock, 'miss_policy', new.miss_policy), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_recurrences_delete AFTER DELETE ON flow_recurrences BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_recurrences', old.rowid, 'delete', json_object('flow_id', old.flow_id, 'start_scope_id', old.start_scope_id, 'gap_n', old.gap_n, 'gap_kind', old.gap_kind, 'end_scope_id', old.end_scope_id, 'clock', old.clock, 'miss_policy', old.miss_policy), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_task_overlays_insert AFTER INSERT ON task_overlays BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'task_overlays', new.rowid, 'insert', NULL, json_object('id', new.id, 'origin', new.origin, 'flow_id', new.flow_id, 'item_type', new.item_type, 'item_id', new.item_id, 'iteration_scope', new.iteration_scope, 'cycle_id', new.cycle_id, 'wait_key', new.wait_key, 'due_at', new.due_at, 'status', new.status, 'resolved_at', new.resolved_at, 'tombstone', new.tombstone, 'title', new.title, 'plan_start_id', new.plan_start_id, 'plan_end_id', new.plan_end_id, 'plan_set', new.plan_set, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'delegate_set', new.delegate_set, 'agentic', new.agentic, 'agentic_set', new.agentic_set, 'asynchronous', new.asynchronous, 'archival', new.archival, 'is_private', new.is_private, 'beads_id', new.beads_id, 'beads_id_set', new.beads_id_set, 'position', new.position, 'block_reasons_set', new.block_reasons_set, 'brief_priority', new.brief_priority, 'brief_priority_set', new.brief_priority_set, 'brief_spec', new.brief_spec, 'brief_design', new.brief_design, 'brief_acceptance', new.brief_acceptance, 'brief_notes', new.brief_notes, 'due_scope_start_id', new.due_scope_start_id, 'due_scope_end_id', new.due_scope_end_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_task_overlays_update AFTER UPDATE ON task_overlays BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'task_overlays', new.rowid, 'update', json_object('id', old.id, 'origin', old.origin, 'flow_id', old.flow_id, 'item_type', old.item_type, 'item_id', old.item_id, 'iteration_scope', old.iteration_scope, 'cycle_id', old.cycle_id, 'wait_key', old.wait_key, 'due_at', old.due_at, 'status', old.status, 'resolved_at', old.resolved_at, 'tombstone', old.tombstone, 'title', old.title, 'plan_start_id', old.plan_start_id, 'plan_end_id', old.plan_end_id, 'plan_set', old.plan_set, 'delegate_kind', old.delegate_kind, 'delegate_id', old.delegate_id, 'delegate_set', old.delegate_set, 'agentic', old.agentic, 'agentic_set', old.agentic_set, 'asynchronous', old.asynchronous, 'archival', old.archival, 'is_private', old.is_private, 'beads_id', old.beads_id, 'beads_id_set', old.beads_id_set, 'position', old.position, 'block_reasons_set', old.block_reasons_set, 'brief_priority', old.brief_priority, 'brief_priority_set', old.brief_priority_set, 'brief_spec', old.brief_spec, 'brief_design', old.brief_design, 'brief_acceptance', old.brief_acceptance, 'brief_notes', old.brief_notes, 'due_scope_start_id', old.due_scope_start_id, 'due_scope_end_id', old.due_scope_end_id), json_object('id', new.id, 'origin', new.origin, 'flow_id', new.flow_id, 'item_type', new.item_type, 'item_id', new.item_id, 'iteration_scope', new.iteration_scope, 'cycle_id', new.cycle_id, 'wait_key', new.wait_key, 'due_at', new.due_at, 'status', new.status, 'resolved_at', new.resolved_at, 'tombstone', new.tombstone, 'title', new.title, 'plan_start_id', new.plan_start_id, 'plan_end_id', new.plan_end_id, 'plan_set', new.plan_set, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'delegate_set', new.delegate_set, 'agentic', new.agentic, 'agentic_set', new.agentic_set, 'asynchronous', new.asynchronous, 'archival', new.archival, 'is_private', new.is_private, 'beads_id', new.beads_id, 'beads_id_set', new.beads_id_set, 'position', new.position, 'block_reasons_set', new.block_reasons_set, 'brief_priority', new.brief_priority, 'brief_priority_set', new.brief_priority_set, 'brief_spec', new.brief_spec, 'brief_design', new.brief_design, 'brief_acceptance', new.brief_acceptance, 'brief_notes', new.brief_notes, 'due_scope_start_id', new.due_scope_start_id, 'due_scope_end_id', new.due_scope_end_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_task_overlays_delete AFTER DELETE ON task_overlays BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'task_overlays', old.rowid, 'delete', json_object('id', old.id, 'origin', old.origin, 'flow_id', old.flow_id, 'item_type', old.item_type, 'item_id', old.item_id, 'iteration_scope', old.iteration_scope, 'cycle_id', old.cycle_id, 'wait_key', old.wait_key, 'due_at', old.due_at, 'status', old.status, 'resolved_at', old.resolved_at, 'tombstone', old.tombstone, 'title', old.title, 'plan_start_id', old.plan_start_id, 'plan_end_id', old.plan_end_id, 'plan_set', old.plan_set, 'delegate_kind', old.delegate_kind, 'delegate_id', old.delegate_id, 'delegate_set', old.delegate_set, 'agentic', old.agentic, 'agentic_set', old.agentic_set, 'asynchronous', old.asynchronous, 'archival', old.archival, 'is_private', old.is_private, 'beads_id', old.beads_id, 'beads_id_set', old.beads_id_set, 'position', old.position, 'block_reasons_set', old.block_reasons_set, 'brief_priority', old.brief_priority, 'brief_priority_set', old.brief_priority_set, 'brief_spec', old.brief_spec, 'brief_design', old.brief_design, 'brief_acceptance', old.brief_acceptance, 'brief_notes', old.brief_notes, 'due_scope_start_id', old.due_scope_start_id, 'due_scope_end_id', old.due_scope_end_id), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;
