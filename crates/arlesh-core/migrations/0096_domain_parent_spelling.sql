-- One spelling for a domains-table parent (Task 13c; ruled by the user, 2026-10-03).
--
-- Aspects, Projects, Domains and Tags are all rows of `domains`, but a reference to one was stored
-- under whichever subtype its writer used: `aspect`, `project`, `domain` or `tag`. A lookup that
-- read one spelling missed the children stored under another. Every such reference is now spelled
-- `domain`, the table's own name, as `mcp_roots.node_kind` already spells it; what kind of
-- domains-table row a parent is, is read from its `subtype`.
--
-- The reference columns that can name a domains-table row, all respelled here:
--
--   * `parent_type` of `tasks`, `goals`, `commitments`, `expectations`, `infos` and `flows`;
--   * `flows.target_type`, a Flow's Target Node;
--   * `flow_instance_nodes.original_parent_type`, where a started Flow put a node.
--
-- Every other polymorphic reference names no domains-table row: the flow item tables'
-- `parent_type`, `task_dependencies`, `derived_dependencies`, `derived_children`, `derived_tags`,
-- `block_reasons`, `template_*`, `flow_dependencies` and `flow_instances.root_type` name only
-- goals, tasks, commitments, waits, infos and flow items; `mcp_roots.node_kind` already says
-- `domain`. A tag link (`tags_on_*`, `template_tags`, `derived_tags`) is a plain `tag_id`.
--
-- SQLite cannot alter a CHECK, so the seven tables are rebuilt with their CHECKs naming `domain`
-- alone — `flows.target_type` and `flow_instance_nodes.original_parent_type`, which had none, gain
-- one. The hazard is 0084's and 0093's, and so is the answer: sqlx runs a SQLite migration inside a
-- transaction, where `PRAGMA foreign_keys = OFF` is a no-op, so dropping a table cascades to every
-- row that references it. Those rows are copied aside first and put back after, and the undo
-- journal is suppressed while they move. Dropping `flows` reaches its whole template and overlay
-- family, so the carried set is long; it was generated from the schema's own foreign keys.
--
-- The undo journal is **respelled, not reset**: an image written under an old spelling is rewritten
-- to `domain`, as the row it describes now is, so a Gesture taken before the migration replays
-- onto the new CHECKs. Resetting would lose nothing at an app start (`undo::reset_journal` empties
-- the journal then anyway), but the MCP server and the Python bindings migrate the same file, and a
-- desktop app already running would be left holding Undo Stack entries for rows the reset deleted.

UPDATE undo_context SET suppressed = 1 WHERE id = 1;

-- 1. Copy aside every row a drop below would cascade away, and every link one would clear.
CREATE TABLE carry_commitment_overlays AS SELECT id, flow_id, item_type, item_id, iteration_scope, cycle_id, verdict, resolved_at, tombstone, title, is_private, position FROM commitment_overlays;
CREATE TABLE carry_derived_block_reasons AS SELECT id, flow_id, node_kind, node_key, reason, position FROM derived_block_reasons;
CREATE TABLE carry_derived_children AS SELECT id, flow_id, parent_kind, parent_key, window_start_scope_id, window_end_scope_id, child_type, child_id FROM derived_children;
CREATE TABLE carry_derived_dependencies AS SELECT id, flow_id, dependent_id, dependent_key, target_type, target_id, target_key, added FROM derived_dependencies;
CREATE TABLE carry_derived_tags AS SELECT id, flow_id, node_kind, node_key, tag_id, added FROM derived_tags;
CREATE TABLE carry_expectation_overlays AS SELECT node_key, flow_id, occurrence_key, title, time_scope_start_id, time_scope_end_id, time_scope_duration_n, time_scope_duration_kind, time_scope_set, check_every_n, check_every_kind, check_every_set, check_starting, is_private, archival, agentic, agentic_note, agentic_note_set, agentic_question, agentic_answer, agentic_answer_set, status, released_at FROM expectation_overlays;
CREATE TABLE carry_flow_async_templates AS SELECT flow_id, title, time_scope_n, time_scope_kind, check_every_n, check_every_kind FROM flow_async_templates;
CREATE TABLE carry_flow_commitments AS SELECT id, flow_id, title, parent_type, parent_id, position, is_private, verdict_window_n, verdict_window_kind FROM flow_commitments;
CREATE TABLE carry_flow_dependencies AS SELECT id, flow_id, dependent_type, dependent_id, depends_on_type, depends_on_id FROM flow_dependencies;
CREATE TABLE carry_flow_expectations AS SELECT id, flow_id, title, parent_type, parent_id, position, is_private, check_every_n, check_every_kind, first_check_kind, first_check_index FROM flow_expectations;
CREATE TABLE carry_flow_goals AS SELECT id, flow_id, title, parent_type, parent_id, position, is_private FROM flow_goals;
CREATE TABLE carry_flow_item_cycles AS SELECT id, flow_id, item_type, item_id, scope_kind, scope_index, plan_kind, plan_start, plan_end, position FROM flow_item_cycles;
CREATE TABLE carry_flow_recurrences AS SELECT flow_id, start_scope_id, gap_n, gap_kind, end_scope_id, clock, miss_policy, cooldown_n, cooldown_kind FROM flow_recurrences;
CREATE TABLE carry_flow_tasks AS SELECT id, flow_id, title, parent_type, parent_id, position, is_private, delegate_kind, delegate_id, agentic, asynchronous, archival, compound FROM flow_tasks;
CREATE TABLE carry_goal_knowledge_base_links AS SELECT goal_id, entity_type, entity_id FROM goal_knowledge_base_links;
CREATE TABLE carry_goal_overlays AS SELECT id, flow_id, item_type, item_id, iteration_scope, cycle_id, status, resolved_at, tombstone, title, is_private, position, block_reasons_set FROM goal_overlays;
CREATE TABLE carry_occurrence_async_templates AS SELECT node_key, flow_id, title, time_scope_n, time_scope_kind, check_every_n, check_every_kind FROM occurrence_async_templates;
CREATE TABLE carry_occurrence_spawned_waits AS SELECT node_key, flow_id, status, archival, released_at FROM occurrence_spawned_waits;
CREATE TABLE carry_spawned_waits AS SELECT task_id, status, archival, last_check_at, released_at FROM spawned_waits;
CREATE TABLE carry_tags_on_commitments AS SELECT commitment_id, tag_id FROM tags_on_commitments;
CREATE TABLE carry_tags_on_expectations AS SELECT expectation_id, tag_id FROM tags_on_expectations;
CREATE TABLE carry_tags_on_goals AS SELECT goal_id, tag_id FROM tags_on_goals;
CREATE TABLE carry_tags_on_tasks AS SELECT task_id, tag_id FROM tags_on_tasks;
CREATE TABLE carry_task_agentic_briefs AS SELECT task_id, priority, spec, design, acceptance, notes FROM task_agentic_briefs;
CREATE TABLE carry_task_async_templates AS SELECT task_id, title, time_scope_n, time_scope_kind, check_every_n, check_every_kind FROM task_async_templates;
CREATE TABLE carry_task_dependencies AS SELECT task_id, dependency_type, dependency_id FROM task_dependencies;
CREATE TABLE carry_task_knowledge_base_links AS SELECT task_id, entity_type, entity_id FROM task_knowledge_base_links;
CREATE TABLE carry_task_overlays AS SELECT id, origin, flow_id, item_type, item_id, iteration_scope, cycle_id, wait_key, due_at, status, resolved_at, tombstone, title, plan_start_id, plan_end_id, plan_set, delegate_kind, delegate_id, delegate_set, agentic, agentic_set, asynchronous, archival, is_private, position, block_reasons_set, brief_priority, brief_priority_set, brief_spec, brief_design, brief_acceptance, brief_notes, due_scope_start_id, due_scope_end_id, compound, async_template_set FROM task_overlays;
CREATE TABLE carry_flow_task_async_templates AS SELECT flow_task_id, title, time_scope_n, time_scope_kind, check_every_n, check_every_kind FROM flow_task_async_templates;
CREATE TABLE carry_tags_on_async_templates AS SELECT task_id, tag_id FROM tags_on_async_templates;
CREATE TABLE carry_tags_on_flow_async_templates AS SELECT flow_id, tag_id FROM tags_on_flow_async_templates;
CREATE TABLE carry_tags_on_occurrence_async_templates AS SELECT node_key, tag_id FROM tags_on_occurrence_async_templates;
CREATE TABLE carry_tags_on_flow_task_async_templates AS SELECT flow_task_id, tag_id FROM tags_on_flow_task_async_templates;
CREATE TABLE carry_flow_instances AS SELECT id, flow_id FROM flow_instances;

