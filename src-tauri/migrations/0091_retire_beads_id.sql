-- The beads id is retired (Task 661): bd no longer tracks this app's work, the Arlesh board does,
-- and the `.beads/` directory is a read-only archive. The column is removed from every table that
-- carried it — the stored nodes, the flow templates and the Habit occurrence overlays — along with
-- an overlay's `beads_id_set` flag.
--
-- **Nothing is dropped.** Every id still set is copied first into `retired_beads_ids`, keyed by the
-- table and rowid it was on, so a node can still be traced back to its bd-era issue by hand.
--
-- No table is rebuilt: SQLite drops a column in place, and the only thing that stands in its way
-- is the undo journal's triggers, which name every column. Those on the ten tables are dropped,
-- the column with them, and the triggers recreated naming the columns that remain. Every other
-- trigger — the mcp_roots ones among them — is untouched.
--
-- The undo journal's stored images name the column too, and a replay writes back every column an
-- image names, so an old Gesture would fail on undo with "no such column". The key is taken out of
-- every image of the ten tables, which is exactly the image the new triggers would have written.

CREATE TABLE retired_beads_ids (
    table_name TEXT    NOT NULL,
    row_id     INTEGER NOT NULL,
    beads_id   TEXT    NOT NULL,
    PRIMARY KEY (table_name, row_id)
);

INSERT INTO retired_beads_ids (table_name, row_id, beads_id)
    SELECT 'domains', rowid, beads_id FROM domains WHERE beads_id IS NOT NULL;
INSERT INTO retired_beads_ids (table_name, row_id, beads_id)
    SELECT 'flows', rowid, beads_id FROM flows WHERE beads_id IS NOT NULL;
INSERT INTO retired_beads_ids (table_name, row_id, beads_id)
    SELECT 'flow_goals', rowid, beads_id FROM flow_goals WHERE beads_id IS NOT NULL;
INSERT INTO retired_beads_ids (table_name, row_id, beads_id)
    SELECT 'flow_tasks', rowid, beads_id FROM flow_tasks WHERE beads_id IS NOT NULL;
INSERT INTO retired_beads_ids (table_name, row_id, beads_id)
    SELECT 'goals', rowid, beads_id FROM goals WHERE beads_id IS NOT NULL;
INSERT INTO retired_beads_ids (table_name, row_id, beads_id)
    SELECT 'commitments', rowid, beads_id FROM commitments WHERE beads_id IS NOT NULL;
INSERT INTO retired_beads_ids (table_name, row_id, beads_id)
    SELECT 'goal_overlays', rowid, beads_id FROM goal_overlays WHERE beads_id IS NOT NULL;
INSERT INTO retired_beads_ids (table_name, row_id, beads_id)
    SELECT 'commitment_overlays', rowid, beads_id FROM commitment_overlays WHERE beads_id IS NOT NULL;
INSERT INTO retired_beads_ids (table_name, row_id, beads_id)
    SELECT 'tasks', rowid, beads_id FROM tasks WHERE beads_id IS NOT NULL;
INSERT INTO retired_beads_ids (table_name, row_id, beads_id)
    SELECT 'task_overlays', rowid, beads_id FROM task_overlays WHERE beads_id IS NOT NULL;

