-- A fourth Task status, **Started** (Task 9e3): begun and left in a middle state, not being done
-- right now. It is stored, like the other three, so both CHECKs that spell the status vocabulary
-- widen to admit 'started': `tasks.status`, and `task_overlays.status`, where a Habit occurrence's
-- own status lives. Nothing else about either table changes, and no row is rewritten.
--
-- SQLite cannot alter a CHECK, so both tables are rebuilt — with 0046's hazard and 0046's answer.
-- `tasks` is referenced ON DELETE CASCADE by its tag, link, dependency, async-template, spawned-wait,
-- derived-dependency and brief tables (and `task_async_templates` by its tags), so dropping it would
-- take their rows with it: `PRAGMA defer_foreign_keys` defers violations, not cascades, and
-- `PRAGMA legacy_alter_table` does nothing while foreign keys are on. Those tables keep their own
-- definitions; only their rows are copied aside and put back. `task_overlays` has no dependents.
--
-- Dropping a table drops its triggers and indexes, so each is recreated below exactly as it stood.
-- The undo journal is suppressed while rows move: the copy is not a user's gesture, and the
-- journal is session-scoped anyway (`undo::reset_journal` empties it at every start).

UPDATE undo_context SET suppressed = 1 WHERE id = 1;

-- 1. Copy aside every row the drop of `tasks` would cascade away.
CREATE TABLE carry_tags_on_tasks AS SELECT task_id, tag_id FROM tags_on_tasks;
CREATE TABLE carry_task_knowledge_base_links AS SELECT task_id, entity_type, entity_id FROM task_knowledge_base_links;
CREATE TABLE carry_task_dependencies AS SELECT task_id, dependency_type, dependency_id FROM task_dependencies;
CREATE TABLE carry_task_async_templates AS SELECT task_id, title, time_scope_n, time_scope_kind, check_every_n, check_every_kind FROM task_async_templates;
CREATE TABLE carry_tags_on_async_templates AS SELECT task_id, tag_id FROM tags_on_async_templates;
CREATE TABLE carry_spawned_waits AS SELECT task_id, status, archival, last_check_at FROM spawned_waits;
CREATE TABLE carry_derived_dependencies AS SELECT id, flow_id, dependent_id, dependent_key, target_type, target_id, target_key, added FROM derived_dependencies;
CREATE TABLE carry_task_agentic_briefs AS SELECT task_id, priority, spec, design, acceptance, notes FROM task_agentic_briefs;

-- 2. Rebuild `tasks` with the widened status CHECK.

CREATE TABLE tasks_new (
    id                       INTEGER PRIMARY KEY,
    title                    TEXT NOT NULL,
    parent_type              TEXT NOT NULL
                                 CHECK (parent_type IN ('project', 'goal', 'domain', 'task', 'commitment')),
    parent_id                INTEGER NOT NULL,
    status                   TEXT NOT NULL DEFAULT 'todo'
                                 CHECK (status IN ('todo', 'in_progress', 'started', 'done')),
    delegate_kind            TEXT CHECK (delegate_kind IN ('person', 'agent')),
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
    beads_id                 TEXT,
    archival                 TEXT NOT NULL DEFAULT 'live' CHECK (archival IN ('live', 'backlog')),
    agentic                  INTEGER NULL CHECK (agentic IN (0, 1)),
    asynchronous             INTEGER NOT NULL DEFAULT 0 CHECK (asynchronous IN (0, 1)),
    done_at                  TEXT,
    CHECK (time_scope_start_id IS NULL OR json_valid(time_scope_start_id)),
    CHECK (time_scope_end_id IS NULL OR json_valid(time_scope_end_id)),
    CHECK (plan_start_id IS NULL OR json_valid(plan_start_id)),
    CHECK (plan_end_id IS NULL OR json_valid(plan_end_id)),
    CHECK (
        (delegate_kind IS NULL     AND delegate_id IS NULL)
     OR (delegate_kind = 'person'  AND delegate_id IS NOT NULL)
     OR (delegate_kind = 'agent'   AND delegate_id IS NULL)
    )
);
INSERT INTO tasks_new (id, title, parent_type, parent_id, status, delegate_kind, delegate_id, position, time_scope_start_id, time_scope_end_id, time_scope_duration_n, time_scope_duration_kind, plan_start_id, plan_end_id, on_scope_exit, is_private, beads_id, archival, agentic, asynchronous, done_at)
SELECT id, title, parent_type, parent_id, status, delegate_kind, delegate_id, position, time_scope_start_id, time_scope_end_id, time_scope_duration_n, time_scope_duration_kind, plan_start_id, plan_end_id, on_scope_exit, is_private, beads_id, archival, agentic, asynchronous, done_at
  FROM tasks;
DROP TABLE tasks;
ALTER TABLE tasks_new RENAME TO tasks;