-- 2. Rebuild each table, its references respelled and its CHECKs tightened. Its indexes and
--    triggers are recreated exactly as they stood: no column changed, so the undo journal's
--    images still fit.

-- tasks
CREATE TABLE tasks_new (
    id                       INTEGER PRIMARY KEY,
    title                    TEXT NOT NULL,
    parent_type              TEXT NOT NULL
                                 CHECK (parent_type IN ('domain', 'goal', 'task', 'commitment')),
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
);
INSERT INTO tasks_new (id, title, parent_type, parent_id, status, delegate_kind, delegate_id, position, time_scope_start_id, time_scope_end_id, time_scope_duration_n, time_scope_duration_kind, plan_start_id, plan_end_id, on_scope_exit, is_private, archival, agentic, asynchronous, done_at, due_scope_start_id, due_scope_end_id, compound)
SELECT id, title, CASE WHEN parent_type IN ('aspect', 'project', 'tag') THEN 'domain' ELSE parent_type END, parent_id, status, delegate_kind, delegate_id, position, time_scope_start_id, time_scope_end_id, time_scope_duration_n, time_scope_duration_kind, plan_start_id, plan_end_id, on_scope_exit, is_private, archival, agentic, asynchronous, done_at, due_scope_start_id, due_scope_end_id, compound FROM tasks;
DROP TABLE tasks;
ALTER TABLE tasks_new RENAME TO tasks;
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
CREATE TRIGGER undo_journal_tasks_delete AFTER DELETE ON tasks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tasks', old.rowid, 'delete', json_object('id', old.id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'status', old.status, 'delegate_kind', old.delegate_kind, 'delegate_id', old.delegate_id, 'position', old.position, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind, 'plan_start_id', old.plan_start_id, 'plan_end_id', old.plan_end_id, 'on_scope_exit', old.on_scope_exit, 'is_private', old.is_private, 'archival', old.archival, 'agentic', old.agentic, 'asynchronous', old.asynchronous, 'done_at', old.done_at, 'due_scope_start_id', old.due_scope_start_id, 'due_scope_end_id', old.due_scope_end_id, 'compound', old.compound), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;
CREATE TRIGGER mcp_roots_forget_task AFTER DELETE ON tasks
WHEN (SELECT suppressed FROM undo_context WHERE id = 1) = 0 BEGIN
    DELETE FROM mcp_roots WHERE node_kind = 'task' AND node_id = old.id;
END;

-- goals
CREATE TABLE goals_new (
    id                       INTEGER PRIMARY KEY,
    title                    TEXT NOT NULL,
    parent_type              TEXT NOT NULL CHECK (parent_type IN ('domain', 'goal')),
    parent_id                INTEGER NOT NULL,
    status                   TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'achieved', 'frozen', 'archived')),
    position                 INTEGER NOT NULL DEFAULT 0,
    time_scope_start_id      TEXT,
    time_scope_end_id        TEXT,
    time_scope_duration_n    INTEGER,
    time_scope_duration_kind TEXT,
    on_scope_exit            TEXT CHECK (on_scope_exit IS NULL OR on_scope_exit IN ('archive', 'keep')),
    is_private               BOOLEAN NOT NULL DEFAULT 0,
    achieved_at TEXT,
    CHECK (time_scope_start_id IS NULL OR json_valid(time_scope_start_id)),
    CHECK (time_scope_end_id IS NULL OR json_valid(time_scope_end_id))
);
INSERT INTO goals_new (id, title, parent_type, parent_id, status, position, time_scope_start_id, time_scope_end_id, time_scope_duration_n, time_scope_duration_kind, on_scope_exit, is_private, achieved_at)
SELECT id, title, CASE WHEN parent_type IN ('aspect', 'project', 'tag') THEN 'domain' ELSE parent_type END, parent_id, status, position, time_scope_start_id, time_scope_end_id, time_scope_duration_n, time_scope_duration_kind, on_scope_exit, is_private, achieved_at FROM goals;
DROP TABLE goals;
ALTER TABLE goals_new RENAME TO goals;
CREATE TRIGGER mcp_roots_forget_goal AFTER DELETE ON goals
WHEN (SELECT suppressed FROM undo_context WHERE id = 1) = 0 BEGIN
    DELETE FROM mcp_roots WHERE node_kind = 'goal' AND node_id = old.id;
