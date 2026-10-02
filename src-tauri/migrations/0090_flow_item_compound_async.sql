-- A Task template's **Compound** flag and **Expectation template** (Task 611; the user,
-- 2026-10-01: "add compound and async expectations to the template editor", and "iteration roots
-- must also support compound and asynchronous").
--
-- A template carries its kind's full schema (0061), and a Task now has two things a Task template
-- could not say: Compound (0086) and the wait template an Asynchronous Task spawns its wait from
-- (0044). Both are stored the way a stored Task stores them, keyed by the template row instead —
-- a flow Task item, or the flow itself for the root of a task-instance flow (its Asynchronous
-- flag is `flows.asynchronous`, from 0061). A flow Goal item has neither.
--
--   * `flow_tasks.compound`, `flows.compound`: a plain boolean, NOT NULL DEFAULT 0, exactly
--     `tasks.compound`.
--   * `flow_task_async_templates` (+ `tags_on_flow_task_async_templates`) and
--     `flow_async_templates` (+ `tags_on_flow_async_templates`): exactly the columns
--     `task_async_templates` has, one row per template that has one, gone with its row
--     (`ON DELETE CASCADE`).
--
-- A Habit occurrence reads both from its item until its overlay says otherwise:
--
--   * `task_overlays.compound`: NULL inherits the item's flag.
--   * `task_overlays.async_template_set`: the occurrence's wait template is its own. Its own
--     template, when it has one, is the `occurrence_async_templates` row it always had (0062); set
--     with no such row, it is overridden to **no template**. Unset, it reads the item's.
--
-- A plain Flow's `start` copies both onto the Tasks it makes, as it copies every other field.
--
-- Every column is added with a default that says what each row said before: not compound, no
-- template, inheriting. Nothing about an existing Habit or Flow changes.

ALTER TABLE flow_tasks ADD COLUMN compound INTEGER NOT NULL DEFAULT 0 CHECK (compound IN (0, 1));
ALTER TABLE flows ADD COLUMN compound INTEGER NOT NULL DEFAULT 0 CHECK (compound IN (0, 1));

CREATE TABLE flow_task_async_templates (
    flow_task_id     INTEGER PRIMARY KEY REFERENCES flow_tasks(id) ON DELETE CASCADE,
    title            TEXT NOT NULL,
    time_scope_n     INTEGER,
    time_scope_kind  TEXT,
    check_every_n    INTEGER,
    check_every_kind TEXT,
    CHECK ((time_scope_n IS NULL) = (time_scope_kind IS NULL)),
    CHECK ((check_every_n IS NULL) = (check_every_kind IS NULL))
);

CREATE TABLE tags_on_flow_task_async_templates (
    flow_task_id INTEGER NOT NULL
                     REFERENCES flow_task_async_templates(flow_task_id) ON DELETE CASCADE,
    tag_id       INTEGER NOT NULL REFERENCES domains(id),
    PRIMARY KEY (flow_task_id, tag_id)
);

CREATE TABLE flow_async_templates (
    flow_id          INTEGER PRIMARY KEY REFERENCES flows(id) ON DELETE CASCADE,
    title            TEXT NOT NULL,
    time_scope_n     INTEGER,
    time_scope_kind  TEXT,
    check_every_n    INTEGER,
    check_every_kind TEXT,
    CHECK ((time_scope_n IS NULL) = (time_scope_kind IS NULL)),
    CHECK ((check_every_n IS NULL) = (check_every_kind IS NULL))
);

CREATE TABLE tags_on_flow_async_templates (
    flow_id INTEGER NOT NULL REFERENCES flow_async_templates(flow_id) ON DELETE CASCADE,
    tag_id  INTEGER NOT NULL REFERENCES domains(id),
    PRIMARY KEY (flow_id, tag_id)
);

ALTER TABLE task_overlays ADD COLUMN compound INTEGER CHECK (compound IS NULL OR compound IN (0, 1));
ALTER TABLE task_overlays ADD COLUMN async_template_set INTEGER NOT NULL DEFAULT 0
    CHECK (async_template_set IN (0, 1));