CREATE TRIGGER undo_journal_tasks_insert AFTER INSERT ON tasks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tasks', new.rowid, 'insert', NULL, json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'status', new.status, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'position', new.position, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'plan_start_id', new.plan_start_id, 'plan_end_id', new.plan_end_id, 'on_scope_exit', new.on_scope_exit, 'is_private', new.is_private, 'beads_id', new.beads_id, 'archival', new.archival, 'agentic', new.agentic, 'asynchronous', new.asynchronous, 'done_at', new.done_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_tasks_update AFTER UPDATE ON tasks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tasks', new.rowid, 'update', json_object('id', old.id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'status', old.status, 'delegate_kind', old.delegate_kind, 'delegate_id', old.delegate_id, 'position', old.position, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind, 'plan_start_id', old.plan_start_id, 'plan_end_id', old.plan_end_id, 'on_scope_exit', old.on_scope_exit, 'is_private', old.is_private, 'beads_id', old.beads_id, 'archival', old.archival, 'agentic', old.agentic, 'asynchronous', old.asynchronous, 'done_at', old.done_at), json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'status', new.status, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'position', new.position, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'plan_start_id', new.plan_start_id, 'plan_end_id', new.plan_end_id, 'on_scope_exit', new.on_scope_exit, 'is_private', new.is_private, 'beads_id', new.beads_id, 'archival', new.archival, 'agentic', new.agentic, 'asynchronous', new.asynchronous, 'done_at', new.done_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_tasks_delete AFTER DELETE ON tasks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tasks', old.rowid, 'delete', json_object('id', old.id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'status', old.status, 'delegate_kind', old.delegate_kind, 'delegate_id', old.delegate_id, 'position', old.position, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind, 'plan_start_id', old.plan_start_id, 'plan_end_id', old.plan_end_id, 'on_scope_exit', old.on_scope_exit, 'is_private', old.is_private, 'beads_id', old.beads_id, 'archival', old.archival, 'agentic', old.agentic, 'asynchronous', old.asynchronous, 'done_at', old.done_at), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER mcp_roots_forget_task AFTER DELETE ON tasks
WHEN (SELECT suppressed FROM undo_context WHERE id = 1) = 0 BEGIN
    DELETE FROM mcp_roots WHERE node_kind = 'task' AND node_id = old.id;
END;

-- 3. Put the dependents' rows back. `task_async_templates` before its tags, since clearing it
--    cascades to them.

DELETE FROM tags_on_tasks;
INSERT INTO tags_on_tasks (task_id, tag_id) SELECT task_id, tag_id FROM carry_tags_on_tasks;
DROP TABLE carry_tags_on_tasks;
DELETE FROM task_knowledge_base_links;
INSERT INTO task_knowledge_base_links (task_id, entity_type, entity_id) SELECT task_id, entity_type, entity_id FROM carry_task_knowledge_base_links;
DROP TABLE carry_task_knowledge_base_links;
DELETE FROM task_dependencies;
INSERT INTO task_dependencies (task_id, dependency_type, dependency_id) SELECT task_id, dependency_type, dependency_id FROM carry_task_dependencies;
DROP TABLE carry_task_dependencies;
DELETE FROM task_async_templates;
INSERT INTO task_async_templates (task_id, title, time_scope_n, time_scope_kind, check_every_n, check_every_kind) SELECT task_id, title, time_scope_n, time_scope_kind, check_every_n, check_every_kind FROM carry_task_async_templates;
DROP TABLE carry_task_async_templates;
DELETE FROM tags_on_async_templates;
INSERT INTO tags_on_async_templates (task_id, tag_id) SELECT task_id, tag_id FROM carry_tags_on_async_templates;
DROP TABLE carry_tags_on_async_templates;
DELETE FROM spawned_waits;
INSERT INTO spawned_waits (task_id, status, archival, last_check_at) SELECT task_id, status, archival, last_check_at FROM carry_spawned_waits;
DROP TABLE carry_spawned_waits;
DELETE FROM derived_dependencies;
INSERT INTO derived_dependencies (id, flow_id, dependent_id, dependent_key, target_type, target_id, target_key, added) SELECT id, flow_id, dependent_id, dependent_key, target_type, target_id, target_key, added FROM carry_derived_dependencies;
DROP TABLE carry_derived_dependencies;
DELETE FROM task_agentic_briefs;
INSERT INTO task_agentic_briefs (task_id, priority, spec, design, acceptance, notes) SELECT task_id, priority, spec, design, acceptance, notes FROM carry_task_agentic_briefs;
DROP TABLE carry_task_agentic_briefs;

-- 4. Rebuild `task_overlays` with the same widened CHECK.