END;
CREATE TRIGGER undo_journal_goals_delete AFTER DELETE ON goals BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'goals', old.rowid, 'delete', json_object('id', old.id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'status', old.status, 'position', old.position, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind, 'on_scope_exit', old.on_scope_exit, 'is_private', old.is_private, 'achieved_at', old.achieved_at), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;
CREATE TRIGGER undo_journal_goals_insert AFTER INSERT ON goals BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'goals', new.rowid, 'insert', NULL, json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'status', new.status, 'position', new.position, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'on_scope_exit', new.on_scope_exit, 'is_private', new.is_private, 'achieved_at', new.achieved_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;
CREATE TRIGGER undo_journal_goals_update AFTER UPDATE ON goals BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'goals', new.rowid, 'update', json_object('id', old.id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'status', old.status, 'position', old.position, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind, 'on_scope_exit', old.on_scope_exit, 'is_private', old.is_private, 'achieved_at', old.achieved_at), json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'status', new.status, 'position', new.position, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'on_scope_exit', new.on_scope_exit, 'is_private', new.is_private, 'achieved_at', new.achieved_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

-- commitments
CREATE TABLE commitments_new (
    id                       INTEGER PRIMARY KEY,
    title                    TEXT NOT NULL,
    parent_type              TEXT NOT NULL
                                 CHECK (parent_type IN ('domain', 'goal', 'task', 'commitment')),
    parent_id                INTEGER NOT NULL,
    verdict                  TEXT NOT NULL DEFAULT 'unresolved'
                                 CHECK (verdict IN ('unresolved', 'kept', 'broken')),
    time_scope_start_id      TEXT,
    time_scope_end_id        TEXT,
    time_scope_duration_n    INTEGER,
    time_scope_duration_kind TEXT,
    verdict_window_n         INTEGER,
    verdict_window_kind      TEXT,
    position                 INTEGER NOT NULL DEFAULT 0,
    is_private               BOOLEAN NOT NULL DEFAULT 0,
    verdict_at TEXT, archival TEXT NOT NULL DEFAULT 'live'
    CHECK (archival IN ('live', 'archived')),
    CHECK (time_scope_start_id IS NULL OR json_valid(time_scope_start_id)),
    CHECK (time_scope_end_id IS NULL OR json_valid(time_scope_end_id)),
    CHECK ((verdict_window_n IS NULL) = (verdict_window_kind IS NULL))
);
INSERT INTO commitments_new (id, title, parent_type, parent_id, verdict, time_scope_start_id, time_scope_end_id, time_scope_duration_n, time_scope_duration_kind, verdict_window_n, verdict_window_kind, position, is_private, verdict_at, archival)
SELECT id, title, CASE WHEN parent_type IN ('aspect', 'project', 'tag') THEN 'domain' ELSE parent_type END, parent_id, verdict, time_scope_start_id, time_scope_end_id, time_scope_duration_n, time_scope_duration_kind, verdict_window_n, verdict_window_kind, position, is_private, verdict_at, archival FROM commitments;
DROP TABLE commitments;
ALTER TABLE commitments_new RENAME TO commitments;
CREATE INDEX idx_commitments_parent ON commitments (parent_type, parent_id);
CREATE TRIGGER mcp_roots_forget_commitment AFTER DELETE ON commitments
WHEN (SELECT suppressed FROM undo_context WHERE id = 1) = 0 BEGIN
    DELETE FROM mcp_roots WHERE node_kind = 'commitment' AND node_id = old.id;
END;
CREATE TRIGGER undo_journal_commitments_insert AFTER INSERT ON commitments BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'commitments', new.rowid, 'insert', NULL, json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'verdict', new.verdict, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'verdict_window_n', new.verdict_window_n, 'verdict_window_kind', new.verdict_window_kind, 'position', new.position, 'is_private', new.is_private, 'verdict_at', new.verdict_at, 'archival', new.archival), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;
CREATE TRIGGER undo_journal_commitments_update AFTER UPDATE ON commitments BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'commitments', new.rowid, 'update', json_object('id', old.id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'verdict', old.verdict, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind, 'verdict_window_n', old.verdict_window_n, 'verdict_window_kind', old.verdict_window_kind, 'position', old.position, 'is_private', old.is_private, 'verdict_at', old.verdict_at, 'archival', old.archival), json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'verdict', new.verdict, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'verdict_window_n', new.verdict_window_n, 'verdict_window_kind', new.verdict_window_kind, 'position', new.position, 'is_private', new.is_private, 'verdict_at', new.verdict_at, 'archival', new.archival), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;
CREATE TRIGGER undo_journal_commitments_delete AFTER DELETE ON commitments BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'commitments', old.rowid, 'delete', json_object('id', old.id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'verdict', old.verdict, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind, 'verdict_window_n', old.verdict_window_n, 'verdict_window_kind', old.verdict_window_kind, 'position', old.position, 'is_private', old.is_private, 'verdict_at', old.verdict_at, 'archival', old.archival), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