-- Undo-journal triggers, straight from scripts/generate-undo-triggers.sh. The journal's images
-- name every column, so the three altered tables' triggers are rebuilt with the new ones.
DROP TRIGGER IF EXISTS undo_journal_flows_insert;
DROP TRIGGER IF EXISTS undo_journal_flows_update;
DROP TRIGGER IF EXISTS undo_journal_flows_delete;
DROP TRIGGER IF EXISTS undo_journal_flow_tasks_insert;
DROP TRIGGER IF EXISTS undo_journal_flow_tasks_update;
DROP TRIGGER IF EXISTS undo_journal_flow_tasks_delete;
DROP TRIGGER IF EXISTS undo_journal_task_overlays_insert;
DROP TRIGGER IF EXISTS undo_journal_task_overlays_update;
DROP TRIGGER IF EXISTS undo_journal_task_overlays_delete;

CREATE TRIGGER undo_journal_flow_async_templates_insert AFTER INSERT ON flow_async_templates BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_async_templates', new.rowid, 'insert', NULL, json_object('flow_id', new.flow_id, 'title', new.title, 'time_scope_n', new.time_scope_n, 'time_scope_kind', new.time_scope_kind, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_async_templates_update AFTER UPDATE ON flow_async_templates BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_async_templates', new.rowid, 'update', json_object('flow_id', old.flow_id, 'title', old.title, 'time_scope_n', old.time_scope_n, 'time_scope_kind', old.time_scope_kind, 'check_every_n', old.check_every_n, 'check_every_kind', old.check_every_kind), json_object('flow_id', new.flow_id, 'title', new.title, 'time_scope_n', new.time_scope_n, 'time_scope_kind', new.time_scope_kind, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_async_templates_delete AFTER DELETE ON flow_async_templates BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_async_templates', old.rowid, 'delete', json_object('flow_id', old.flow_id, 'title', old.title, 'time_scope_n', old.time_scope_n, 'time_scope_kind', old.time_scope_kind, 'check_every_n', old.check_every_n, 'check_every_kind', old.check_every_kind), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_task_async_templates_insert AFTER INSERT ON flow_task_async_templates BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_task_async_templates', new.rowid, 'insert', NULL, json_object('flow_task_id', new.flow_task_id, 'title', new.title, 'time_scope_n', new.time_scope_n, 'time_scope_kind', new.time_scope_kind, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_task_async_templates_update AFTER UPDATE ON flow_task_async_templates BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_task_async_templates', new.rowid, 'update', json_object('flow_task_id', old.flow_task_id, 'title', old.title, 'time_scope_n', old.time_scope_n, 'time_scope_kind', old.time_scope_kind, 'check_every_n', old.check_every_n, 'check_every_kind', old.check_every_kind), json_object('flow_task_id', new.flow_task_id, 'title', new.title, 'time_scope_n', new.time_scope_n, 'time_scope_kind', new.time_scope_kind, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_task_async_templates_delete AFTER DELETE ON flow_task_async_templates BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_task_async_templates', old.rowid, 'delete', json_object('flow_task_id', old.flow_task_id, 'title', old.title, 'time_scope_n', old.time_scope_n, 'time_scope_kind', old.time_scope_kind, 'check_every_n', old.check_every_n, 'check_every_kind', old.check_every_kind), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_tasks_insert AFTER INSERT ON flow_tasks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_tasks', new.rowid, 'insert', NULL, json_object('id', new.id, 'flow_id', new.flow_id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'is_private', new.is_private, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'agentic', new.agentic, 'asynchronous', new.asynchronous, 'archival', new.archival, 'beads_id', new.beads_id, 'compound', new.compound), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_tasks_update AFTER UPDATE ON flow_tasks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_tasks', new.rowid, 'update', json_object('id', old.id, 'flow_id', old.flow_id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'position', old.position, 'is_private', old.is_private, 'delegate_kind', old.delegate_kind, 'delegate_id', old.delegate_id, 'agentic', old.agentic, 'asynchronous', old.asynchronous, 'archival', old.archival, 'beads_id', old.beads_id, 'compound', old.compound), json_object('id', new.id, 'flow_id', new.flow_id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'is_private', new.is_private, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'agentic', new.agentic, 'asynchronous', new.asynchronous, 'archival', new.archival, 'beads_id', new.beads_id, 'compound', new.compound), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_tasks_delete AFTER DELETE ON flow_tasks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_tasks', old.rowid, 'delete', json_object('id', old.id, 'flow_id', old.flow_id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'position', old.position, 'is_private', old.is_private, 'delegate_kind', old.delegate_kind, 'delegate_id', old.delegate_id, 'agentic', old.agentic, 'asynchronous', old.asynchronous, 'archival', old.archival, 'beads_id', old.beads_id, 'compound', old.compound), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flows_insert AFTER INSERT ON flows BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flows', new.rowid, 'insert', NULL, json_object('id', new.id, 'title', new.title, 'instance_type', new.instance_type, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'target_type', new.target_type, 'target_id', new.target_id, 'flow_duration_n', new.flow_duration_n, 'flow_duration_kind', new.flow_duration_kind, 'position', new.position, 'flow_window_part', new.flow_window_part, 'flow_window_time_start', new.flow_window_time_start, 'flow_window_time_end', new.flow_window_time_end, 'root_plan_kind', new.root_plan_kind, 'root_plan_start', new.root_plan_start, 'root_plan_end', new.root_plan_end, 'is_private', new.is_private, 'verdict_window_n', new.verdict_window_n, 'verdict_window_kind', new.verdict_window_kind, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'agentic', new.agentic, 'asynchronous', new.asynchronous, 'archival', new.archival, 'beads_id', new.beads_id, 'compound', new.compound), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flows_update AFTER UPDATE ON flows BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flows', new.rowid, 'update', json_object('id', old.id, 'title', old.title, 'instance_type', old.instance_type, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'target_type', old.target_type, 'target_id', old.target_id, 'flow_duration_n', old.flow_duration_n, 'flow_duration_kind', old.flow_duration_kind, 'position', old.position, 'flow_window_part', old.flow_window_part, 'flow_window_time_start', old.flow_window_time_start, 'flow_window_time_end', old.flow_window_time_end, 'root_plan_kind', old.root_plan_kind, 'root_plan_start', old.root_plan_start, 'root_plan_end', old.root_plan_end, 'is_private', old.is_private, 'verdict_window_n', old.verdict_window_n, 'verdict_window_kind', old.verdict_window_kind, 'delegate_kind', old.delegate_kind, 'delegate_id', old.delegate_id, 'agentic', old.agentic, 'asynchronous', old.asynchronous, 'archival', old.archival, 'beads_id', old.beads_id, 'compound', old.compound), json_object('id', new.id, 'title', new.title, 'instance_type', new.instance_type, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'target_type', new.target_type, 'target_id', new.target_id, 'flow_duration_n', new.flow_duration_n, 'flow_duration_kind', new.flow_duration_kind, 'position', new.position, 'flow_window_part', new.flow_window_part, 'flow_window_time_start', new.flow_window_time_start, 'flow_window_time_end', new.flow_window_time_end, 'root_plan_kind', new.root_plan_kind, 'root_plan_start', new.root_plan_start, 'root_plan_end', new.root_plan_end, 'is_private', new.is_private, 'verdict_window_n', new.verdict_window_n, 'verdict_window_kind', new.verdict_window_kind, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'agentic', new.agentic, 'asynchronous', new.asynchronous, 'archival', new.archival, 'beads_id', new.beads_id, 'compound', new.compound), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flows_delete AFTER DELETE ON flows BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flows', old.rowid, 'delete', json_object('id', old.id, 'title', old.title, 'instance_type', old.instance_type, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'target_type', old.target_type, 'target_id', old.target_id, 'flow_duration_n', old.flow_duration_n, 'flow_duration_kind', old.flow_duration_kind, 'position', old.position, 'flow_window_part', old.flow_window_part, 'flow_window_time_start', old.flow_window_time_start, 'flow_window_time_end', old.flow_window_time_end, 'root_plan_kind', old.root_plan_kind, 'root_plan_start', old.root_plan_start, 'root_plan_end', old.root_plan_end, 'is_private', old.is_private, 'verdict_window_n', old.verdict_window_n, 'verdict_window_kind', old.verdict_window_kind, 'delegate_kind', old.delegate_kind, 'delegate_id', old.delegate_id, 'agentic', old.agentic, 'asynchronous', old.asynchronous, 'archival', old.archival, 'beads_id', old.beads_id, 'compound', old.compound), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_tags_on_flow_async_templates_insert AFTER INSERT ON tags_on_flow_async_templates BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tags_on_flow_async_templates', new.rowid, 'insert', NULL, json_object('flow_id', new.flow_id, 'tag_id', new.tag_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_tags_on_flow_async_templates_update AFTER UPDATE ON tags_on_flow_async_templates BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tags_on_flow_async_templates', new.rowid, 'update', json_object('flow_id', old.flow_id, 'tag_id', old.tag_id), json_object('flow_id', new.flow_id, 'tag_id', new.tag_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_tags_on_flow_async_templates_delete AFTER DELETE ON tags_on_flow_async_templates BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tags_on_flow_async_templates', old.rowid, 'delete', json_object('flow_id', old.flow_id, 'tag_id', old.tag_id), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_tags_on_flow_task_async_templates_insert AFTER INSERT ON tags_on_flow_task_async_templates BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tags_on_flow_task_async_templates', new.rowid, 'insert', NULL, json_object('flow_task_id', new.flow_task_id, 'tag_id', new.tag_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_tags_on_flow_task_async_templates_update AFTER UPDATE ON tags_on_flow_task_async_templates BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tags_on_flow_task_async_templates', new.rowid, 'update', json_object('flow_task_id', old.flow_task_id, 'tag_id', old.tag_id), json_object('flow_task_id', new.flow_task_id, 'tag_id', new.tag_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_tags_on_flow_task_async_templates_delete AFTER DELETE ON tags_on_flow_task_async_templates BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tags_on_flow_task_async_templates', old.rowid, 'delete', json_object('flow_task_id', old.flow_task_id, 'tag_id', old.tag_id), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_task_overlays_insert AFTER INSERT ON task_overlays BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'task_overlays', new.rowid, 'insert', NULL, json_object('id', new.id, 'origin', new.origin, 'flow_id', new.flow_id, 'item_type', new.item_type, 'item_id', new.item_id, 'iteration_scope', new.iteration_scope, 'cycle_id', new.cycle_id, 'wait_key', new.wait_key, 'due_at', new.due_at, 'status', new.status, 'resolved_at', new.resolved_at, 'tombstone', new.tombstone, 'title', new.title, 'plan_start_id', new.plan_start_id, 'plan_end_id', new.plan_end_id, 'plan_set', new.plan_set, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'delegate_set', new.delegate_set, 'agentic', new.agentic, 'agentic_set', new.agentic_set, 'asynchronous', new.asynchronous, 'archival', new.archival, 'is_private', new.is_private, 'beads_id', new.beads_id, 'beads_id_set', new.beads_id_set, 'position', new.position, 'block_reasons_set', new.block_reasons_set, 'brief_priority', new.brief_priority, 'brief_priority_set', new.brief_priority_set, 'brief_spec', new.brief_spec, 'brief_design', new.brief_design, 'brief_acceptance', new.brief_acceptance, 'brief_notes', new.brief_notes, 'due_scope_start_id', new.due_scope_start_id, 'due_scope_end_id', new.due_scope_end_id, 'compound', new.compound, 'async_template_set', new.async_template_set), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_task_overlays_update AFTER UPDATE ON task_overlays BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'task_overlays', new.rowid, 'update', json_object('id', old.id, 'origin', old.origin, 'flow_id', old.flow_id, 'item_type', old.item_type, 'item_id', old.item_id, 'iteration_scope', old.iteration_scope, 'cycle_id', old.cycle_id, 'wait_key', old.wait_key, 'due_at', old.due_at, 'status', old.status, 'resolved_at', old.resolved_at, 'tombstone', old.tombstone, 'title', old.title, 'plan_start_id', old.plan_start_id, 'plan_end_id', old.plan_end_id, 'plan_set', old.plan_set, 'delegate_kind', old.delegate_kind, 'delegate_id', old.delegate_id, 'delegate_set', old.delegate_set, 'agentic', old.agentic, 'agentic_set', old.agentic_set, 'asynchronous', old.asynchronous, 'archival', old.archival, 'is_private', old.is_private, 'beads_id', old.beads_id, 'beads_id_set', old.beads_id_set, 'position', old.position, 'block_reasons_set', old.block_reasons_set, 'brief_priority', old.brief_priority, 'brief_priority_set', old.brief_priority_set, 'brief_spec', old.brief_spec, 'brief_design', old.brief_design, 'brief_acceptance', old.brief_acceptance, 'brief_notes', old.brief_notes, 'due_scope_start_id', old.due_scope_start_id, 'due_scope_end_id', old.due_scope_end_id, 'compound', old.compound, 'async_template_set', old.async_template_set), json_object('id', new.id, 'origin', new.origin, 'flow_id', new.flow_id, 'item_type', new.item_type, 'item_id', new.item_id, 'iteration_scope', new.iteration_scope, 'cycle_id', new.cycle_id, 'wait_key', new.wait_key, 'due_at', new.due_at, 'status', new.status, 'resolved_at', new.resolved_at, 'tombstone', new.tombstone, 'title', new.title, 'plan_start_id', new.plan_start_id, 'plan_end_id', new.plan_end_id, 'plan_set', new.plan_set, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'delegate_set', new.delegate_set, 'agentic', new.agentic, 'agentic_set', new.agentic_set, 'asynchronous', new.asynchronous, 'archival', new.archival, 'is_private', new.is_private, 'beads_id', new.beads_id, 'beads_id_set', new.beads_id_set, 'position', new.position, 'block_reasons_set', new.block_reasons_set, 'brief_priority', new.brief_priority, 'brief_priority_set', new.brief_priority_set, 'brief_spec', new.brief_spec, 'brief_design', new.brief_design, 'brief_acceptance', new.brief_acceptance, 'brief_notes', new.brief_notes, 'due_scope_start_id', new.due_scope_start_id, 'due_scope_end_id', new.due_scope_end_id, 'compound', new.compound, 'async_template_set', new.async_template_set), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_task_overlays_delete AFTER DELETE ON task_overlays BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'task_overlays', old.rowid, 'delete', json_object('id', old.id, 'origin', old.origin, 'flow_id', old.flow_id, 'item_type', old.item_type, 'item_id', old.item_id, 'iteration_scope', old.iteration_scope, 'cycle_id', old.cycle_id, 'wait_key', old.wait_key, 'due_at', old.due_at, 'status', old.status, 'resolved_at', old.resolved_at, 'tombstone', old.tombstone, 'title', old.title, 'plan_start_id', old.plan_start_id, 'plan_end_id', old.plan_end_id, 'plan_set', old.plan_set, 'delegate_kind', old.delegate_kind, 'delegate_id', old.delegate_id, 'delegate_set', old.delegate_set, 'agentic', old.agentic, 'agentic_set', old.agentic_set, 'asynchronous', old.asynchronous, 'archival', old.archival, 'is_private', old.is_private, 'beads_id', old.beads_id, 'beads_id_set', old.beads_id_set, 'position', old.position, 'block_reasons_set', old.block_reasons_set, 'brief_priority', old.brief_priority, 'brief_priority_set', old.brief_priority_set, 'brief_spec', old.brief_spec, 'brief_design', old.brief_design, 'brief_acceptance', old.brief_acceptance, 'brief_notes', old.brief_notes, 'due_scope_start_id', old.due_scope_start_id, 'due_scope_end_id', old.due_scope_end_id, 'compound', old.compound, 'async_template_set', old.async_template_set), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;