DROP TRIGGER undo_journal_commitment_overlays_delete;
DROP TRIGGER undo_journal_commitment_overlays_insert;
DROP TRIGGER undo_journal_commitment_overlays_update;
DROP TRIGGER undo_journal_commitments_delete;
DROP TRIGGER undo_journal_commitments_insert;
DROP TRIGGER undo_journal_commitments_update;
DROP TRIGGER undo_journal_domains_delete;
DROP TRIGGER undo_journal_domains_insert;
DROP TRIGGER undo_journal_domains_update;
DROP TRIGGER undo_journal_flow_goals_delete;
DROP TRIGGER undo_journal_flow_goals_insert;
DROP TRIGGER undo_journal_flow_goals_update;
DROP TRIGGER undo_journal_flow_tasks_delete;
DROP TRIGGER undo_journal_flow_tasks_insert;
DROP TRIGGER undo_journal_flow_tasks_update;
DROP TRIGGER undo_journal_flows_delete;
DROP TRIGGER undo_journal_flows_insert;
DROP TRIGGER undo_journal_flows_update;
DROP TRIGGER undo_journal_goal_overlays_delete;
DROP TRIGGER undo_journal_goal_overlays_insert;
DROP TRIGGER undo_journal_goal_overlays_update;
DROP TRIGGER undo_journal_goals_delete;
DROP TRIGGER undo_journal_goals_insert;
DROP TRIGGER undo_journal_goals_update;
DROP TRIGGER undo_journal_task_overlays_delete;
DROP TRIGGER undo_journal_task_overlays_insert;
DROP TRIGGER undo_journal_task_overlays_update;
DROP TRIGGER undo_journal_tasks_delete;
DROP TRIGGER undo_journal_tasks_insert;
DROP TRIGGER undo_journal_tasks_update;

ALTER TABLE domains DROP COLUMN beads_id;
ALTER TABLE flows DROP COLUMN beads_id;
ALTER TABLE flow_goals DROP COLUMN beads_id;
ALTER TABLE flow_tasks DROP COLUMN beads_id;
ALTER TABLE goals DROP COLUMN beads_id;
ALTER TABLE commitments DROP COLUMN beads_id;
ALTER TABLE goal_overlays DROP COLUMN beads_id;
ALTER TABLE goal_overlays DROP COLUMN beads_id_set;
ALTER TABLE commitment_overlays DROP COLUMN beads_id;
ALTER TABLE commitment_overlays DROP COLUMN beads_id_set;
ALTER TABLE tasks DROP COLUMN beads_id;
ALTER TABLE task_overlays DROP COLUMN beads_id;
ALTER TABLE task_overlays DROP COLUMN beads_id_set;

UPDATE undo_journal
   SET before_image = json_remove(before_image, '$.beads_id', '$.beads_id_set'),
       after_image  = json_remove(after_image, '$.beads_id', '$.beads_id_set')
 WHERE table_name IN ('domains', 'flows', 'flow_goals', 'flow_tasks', 'goals', 'commitments', 'goal_overlays', 'commitment_overlays', 'tasks', 'task_overlays');

