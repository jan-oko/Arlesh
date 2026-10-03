-- Commitment and wait items in Flow templates (Task b66; ruled by the user, 2026-10-03).
--
-- A flow item was a Task or a Goal (`flow_tasks`, `flow_goals`). A template may now also hold a
-- **Commitment item** and a **wait item** (an Expectation), each carrying the fields its stored
-- counterpart's editor has, less what an occurrence's window gives it:
--
--   * `flow_commitments`: title, privacy and the **Verdict Window** every occurrence is copied.
--     Its tags are template relations (`template_tags`), as every item's are. A Commitment takes
--     no block reasons and has no Plan, so neither is here.
--   * `flow_expectations`: title, privacy, the **Check every**, and the **first check** — a
--     relative `(kind, index)` offset into each occurrence's window, in the form a Cycle Plan
--     takes: the index-th unit of that kind from the window's start. The Check every repeats
--     from there. Its tags are template relations too.
--
-- Placement follows the parenting table for stored nodes exactly (`nodes::rules::parenting`):
-- a Commitment and a wait hang anywhere a Task does — under the Flow, a Goal item, a Task item or
-- a Commitment item — and a Commitment holds Tasks, Commitments and waits, never a Goal. So a Task
-- item may now sit under a Commitment item, which `flow_tasks.parent_type` did not allow.
--
-- The tables naming an item kind in a CHECK are rebuilt to name the new ones:
--
--   * `flow_tasks.parent_type` gains `flow_commitment`;
--   * `flow_item_cycles.item_type` and `template_tags.item_type` gain both new kinds;
--   * `flow_dependencies.depends_on_type` gains `flow_expectation`: a Task item may depend on a
--     wait item, fanned in per iteration like any other template edge. A Commitment is never a
--     dependency target, stored or templated;
--   * `flow_instance_nodes`: a started plain Flow materialises a Commitment item as a stored
--     Commitment and a wait item as a stored Expectation;
--   * `commitment_overlays.item_type` gains `flow_commitment`: each occurrence of a Commitment item
--     is its own Commitment, with its own verdict, in the overlay a commitment Habit's root uses.
--
-- A wait item's occurrence keeps its overrides in `expectation_overlays`, keyed by its own node
-- key, as a spawned wait's do. What it adds is the state only an occurrence has: its **status**
-- (pending/released) and when it was released, so each occurrence is released on its own. Both
-- columns are NULL on every existing row, which reads as before.
--
-- Rebuilding `flow_tasks` would cascade away its wait templates (`flow_task_async_templates` and
-- their tags reference it ON DELETE CASCADE), so those are carried across, as 0084 carried a
-- Task's dependents. Nothing existing changes meaning: every row is copied as it stands.

CREATE TABLE carry_flow_task_async_templates AS
    SELECT flow_task_id, title, time_scope_n, time_scope_kind, check_every_n, check_every_kind
    FROM flow_task_async_templates;
CREATE TABLE carry_tags_on_flow_task_async_templates AS
    SELECT flow_task_id, tag_id FROM tags_on_flow_task_async_templates;

CREATE TABLE flow_tasks_new (
    id            INTEGER PRIMARY KEY,
    flow_id       INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    parent_type   TEXT NOT NULL
                      CHECK (parent_type IN ('flow', 'flow_goal', 'flow_task', 'flow_commitment')),
    parent_id     INTEGER NOT NULL,
    position      INTEGER NOT NULL DEFAULT 0,
    is_private    BOOLEAN NOT NULL DEFAULT 0,
    delegate_kind TEXT CHECK (delegate_kind IN ('person', 'agent')),
    delegate_id   INTEGER REFERENCES people(id),
    agentic       INTEGER CHECK (agentic IN (0, 1)),
    asynchronous  INTEGER NOT NULL DEFAULT 0 CHECK (asynchronous IN (0, 1)),
    archival      TEXT NOT NULL DEFAULT 'live' CHECK (archival IN ('live', 'backlog')),
    compound      INTEGER NOT NULL DEFAULT 0 CHECK (compound IN (0, 1))
);
INSERT INTO flow_tasks_new
    (id, flow_id, title, parent_type, parent_id, position, is_private, delegate_kind, delegate_id,
     agentic, asynchronous, archival, compound)
