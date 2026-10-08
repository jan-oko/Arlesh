-- **Agentic statuses** (Task 68f, specced with the user 2026-10-01): an Agentic Task's status is a
-- model of its own — To Do, On Agent, Review, Doing, Done — and the **Agent delegate** is gone.
--
-- Storage (the implementer's call; see docs/spec/resources.md, "Agentic statuses"): one `status`
-- column, as before, whose two models are spelled **disjointly** — the ordinary `todo`,
-- `in_progress`, `started`, `done`, and the Agentic `agentic_todo`, `on_agent`, `doing`,
-- `agentic_done` — so a stored value decodes into exactly one model without knowing the row's kind
-- (an inherited flag, a tree climb away). **Review is never stored**: it is derived on every board
-- load from an On Agent Task with an open agentic question beneath it. The same holds for
-- `task_overlays.status`, where a Habit occurrence's own status lives; a wait's check task keeps
-- the ordinary model.
--
-- Rows move as follows — the one bulk mapping the spec allows:
--   * a Task delegated to the Agent: `in_progress` (or `started`) -> `on_agent`, `todo` ->
--     `agentic_todo`, `done` -> `agentic_done`, and its delegate is cleared. One that does not read
--     as Agentic keeps its ordinary status (On Agent exists only in the Agentic model) and loses
--     the delegate all the same.
--   * every other Task that reads as Agentic: `todo` -> `agentic_todo`, `in_progress` and
--     `started` -> `doing`, `done` -> `agentic_done`.
--   * a Habit occurrence that reads as Agentic: the same, in its overlay (no overlay status is
--     To Do in either model, and stays NULL).
--
-- "Reads as Agentic" is resolved here in SQL the way `tasks::agentic` resolves it: a row's own
-- flag, else its parent's, through Goals and Commitments; a row hung on a Habit occurrence asks the
-- occurrence first (its overlay's flag, else its template's, up the template tree), then the
-- Habit's host. One simplification: an occurrence's *ancestor* occurrences are read by their
-- templates' flags only, not their overlays'.
--
-- Both tables are rebuilt — 0084's hazard and 0084's answer: `tasks`' dependents are copied aside
-- and put back, the undo journal is suppressed while rows move, and each trigger and index is
-- recreated as it stood. `flows` and `flow_tasks` keep their tables; their Agent delegates are
-- cleared and two guard triggers each refuse one being written again.

UPDATE undo_context SET suppressed = 1 WHERE id = 1;

-- 1. What each Task, Goal and Commitment reads as.

CREATE TABLE m88_template (item_type TEXT NOT NULL, item_id INTEGER NOT NULL, flag INTEGER,
                           PRIMARY KEY (item_type, item_id));
WITH RECURSIVE
    items(t, id, flag, pt, pid) AS (
        SELECT 'flow_task', id, agentic,
               CASE parent_type WHEN 'flow' THEN 'flow_root' ELSE parent_type END, parent_id
          FROM flow_tasks
        UNION ALL
        SELECT 'flow_goal', id, NULL,
               CASE parent_type WHEN 'flow' THEN 'flow_root' ELSE parent_type END, parent_id
          FROM flow_goals
        UNION ALL
        SELECT 'flow_root', id, agentic, NULL, NULL FROM flows
    ),
    climb(st, sid, t, id, flag, depth) AS (
        SELECT t, id, t, id, flag, 0 FROM items
        UNION ALL
        SELECT c.st, c.sid, p.t, p.id, p.flag, c.depth + 1
          FROM climb c
          JOIN items cur ON cur.t = c.t AND cur.id = c.id
          JOIN items p ON p.t = cur.pt AND p.id = cur.pid
         WHERE c.flag IS NULL AND c.depth < 64
    )
INSERT INTO m88_template (item_type, item_id, flag)
SELECT st, sid, MAX(flag) FROM climb GROUP BY st, sid;

-- An occurrence's own reading before its host: its overlay's flag, else its template tree's.
CREATE TABLE m88_occurrence (node_key TEXT PRIMARY KEY, flag INTEGER);
INSERT INTO m88_occurrence (node_key, flag)
SELECT k.node_key,
       CASE WHEN o.agentic_set = 1 THEN o.agentic ELSE t.flag END
  FROM (
        SELECT parent_key AS node_key FROM derived_children
        UNION
        SELECT node_key FROM task_overlays WHERE origin = 'habit'
       ) AS k
  LEFT JOIN task_overlays o ON o.node_key = k.node_key
  LEFT JOIN m88_template t
         ON t.item_type = substr(k.node_key, 1, instr(k.node_key, ':') - 1)
        AND t.item_id = CAST(substr(substr(k.node_key, instr(k.node_key, ':') + 1), 1,
                             instr(substr(k.node_key, instr(k.node_key, ':') + 1), ':') - 1) AS INTEGER);

CREATE TABLE m88_reads (node_type TEXT NOT NULL, node_id INTEGER NOT NULL, agentic INTEGER NOT NULL,
                        PRIMARY KEY (node_type, node_id));
WITH RECURSIVE
    nodes(t, id, flag, pt, pid) AS (
        SELECT 'task', id, agentic, parent_type, parent_id FROM tasks
        UNION ALL
        SELECT 'goal', id, NULL, parent_type, parent_id FROM goals
        UNION ALL
        SELECT 'commitment', id, NULL, parent_type, parent_id FROM commitments
    ),
    hung(t, id, flag) AS (
        SELECT d.child_type, d.child_id, o.flag
          FROM derived_children d LEFT JOIN m88_occurrence o ON o.node_key = d.parent_key
    ),
    climb(st, sid, t, id, flag, asked, depth) AS (
        SELECT t, id, t, id, flag, 0, 0 FROM nodes
        UNION ALL
        -- A row hung on an occurrence asks the occurrence first...
        SELECT c.st, c.sid, c.t, c.id, h.flag, 1, c.depth + 1
          FROM climb c JOIN hung h ON h.t = c.t AND h.id = c.id
         WHERE c.flag IS NULL AND c.asked = 0 AND c.depth < 64
        UNION ALL
        -- ...then its parent: for a hung row, the Habit's host its columns name.
        SELECT c.st, c.sid, p.t, p.id, p.flag, 0, c.depth + 1
          FROM climb c
          JOIN nodes cur ON cur.t = c.t AND cur.id = c.id
          JOIN nodes p ON p.t = cur.pt AND p.id = cur.pid
         WHERE c.flag IS NULL AND c.depth < 64
           AND (c.asked = 1 OR NOT EXISTS (SELECT 1 FROM derived_children d
                                            WHERE d.child_type = c.t AND d.child_id = c.id))
    )
INSERT INTO m88_reads (node_type, node_id, agentic)
SELECT st, sid, COALESCE(MAX(flag), 0) FROM climb GROUP BY st, sid;

-- 2. Copy aside every row the drop of `tasks` would cascade away.
CREATE TABLE carry_tags_on_tasks AS SELECT task_id, tag_id FROM tags_on_tasks;
CREATE TABLE carry_task_knowledge_base_links AS SELECT task_id, entity_type, entity_id FROM task_knowledge_base_links;
CREATE TABLE carry_task_dependencies AS SELECT task_id, dependency_type, dependency_id FROM task_dependencies;
CREATE TABLE carry_task_async_templates AS SELECT task_id, title, time_scope_n, time_scope_kind, check_every_n, check_every_kind FROM task_async_templates;
CREATE TABLE carry_tags_on_async_templates AS SELECT task_id, tag_id FROM tags_on_async_templates;
CREATE TABLE carry_spawned_waits AS SELECT task_id, status, archival, last_check_at FROM spawned_waits;
CREATE TABLE carry_derived_dependencies AS SELECT id, flow_id, dependent_id, dependent_key, target_type, target_id, target_key, added FROM derived_dependencies;
CREATE TABLE carry_task_agentic_briefs AS SELECT task_id, priority, spec, design, acceptance, notes FROM task_agentic_briefs;

-- 3. Rebuild `tasks`: both models' spellings, and a Person-only delegate.

CREATE TABLE tasks_new (
    id                       INTEGER PRIMARY KEY,
    title                    TEXT NOT NULL,
    parent_type              TEXT NOT NULL
                                 CHECK (parent_type IN ('project', 'goal', 'domain', 'task', 'commitment')),
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
    beads_id                 TEXT,
    archival                 TEXT NOT NULL DEFAULT 'live' CHECK (archival IN ('live', 'backlog')),
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
INSERT INTO tasks_new (id, title, parent_type, parent_id, status, delegate_kind, delegate_id, position, time_scope_start_id, time_scope_end_id, time_scope_duration_n, time_scope_duration_kind, plan_start_id, plan_end_id, on_scope_exit, is_private, beads_id, archival, agentic, asynchronous, done_at, due_scope_start_id, due_scope_end_id, compound)
SELECT t.id, t.title, t.parent_type, t.parent_id,
       CASE
           WHEN COALESCE(r.agentic, 0) = 0 THEN t.status
           WHEN t.status = 'todo' THEN 'agentic_todo'
           WHEN t.status = 'done' THEN 'agentic_done'
           WHEN t.delegate_kind = 'agent' THEN 'on_agent'
           ELSE 'doing'
       END,
       CASE WHEN t.delegate_kind = 'agent' THEN NULL ELSE t.delegate_kind END,
       CASE WHEN t.delegate_kind = 'agent' THEN NULL ELSE t.delegate_id END,
       t.position, t.time_scope_start_id, t.time_scope_end_id, t.time_scope_duration_n, t.time_scope_duration_kind, t.plan_start_id, t.plan_end_id, t.on_scope_exit, t.is_private, t.beads_id, t.archival, t.agentic, t.asynchronous, t.done_at, t.due_scope_start_id, t.due_scope_end_id, t.compound
  FROM tasks t LEFT JOIN m88_reads r ON r.node_type = 'task' AND r.node_id = t.id;
DROP TABLE tasks;
ALTER TABLE tasks_new RENAME TO tasks;

CREATE TRIGGER undo_journal_tasks_insert AFTER INSERT ON tasks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tasks', new.rowid, 'insert', NULL, json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'status', new.status, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'position', new.position, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'plan_start_id', new.plan_start_id, 'plan_end_id', new.plan_end_id, 'on_scope_exit', new.on_scope_exit, 'is_private', new.is_private, 'beads_id', new.beads_id, 'archival', new.archival, 'agentic', new.agentic, 'asynchronous', new.asynchronous, 'done_at', new.done_at, 'due_scope_start_id', new.due_scope_start_id, 'due_scope_end_id', new.due_scope_end_id, 'compound', new.compound), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_tasks_update AFTER UPDATE ON tasks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tasks', new.rowid, 'update', json_object('id', old.id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'status', old.status, 'delegate_kind', old.delegate_kind, 'delegate_id', old.delegate_id, 'position', old.position, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind, 'plan_start_id', old.plan_start_id, 'plan_end_id', old.plan_end_id, 'on_scope_exit', old.on_scope_exit, 'is_private', old.is_private, 'beads_id', old.beads_id, 'archival', old.archival, 'agentic', old.agentic, 'asynchronous', old.asynchronous, 'done_at', old.done_at, 'due_scope_start_id', old.due_scope_start_id, 'due_scope_end_id', old.due_scope_end_id, 'compound', old.compound), json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'status', new.status, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'position', new.position, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'plan_start_id', new.plan_start_id, 'plan_end_id', new.plan_end_id, 'on_scope_exit', new.on_scope_exit, 'is_private', new.is_private, 'beads_id', new.beads_id, 'archival', new.archival, 'agentic', new.agentic, 'asynchronous', new.asynchronous, 'done_at', new.done_at, 'due_scope_start_id', new.due_scope_start_id, 'due_scope_end_id', new.due_scope_end_id, 'compound', new.compound), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_tasks_delete AFTER DELETE ON tasks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tasks', old.rowid, 'delete', json_object('id', old.id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'status', old.status, 'delegate_kind', old.delegate_kind, 'delegate_id', old.delegate_id, 'position', old.position, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind, 'plan_start_id', old.plan_start_id, 'plan_end_id', old.plan_end_id, 'on_scope_exit', old.on_scope_exit, 'is_private', old.is_private, 'beads_id', old.beads_id, 'archival', old.archival, 'agentic', old.agentic, 'asynchronous', old.asynchronous, 'done_at', old.done_at, 'due_scope_start_id', old.due_scope_start_id, 'due_scope_end_id', old.due_scope_end_id, 'compound', old.compound), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER mcp_roots_forget_task AFTER DELETE ON tasks
WHEN (SELECT suppressed FROM undo_context WHERE id = 1) = 0 BEGIN
    DELETE FROM mcp_roots WHERE node_kind = 'task' AND node_id = old.id;
END;

-- 4. Put the dependents' rows back. `task_async_templates` before its tags, since clearing it
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

-- 5. Rebuild `task_overlays` the same way. An occurrence reads as Agentic by its own reading
--    (m88_occurrence), else its Habit's host's; a check task keeps the ordinary model.

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
    -- Per-occurrence state, in the occurrence's own model: NULL is To Do in either.
    status            TEXT CHECK (status IN ('todo', 'in_progress', 'started', 'done', 'agentic_todo', 'on_agent', 'doing', 'agentic_done')),
    resolved_at       INTEGER,
    tombstone         TEXT CHECK (tombstone IN ('archived', 'missed')),
    -- Inherited columns: NULL inherits the template's value.
    title             TEXT,
    plan_start_id     TEXT,
    plan_end_id       TEXT,
    plan_set          INTEGER NOT NULL DEFAULT 0 CHECK (plan_set IN (0, 1)),
    delegate_kind     TEXT CHECK (delegate_kind IN ('person')),
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
    -- An occurrence's own explicit due (migration 0087).
    due_scope_start_id TEXT CHECK (due_scope_start_id IS NULL OR json_valid(due_scope_start_id)),
    due_scope_end_id   TEXT CHECK (due_scope_end_id IS NULL OR json_valid(due_scope_end_id)),
    CHECK ((origin = 'habit') = (flow_id IS NOT NULL AND item_type IS NOT NULL AND item_id IS NOT NULL
                                 AND iteration_scope IS NOT NULL AND cycle_id IS NOT NULL)),
    CHECK ((origin = 'check') = (wait_key IS NOT NULL AND due_at IS NOT NULL)),
    CHECK (plan_set = 1 OR (plan_start_id IS NULL AND plan_end_id IS NULL)),
    CHECK ((plan_start_id IS NULL) = (plan_end_id IS NULL)),
    CHECK (
        (delegate_kind IS NULL     AND delegate_id IS NULL)
     OR (delegate_kind = 'person'  AND delegate_id IS NOT NULL)
    ),
    CHECK (iteration_scope IS NULL OR json_valid(iteration_scope)),
    CHECK (plan_start_id IS NULL OR json_valid(plan_start_id)),
    CHECK (plan_end_id IS NULL OR json_valid(plan_end_id))
);
INSERT INTO task_overlays_new (id, origin, flow_id, item_type, item_id, iteration_scope, cycle_id, wait_key, due_at, status, resolved_at, tombstone, title, plan_start_id, plan_end_id, plan_set, delegate_kind, delegate_id, delegate_set, agentic, agentic_set, asynchronous, archival, is_private, beads_id, beads_id_set, position, block_reasons_set, brief_priority, brief_priority_set, brief_spec, brief_design, brief_acceptance, brief_notes, due_scope_start_id, due_scope_end_id)
SELECT o.id, o.origin, o.flow_id, o.item_type, o.item_id, o.iteration_scope, o.cycle_id, o.wait_key, o.due_at,
       CASE
           WHEN o.status IS NULL OR o.origin <> 'habit' THEN o.status
           WHEN COALESCE(occ.flag, host.agentic, 0) = 0 THEN o.status
           WHEN o.status = 'todo' THEN 'agentic_todo'
           WHEN o.status = 'done' THEN 'agentic_done'
           ELSE 'doing'
       END,
       o.resolved_at, o.tombstone, o.title, o.plan_start_id, o.plan_end_id, o.plan_set,
       CASE WHEN o.delegate_kind = 'agent' THEN NULL ELSE o.delegate_kind END,
       CASE WHEN o.delegate_kind = 'agent' THEN NULL ELSE o.delegate_id END,
       o.delegate_set, o.agentic, o.agentic_set, o.asynchronous, o.archival, o.is_private, o.beads_id, o.beads_id_set, o.position, o.block_reasons_set, o.brief_priority, o.brief_priority_set, o.brief_spec, o.brief_design, o.brief_acceptance, o.brief_notes, o.due_scope_start_id, o.due_scope_end_id
  FROM task_overlays o
  LEFT JOIN m88_occurrence occ ON occ.node_key = o.node_key
  LEFT JOIN flows f ON f.id = o.flow_id
  LEFT JOIN m88_reads host
         ON host.node_type = COALESCE(f.target_type, f.parent_type)
        AND host.node_id = COALESCE(f.target_id, f.parent_id);
