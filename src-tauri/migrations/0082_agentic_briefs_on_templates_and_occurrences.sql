-- The agentic brief through templates and occurrences (Arlesh-cz2 on top of Arlesh-pnn).
--
-- A template carries its kind's full schema (0061), so a Task template carries a brief too: every
-- occurrence reads its template's brief, field by field, until its overlay says otherwise. Plain
-- Flows copy it onto the Tasks their `start` makes, as they copy the other fields.
--
-- * `template_agentic_briefs`: one per Task template that has one — a flow task item, or the root
--   of a task-instance flow (`flow`, the flow's id), as `template_tags` keys its rows.
-- * `task_overlays` gains one column per brief field. NULL inherits the template's; a text field
--   set to '' is overridden to empty. Priority's NULL is itself a value (no priority), so
--   `brief_priority_set` says "overridden".

CREATE TABLE template_agentic_briefs (
    id         INTEGER PRIMARY KEY,
    item_type  TEXT NOT NULL CHECK (item_type IN ('flow', 'flow_task')),
    item_id    INTEGER NOT NULL,
    priority   INTEGER CHECK (priority IS NULL OR priority BETWEEN 0 AND 4),
    spec       TEXT NOT NULL DEFAULT '',
    design     TEXT NOT NULL DEFAULT '',
    acceptance TEXT NOT NULL DEFAULT '',
    notes      TEXT NOT NULL DEFAULT '',
    UNIQUE (item_type, item_id)
);

ALTER TABLE task_overlays ADD COLUMN brief_priority INTEGER
    CHECK (brief_priority IS NULL OR brief_priority BETWEEN 0 AND 4);
ALTER TABLE task_overlays ADD COLUMN brief_priority_set INTEGER NOT NULL DEFAULT 0
    CHECK (brief_priority_set IN (0, 1));
ALTER TABLE task_overlays ADD COLUMN brief_spec TEXT;
ALTER TABLE task_overlays ADD COLUMN brief_design TEXT;
ALTER TABLE task_overlays ADD COLUMN brief_acceptance TEXT;
ALTER TABLE task_overlays ADD COLUMN brief_notes TEXT;

-- Undo-journal triggers, straight from scripts/generate-undo-triggers.sh
DROP TRIGGER IF EXISTS undo_journal_task_overlays_insert;
DROP TRIGGER IF EXISTS undo_journal_task_overlays_update;
DROP TRIGGER IF EXISTS undo_journal_task_overlays_delete;
CREATE TRIGGER undo_journal_task_overlays_insert AFTER INSERT ON task_overlays BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'task_overlays', new.rowid, 'insert', NULL, json_object('id', new.id, 'origin', new.origin, 'flow_id', new.flow_id, 'item_type', new.item_type, 'item_id', new.item_id, 'iteration_scope', new.iteration_scope, 'cycle_id', new.cycle_id, 'wait_key', new.wait_key, 'due_at', new.due_at, 'status', new.status, 'resolved_at', new.resolved_at, 'tombstone', new.tombstone, 'title', new.title, 'plan_start_id', new.plan_start_id, 'plan_end_id', new.plan_end_id, 'plan_set', new.plan_set, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'delegate_set', new.delegate_set, 'agentic', new.agentic, 'agentic_set', new.agentic_set, 'asynchronous', new.asynchronous, 'archival', new.archival, 'is_private', new.is_private, 'beads_id', new.beads_id, 'beads_id_set', new.beads_id_set, 'position', new.position, 'block_reasons_set', new.block_reasons_set, 'brief_priority', new.brief_priority, 'brief_priority_set', new.brief_priority_set, 'brief_spec', new.brief_spec, 'brief_design', new.brief_design, 'brief_acceptance', new.brief_acceptance, 'brief_notes', new.brief_notes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_task_overlays_update AFTER UPDATE ON task_overlays BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'task_overlays', new.rowid, 'update', json_object('id', old.id, 'origin', old.origin, 'flow_id', old.flow_id, 'item_type', old.item_type, 'item_id', old.item_id, 'iteration_scope', old.iteration_scope, 'cycle_id', old.cycle_id, 'wait_key', old.wait_key, 'due_at', old.due_at, 'status', old.status, 'resolved_at', old.resolved_at, 'tombstone', old.tombstone, 'title', old.title, 'plan_start_id', old.plan_start_id, 'plan_end_id', old.plan_end_id, 'plan_set', old.plan_set, 'delegate_kind', old.delegate_kind, 'delegate_id', old.delegate_id, 'delegate_set', old.delegate_set, 'agentic', old.agentic, 'agentic_set', old.agentic_set, 'asynchronous', old.asynchronous, 'archival', old.archival, 'is_private', old.is_private, 'beads_id', old.beads_id, 'beads_id_set', old.beads_id_set, 'position', old.position, 'block_reasons_set', old.block_reasons_set, 'brief_priority', old.brief_priority, 'brief_priority_set', old.brief_priority_set, 'brief_spec', old.brief_spec, 'brief_design', old.brief_design, 'brief_acceptance', old.brief_acceptance, 'brief_notes', old.brief_notes), json_object('id', new.id, 'origin', new.origin, 'flow_id', new.flow_id, 'item_type', new.item_type, 'item_id', new.item_id, 'iteration_scope', new.iteration_scope, 'cycle_id', new.cycle_id, 'wait_key', new.wait_key, 'due_at', new.due_at, 'status', new.status, 'resolved_at', new.resolved_at, 'tombstone', new.tombstone, 'title', new.title, 'plan_start_id', new.plan_start_id, 'plan_end_id', new.plan_end_id, 'plan_set', new.plan_set, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'delegate_set', new.delegate_set, 'agentic', new.agentic, 'agentic_set', new.agentic_set, 'asynchronous', new.asynchronous, 'archival', new.archival, 'is_private', new.is_private, 'beads_id', new.beads_id, 'beads_id_set', new.beads_id_set, 'position', new.position, 'block_reasons_set', new.block_reasons_set, 'brief_priority', new.brief_priority, 'brief_priority_set', new.brief_priority_set, 'brief_spec', new.brief_spec, 'brief_design', new.brief_design, 'brief_acceptance', new.brief_acceptance, 'brief_notes', new.brief_notes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_task_overlays_delete AFTER DELETE ON task_overlays BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'task_overlays', old.rowid, 'delete', json_object('id', old.id, 'origin', old.origin, 'flow_id', old.flow_id, 'item_type', old.item_type, 'item_id', old.item_id, 'iteration_scope', old.iteration_scope, 'cycle_id', old.cycle_id, 'wait_key', old.wait_key, 'due_at', old.due_at, 'status', old.status, 'resolved_at', old.resolved_at, 'tombstone', old.tombstone, 'title', old.title, 'plan_start_id', old.plan_start_id, 'plan_end_id', old.plan_end_id, 'plan_set', old.plan_set, 'delegate_kind', old.delegate_kind, 'delegate_id', old.delegate_id, 'delegate_set', old.delegate_set, 'agentic', old.agentic, 'agentic_set', old.agentic_set, 'asynchronous', old.asynchronous, 'archival', old.archival, 'is_private', old.is_private, 'beads_id', old.beads_id, 'beads_id_set', old.beads_id_set, 'position', old.position, 'block_reasons_set', old.block_reasons_set, 'brief_priority', old.brief_priority, 'brief_priority_set', old.brief_priority_set, 'brief_spec', old.brief_spec, 'brief_design', old.brief_design, 'brief_acceptance', old.brief_acceptance, 'brief_notes', old.brief_notes), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_template_agentic_briefs_insert AFTER INSERT ON template_agentic_briefs BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'template_agentic_briefs', new.rowid, 'insert', NULL, json_object('id', new.id, 'item_type', new.item_type, 'item_id', new.item_id, 'priority', new.priority, 'spec', new.spec, 'design', new.design, 'acceptance', new.acceptance, 'notes', new.notes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_template_agentic_briefs_update AFTER UPDATE ON template_agentic_briefs BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'template_agentic_briefs', new.rowid, 'update', json_object('id', old.id, 'item_type', old.item_type, 'item_id', old.item_id, 'priority', old.priority, 'spec', old.spec, 'design', old.design, 'acceptance', old.acceptance, 'notes', old.notes), json_object('id', new.id, 'item_type', new.item_type, 'item_id', new.item_id, 'priority', new.priority, 'spec', new.spec, 'design', new.design, 'acceptance', new.acceptance, 'notes', new.notes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_template_agentic_briefs_delete AFTER DELETE ON template_agentic_briefs BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'template_agentic_briefs', old.rowid, 'delete', json_object('id', old.id, 'item_type', old.item_type, 'item_id', old.item_id, 'priority', old.priority, 'spec', old.spec, 'design', old.design, 'acceptance', old.acceptance, 'notes', old.notes), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;