-- expectations
CREATE TABLE expectations_new (
    id                       INTEGER PRIMARY KEY,
    title                    TEXT NOT NULL,
    parent_type              TEXT NOT NULL
                                 CHECK (parent_type IN ('domain', 'goal', 'task', 'commitment')),
    parent_id                INTEGER NOT NULL,
    status                   TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'released')),
    archival                 TEXT NOT NULL DEFAULT 'live' CHECK (archival IN ('live', 'archived')),
    position                 INTEGER NOT NULL DEFAULT 0,
    is_private               BOOLEAN NOT NULL DEFAULT 0,
    time_scope_start_id      TEXT,
    time_scope_end_id        TEXT,
    time_scope_duration_n    INTEGER,
    time_scope_duration_kind TEXT,
    check_every_n            INTEGER,
    check_every_kind         TEXT,
    check_starting           TEXT,
    last_check_at            TEXT, agentic INTEGER NOT NULL DEFAULT 0 CHECK (agentic IN (0, 1)), agentic_note TEXT, agentic_question INTEGER NOT NULL DEFAULT 1
    CHECK (agentic_question IN (0, 1)), agentic_answer TEXT, released_at TEXT,
    CHECK (time_scope_start_id IS NULL OR json_valid(time_scope_start_id)),
    CHECK (time_scope_end_id IS NULL OR json_valid(time_scope_end_id)),
    CHECK ((check_every_n IS NULL) = (check_every_kind IS NULL))
);
INSERT INTO expectations_new (id, title, parent_type, parent_id, status, archival, position, is_private, time_scope_start_id, time_scope_end_id, time_scope_duration_n, time_scope_duration_kind, check_every_n, check_every_kind, check_starting, last_check_at, agentic, agentic_note, agentic_question, agentic_answer, released_at)
SELECT id, title, CASE WHEN parent_type IN ('aspect', 'project', 'tag') THEN 'domain' ELSE parent_type END, parent_id, status, archival, position, is_private, time_scope_start_id, time_scope_end_id, time_scope_duration_n, time_scope_duration_kind, check_every_n, check_every_kind, check_starting, last_check_at, agentic, agentic_note, agentic_question, agentic_answer, released_at FROM expectations;
DROP TABLE expectations;
ALTER TABLE expectations_new RENAME TO expectations;
CREATE INDEX idx_expectations_parent ON expectations (parent_type, parent_id);
CREATE TRIGGER mcp_roots_forget_expectation AFTER DELETE ON expectations
WHEN (SELECT suppressed FROM undo_context WHERE id = 1) = 0 BEGIN
    DELETE FROM mcp_roots WHERE node_kind = 'expectation' AND node_id = old.id;
END;
CREATE TRIGGER undo_journal_expectations_insert AFTER INSERT ON expectations BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'expectations', new.rowid, 'insert', NULL, json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'status', new.status, 'archival', new.archival, 'position', new.position, 'is_private', new.is_private, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind, 'check_starting', new.check_starting, 'last_check_at', new.last_check_at, 'agentic', new.agentic, 'agentic_note', new.agentic_note, 'agentic_question', new.agentic_question, 'agentic_answer', new.agentic_answer, 'released_at', new.released_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;
CREATE TRIGGER undo_journal_expectations_update AFTER UPDATE ON expectations BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'expectations', new.rowid, 'update', json_object('id', old.id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'status', old.status, 'archival', old.archival, 'position', old.position, 'is_private', old.is_private, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind, 'check_every_n', old.check_every_n, 'check_every_kind', old.check_every_kind, 'check_starting', old.check_starting, 'last_check_at', old.last_check_at, 'agentic', old.agentic, 'agentic_note', old.agentic_note, 'agentic_question', old.agentic_question, 'agentic_answer', old.agentic_answer, 'released_at', old.released_at), json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'status', new.status, 'archival', new.archival, 'position', new.position, 'is_private', new.is_private, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind, 'check_starting', new.check_starting, 'last_check_at', new.last_check_at, 'agentic', new.agentic, 'agentic_note', new.agentic_note, 'agentic_question', new.agentic_question, 'agentic_answer', new.agentic_answer, 'released_at', new.released_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;
CREATE TRIGGER undo_journal_expectations_delete AFTER DELETE ON expectations BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'expectations', old.rowid, 'delete', json_object('id', old.id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'status', old.status, 'archival', old.archival, 'position', old.position, 'is_private', old.is_private, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind, 'check_every_n', old.check_every_n, 'check_every_kind', old.check_every_kind, 'check_starting', old.check_starting, 'last_check_at', old.last_check_at, 'agentic', old.agentic, 'agentic_note', old.agentic_note, 'agentic_question', old.agentic_question, 'agentic_answer', old.agentic_answer, 'released_at', old.released_at), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

-- infos
CREATE TABLE infos_new (
    id          INTEGER PRIMARY KEY,
    body        TEXT NOT NULL,
    parent_type TEXT NOT NULL
                    CHECK (parent_type IN ('domain', 'goal', 'task', 'commitment', 'expectation', 'info')),
    parent_id   INTEGER NOT NULL,
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    details     TEXT,
    is_private  BOOLEAN NOT NULL DEFAULT 0
);
INSERT INTO infos_new (id, body, parent_type, parent_id, position, created_at, updated_at, details, is_private)
SELECT id, body, CASE WHEN parent_type IN ('aspect', 'project', 'tag') THEN 'domain' ELSE parent_type END, parent_id, position, created_at, updated_at, details, is_private FROM infos;
DROP TABLE infos;
ALTER TABLE infos_new RENAME TO infos;
CREATE TRIGGER undo_journal_infos_insert AFTER INSERT ON infos BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'infos', new.rowid, 'insert', NULL, json_object('id', new.id, 'body', new.body, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'created_at', new.created_at, 'updated_at', new.updated_at, 'details', new.details, 'is_private', new.is_private), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;
CREATE TRIGGER undo_journal_infos_update AFTER UPDATE ON infos BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'infos', new.rowid, 'update', json_object('id', old.id, 'body', old.body, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'position', old.position, 'created_at', old.created_at, 'updated_at', old.updated_at, 'details', old.details, 'is_private', old.is_private), json_object('id', new.id, 'body', new.body, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'created_at', new.created_at, 'updated_at', new.updated_at, 'details', new.details, 'is_private', new.is_private), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;
CREATE TRIGGER undo_journal_infos_delete AFTER DELETE ON infos BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'infos', old.rowid, 'delete', json_object('id', old.id, 'body', old.body, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'position', old.position, 'created_at', old.created_at, 'updated_at', old.updated_at, 'details', old.details, 'is_private', old.is_private), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;
CREATE TRIGGER mcp_roots_forget_info AFTER DELETE ON infos
WHEN (SELECT suppressed FROM undo_context WHERE id = 1) = 0 BEGIN
    DELETE FROM mcp_roots WHERE node_kind = 'info' AND node_id = old.id;