CREATE TABLE task_overlays_new (
    id                INTEGER PRIMARY KEY,
    -- Which derivation the row belongs to: a Habit occurrence, or a wait's check task.
    origin            TEXT NOT NULL DEFAULT 'habit' CHECK (origin IN ('habit', 'check')),
    -- Habit occurrence key.
    flow_id           INTEGER REFERENCES flows(id) ON DELETE CASCADE,
    item_type         TEXT CHECK (item_type IN ('flow_task', 'flow_root')),
    item_id           INTEGER,
    iteration_scope   TEXT,
    cycle_id          INTEGER,
    -- Check task key: the wait's own node key, and the instant the check fell due.
    wait_key          TEXT,
    due_at            TEXT,
    node_key          TEXT GENERATED ALWAYS AS (
                          CASE origin
                              WHEN 'habit' THEN item_type || ':' || item_id || ':' || iteration_scope || ':' || cycle_id
                              ELSE 'check:' || wait_key || '@' || due_at
                          END) VIRTUAL,
    -- Per-occurrence state.
    status            TEXT CHECK (status IN ('todo', 'in_progress', 'started', 'done')),
    resolved_at       INTEGER,
    tombstone         TEXT CHECK (tombstone IN ('archived', 'missed')),
    -- Inherited columns: NULL inherits the template's value.
    title             TEXT,
    plan_start_id     TEXT,
    plan_end_id       TEXT,
    plan_set          INTEGER NOT NULL DEFAULT 0 CHECK (plan_set IN (0, 1)),
    delegate_kind     TEXT CHECK (delegate_kind IN ('person', 'agent')),
    delegate_id       INTEGER REFERENCES people(id),
    delegate_set      INTEGER NOT NULL DEFAULT 0 CHECK (delegate_set IN (0, 1)),
    agentic           INTEGER CHECK (agentic IN (0, 1)),
    agentic_set       INTEGER NOT NULL DEFAULT 0 CHECK (agentic_set IN (0, 1)),
    asynchronous      INTEGER CHECK (asynchronous IN (0, 1)),
    archival          TEXT CHECK (archival IN ('live', 'backlog')),
    is_private        INTEGER CHECK (is_private IN (0, 1)),
    beads_id          TEXT,
    beads_id_set      INTEGER NOT NULL DEFAULT 0 CHECK (beads_id_set IN (0, 1)),
    position          INTEGER,
    -- Set when the occurrence's block reasons are its own list (in derived_block_reasons), even an
    -- empty one; clear when it reads its template's.
    block_reasons_set INTEGER NOT NULL DEFAULT 0 CHECK (block_reasons_set IN (0, 1)), brief_priority INTEGER
    CHECK (brief_priority IS NULL OR brief_priority BETWEEN 0 AND 3), brief_priority_set INTEGER NOT NULL DEFAULT 0
    CHECK (brief_priority_set IN (0, 1)), brief_spec TEXT, brief_design TEXT, brief_acceptance TEXT, brief_notes TEXT,
    CHECK ((origin = 'habit') = (flow_id IS NOT NULL AND item_type IS NOT NULL AND item_id IS NOT NULL
                                 AND iteration_scope IS NOT NULL AND cycle_id IS NOT NULL)),
    CHECK ((origin = 'check') = (wait_key IS NOT NULL AND due_at IS NOT NULL)),
    CHECK (plan_set = 1 OR (plan_start_id IS NULL AND plan_end_id IS NULL)),
    CHECK ((plan_start_id IS NULL) = (plan_end_id IS NULL)),
    CHECK (
        (delegate_kind IS NULL     AND delegate_id IS NULL)
     OR (delegate_kind = 'person'  AND delegate_id IS NOT NULL)
     OR (delegate_kind = 'agent'   AND delegate_id IS NULL)
    ),
    CHECK (iteration_scope IS NULL OR json_valid(iteration_scope)),
    CHECK (plan_start_id IS NULL OR json_valid(plan_start_id)),
    CHECK (plan_end_id IS NULL OR json_valid(plan_end_id))
);
INSERT INTO task_overlays_new (id, origin, flow_id, item_type, item_id, iteration_scope, cycle_id, wait_key, due_at, status, resolved_at, tombstone, title, plan_start_id, plan_end_id, plan_set, delegate_kind, delegate_id, delegate_set, agentic, agentic_set, asynchronous, archival, is_private, beads_id, beads_id_set, position, block_reasons_set, brief_priority, brief_priority_set, brief_spec, brief_design, brief_acceptance, brief_notes)
SELECT id, origin, flow_id, item_type, item_id, iteration_scope, cycle_id, wait_key, due_at, status, resolved_at, tombstone, title, plan_start_id, plan_end_id, plan_set, delegate_kind, delegate_id, delegate_set, agentic, agentic_set, asynchronous, archival, is_private, beads_id, beads_id_set, position, block_reasons_set, brief_priority, brief_priority_set, brief_spec, brief_design, brief_acceptance, brief_notes
  FROM task_overlays;
DROP TABLE task_overlays;
ALTER TABLE task_overlays_new RENAME TO task_overlays;

CREATE UNIQUE INDEX idx_task_overlays_key ON task_overlays (node_key);
CREATE INDEX idx_task_overlays_item ON task_overlays (item_type, item_id);
CREATE INDEX idx_task_overlays_flow ON task_overlays (flow_id, iteration_scope);

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

UPDATE undo_context SET suppressed = 0 WHERE id = 1;