CREATE TRIGGER undo_journal_commitment_overlays_delete AFTER DELETE ON commitment_overlays BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'commitment_overlays', old.rowid, 'delete', json_object('id', old.id, 'flow_id', old.flow_id, 'item_type', old.item_type, 'item_id', old.item_id, 'iteration_scope', old.iteration_scope, 'cycle_id', old.cycle_id, 'verdict', old.verdict, 'resolved_at', old.resolved_at, 'tombstone', old.tombstone, 'title', old.title, 'is_private', old.is_private, 'position', old.position), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_commitment_overlays_insert AFTER INSERT ON commitment_overlays BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'commitment_overlays', new.rowid, 'insert', NULL, json_object('id', new.id, 'flow_id', new.flow_id, 'item_type', new.item_type, 'item_id', new.item_id, 'iteration_scope', new.iteration_scope, 'cycle_id', new.cycle_id, 'verdict', new.verdict, 'resolved_at', new.resolved_at, 'tombstone', new.tombstone, 'title', new.title, 'is_private', new.is_private, 'position', new.position), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_commitment_overlays_update AFTER UPDATE ON commitment_overlays BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'commitment_overlays', new.rowid, 'update', json_object('id', old.id, 'flow_id', old.flow_id, 'item_type', old.item_type, 'item_id', old.item_id, 'iteration_scope', old.iteration_scope, 'cycle_id', old.cycle_id, 'verdict', old.verdict, 'resolved_at', old.resolved_at, 'tombstone', old.tombstone, 'title', old.title, 'is_private', old.is_private, 'position', old.position), json_object('id', new.id, 'flow_id', new.flow_id, 'item_type', new.item_type, 'item_id', new.item_id, 'iteration_scope', new.iteration_scope, 'cycle_id', new.cycle_id, 'verdict', new.verdict, 'resolved_at', new.resolved_at, 'tombstone', new.tombstone, 'title', new.title, 'is_private', new.is_private, 'position', new.position), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_commitments_delete AFTER DELETE ON commitments BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'commitments', old.rowid, 'delete', json_object('id', old.id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'verdict', old.verdict, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind, 'verdict_window_n', old.verdict_window_n, 'verdict_window_kind', old.verdict_window_kind, 'position', old.position, 'is_private', old.is_private), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_commitments_insert AFTER INSERT ON commitments BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'commitments', new.rowid, 'insert', NULL, json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'verdict', new.verdict, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'verdict_window_n', new.verdict_window_n, 'verdict_window_kind', new.verdict_window_kind, 'position', new.position, 'is_private', new.is_private), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_commitments_update AFTER UPDATE ON commitments BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'commitments', new.rowid, 'update', json_object('id', old.id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'verdict', old.verdict, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind, 'verdict_window_n', old.verdict_window_n, 'verdict_window_kind', old.verdict_window_kind, 'position', old.position, 'is_private', old.is_private), json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'verdict', new.verdict, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'verdict_window_n', new.verdict_window_n, 'verdict_window_kind', new.verdict_window_kind, 'position', new.position, 'is_private', new.is_private), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_domains_delete AFTER DELETE ON domains BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'domains', old.rowid, 'delete', json_object('id', old.id, 'title', old.title, 'description', old.description, 'subtype', old.subtype, 'parent_id', old.parent_id, 'color', old.color, 'status', old.status, 'knowledge_base_directory', old.knowledge_base_directory, 'position', old.position, 'is_private', old.is_private), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_domains_insert AFTER INSERT ON domains BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'domains', new.rowid, 'insert', NULL, json_object('id', new.id, 'title', new.title, 'description', new.description, 'subtype', new.subtype, 'parent_id', new.parent_id, 'color', new.color, 'status', new.status, 'knowledge_base_directory', new.knowledge_base_directory, 'position', new.position, 'is_private', new.is_private), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_domains_update AFTER UPDATE ON domains BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'domains', new.rowid, 'update', json_object('id', old.id, 'title', old.title, 'description', old.description, 'subtype', old.subtype, 'parent_id', old.parent_id, 'color', old.color, 'status', old.status, 'knowledge_base_directory', old.knowledge_base_directory, 'position', old.position, 'is_private', old.is_private), json_object('id', new.id, 'title', new.title, 'description', new.description, 'subtype', new.subtype, 'parent_id', new.parent_id, 'color', new.color, 'status', new.status, 'knowledge_base_directory', new.knowledge_base_directory, 'position', new.position, 'is_private', new.is_private), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_goals_delete AFTER DELETE ON flow_goals BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_goals', old.rowid, 'delete', json_object('id', old.id, 'flow_id', old.flow_id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'position', old.position, 'is_private', old.is_private), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_goals_insert AFTER INSERT ON flow_goals BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_goals', new.rowid, 'insert', NULL, json_object('id', new.id, 'flow_id', new.flow_id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'is_private', new.is_private), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_goals_update AFTER UPDATE ON flow_goals BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_goals', new.rowid, 'update', json_object('id', old.id, 'flow_id', old.flow_id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'position', old.position, 'is_private', old.is_private), json_object('id', new.id, 'flow_id', new.flow_id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'is_private', new.is_private), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_tasks_delete AFTER DELETE ON flow_tasks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_tasks', old.rowid, 'delete', json_object('id', old.id, 'flow_id', old.flow_id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'position', old.position, 'is_private', old.is_private, 'delegate_kind', old.delegate_kind, 'delegate_id', old.delegate_id, 'agentic', old.agentic, 'asynchronous', old.asynchronous, 'archival', old.archival), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_tasks_insert AFTER INSERT ON flow_tasks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_tasks', new.rowid, 'insert', NULL, json_object('id', new.id, 'flow_id', new.flow_id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'is_private', new.is_private, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'agentic', new.agentic, 'asynchronous', new.asynchronous, 'archival', new.archival), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_tasks_update AFTER UPDATE ON flow_tasks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_tasks', new.rowid, 'update', json_object('id', old.id, 'flow_id', old.flow_id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'position', old.position, 'is_private', old.is_private, 'delegate_kind', old.delegate_kind, 'delegate_id', old.delegate_id, 'agentic', old.agentic, 'asynchronous', old.asynchronous, 'archival', old.archival), json_object('id', new.id, 'flow_id', new.flow_id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'is_private', new.is_private, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'agentic', new.agentic, 'asynchronous', new.asynchronous, 'archival', new.archival), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flows_delete AFTER DELETE ON flows BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flows', old.rowid, 'delete', json_object('id', old.id, 'title', old.title, 'instance_type', old.instance_type, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'target_type', old.target_type, 'target_id', old.target_id, 'flow_duration_n', old.flow_duration_n, 'flow_duration_kind', old.flow_duration_kind, 'position', old.position, 'flow_window_part', old.flow_window_part, 'flow_window_time_start', old.flow_window_time_start, 'flow_window_time_end', old.flow_window_time_end, 'root_plan_kind', old.root_plan_kind, 'root_plan_start', old.root_plan_start, 'root_plan_end', old.root_plan_end, 'is_private', old.is_private, 'verdict_window_n', old.verdict_window_n, 'verdict_window_kind', old.verdict_window_kind, 'delegate_kind', old.delegate_kind, 'delegate_id', old.delegate_id, 'agentic', old.agentic, 'asynchronous', old.asynchronous, 'archival', old.archival), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flows_insert AFTER INSERT ON flows BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flows', new.rowid, 'insert', NULL, json_object('id', new.id, 'title', new.title, 'instance_type', new.instance_type, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'target_type', new.target_type, 'target_id', new.target_id, 'flow_duration_n', new.flow_duration_n, 'flow_duration_kind', new.flow_duration_kind, 'position', new.position, 'flow_window_part', new.flow_window_part, 'flow_window_time_start', new.flow_window_time_start, 'flow_window_time_end', new.flow_window_time_end, 'root_plan_kind', new.root_plan_kind, 'root_plan_start', new.root_plan_start, 'root_plan_end', new.root_plan_end, 'is_private', new.is_private, 'verdict_window_n', new.verdict_window_n, 'verdict_window_kind', new.verdict_window_kind, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'agentic', new.agentic, 'asynchronous', new.asynchronous, 'archival', new.archival), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flows_update AFTER UPDATE ON flows BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flows', new.rowid, 'update', json_object('id', old.id, 'title', old.title, 'instance_type', old.instance_type, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'target_type', old.target_type, 'target_id', old.target_id, 'flow_duration_n', old.flow_duration_n, 'flow_duration_kind', old.flow_duration_kind, 'position', old.position, 'flow_window_part', old.flow_window_part, 'flow_window_time_start', old.flow_window_time_start, 'flow_window_time_end', old.flow_window_time_end, 'root_plan_kind', old.root_plan_kind, 'root_plan_start', old.root_plan_start, 'root_plan_end', old.root_plan_end, 'is_private', old.is_private, 'verdict_window_n', old.verdict_window_n, 'verdict_window_kind', old.verdict_window_kind, 'delegate_kind', old.delegate_kind, 'delegate_id', old.delegate_id, 'agentic', old.agentic, 'asynchronous', old.asynchronous, 'archival', old.archival), json_object('id', new.id, 'title', new.title, 'instance_type', new.instance_type, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'target_type', new.target_type, 'target_id', new.target_id, 'flow_duration_n', new.flow_duration_n, 'flow_duration_kind', new.flow_duration_kind, 'position', new.position, 'flow_window_part', new.flow_window_part, 'flow_window_time_start', new.flow_window_time_start, 'flow_window_time_end', new.flow_window_time_end, 'root_plan_kind', new.root_plan_kind, 'root_plan_start', new.root_plan_start, 'root_plan_end', new.root_plan_end, 'is_private', new.is_private, 'verdict_window_n', new.verdict_window_n, 'verdict_window_kind', new.verdict_window_kind, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'agentic', new.agentic, 'asynchronous', new.asynchronous, 'archival', new.archival), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_goal_overlays_delete AFTER DELETE ON goal_overlays BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'goal_overlays', old.rowid, 'delete', json_object('id', old.id, 'flow_id', old.flow_id, 'item_type', old.item_type, 'item_id', old.item_id, 'iteration_scope', old.iteration_scope, 'cycle_id', old.cycle_id, 'status', old.status, 'resolved_at', old.resolved_at, 'tombstone', old.tombstone, 'title', old.title, 'is_private', old.is_private, 'position', old.position, 'block_reasons_set', old.block_reasons_set), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_goal_overlays_insert AFTER INSERT ON goal_overlays BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'goal_overlays', new.rowid, 'insert', NULL, json_object('id', new.id, 'flow_id', new.flow_id, 'item_type', new.item_type, 'item_id', new.item_id, 'iteration_scope', new.iteration_scope, 'cycle_id', new.cycle_id, 'status', new.status, 'resolved_at', new.resolved_at, 'tombstone', new.tombstone, 'title', new.title, 'is_private', new.is_private, 'position', new.position, 'block_reasons_set', new.block_reasons_set), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_goal_overlays_update AFTER UPDATE ON goal_overlays BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'goal_overlays', new.rowid, 'update', json_object('id', old.id, 'flow_id', old.flow_id, 'item_type', old.item_type, 'item_id', old.item_id, 'iteration_scope', old.iteration_scope, 'cycle_id', old.cycle_id, 'status', old.status, 'resolved_at', old.resolved_at, 'tombstone', old.tombstone, 'title', old.title, 'is_private', old.is_private, 'position', old.position, 'block_reasons_set', old.block_reasons_set), json_object('id', new.id, 'flow_id', new.flow_id, 'item_type', new.item_type, 'item_id', new.item_id, 'iteration_scope', new.iteration_scope, 'cycle_id', new.cycle_id, 'status', new.status, 'resolved_at', new.resolved_at, 'tombstone', new.tombstone, 'title', new.title, 'is_private', new.is_private, 'position', new.position, 'block_reasons_set', new.block_reasons_set), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_goals_delete AFTER DELETE ON goals BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'goals', old.rowid, 'delete', json_object('id', old.id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'status', old.status, 'position', old.position, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind, 'on_scope_exit', old.on_scope_exit, 'is_private', old.is_private), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_goals_insert AFTER INSERT ON goals BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'goals', new.rowid, 'insert', NULL, json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'status', new.status, 'position', new.position, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'on_scope_exit', new.on_scope_exit, 'is_private', new.is_private), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_goals_update AFTER UPDATE ON goals BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'goals', new.rowid, 'update', json_object('id', old.id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'status', old.status, 'position', old.position, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind, 'on_scope_exit', old.on_scope_exit, 'is_private', old.is_private), json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'status', new.status, 'position', new.position, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'on_scope_exit', new.on_scope_exit, 'is_private', new.is_private), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_task_overlays_delete AFTER DELETE ON task_overlays BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'task_overlays', old.rowid, 'delete', json_object('id', old.id, 'origin', old.origin, 'flow_id', old.flow_id, 'item_type', old.item_type, 'item_id', old.item_id, 'iteration_scope', old.iteration_scope, 'cycle_id', old.cycle_id, 'wait_key', old.wait_key, 'due_at', old.due_at, 'status', old.status, 'resolved_at', old.resolved_at, 'tombstone', old.tombstone, 'title', old.title, 'plan_start_id', old.plan_start_id, 'plan_end_id', old.plan_end_id, 'plan_set', old.plan_set, 'delegate_kind', old.delegate_kind, 'delegate_id', old.delegate_id, 'delegate_set', old.delegate_set, 'agentic', old.agentic, 'agentic_set', old.agentic_set, 'asynchronous', old.asynchronous, 'archival', old.archival, 'is_private', old.is_private, 'position', old.position, 'block_reasons_set', old.block_reasons_set, 'brief_priority', old.brief_priority, 'brief_priority_set', old.brief_priority_set, 'brief_spec', old.brief_spec, 'brief_design', old.brief_design, 'brief_acceptance', old.brief_acceptance, 'brief_notes', old.brief_notes, 'due_scope_start_id', old.due_scope_start_id, 'due_scope_end_id', old.due_scope_end_id), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_task_overlays_insert AFTER INSERT ON task_overlays BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'task_overlays', new.rowid, 'insert', NULL, json_object('id', new.id, 'origin', new.origin, 'flow_id', new.flow_id, 'item_type', new.item_type, 'item_id', new.item_id, 'iteration_scope', new.iteration_scope, 'cycle_id', new.cycle_id, 'wait_key', new.wait_key, 'due_at', new.due_at, 'status', new.status, 'resolved_at', new.resolved_at, 'tombstone', new.tombstone, 'title', new.title, 'plan_start_id', new.plan_start_id, 'plan_end_id', new.plan_end_id, 'plan_set', new.plan_set, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'delegate_set', new.delegate_set, 'agentic', new.agentic, 'agentic_set', new.agentic_set, 'asynchronous', new.asynchronous, 'archival', new.archival, 'is_private', new.is_private, 'position', new.position, 'block_reasons_set', new.block_reasons_set, 'brief_priority', new.brief_priority, 'brief_priority_set', new.brief_priority_set, 'brief_spec', new.brief_spec, 'brief_design', new.brief_design, 'brief_acceptance', new.brief_acceptance, 'brief_notes', new.brief_notes, 'due_scope_start_id', new.due_scope_start_id, 'due_scope_end_id', new.due_scope_end_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_task_overlays_update AFTER UPDATE ON task_overlays BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'task_overlays', new.rowid, 'update', json_object('id', old.id, 'origin', old.origin, 'flow_id', old.flow_id, 'item_type', old.item_type, 'item_id', old.item_id, 'iteration_scope', old.iteration_scope, 'cycle_id', old.cycle_id, 'wait_key', old.wait_key, 'due_at', old.due_at, 'status', old.status, 'resolved_at', old.resolved_at, 'tombstone', old.tombstone, 'title', old.title, 'plan_start_id', old.plan_start_id, 'plan_end_id', old.plan_end_id, 'plan_set', old.plan_set, 'delegate_kind', old.delegate_kind, 'delegate_id', old.delegate_id, 'delegate_set', old.delegate_set, 'agentic', old.agentic, 'agentic_set', old.agentic_set, 'asynchronous', old.asynchronous, 'archival', old.archival, 'is_private', old.is_private, 'position', old.position, 'block_reasons_set', old.block_reasons_set, 'brief_priority', old.brief_priority, 'brief_priority_set', old.brief_priority_set, 'brief_spec', old.brief_spec, 'brief_design', old.brief_design, 'brief_acceptance', old.brief_acceptance, 'brief_notes', old.brief_notes, 'due_scope_start_id', old.due_scope_start_id, 'due_scope_end_id', old.due_scope_end_id), json_object('id', new.id, 'origin', new.origin, 'flow_id', new.flow_id, 'item_type', new.item_type, 'item_id', new.item_id, 'iteration_scope', new.iteration_scope, 'cycle_id', new.cycle_id, 'wait_key', new.wait_key, 'due_at', new.due_at, 'status', new.status, 'resolved_at', new.resolved_at, 'tombstone', new.tombstone, 'title', new.title, 'plan_start_id', new.plan_start_id, 'plan_end_id', new.plan_end_id, 'plan_set', new.plan_set, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'delegate_set', new.delegate_set, 'agentic', new.agentic, 'agentic_set', new.agentic_set, 'asynchronous', new.asynchronous, 'archival', new.archival, 'is_private', new.is_private, 'position', new.position, 'block_reasons_set', new.block_reasons_set, 'brief_priority', new.brief_priority, 'brief_priority_set', new.brief_priority_set, 'brief_spec', new.brief_spec, 'brief_design', new.brief_design, 'brief_acceptance', new.brief_acceptance, 'brief_notes', new.brief_notes, 'due_scope_start_id', new.due_scope_start_id, 'due_scope_end_id', new.due_scope_end_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_tasks_delete AFTER DELETE ON tasks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tasks', old.rowid, 'delete', json_object('id', old.id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'status', old.status, 'delegate_kind', old.delegate_kind, 'delegate_id', old.delegate_id, 'position', old.position, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind, 'plan_start_id', old.plan_start_id, 'plan_end_id', old.plan_end_id, 'on_scope_exit', old.on_scope_exit, 'is_private', old.is_private, 'archival', old.archival, 'agentic', old.agentic, 'asynchronous', old.asynchronous, 'done_at', old.done_at, 'due_scope_start_id', old.due_scope_start_id, 'due_scope_end_id', old.due_scope_end_id, 'compound', old.compound), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_tasks_insert AFTER INSERT ON tasks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tasks', new.rowid, 'insert', NULL, json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'status', new.status, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'position', new.position, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'plan_start_id', new.plan_start_id, 'plan_end_id', new.plan_end_id, 'on_scope_exit', new.on_scope_exit, 'is_private', new.is_private, 'archival', new.archival, 'agentic', new.agentic, 'asynchronous', new.asynchronous, 'done_at', new.done_at, 'due_scope_start_id', new.due_scope_start_id, 'due_scope_end_id', new.due_scope_end_id, 'compound', new.compound), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_tasks_update AFTER UPDATE ON tasks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tasks', new.rowid, 'update', json_object('id', old.id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'status', old.status, 'delegate_kind', old.delegate_kind, 'delegate_id', old.delegate_id, 'position', old.position, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind, 'plan_start_id', old.plan_start_id, 'plan_end_id', old.plan_end_id, 'on_scope_exit', old.on_scope_exit, 'is_private', old.is_private, 'archival', old.archival, 'agentic', old.agentic, 'asynchronous', old.asynchronous, 'done_at', old.done_at, 'due_scope_start_id', old.due_scope_start_id, 'due_scope_end_id', old.due_scope_end_id, 'compound', old.compound), json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'status', new.status, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'position', new.position, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'plan_start_id', new.plan_start_id, 'plan_end_id', new.plan_end_id, 'on_scope_exit', new.on_scope_exit, 'is_private', new.is_private, 'archival', new.archival, 'agentic', new.agentic, 'asynchronous', new.asynchronous, 'done_at', new.done_at, 'due_scope_start_id', new.due_scope_start_id, 'due_scope_end_id', new.due_scope_end_id, 'compound', new.compound), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

-- The archive is a table like any other, so it is journaled like any other
-- (`tests/undo_journal.rs` holds every non-excluded table to its three triggers). Created after
-- the archive is filled, so the copy above is not itself a journaled write.
CREATE TRIGGER undo_journal_retired_beads_ids_insert AFTER INSERT ON retired_beads_ids BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'retired_beads_ids', new.rowid, 'insert', NULL, json_object('table_name', new.table_name, 'row_id', new.row_id, 'beads_id', new.beads_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_retired_beads_ids_update AFTER UPDATE ON retired_beads_ids BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'retired_beads_ids', new.rowid, 'update', json_object('table_name', old.table_name, 'row_id', old.row_id, 'beads_id', old.beads_id), json_object('table_name', new.table_name, 'row_id', new.row_id, 'beads_id', new.beads_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_retired_beads_ids_delete AFTER DELETE ON retired_beads_ids BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'retired_beads_ids', old.rowid, 'delete', json_object('table_name', old.table_name, 'row_id', old.row_id, 'beads_id', old.beads_id), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;