END;

-- flows
CREATE TABLE flows_new (
    id                     INTEGER PRIMARY KEY,
    title                  TEXT NOT NULL,
    instance_type          TEXT NOT NULL CHECK (instance_type IN ('goal', 'task', 'commitment')),
    parent_type            TEXT NOT NULL CHECK (parent_type IN ('domain', 'goal')),
    parent_id              INTEGER NOT NULL,
    target_type            TEXT CHECK (target_type IS NULL OR target_type IN ('domain', 'goal', 'task')),
    target_id              INTEGER,
    flow_duration_n        INTEGER,
    flow_duration_kind     TEXT,
    position               INTEGER NOT NULL DEFAULT 0,
    flow_window_part       TEXT
                               CHECK (flow_window_part IS NULL OR flow_window_part IN
                                   ('morning', 'noon', 'afternoon', 'evening', 'night', 'premorning')),
    flow_window_time_start TEXT,
    flow_window_time_end   TEXT,
    root_plan_kind         TEXT,
    root_plan_start        INTEGER,
    root_plan_end          INTEGER,
    is_private             BOOLEAN NOT NULL DEFAULT 0
, verdict_window_n INTEGER, verdict_window_kind TEXT, delegate_kind TEXT CHECK (delegate_kind IN ('person', 'agent')), delegate_id INTEGER REFERENCES people(id), agentic INTEGER CHECK (agentic IN (0, 1)), asynchronous INTEGER NOT NULL DEFAULT 0 CHECK (asynchronous IN (0, 1)), archival TEXT NOT NULL DEFAULT 'live' CHECK (archival IN ('live', 'backlog')), compound INTEGER NOT NULL DEFAULT 0 CHECK (compound IN (0, 1)));
INSERT INTO flows_new (id, title, instance_type, parent_type, parent_id, target_type, target_id, flow_duration_n, flow_duration_kind, position, flow_window_part, flow_window_time_start, flow_window_time_end, root_plan_kind, root_plan_start, root_plan_end, is_private, verdict_window_n, verdict_window_kind, delegate_kind, delegate_id, agentic, asynchronous, archival, compound)
SELECT id, title, instance_type, CASE WHEN parent_type IN ('aspect', 'project', 'tag') THEN 'domain' ELSE parent_type END, parent_id, CASE WHEN target_type IN ('aspect', 'project', 'tag') THEN 'domain' ELSE target_type END, target_id, flow_duration_n, flow_duration_kind, position, flow_window_part, flow_window_time_start, flow_window_time_end, root_plan_kind, root_plan_start, root_plan_end, is_private, verdict_window_n, verdict_window_kind, delegate_kind, delegate_id, agentic, asynchronous, archival, compound FROM flows;
DROP TABLE flows;
ALTER TABLE flows_new RENAME TO flows;
CREATE TRIGGER mcp_roots_forget_flow AFTER DELETE ON flows
WHEN (SELECT suppressed FROM undo_context WHERE id = 1) = 0 BEGIN
    DELETE FROM mcp_roots WHERE node_kind = 'flow' AND node_id = old.id;
END;
CREATE TRIGGER flows_refuse_agent_delegate_insert BEFORE INSERT ON flows
WHEN new.delegate_kind = 'agent' BEGIN
    SELECT RAISE(ABORT, 'the Agent delegate was removed; an agent holds a Task as On Agent');
END;
CREATE TRIGGER flows_refuse_agent_delegate_update BEFORE UPDATE OF delegate_kind ON flows
WHEN new.delegate_kind = 'agent' BEGIN
    SELECT RAISE(ABORT, 'the Agent delegate was removed; an agent holds a Task as On Agent');
END;
CREATE TRIGGER undo_journal_flows_delete AFTER DELETE ON flows BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flows', old.rowid, 'delete', json_object('id', old.id, 'title', old.title, 'instance_type', old.instance_type, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'target_type', old.target_type, 'target_id', old.target_id, 'flow_duration_n', old.flow_duration_n, 'flow_duration_kind', old.flow_duration_kind, 'position', old.position, 'flow_window_part', old.flow_window_part, 'flow_window_time_start', old.flow_window_time_start, 'flow_window_time_end', old.flow_window_time_end, 'root_plan_kind', old.root_plan_kind, 'root_plan_start', old.root_plan_start, 'root_plan_end', old.root_plan_end, 'is_private', old.is_private, 'verdict_window_n', old.verdict_window_n, 'verdict_window_kind', old.verdict_window_kind, 'delegate_kind', old.delegate_kind, 'delegate_id', old.delegate_id, 'agentic', old.agentic, 'asynchronous', old.asynchronous, 'archival', old.archival, 'compound', old.compound), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;
CREATE TRIGGER undo_journal_flows_insert AFTER INSERT ON flows BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flows', new.rowid, 'insert', NULL, json_object('id', new.id, 'title', new.title, 'instance_type', new.instance_type, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'target_type', new.target_type, 'target_id', new.target_id, 'flow_duration_n', new.flow_duration_n, 'flow_duration_kind', new.flow_duration_kind, 'position', new.position, 'flow_window_part', new.flow_window_part, 'flow_window_time_start', new.flow_window_time_start, 'flow_window_time_end', new.flow_window_time_end, 'root_plan_kind', new.root_plan_kind, 'root_plan_start', new.root_plan_start, 'root_plan_end', new.root_plan_end, 'is_private', new.is_private, 'verdict_window_n', new.verdict_window_n, 'verdict_window_kind', new.verdict_window_kind, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'agentic', new.agentic, 'asynchronous', new.asynchronous, 'archival', new.archival, 'compound', new.compound), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;
CREATE TRIGGER undo_journal_flows_update AFTER UPDATE ON flows BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flows', new.rowid, 'update', json_object('id', old.id, 'title', old.title, 'instance_type', old.instance_type, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'target_type', old.target_type, 'target_id', old.target_id, 'flow_duration_n', old.flow_duration_n, 'flow_duration_kind', old.flow_duration_kind, 'position', old.position, 'flow_window_part', old.flow_window_part, 'flow_window_time_start', old.flow_window_time_start, 'flow_window_time_end', old.flow_window_time_end, 'root_plan_kind', old.root_plan_kind, 'root_plan_start', old.root_plan_start, 'root_plan_end', old.root_plan_end, 'is_private', old.is_private, 'verdict_window_n', old.verdict_window_n, 'verdict_window_kind', old.verdict_window_kind, 'delegate_kind', old.delegate_kind, 'delegate_id', old.delegate_id, 'agentic', old.agentic, 'asynchronous', old.asynchronous, 'archival', old.archival, 'compound', old.compound), json_object('id', new.id, 'title', new.title, 'instance_type', new.instance_type, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'target_type', new.target_type, 'target_id', new.target_id, 'flow_duration_n', new.flow_duration_n, 'flow_duration_kind', new.flow_duration_kind, 'position', new.position, 'flow_window_part', new.flow_window_part, 'flow_window_time_start', new.flow_window_time_start, 'flow_window_time_end', new.flow_window_time_end, 'root_plan_kind', new.root_plan_kind, 'root_plan_start', new.root_plan_start, 'root_plan_end', new.root_plan_end, 'is_private', new.is_private, 'verdict_window_n', new.verdict_window_n, 'verdict_window_kind', new.verdict_window_kind, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'agentic', new.agentic, 'asynchronous', new.asynchronous, 'archival', new.archival, 'compound', new.compound), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