SELECT id, flow_id, title, parent_type, parent_id, position, is_private, delegate_kind, delegate_id,
       agentic, asynchronous, archival, compound
FROM flow_tasks;
DROP TABLE flow_tasks;
ALTER TABLE flow_tasks_new RENAME TO flow_tasks;

INSERT INTO flow_task_async_templates
    (flow_task_id, title, time_scope_n, time_scope_kind, check_every_n, check_every_kind)
SELECT flow_task_id, title, time_scope_n, time_scope_kind, check_every_n, check_every_kind
FROM carry_flow_task_async_templates;
DROP TABLE carry_flow_task_async_templates;
INSERT INTO tags_on_flow_task_async_templates (flow_task_id, tag_id)
SELECT flow_task_id, tag_id FROM carry_tags_on_flow_task_async_templates;
DROP TABLE carry_tags_on_flow_task_async_templates;

-- The two triggers `flow_tasks` carried besides its journal, as 0080 and 0088 wrote them.
CREATE TRIGGER mcp_roots_forget_flow_task AFTER DELETE ON flow_tasks
WHEN (SELECT suppressed FROM undo_context WHERE id = 1) = 0 BEGIN
    DELETE FROM mcp_roots WHERE node_kind = 'flow_task' AND node_id = old.id;
END;
CREATE TRIGGER flow_tasks_refuse_agent_delegate_insert BEFORE INSERT ON flow_tasks
WHEN new.delegate_kind = 'agent' BEGIN
    SELECT RAISE(ABORT, 'the Agent delegate was removed; an agent holds a Task as On Agent');
END;
CREATE TRIGGER flow_tasks_refuse_agent_delegate_update BEFORE UPDATE OF delegate_kind ON flow_tasks
WHEN new.delegate_kind = 'agent' BEGIN
    SELECT RAISE(ABORT, 'the Agent delegate was removed; an agent holds a Task as On Agent');
END;

CREATE TABLE flow_commitments (
    id                  INTEGER PRIMARY KEY,
    flow_id             INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    title               TEXT NOT NULL,
    parent_type         TEXT NOT NULL
                            CHECK (parent_type IN ('flow', 'flow_goal', 'flow_task', 'flow_commitment')),
    parent_id           INTEGER NOT NULL,
    position            INTEGER NOT NULL DEFAULT 0,
    is_private          BOOLEAN NOT NULL DEFAULT 0,
    verdict_window_n    INTEGER,
    verdict_window_kind TEXT,
    CHECK ((verdict_window_n IS NULL) = (verdict_window_kind IS NULL))
);

CREATE TABLE flow_expectations (
    id                INTEGER PRIMARY KEY,
    flow_id           INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    title             TEXT NOT NULL,
    parent_type       TEXT NOT NULL
                          CHECK (parent_type IN ('flow', 'flow_goal', 'flow_task', 'flow_commitment')),
    parent_id         INTEGER NOT NULL,
    position          INTEGER NOT NULL DEFAULT 0,
    is_private        BOOLEAN NOT NULL DEFAULT 0,
    check_every_n     INTEGER,
    check_every_kind  TEXT,
    first_check_kind  TEXT,
    first_check_index INTEGER,
    CHECK ((check_every_n IS NULL) = (check_every_kind IS NULL)),
    CHECK ((first_check_kind IS NULL) = (first_check_index IS NULL)),
    CHECK (first_check_index IS NULL OR first_check_index >= 1)
);

CREATE TABLE flow_item_cycles_new (
    id          INTEGER PRIMARY KEY,
    flow_id     INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    item_type   TEXT NOT NULL
                    CHECK (item_type IN ('flow_goal', 'flow_task', 'flow_commitment', 'flow_expectation')),
    item_id     INTEGER NOT NULL,
    scope_kind  TEXT,
    scope_index INTEGER,
    plan_kind   TEXT,
    plan_start  INTEGER,
    plan_end    INTEGER,
    position    INTEGER NOT NULL DEFAULT 0
);
INSERT INTO flow_item_cycles_new
    (id, flow_id, item_type, item_id, scope_kind, scope_index, plan_kind, plan_start, plan_end, position)
