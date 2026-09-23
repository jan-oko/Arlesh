-- A template carries its kind's full schema (ADR 0008, decision 5; Arlesh-pnn).
--
-- A flow item stored a title, a parent, a position and privacy; the flow root, being the flow row,
-- stored the flow's own fields. A Habit's occurrence inherits field by field from its template,
-- so a template that cannot say "delegated to the agent" or "tagged #errands" is a template whose
-- every occurrence has to be told one at a time. These are the columns and relations of the kind
-- each template draws, so the normal editor edits a template as it edits the row it draws:
--
--   * a flow task item, and the root of a task-instance flow: a Task's delegate, Agentic flag,
--     Asynchronous flag, Backlog and beads id;
--   * a flow goal item, and the root of a goal- or commitment-instance flow: a beads id.
--
-- Tags and block reasons are relations, in their own tables keyed by the template row. A plain
-- Flow's `start` copies all of it onto the rows it materialises, as it copies the title.
--
-- What stays per occurrence and is not here: status, the Time Scope (the iteration's window, or
-- the item's Cycle Scope within it) and — for a Task — the Plan, which the Cycle Plan already is.
--
-- Every column is added with a default that says what each template said before: undelegated,
-- inheriting Agentic, not asynchronous, in play, no issue. Nothing about an existing Habit changes.

ALTER TABLE flow_tasks ADD COLUMN delegate_kind TEXT CHECK (delegate_kind IN ('person', 'agent'));
ALTER TABLE flow_tasks ADD COLUMN delegate_id INTEGER REFERENCES people(id);
ALTER TABLE flow_tasks ADD COLUMN agentic INTEGER CHECK (agentic IN (0, 1));
ALTER TABLE flow_tasks ADD COLUMN asynchronous INTEGER NOT NULL DEFAULT 0 CHECK (asynchronous IN (0, 1));
ALTER TABLE flow_tasks ADD COLUMN archival TEXT NOT NULL DEFAULT 'live' CHECK (archival IN ('live', 'backlog'));
ALTER TABLE flow_tasks ADD COLUMN beads_id TEXT;

ALTER TABLE flow_goals ADD COLUMN beads_id TEXT;

ALTER TABLE flows ADD COLUMN delegate_kind TEXT CHECK (delegate_kind IN ('person', 'agent'));
ALTER TABLE flows ADD COLUMN delegate_id INTEGER REFERENCES people(id);
ALTER TABLE flows ADD COLUMN agentic INTEGER CHECK (agentic IN (0, 1));
ALTER TABLE flows ADD COLUMN asynchronous INTEGER NOT NULL DEFAULT 0 CHECK (asynchronous IN (0, 1));
ALTER TABLE flows ADD COLUMN archival TEXT NOT NULL DEFAULT 'live' CHECK (archival IN ('live', 'backlog'));
ALTER TABLE flows ADD COLUMN beads_id TEXT;

-- Tags on a template row: the flow root (`flow`, the flow's id) or an item.
CREATE TABLE template_tags (
    id        INTEGER PRIMARY KEY,
    item_type TEXT NOT NULL CHECK (item_type IN ('flow', 'flow_goal', 'flow_task')),
    item_id   INTEGER NOT NULL,
    tag_id    INTEGER NOT NULL REFERENCES domains(id),
    UNIQUE (item_type, item_id, tag_id)
);

-- A template row's block reasons, ordered — what every occurrence reads until it has its own.
CREATE TABLE template_block_reasons (
    id        INTEGER PRIMARY KEY,
    item_type TEXT NOT NULL CHECK (item_type IN ('flow', 'flow_goal', 'flow_task')),
    item_id   INTEGER NOT NULL,
    reason    TEXT NOT NULL,
    position  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_template_block_reasons_item ON template_block_reasons (item_type, item_id);

-- Undo-journal triggers, straight from scripts/generate-undo-triggers.sh.

DROP TRIGGER IF EXISTS undo_journal_flow_goals_insert;
CREATE TRIGGER undo_journal_flow_goals_insert AFTER INSERT ON flow_goals BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_goals', new.rowid, 'insert', NULL, json_object('id', new.id, 'flow_id', new.flow_id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'is_private', new.is_private, 'beads_id', new.beads_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_flow_goals_update;
CREATE TRIGGER undo_journal_flow_goals_update AFTER UPDATE ON flow_goals BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_goals', new.rowid, 'update', json_object('id', old.id, 'flow_id', old.flow_id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'position', old.position, 'is_private', old.is_private, 'beads_id', old.beads_id), json_object('id', new.id, 'flow_id', new.flow_id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'is_private', new.is_private, 'beads_id', new.beads_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_flow_goals_delete;
CREATE TRIGGER undo_journal_flow_goals_delete AFTER DELETE ON flow_goals BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_goals', old.rowid, 'delete', json_object('id', old.id, 'flow_id', old.flow_id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'position', old.position, 'is_private', old.is_private, 'beads_id', old.beads_id), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_flow_tasks_insert;
CREATE TRIGGER undo_journal_flow_tasks_insert AFTER INSERT ON flow_tasks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_tasks', new.rowid, 'insert', NULL, json_object('id', new.id, 'flow_id', new.flow_id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'is_private', new.is_private, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'agentic', new.agentic, 'asynchronous', new.asynchronous, 'archival', new.archival, 'beads_id', new.beads_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_flow_tasks_update;
CREATE TRIGGER undo_journal_flow_tasks_update AFTER UPDATE ON flow_tasks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_tasks', new.rowid, 'update', json_object('id', old.id, 'flow_id', old.flow_id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'position', old.position, 'is_private', old.is_private, 'delegate_kind', old.delegate_kind, 'delegate_id', old.delegate_id, 'agentic', old.agentic, 'asynchronous', old.asynchronous, 'archival', old.archival, 'beads_id', old.beads_id), json_object('id', new.id, 'flow_id', new.flow_id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'is_private', new.is_private, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'agentic', new.agentic, 'asynchronous', new.asynchronous, 'archival', new.archival, 'beads_id', new.beads_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_flow_tasks_delete;
CREATE TRIGGER undo_journal_flow_tasks_delete AFTER DELETE ON flow_tasks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_tasks', old.rowid, 'delete', json_object('id', old.id, 'flow_id', old.flow_id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'position', old.position, 'is_private', old.is_private, 'delegate_kind', old.delegate_kind, 'delegate_id', old.delegate_id, 'agentic', old.agentic, 'asynchronous', old.asynchronous, 'archival', old.archival, 'beads_id', old.beads_id), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_flows_insert;
CREATE TRIGGER undo_journal_flows_insert AFTER INSERT ON flows BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flows', new.rowid, 'insert', NULL, json_object('id', new.id, 'title', new.title, 'instance_type', new.instance_type, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'target_type', new.target_type, 'target_id', new.target_id, 'flow_duration_n', new.flow_duration_n, 'flow_duration_kind', new.flow_duration_kind, 'position', new.position, 'flow_window_part', new.flow_window_part, 'flow_window_time_start', new.flow_window_time_start, 'flow_window_time_end', new.flow_window_time_end, 'root_plan_kind', new.root_plan_kind, 'root_plan_start', new.root_plan_start, 'root_plan_end', new.root_plan_end, 'is_private', new.is_private, 'verdict_window_n', new.verdict_window_n, 'verdict_window_kind', new.verdict_window_kind, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'agentic', new.agentic, 'asynchronous', new.asynchronous, 'archival', new.archival, 'beads_id', new.beads_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_flows_update;
CREATE TRIGGER undo_journal_flows_update AFTER UPDATE ON flows BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flows', new.rowid, 'update', json_object('id', old.id, 'title', old.title, 'instance_type', old.instance_type, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'target_type', old.target_type, 'target_id', old.target_id, 'flow_duration_n', old.flow_duration_n, 'flow_duration_kind', old.flow_duration_kind, 'position', old.position, 'flow_window_part', old.flow_window_part, 'flow_window_time_start', old.flow_window_time_start, 'flow_window_time_end', old.flow_window_time_end, 'root_plan_kind', old.root_plan_kind, 'root_plan_start', old.root_plan_start, 'root_plan_end', old.root_plan_end, 'is_private', old.is_private, 'verdict_window_n', old.verdict_window_n, 'verdict_window_kind', old.verdict_window_kind, 'delegate_kind', old.delegate_kind, 'delegate_id', old.delegate_id, 'agentic', old.agentic, 'asynchronous', old.asynchronous, 'archival', old.archival, 'beads_id', old.beads_id), json_object('id', new.id, 'title', new.title, 'instance_type', new.instance_type, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'target_type', new.target_type, 'target_id', new.target_id, 'flow_duration_n', new.flow_duration_n, 'flow_duration_kind', new.flow_duration_kind, 'position', new.position, 'flow_window_part', new.flow_window_part, 'flow_window_time_start', new.flow_window_time_start, 'flow_window_time_end', new.flow_window_time_end, 'root_plan_kind', new.root_plan_kind, 'root_plan_start', new.root_plan_start, 'root_plan_end', new.root_plan_end, 'is_private', new.is_private, 'verdict_window_n', new.verdict_window_n, 'verdict_window_kind', new.verdict_window_kind, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'agentic', new.agentic, 'asynchronous', new.asynchronous, 'archival', new.archival, 'beads_id', new.beads_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_flows_delete;
CREATE TRIGGER undo_journal_flows_delete AFTER DELETE ON flows BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flows', old.rowid, 'delete', json_object('id', old.id, 'title', old.title, 'instance_type', old.instance_type, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'target_type', old.target_type, 'target_id', old.target_id, 'flow_duration_n', old.flow_duration_n, 'flow_duration_kind', old.flow_duration_kind, 'position', old.position, 'flow_window_part', old.flow_window_part, 'flow_window_time_start', old.flow_window_time_start, 'flow_window_time_end', old.flow_window_time_end, 'root_plan_kind', old.root_plan_kind, 'root_plan_start', old.root_plan_start, 'root_plan_end', old.root_plan_end, 'is_private', old.is_private, 'verdict_window_n', old.verdict_window_n, 'verdict_window_kind', old.verdict_window_kind, 'delegate_kind', old.delegate_kind, 'delegate_id', old.delegate_id, 'agentic', old.agentic, 'asynchronous', old.asynchronous, 'archival', old.archival, 'beads_id', old.beads_id), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_template_block_reasons_insert;
CREATE TRIGGER undo_journal_template_block_reasons_insert AFTER INSERT ON template_block_reasons BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'template_block_reasons', new.rowid, 'insert', NULL, json_object('id', new.id, 'item_type', new.item_type, 'item_id', new.item_id, 'reason', new.reason, 'position', new.position), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_template_block_reasons_update;
CREATE TRIGGER undo_journal_template_block_reasons_update AFTER UPDATE ON template_block_reasons BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'template_block_reasons', new.rowid, 'update', json_object('id', old.id, 'item_type', old.item_type, 'item_id', old.item_id, 'reason', old.reason, 'position', old.position), json_object('id', new.id, 'item_type', new.item_type, 'item_id', new.item_id, 'reason', new.reason, 'position', new.position), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_template_block_reasons_delete;
CREATE TRIGGER undo_journal_template_block_reasons_delete AFTER DELETE ON template_block_reasons BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'template_block_reasons', old.rowid, 'delete', json_object('id', old.id, 'item_type', old.item_type, 'item_id', old.item_id, 'reason', old.reason, 'position', old.position), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_template_tags_insert;
CREATE TRIGGER undo_journal_template_tags_insert AFTER INSERT ON template_tags BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'template_tags', new.rowid, 'insert', NULL, json_object('id', new.id, 'item_type', new.item_type, 'item_id', new.item_id, 'tag_id', new.tag_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_template_tags_update;
CREATE TRIGGER undo_journal_template_tags_update AFTER UPDATE ON template_tags BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'template_tags', new.rowid, 'update', json_object('id', old.id, 'item_type', old.item_type, 'item_id', old.item_id, 'tag_id', old.tag_id), json_object('id', new.id, 'item_type', new.item_type, 'item_id', new.item_id, 'tag_id', new.tag_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_template_tags_delete;
CREATE TRIGGER undo_journal_template_tags_delete AFTER DELETE ON template_tags BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'template_tags', old.rowid, 'delete', json_object('id', old.id, 'item_type', old.item_type, 'item_id', old.item_id, 'tag_id', old.tag_id), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;