-- flow_instance_nodes
CREATE TABLE flow_instance_nodes_new (
    id                   INTEGER PRIMARY KEY,
    flow_instance_id     INTEGER NOT NULL REFERENCES flow_instances(id) ON DELETE CASCADE,
    node_type            TEXT NOT NULL
                             CHECK (node_type IN ('goal', 'task', 'commitment', 'expectation')),
    node_id              INTEGER NOT NULL,
    source_item_type     TEXT NOT NULL
                             CHECK (source_item_type IN
                                 ('flow', 'flow_goal', 'flow_task', 'flow_commitment', 'flow_expectation')),
    source_item_id       INTEGER NOT NULL,
    original_parent_type TEXT NOT NULL
                             CHECK (original_parent_type IN ('domain', 'goal', 'task', 'commitment')),
    original_parent_id   INTEGER NOT NULL
);
INSERT INTO flow_instance_nodes_new (id, flow_instance_id, node_type, node_id, source_item_type, source_item_id, original_parent_type, original_parent_id)
SELECT id, flow_instance_id, node_type, node_id, source_item_type, source_item_id, CASE WHEN original_parent_type IN ('aspect', 'project', 'tag') THEN 'domain' ELSE original_parent_type END, original_parent_id FROM flow_instance_nodes;
DROP TABLE flow_instance_nodes;
ALTER TABLE flow_instance_nodes_new RENAME TO flow_instance_nodes;
CREATE INDEX idx_flow_instance_nodes_instance ON flow_instance_nodes (flow_instance_id);
CREATE INDEX idx_flow_instance_nodes_node ON flow_instance_nodes (node_type, node_id);
CREATE TRIGGER undo_journal_flow_instance_nodes_insert AFTER INSERT ON flow_instance_nodes BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_instance_nodes', new.rowid, 'insert', NULL, json_object('id', new.id, 'flow_instance_id', new.flow_instance_id, 'node_type', new.node_type, 'node_id', new.node_id, 'source_item_type', new.source_item_type, 'source_item_id', new.source_item_id, 'original_parent_type', new.original_parent_type, 'original_parent_id', new.original_parent_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;
CREATE TRIGGER undo_journal_flow_instance_nodes_update AFTER UPDATE ON flow_instance_nodes BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_instance_nodes', new.rowid, 'update', json_object('id', old.id, 'flow_instance_id', old.flow_instance_id, 'node_type', old.node_type, 'node_id', old.node_id, 'source_item_type', old.source_item_type, 'source_item_id', old.source_item_id, 'original_parent_type', old.original_parent_type, 'original_parent_id', old.original_parent_id), json_object('id', new.id, 'flow_instance_id', new.flow_instance_id, 'node_type', new.node_type, 'node_id', new.node_id, 'source_item_type', new.source_item_type, 'source_item_id', new.source_item_id, 'original_parent_type', new.original_parent_type, 'original_parent_id', new.original_parent_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;
CREATE TRIGGER undo_journal_flow_instance_nodes_delete AFTER DELETE ON flow_instance_nodes BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_instance_nodes', old.rowid, 'delete', json_object('id', old.id, 'flow_instance_id', old.flow_instance_id, 'node_type', old.node_type, 'node_id', old.node_id, 'source_item_type', old.source_item_type, 'source_item_id', old.source_item_id, 'original_parent_type', old.original_parent_type, 'original_parent_id', old.original_parent_id), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