SELECT id, flow_id, item_type, item_id, scope_kind, scope_index, plan_kind, plan_start, plan_end, position
FROM flow_item_cycles;
DROP TABLE flow_item_cycles;
ALTER TABLE flow_item_cycles_new RENAME TO flow_item_cycles;
CREATE INDEX idx_flow_item_cycles_item ON flow_item_cycles (item_type, item_id);

CREATE TABLE flow_dependencies_new (
    id              INTEGER PRIMARY KEY,
    flow_id         INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    dependent_type  TEXT NOT NULL CHECK (dependent_type IN ('flow_goal', 'flow_task')),
    dependent_id    INTEGER NOT NULL,
    depends_on_type TEXT NOT NULL
                        CHECK (depends_on_type IN ('flow_goal', 'flow_task', 'flow_expectation')),
    depends_on_id   INTEGER NOT NULL,
    UNIQUE (dependent_type, dependent_id, depends_on_type, depends_on_id)
);
INSERT INTO flow_dependencies_new
    (id, flow_id, dependent_type, dependent_id, depends_on_type, depends_on_id)
SELECT id, flow_id, dependent_type, dependent_id, depends_on_type, depends_on_id
FROM flow_dependencies;
DROP TABLE flow_dependencies;
ALTER TABLE flow_dependencies_new RENAME TO flow_dependencies;

CREATE TABLE template_tags_new (
    id        INTEGER PRIMARY KEY,
    item_type TEXT NOT NULL
                  CHECK (item_type IN ('flow', 'flow_goal', 'flow_task', 'flow_commitment', 'flow_expectation')),
    item_id   INTEGER NOT NULL,
    tag_id    INTEGER NOT NULL REFERENCES domains(id),
    UNIQUE (item_type, item_id, tag_id)
);
INSERT INTO template_tags_new (id, item_type, item_id, tag_id)
SELECT id, item_type, item_id, tag_id FROM template_tags;
DROP TABLE template_tags;
ALTER TABLE template_tags_new RENAME TO template_tags;

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
    original_parent_type TEXT NOT NULL,
    original_parent_id   INTEGER NOT NULL
);
INSERT INTO flow_instance_nodes_new
    (id, flow_instance_id, node_type, node_id, source_item_type, source_item_id,
     original_parent_type, original_parent_id)
SELECT id, flow_instance_id, node_type, node_id, source_item_type, source_item_id,
       original_parent_type, original_parent_id
FROM flow_instance_nodes;
DROP TABLE flow_instance_nodes;
ALTER TABLE flow_instance_nodes_new RENAME TO flow_instance_nodes;
CREATE INDEX idx_flow_instance_nodes_instance ON flow_instance_nodes (flow_instance_id);
CREATE INDEX idx_flow_instance_nodes_node ON flow_instance_nodes (node_type, node_id);

CREATE TABLE commitment_overlays_new (
    id                INTEGER PRIMARY KEY,
    flow_id           INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    -- A commitment Habit's iteration root, and each occurrence of a Commitment item.
    item_type         TEXT NOT NULL CHECK (item_type IN ('flow_root', 'flow_commitment')),
    item_id           INTEGER NOT NULL,
    iteration_scope   TEXT NOT NULL,
    cycle_id          INTEGER NOT NULL DEFAULT 0,
    node_key          TEXT GENERATED ALWAYS AS (
                          item_type || ':' || item_id || ':' || iteration_scope || ':' || cycle_id) VIRTUAL,
    verdict           TEXT CHECK (verdict IN ('kept', 'broken')),
    resolved_at       INTEGER,
    tombstone         TEXT CHECK (tombstone IN ('archived', 'missed')),
    title             TEXT,
    is_private        INTEGER CHECK (is_private IN (0, 1)),
    position          INTEGER,
    UNIQUE (item_type, item_id, iteration_scope, cycle_id),
    CHECK (iteration_scope IS NULL OR json_valid(iteration_scope))
);
INSERT INTO commitment_overlays_new
    (id, flow_id, item_type, item_id, iteration_scope, cycle_id, verdict, resolved_at, tombstone,
     title, is_private, position)