DROP TABLE task_overlays;
ALTER TABLE task_overlays_new RENAME TO task_overlays;

CREATE UNIQUE INDEX idx_task_overlays_key ON task_overlays (node_key);
CREATE INDEX idx_task_overlays_item ON task_overlays (item_type, item_id);
CREATE INDEX idx_task_overlays_flow ON task_overlays (flow_id, iteration_scope);

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

-- 6. The templates: no Agent delegate, and none written again.

UPDATE flows SET delegate_kind = NULL, delegate_id = NULL WHERE delegate_kind = 'agent';
UPDATE flow_tasks SET delegate_kind = NULL, delegate_id = NULL WHERE delegate_kind = 'agent';

CREATE TRIGGER flows_refuse_agent_delegate_insert BEFORE INSERT ON flows
WHEN new.delegate_kind = 'agent' BEGIN
    SELECT RAISE(ABORT, 'the Agent delegate was removed; an agent holds a Task as On Agent');
END;
CREATE TRIGGER flows_refuse_agent_delegate_update BEFORE UPDATE OF delegate_kind ON flows
WHEN new.delegate_kind = 'agent' BEGIN
    SELECT RAISE(ABORT, 'the Agent delegate was removed; an agent holds a Task as On Agent');
END;
CREATE TRIGGER flow_tasks_refuse_agent_delegate_insert BEFORE INSERT ON flow_tasks
WHEN new.delegate_kind = 'agent' BEGIN
    SELECT RAISE(ABORT, 'the Agent delegate was removed; an agent holds a Task as On Agent');
END;
CREATE TRIGGER flow_tasks_refuse_agent_delegate_update BEFORE UPDATE OF delegate_kind ON flow_tasks
WHEN new.delegate_kind = 'agent' BEGIN
    SELECT RAISE(ABORT, 'the Agent delegate was removed; an agent holds a Task as On Agent');
END;

DROP TABLE m88_reads;
DROP TABLE m88_occurrence;
DROP TABLE m88_template;

UPDATE undo_context SET suppressed = 0 WHERE id = 1;