-- 3. Put the carried rows back, parents before children, and the cleared links with them.
DELETE FROM commitment_overlays;
INSERT INTO commitment_overlays (id, flow_id, item_type, item_id, iteration_scope, cycle_id, verdict, resolved_at, tombstone, title, is_private, position) SELECT id, flow_id, item_type, item_id, iteration_scope, cycle_id, verdict, resolved_at, tombstone, title, is_private, position FROM carry_commitment_overlays;
DROP TABLE carry_commitment_overlays;
DELETE FROM derived_block_reasons;
INSERT INTO derived_block_reasons (id, flow_id, node_kind, node_key, reason, position) SELECT id, flow_id, node_kind, node_key, reason, position FROM carry_derived_block_reasons;
DROP TABLE carry_derived_block_reasons;
DELETE FROM derived_children;
INSERT INTO derived_children (id, flow_id, parent_kind, parent_key, window_start_scope_id, window_end_scope_id, child_type, child_id) SELECT id, flow_id, parent_kind, parent_key, window_start_scope_id, window_end_scope_id, child_type, child_id FROM carry_derived_children;
DROP TABLE carry_derived_children;
DELETE FROM derived_dependencies;
INSERT INTO derived_dependencies (id, flow_id, dependent_id, dependent_key, target_type, target_id, target_key, added) SELECT id, flow_id, dependent_id, dependent_key, target_type, target_id, target_key, added FROM carry_derived_dependencies;
DROP TABLE carry_derived_dependencies;
DELETE FROM derived_tags;
INSERT INTO derived_tags (id, flow_id, node_kind, node_key, tag_id, added) SELECT id, flow_id, node_kind, node_key, tag_id, added FROM carry_derived_tags;
DROP TABLE carry_derived_tags;
DELETE FROM expectation_overlays;
INSERT INTO expectation_overlays (node_key, flow_id, occurrence_key, title, time_scope_start_id, time_scope_end_id, time_scope_duration_n, time_scope_duration_kind, time_scope_set, check_every_n, check_every_kind, check_every_set, check_starting, is_private, archival, agentic, agentic_note, agentic_note_set, agentic_question, agentic_answer, agentic_answer_set, status, released_at) SELECT node_key, flow_id, occurrence_key, title, time_scope_start_id, time_scope_end_id, time_scope_duration_n, time_scope_duration_kind, time_scope_set, check_every_n, check_every_kind, check_every_set, check_starting, is_private, archival, agentic, agentic_note, agentic_note_set, agentic_question, agentic_answer, agentic_answer_set, status, released_at FROM carry_expectation_overlays;
DROP TABLE carry_expectation_overlays;
DELETE FROM flow_async_templates;
INSERT INTO flow_async_templates (flow_id, title, time_scope_n, time_scope_kind, check_every_n, check_every_kind) SELECT flow_id, title, time_scope_n, time_scope_kind, check_every_n, check_every_kind FROM carry_flow_async_templates;
DROP TABLE carry_flow_async_templates;
DELETE FROM flow_commitments;
INSERT INTO flow_commitments (id, flow_id, title, parent_type, parent_id, position, is_private, verdict_window_n, verdict_window_kind) SELECT id, flow_id, title, parent_type, parent_id, position, is_private, verdict_window_n, verdict_window_kind FROM carry_flow_commitments;
DROP TABLE carry_flow_commitments;
DELETE FROM flow_dependencies;
INSERT INTO flow_dependencies (id, flow_id, dependent_type, dependent_id, depends_on_type, depends_on_id) SELECT id, flow_id, dependent_type, dependent_id, depends_on_type, depends_on_id FROM carry_flow_dependencies;
DROP TABLE carry_flow_dependencies;
DELETE FROM flow_expectations;
INSERT INTO flow_expectations (id, flow_id, title, parent_type, parent_id, position, is_private, check_every_n, check_every_kind, first_check_kind, first_check_index) SELECT id, flow_id, title, parent_type, parent_id, position, is_private, check_every_n, check_every_kind, first_check_kind, first_check_index FROM carry_flow_expectations;
DROP TABLE carry_flow_expectations;
DELETE FROM flow_goals;
INSERT INTO flow_goals (id, flow_id, title, parent_type, parent_id, position, is_private) SELECT id, flow_id, title, parent_type, parent_id, position, is_private FROM carry_flow_goals;
DROP TABLE carry_flow_goals;
DELETE FROM flow_item_cycles;
INSERT INTO flow_item_cycles (id, flow_id, item_type, item_id, scope_kind, scope_index, plan_kind, plan_start, plan_end, position) SELECT id, flow_id, item_type, item_id, scope_kind, scope_index, plan_kind, plan_start, plan_end, position FROM carry_flow_item_cycles;
DROP TABLE carry_flow_item_cycles;
DELETE FROM flow_recurrences;
INSERT INTO flow_recurrences (flow_id, start_scope_id, gap_n, gap_kind, end_scope_id, clock, miss_policy, cooldown_n, cooldown_kind) SELECT flow_id, start_scope_id, gap_n, gap_kind, end_scope_id, clock, miss_policy, cooldown_n, cooldown_kind FROM carry_flow_recurrences;
DROP TABLE carry_flow_recurrences;
DELETE FROM flow_tasks;
INSERT INTO flow_tasks (id, flow_id, title, parent_type, parent_id, position, is_private, delegate_kind, delegate_id, agentic, asynchronous, archival, compound) SELECT id, flow_id, title, parent_type, parent_id, position, is_private, delegate_kind, delegate_id, agentic, asynchronous, archival, compound FROM carry_flow_tasks;
DROP TABLE carry_flow_tasks;
DELETE FROM goal_knowledge_base_links;
INSERT INTO goal_knowledge_base_links (goal_id, entity_type, entity_id) SELECT goal_id, entity_type, entity_id FROM carry_goal_knowledge_base_links;
DROP TABLE carry_goal_knowledge_base_links;
DELETE FROM goal_overlays;
INSERT INTO goal_overlays (id, flow_id, item_type, item_id, iteration_scope, cycle_id, status, resolved_at, tombstone, title, is_private, position, block_reasons_set) SELECT id, flow_id, item_type, item_id, iteration_scope, cycle_id, status, resolved_at, tombstone, title, is_private, position, block_reasons_set FROM carry_goal_overlays;
DROP TABLE carry_goal_overlays;
DELETE FROM occurrence_async_templates;
INSERT INTO occurrence_async_templates (node_key, flow_id, title, time_scope_n, time_scope_kind, check_every_n, check_every_kind) SELECT node_key, flow_id, title, time_scope_n, time_scope_kind, check_every_n, check_every_kind FROM carry_occurrence_async_templates;
DROP TABLE carry_occurrence_async_templates;
DELETE FROM occurrence_spawned_waits;
INSERT INTO occurrence_spawned_waits (node_key, flow_id, status, archival, released_at) SELECT node_key, flow_id, status, archival, released_at FROM carry_occurrence_spawned_waits;
DROP TABLE carry_occurrence_spawned_waits;
DELETE FROM spawned_waits;
INSERT INTO spawned_waits (task_id, status, archival, last_check_at, released_at) SELECT task_id, status, archival, last_check_at, released_at FROM carry_spawned_waits;
DROP TABLE carry_spawned_waits;
DELETE FROM tags_on_commitments;
INSERT INTO tags_on_commitments (commitment_id, tag_id) SELECT commitment_id, tag_id FROM carry_tags_on_commitments;
DROP TABLE carry_tags_on_commitments;
DELETE FROM tags_on_expectations;
INSERT INTO tags_on_expectations (expectation_id, tag_id) SELECT expectation_id, tag_id FROM carry_tags_on_expectations;
DROP TABLE carry_tags_on_expectations;
DELETE FROM tags_on_goals;
INSERT INTO tags_on_goals (goal_id, tag_id) SELECT goal_id, tag_id FROM carry_tags_on_goals;
DROP TABLE carry_tags_on_goals;
DELETE FROM tags_on_tasks;
INSERT INTO tags_on_tasks (task_id, tag_id) SELECT task_id, tag_id FROM carry_tags_on_tasks;
DROP TABLE carry_tags_on_tasks;
DELETE FROM task_agentic_briefs;
INSERT INTO task_agentic_briefs (task_id, priority, spec, design, acceptance, notes) SELECT task_id, priority, spec, design, acceptance, notes FROM carry_task_agentic_briefs;
DROP TABLE carry_task_agentic_briefs;
DELETE FROM task_async_templates;
INSERT INTO task_async_templates (task_id, title, time_scope_n, time_scope_kind, check_every_n, check_every_kind) SELECT task_id, title, time_scope_n, time_scope_kind, check_every_n, check_every_kind FROM carry_task_async_templates;
DROP TABLE carry_task_async_templates;
DELETE FROM task_dependencies;
INSERT INTO task_dependencies (task_id, dependency_type, dependency_id) SELECT task_id, dependency_type, dependency_id FROM carry_task_dependencies;
DROP TABLE carry_task_dependencies;
DELETE FROM task_knowledge_base_links;
INSERT INTO task_knowledge_base_links (task_id, entity_type, entity_id) SELECT task_id, entity_type, entity_id FROM carry_task_knowledge_base_links;
DROP TABLE carry_task_knowledge_base_links;
DELETE FROM task_overlays;
INSERT INTO task_overlays (id, origin, flow_id, item_type, item_id, iteration_scope, cycle_id, wait_key, due_at, status, resolved_at, tombstone, title, plan_start_id, plan_end_id, plan_set, delegate_kind, delegate_id, delegate_set, agentic, agentic_set, asynchronous, archival, is_private, position, block_reasons_set, brief_priority, brief_priority_set, brief_spec, brief_design, brief_acceptance, brief_notes, due_scope_start_id, due_scope_end_id, compound, async_template_set) SELECT id, origin, flow_id, item_type, item_id, iteration_scope, cycle_id, wait_key, due_at, status, resolved_at, tombstone, title, plan_start_id, plan_end_id, plan_set, delegate_kind, delegate_id, delegate_set, agentic, agentic_set, asynchronous, archival, is_private, position, block_reasons_set, brief_priority, brief_priority_set, brief_spec, brief_design, brief_acceptance, brief_notes, due_scope_start_id, due_scope_end_id, compound, async_template_set FROM carry_task_overlays;
DROP TABLE carry_task_overlays;
DELETE FROM flow_task_async_templates;
INSERT INTO flow_task_async_templates (flow_task_id, title, time_scope_n, time_scope_kind, check_every_n, check_every_kind) SELECT flow_task_id, title, time_scope_n, time_scope_kind, check_every_n, check_every_kind FROM carry_flow_task_async_templates;
DROP TABLE carry_flow_task_async_templates;
DELETE FROM tags_on_async_templates;
INSERT INTO tags_on_async_templates (task_id, tag_id) SELECT task_id, tag_id FROM carry_tags_on_async_templates;
DROP TABLE carry_tags_on_async_templates;
DELETE FROM tags_on_flow_async_templates;
INSERT INTO tags_on_flow_async_templates (flow_id, tag_id) SELECT flow_id, tag_id FROM carry_tags_on_flow_async_templates;
DROP TABLE carry_tags_on_flow_async_templates;
DELETE FROM tags_on_occurrence_async_templates;
INSERT INTO tags_on_occurrence_async_templates (node_key, tag_id) SELECT node_key, tag_id FROM carry_tags_on_occurrence_async_templates;
DROP TABLE carry_tags_on_occurrence_async_templates;
DELETE FROM tags_on_flow_task_async_templates;
INSERT INTO tags_on_flow_task_async_templates (flow_task_id, tag_id) SELECT flow_task_id, tag_id FROM carry_tags_on_flow_task_async_templates;
DROP TABLE carry_tags_on_flow_task_async_templates;
UPDATE flow_instances SET flow_id = (SELECT c.flow_id FROM carry_flow_instances c WHERE c.id = flow_instances.id);
DROP TABLE carry_flow_instances;