SELECT id, flow_id, item_type, item_id, iteration_scope, cycle_id, verdict, resolved_at, tombstone,
       title, is_private, position
FROM commitment_overlays;
DROP TABLE commitment_overlays;
ALTER TABLE commitment_overlays_new RENAME TO commitment_overlays;
CREATE UNIQUE INDEX idx_commitment_overlays_key ON commitment_overlays (node_key);
CREATE INDEX idx_commitment_overlays_flow ON commitment_overlays (flow_id, iteration_scope);

ALTER TABLE expectation_overlays ADD COLUMN status TEXT CHECK (status IS NULL OR status IN ('pending', 'released'));
ALTER TABLE expectation_overlays ADD COLUMN released_at TEXT;

-- Undo-journal triggers, straight from scripts/generate-undo-triggers.sh: the rebuilt tables lost
-- theirs with the old table, the new tables need theirs, and `expectation_overlays`' images name
-- its two new columns.
DROP TRIGGER IF EXISTS undo_journal_expectation_overlays_insert;
DROP TRIGGER IF EXISTS undo_journal_expectation_overlays_update;
DROP TRIGGER IF EXISTS undo_journal_expectation_overlays_delete;
CREATE TRIGGER undo_journal_flow_tasks_insert AFTER INSERT ON flow_tasks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_tasks', new.rowid, 'insert', NULL, json_object('id', new.id, 'flow_id', new.flow_id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'is_private', new.is_private, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'agentic', new.agentic, 'asynchronous', new.asynchronous, 'archival', new.archival, 'compound', new.compound), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_tasks_update AFTER UPDATE ON flow_tasks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_tasks', new.rowid, 'update', json_object('id', old.id, 'flow_id', old.flow_id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'position', old.position, 'is_private', old.is_private, 'delegate_kind', old.delegate_kind, 'delegate_id', old.delegate_id, 'agentic', old.agentic, 'asynchronous', old.asynchronous, 'archival', old.archival, 'compound', old.compound), json_object('id', new.id, 'flow_id', new.flow_id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'is_private', new.is_private, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'agentic', new.agentic, 'asynchronous', new.asynchronous, 'archival', new.archival, 'compound', new.compound), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_tasks_delete AFTER DELETE ON flow_tasks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_tasks', old.rowid, 'delete', json_object('id', old.id, 'flow_id', old.flow_id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'position', old.position, 'is_private', old.is_private, 'delegate_kind', old.delegate_kind, 'delegate_id', old.delegate_id, 'agentic', old.agentic, 'asynchronous', old.asynchronous, 'archival', old.archival, 'compound', old.compound), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_commitments_insert AFTER INSERT ON flow_commitments BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_commitments', new.rowid, 'insert', NULL, json_object('id', new.id, 'flow_id', new.flow_id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'is_private', new.is_private, 'verdict_window_n', new.verdict_window_n, 'verdict_window_kind', new.verdict_window_kind), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_commitments_update AFTER UPDATE ON flow_commitments BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_commitments', new.rowid, 'update', json_object('id', old.id, 'flow_id', old.flow_id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'position', old.position, 'is_private', old.is_private, 'verdict_window_n', old.verdict_window_n, 'verdict_window_kind', old.verdict_window_kind), json_object('id', new.id, 'flow_id', new.flow_id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'is_private', new.is_private, 'verdict_window_n', new.verdict_window_n, 'verdict_window_kind', new.verdict_window_kind), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_commitments_delete AFTER DELETE ON flow_commitments BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_commitments', old.rowid, 'delete', json_object('id', old.id, 'flow_id', old.flow_id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'position', old.position, 'is_private', old.is_private, 'verdict_window_n', old.verdict_window_n, 'verdict_window_kind', old.verdict_window_kind), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_expectations_insert AFTER INSERT ON flow_expectations BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_expectations', new.rowid, 'insert', NULL, json_object('id', new.id, 'flow_id', new.flow_id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'is_private', new.is_private, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind, 'first_check_kind', new.first_check_kind, 'first_check_index', new.first_check_index), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_expectations_update AFTER UPDATE ON flow_expectations BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_expectations', new.rowid, 'update', json_object('id', old.id, 'flow_id', old.flow_id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'position', old.position, 'is_private', old.is_private, 'check_every_n', old.check_every_n, 'check_every_kind', old.check_every_kind, 'first_check_kind', old.first_check_kind, 'first_check_index', old.first_check_index), json_object('id', new.id, 'flow_id', new.flow_id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'is_private', new.is_private, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind, 'first_check_kind', new.first_check_kind, 'first_check_index', new.first_check_index), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_expectations_delete AFTER DELETE ON flow_expectations BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_expectations', old.rowid, 'delete', json_object('id', old.id, 'flow_id', old.flow_id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'position', old.position, 'is_private', old.is_private, 'check_every_n', old.check_every_n, 'check_every_kind', old.check_every_kind, 'first_check_kind', old.first_check_kind, 'first_check_index', old.first_check_index), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_item_cycles_insert AFTER INSERT ON flow_item_cycles BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_item_cycles', new.rowid, 'insert', NULL, json_object('id', new.id, 'flow_id', new.flow_id, 'item_type', new.item_type, 'item_id', new.item_id, 'scope_kind', new.scope_kind, 'scope_index', new.scope_index, 'plan_kind', new.plan_kind, 'plan_start', new.plan_start, 'plan_end', new.plan_end, 'position', new.position), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_item_cycles_update AFTER UPDATE ON flow_item_cycles BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_item_cycles', new.rowid, 'update', json_object('id', old.id, 'flow_id', old.flow_id, 'item_type', old.item_type, 'item_id', old.item_id, 'scope_kind', old.scope_kind, 'scope_index', old.scope_index, 'plan_kind', old.plan_kind, 'plan_start', old.plan_start, 'plan_end', old.plan_end, 'position', old.position), json_object('id', new.id, 'flow_id', new.flow_id, 'item_type', new.item_type, 'item_id', new.item_id, 'scope_kind', new.scope_kind, 'scope_index', new.scope_index, 'plan_kind', new.plan_kind, 'plan_start', new.plan_start, 'plan_end', new.plan_end, 'position', new.position), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_item_cycles_delete AFTER DELETE ON flow_item_cycles BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_item_cycles', old.rowid, 'delete', json_object('id', old.id, 'flow_id', old.flow_id, 'item_type', old.item_type, 'item_id', old.item_id, 'scope_kind', old.scope_kind, 'scope_index', old.scope_index, 'plan_kind', old.plan_kind, 'plan_start', old.plan_start, 'plan_end', old.plan_end, 'position', old.position), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_dependencies_insert AFTER INSERT ON flow_dependencies BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_dependencies', new.rowid, 'insert', NULL, json_object('id', new.id, 'flow_id', new.flow_id, 'dependent_type', new.dependent_type, 'dependent_id', new.dependent_id, 'depends_on_type', new.depends_on_type, 'depends_on_id', new.depends_on_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_dependencies_update AFTER UPDATE ON flow_dependencies BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_dependencies', new.rowid, 'update', json_object('id', old.id, 'flow_id', old.flow_id, 'dependent_type', old.dependent_type, 'dependent_id', old.dependent_id, 'depends_on_type', old.depends_on_type, 'depends_on_id', old.depends_on_id), json_object('id', new.id, 'flow_id', new.flow_id, 'dependent_type', new.dependent_type, 'dependent_id', new.dependent_id, 'depends_on_type', new.depends_on_type, 'depends_on_id', new.depends_on_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_dependencies_delete AFTER DELETE ON flow_dependencies BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_dependencies', old.rowid, 'delete', json_object('id', old.id, 'flow_id', old.flow_id, 'dependent_type', old.dependent_type, 'dependent_id', old.dependent_id, 'depends_on_type', old.depends_on_type, 'depends_on_id', old.depends_on_id), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_template_tags_insert AFTER INSERT ON template_tags BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'template_tags', new.rowid, 'insert', NULL, json_object('id', new.id, 'item_type', new.item_type, 'item_id', new.item_id, 'tag_id', new.tag_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_template_tags_update AFTER UPDATE ON template_tags BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'template_tags', new.rowid, 'update', json_object('id', old.id, 'item_type', old.item_type, 'item_id', old.item_id, 'tag_id', old.tag_id), json_object('id', new.id, 'item_type', new.item_type, 'item_id', new.item_id, 'tag_id', new.tag_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_template_tags_delete AFTER DELETE ON template_tags BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'template_tags', old.rowid, 'delete', json_object('id', old.id, 'item_type', old.item_type, 'item_id', old.item_id, 'tag_id', old.tag_id), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

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

CREATE TRIGGER undo_journal_commitment_overlays_delete AFTER DELETE ON commitment_overlays BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'commitment_overlays', old.rowid, 'delete', json_object('id', old.id, 'flow_id', old.flow_id, 'item_type', old.item_type, 'item_id', old.item_id, 'iteration_scope', old.iteration_scope, 'cycle_id', old.cycle_id, 'verdict', old.verdict, 'resolved_at', old.resolved_at, 'tombstone', old.tombstone, 'title', old.title, 'is_private', old.is_private, 'position', old.position), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_expectation_overlays_insert AFTER INSERT ON expectation_overlays BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'expectation_overlays', new.rowid, 'insert', NULL, json_object('node_key', new.node_key, 'flow_id', new.flow_id, 'occurrence_key', new.occurrence_key, 'title', new.title, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'time_scope_set', new.time_scope_set, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind, 'check_every_set', new.check_every_set, 'check_starting', new.check_starting, 'is_private', new.is_private, 'archival', new.archival, 'agentic', new.agentic, 'agentic_note', new.agentic_note, 'agentic_note_set', new.agentic_note_set, 'agentic_question', new.agentic_question, 'agentic_answer', new.agentic_answer, 'agentic_answer_set', new.agentic_answer_set, 'status', new.status, 'released_at', new.released_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_expectation_overlays_update AFTER UPDATE ON expectation_overlays BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'expectation_overlays', new.rowid, 'update', json_object('node_key', old.node_key, 'flow_id', old.flow_id, 'occurrence_key', old.occurrence_key, 'title', old.title, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind, 'time_scope_set', old.time_scope_set, 'check_every_n', old.check_every_n, 'check_every_kind', old.check_every_kind, 'check_every_set', old.check_every_set, 'check_starting', old.check_starting, 'is_private', old.is_private, 'archival', old.archival, 'agentic', old.agentic, 'agentic_note', old.agentic_note, 'agentic_note_set', old.agentic_note_set, 'agentic_question', old.agentic_question, 'agentic_answer', old.agentic_answer, 'agentic_answer_set', old.agentic_answer_set, 'status', old.status, 'released_at', old.released_at), json_object('node_key', new.node_key, 'flow_id', new.flow_id, 'occurrence_key', new.occurrence_key, 'title', new.title, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'time_scope_set', new.time_scope_set, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind, 'check_every_set', new.check_every_set, 'check_starting', new.check_starting, 'is_private', new.is_private, 'archival', new.archival, 'agentic', new.agentic, 'agentic_note', new.agentic_note, 'agentic_note_set', new.agentic_note_set, 'agentic_question', new.agentic_question, 'agentic_answer', new.agentic_answer, 'agentic_answer_set', new.agentic_answer_set, 'status', new.status, 'released_at', new.released_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_expectation_overlays_delete AFTER DELETE ON expectation_overlays BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'expectation_overlays', old.rowid, 'delete', json_object('node_key', old.node_key, 'flow_id', old.flow_id, 'occurrence_key', old.occurrence_key, 'title', old.title, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind, 'time_scope_set', old.time_scope_set, 'check_every_n', old.check_every_n, 'check_every_kind', old.check_every_kind, 'check_every_set', old.check_every_set, 'check_starting', old.check_starting, 'is_private', old.is_private, 'archival', old.archival, 'agentic', old.agentic, 'agentic_note', old.agentic_note, 'agentic_note_set', old.agentic_note_set, 'agentic_question', old.agentic_question, 'agentic_answer', old.agentic_answer, 'agentic_answer_set', old.agentic_answer_set, 'status', old.status, 'released_at', old.released_at), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