-- 4. The undo journal's images, respelled as the rows they describe now are.
UPDATE undo_journal SET before_image = json_set(before_image, '$.parent_type', 'domain')
 WHERE table_name IN ('tasks', 'goals', 'commitments', 'expectations', 'infos', 'flows')
   AND json_extract(before_image, '$.parent_type') IN ('aspect', 'project', 'tag');
UPDATE undo_journal SET after_image = json_set(after_image, '$.parent_type', 'domain')
 WHERE table_name IN ('tasks', 'goals', 'commitments', 'expectations', 'infos', 'flows')
   AND json_extract(after_image, '$.parent_type') IN ('aspect', 'project', 'tag');
UPDATE undo_journal SET before_image = json_set(before_image, '$.target_type', 'domain')
 WHERE table_name IN ('flows')
   AND json_extract(before_image, '$.target_type') IN ('aspect', 'project', 'tag');
UPDATE undo_journal SET after_image = json_set(after_image, '$.target_type', 'domain')
 WHERE table_name IN ('flows')
   AND json_extract(after_image, '$.target_type') IN ('aspect', 'project', 'tag');
UPDATE undo_journal SET before_image = json_set(before_image, '$.original_parent_type', 'domain')
 WHERE table_name IN ('flow_instance_nodes')
   AND json_extract(before_image, '$.original_parent_type') IN ('aspect', 'project', 'tag');
UPDATE undo_journal SET after_image = json_set(after_image, '$.original_parent_type', 'domain')
 WHERE table_name IN ('flow_instance_nodes')
   AND json_extract(after_image, '$.original_parent_type') IN ('aspect', 'project', 'tag');

UPDATE undo_context SET suppressed = 0 WHERE id = 1;
