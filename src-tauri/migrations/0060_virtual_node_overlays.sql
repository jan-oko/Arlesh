-- Virtual node tables (ADR 0008, Arlesh-pnn): a derived node is an ordinary row of its kind.
--
-- A Habit occurrence is read through its kind's virtual table — the stored rows merged with the
-- rows derived from templates — and what makes one occurrence differ from its template lives in
-- that kind's **overlay**. `habit_instance_modifications` was one polymorphic overlay holding a
-- status for whichever kind the occurrence happened to be; it is split here into one overlay per
-- kind, each mirroring its kind's columns, and dropped.
--
-- # The key
--
-- An overlay row is keyed by the occurrence's **value key**: the template item, the iteration it
-- is in — named by the value key of the scope anchoring the iteration's window (ADR 0009), which
-- spells the date it starts on — and the cycle pair. The tuple is stored as real columns, because
-- it is the data. `node_key` is the same tuple spelled as one canonical string
-- (`flow_task:12:{"kind":"day","date":"2026-09-20"}:3` — the scope key in its canonical JSON
-- text), a VIRTUAL generated column that the Rust side hashes into the row's UUID-v5 id; SQLite has
-- no SHA-1 of its own. Every scope key column carries `CHECK (col IS NULL OR json_valid(col))`, as
-- every keyed column does (migration 0046).
--
-- The Task overlay is also where an Expectation's **check tasks** will keep their state
-- (`origin = 'check'`, keyed by the wait and the instant the check fell due). Those columns are
-- here from the start so that moving checks in is an insert, not a rebuild of a populated table.
--
-- # The columns
--
-- Every overlay column is nullable, and NULL means *inherit from the template*. Where NULL is
-- itself a value — no Plan, no delegate, no beads id — a `*_set` flag says "overridden to NULL".
-- Only what is inherently per-occurrence is not inherited: the status (and when it was resolved),
-- and the tombstone. The Time Scope is not a column at all: an occurrence's window is its
-- iteration's (or its Cycle Scope's), and moving an occurrence out of it is refused.
--
-- # Migrating the Modifications
--
-- Every row that says anything its kind can read carries across, under the iteration scope key it
-- already had (migration 0046 keyed it). The status moves into
-- its kind's vocabulary: a Goal's `done` is `achieved`, a Commitment keeps `kept`/`broken` as
-- its verdict (a stale `done` is not a verdict, and nothing reads it as one), and a Task keeps
-- its status. A `deleted` tombstone becomes `archived` — an occurrence is never deleted.
--
-- The per-iteration dependency edges and the added children move to the relation tables below,
-- keyed the same way.

-- ---------------------------------------------------------------------------------------------
-- Overlays
-- ---------------------------------------------------------------------------------------------

CREATE TABLE task_overlays (
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
    status            TEXT CHECK (status IN ('todo', 'in_progress', 'done')),
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
    block_reasons_set INTEGER NOT NULL DEFAULT 0 CHECK (block_reasons_set IN (0, 1)),
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
CREATE UNIQUE INDEX idx_task_overlays_key ON task_overlays (node_key);
CREATE INDEX idx_task_overlays_item ON task_overlays (item_type, item_id);
CREATE INDEX idx_task_overlays_flow ON task_overlays (flow_id, iteration_scope);

CREATE TABLE goal_overlays (
    id                INTEGER PRIMARY KEY,
    flow_id           INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    item_type         TEXT NOT NULL CHECK (item_type IN ('flow_goal', 'flow_root')),
    item_id           INTEGER NOT NULL,
    iteration_scope   TEXT NOT NULL,
    cycle_id          INTEGER NOT NULL DEFAULT 0,
    node_key          TEXT GENERATED ALWAYS AS (
                          item_type || ':' || item_id || ':' || iteration_scope || ':' || cycle_id) VIRTUAL,
    status            TEXT CHECK (status IN ('active', 'achieved', 'frozen', 'archived')),
    resolved_at       INTEGER,
    tombstone         TEXT CHECK (tombstone IN ('archived', 'missed')),
    title             TEXT,
    is_private        INTEGER CHECK (is_private IN (0, 1)),
    beads_id          TEXT,
    beads_id_set      INTEGER NOT NULL DEFAULT 0 CHECK (beads_id_set IN (0, 1)),
    position          INTEGER,
    block_reasons_set INTEGER NOT NULL DEFAULT 0 CHECK (block_reasons_set IN (0, 1)),
    UNIQUE (item_type, item_id, iteration_scope, cycle_id),
    CHECK (iteration_scope IS NULL OR json_valid(iteration_scope))
);
CREATE UNIQUE INDEX idx_goal_overlays_key ON goal_overlays (node_key);
CREATE INDEX idx_goal_overlays_flow ON goal_overlays (flow_id, iteration_scope);

CREATE TABLE commitment_overlays (
    id                INTEGER PRIMARY KEY,
    flow_id           INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    -- A commitment Habit's items are Tasks; only its iteration root is a Commitment.
    item_type         TEXT NOT NULL CHECK (item_type IN ('flow_root')),
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
    beads_id          TEXT,
    beads_id_set      INTEGER NOT NULL DEFAULT 0 CHECK (beads_id_set IN (0, 1)),
    position          INTEGER,
    UNIQUE (item_type, item_id, iteration_scope, cycle_id),
    CHECK (iteration_scope IS NULL OR json_valid(iteration_scope))
);
CREATE UNIQUE INDEX idx_commitment_overlays_key ON commitment_overlays (node_key);
CREATE INDEX idx_commitment_overlays_flow ON commitment_overlays (flow_id, iteration_scope);

-- ---------------------------------------------------------------------------------------------
-- Relations of derived nodes
--
-- A stored node keeps today's relation tables. A derived node's relations are differences
-- against its template, keyed by its canonical node key (`flow_task:12:2026-09-20:3`) — a real
-- column here, since a relation's endpoint can be a derived node of any origin, and the key is
-- what names one. `flow_id` is the Habit the derived end belongs to, so deleting the Habit takes
-- its occurrences' relations with it.
-- ---------------------------------------------------------------------------------------------

-- Tags: `added = 1` puts a tag on the occurrence, `added = 0` takes one of its template's off.
CREATE TABLE derived_tags (
    id        INTEGER PRIMARY KEY,
    flow_id   INTEGER REFERENCES flows(id) ON DELETE CASCADE,
    node_kind TEXT NOT NULL CHECK (node_kind IN ('task', 'goal', 'commitment', 'expectation')),
    node_key  TEXT NOT NULL,
    tag_id    INTEGER NOT NULL REFERENCES domains(id),
    added     INTEGER NOT NULL CHECK (added IN (0, 1)),
    UNIQUE (node_key, tag_id)
);
CREATE INDEX idx_derived_tags_flow ON derived_tags (flow_id);

-- Block reasons: an occurrence either reads its template's list or has its own, flagged by its
-- overlay's `block_reasons_set`; its own list lives here, ordered.
CREATE TABLE derived_block_reasons (
    id         INTEGER PRIMARY KEY,
    flow_id    INTEGER REFERENCES flows(id) ON DELETE CASCADE,
    node_kind  TEXT NOT NULL CHECK (node_kind IN ('task', 'goal')),
    node_key   TEXT NOT NULL,
    reason     TEXT NOT NULL,
    position   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_derived_block_reasons_node ON derived_block_reasons (node_key);

-- Dependencies with a derived end. Stored-to-stored edges stay in `task_dependencies`.
--
-- Each end is a stored row (`*_id`) or a derived one (`*_key`), never both. The template's own
-- edges are inherited by every occurrence; `added = 0` removes one of them from one occurrence,
-- which only a derived dependent can do. `dependent_node` and `target_node` are the unified
-- endpoint keys (`task:42`, or the derived key), generated, and what the uniqueness is over.
CREATE TABLE derived_dependencies (
    id             INTEGER PRIMARY KEY,
    flow_id        INTEGER REFERENCES flows(id) ON DELETE CASCADE,
    dependent_id   INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
    dependent_key  TEXT,
    target_type    TEXT NOT NULL CHECK (target_type IN ('task', 'goal', 'expectation')),
    target_id      INTEGER,
    target_key     TEXT,
    added          INTEGER NOT NULL DEFAULT 1 CHECK (added IN (0, 1)),
    dependent_node TEXT GENERATED ALWAYS AS (coalesce(dependent_key, 'task:' || dependent_id)) VIRTUAL,
    target_node    TEXT GENERATED ALWAYS AS (coalesce(target_key, target_type || ':' || target_id)) VIRTUAL,
    CHECK ((dependent_id IS NULL) <> (dependent_key IS NULL)),
    CHECK ((target_id IS NULL) <> (target_key IS NULL)),
    CHECK (dependent_key IS NOT NULL OR target_key IS NOT NULL),
    CHECK (added = 1 OR dependent_key IS NOT NULL)
);
CREATE UNIQUE INDEX idx_derived_dependencies_edge ON derived_dependencies (dependent_node, target_node);
CREATE INDEX idx_derived_dependencies_flow ON derived_dependencies (flow_id);

-- Stored rows hung on a derived node. The child's own `parent_type`/`parent_id` name the Habit's
-- host (a derived node has no integer id for them to hold); this attachment is what makes the
-- occurrence its parent, and the virtual table reads the child's parent through it.
CREATE TABLE derived_children (
    id                  INTEGER PRIMARY KEY,
    flow_id             INTEGER REFERENCES flows(id) ON DELETE CASCADE,
    parent_kind         TEXT NOT NULL CHECK (parent_kind IN ('task', 'goal', 'commitment')),
    parent_key          TEXT NOT NULL,
    -- The occurrence's window, its two boundary scopes resolved at attach time: reading the
    -- child's ancestry must not have to resolve a Flow Window, which mints scope rows.
    window_start_scope_id TEXT,
    window_end_scope_id TEXT,
    child_type          TEXT NOT NULL CHECK (child_type IN ('task', 'goal', 'commitment', 'info', 'expectation')),
    child_id            INTEGER NOT NULL,
    UNIQUE (child_type, child_id),
    CHECK (window_start_scope_id IS NULL OR json_valid(window_start_scope_id)),
    CHECK (window_end_scope_id IS NULL OR json_valid(window_end_scope_id))
);
CREATE INDEX idx_derived_children_parent ON derived_children (parent_key);
CREATE INDEX idx_derived_children_flow ON derived_children (flow_id);

-- ---------------------------------------------------------------------------------------------
-- Carry the Modifications across
-- ---------------------------------------------------------------------------------------------

-- Each Modification with the kind its occurrence is.
CREATE TEMP TABLE modification_moves AS
SELECT m.*,
       CASE m.item_type
           WHEN 'flow_task' THEN 'task'
           WHEN 'flow_goal' THEN 'goal'
           ELSE f.instance_type
       END AS node_kind
FROM habit_instance_modifications m
JOIN flows f ON f.id = m.flow_id;

INSERT INTO task_overlays
    (origin, flow_id, item_type, item_id, iteration_scope, cycle_id, status, resolved_at, tombstone, title)
SELECT 'habit', flow_id, item_type, item_id, iteration_scope_id, cycle_id,
       CASE WHEN status IN ('todo', 'in_progress', 'done') THEN status END,
       resolved_at,
       CASE WHEN tombstone_kind IS NULL THEN NULL WHEN tombstone_kind = 'missed' THEN 'missed' ELSE 'archived' END,
       title
FROM modification_moves
WHERE node_kind = 'task';

INSERT INTO goal_overlays
    (flow_id, item_type, item_id, iteration_scope, cycle_id, status, resolved_at, tombstone, title)
SELECT flow_id, item_type, item_id, iteration_scope_id, cycle_id,
       CASE status
           WHEN 'done' THEN 'achieved'
           WHEN 'achieved' THEN 'achieved'
           WHEN 'frozen' THEN 'frozen'
           WHEN 'archived' THEN 'archived'
       END,
       resolved_at,
       CASE WHEN tombstone_kind IS NULL THEN NULL WHEN tombstone_kind = 'missed' THEN 'missed' ELSE 'archived' END,
       title
FROM modification_moves
WHERE node_kind = 'goal';

INSERT INTO commitment_overlays
    (flow_id, item_type, item_id, iteration_scope, cycle_id, verdict, resolved_at, tombstone, title)
SELECT flow_id, item_type, item_id, iteration_scope_id, cycle_id,
       CASE WHEN status IN ('kept', 'broken') THEN status END,
       CASE WHEN status IN ('kept', 'broken') THEN resolved_at END,
       CASE WHEN tombstone_kind IS NULL THEN NULL WHEN tombstone_kind = 'missed' THEN 'missed' ELSE 'archived' END,
       title
FROM modification_moves
WHERE node_kind = 'commitment';

-- A Modification's block reason becomes its occurrence's own one-reason list.
INSERT INTO derived_block_reasons (flow_id, node_kind, node_key, reason, position)
SELECT flow_id, node_kind, item_type || ':' || item_id || ':' || iteration_scope_id || ':' || cycle_id,
       blocked_reason, 0
FROM modification_moves
WHERE blocked_reason IS NOT NULL AND node_kind IN ('task', 'goal');
UPDATE task_overlays SET block_reasons_set = 1
WHERE node_key IN (SELECT node_key FROM derived_block_reasons WHERE node_kind = 'task');
UPDATE goal_overlays SET block_reasons_set = 1
WHERE node_key IN (SELECT node_key FROM derived_block_reasons WHERE node_kind = 'goal');

DROP TABLE modification_moves;

-- A row that carried nothing its kind can read — a goal's `in_progress`, a commitment's stale
-- `done` — says nothing now, and an overlay that says nothing is not kept.
DELETE FROM task_overlays
WHERE status IS NULL AND tombstone IS NULL AND title IS NULL AND block_reasons_set = 0;
DELETE FROM goal_overlays
WHERE status IS NULL AND tombstone IS NULL AND title IS NULL AND block_reasons_set = 0;
DELETE FROM commitment_overlays
WHERE verdict IS NULL AND tombstone IS NULL AND title IS NULL;

-- Per-iteration dependency edges: both ends are occurrences of the one iteration, cycle `0`.
INSERT OR IGNORE INTO derived_dependencies
    (flow_id, dependent_key, target_type, target_key, added)
SELECT flow_id,
       dependent_type || ':' || dependent_id || ':' || iteration_scope_id || ':0',
       CASE depends_on_type WHEN 'flow_goal' THEN 'goal' ELSE 'task' END,
       depends_on_type || ':' || depends_on_id || ':' || iteration_scope_id || ':0',
       added
FROM habit_instance_dependencies
WHERE dependent_type = 'flow_task';

INSERT INTO derived_children
    (flow_id, parent_kind, parent_key, window_start_scope_id, window_end_scope_id, child_type, child_id)
SELECT c.flow_id,
       CASE c.item_type WHEN 'flow_task' THEN 'task' WHEN 'flow_goal' THEN 'goal' ELSE f.instance_type END,
       c.item_type || ':' || c.item_id || ':' || c.iteration_scope_id || ':' || c.cycle_id,
       c.iteration_scope_id, c.window_end_scope_id, c.child_type, c.child_id
FROM habit_instance_children c
JOIN flows f ON f.id = c.flow_id;

DROP TABLE habit_instance_modifications;
DROP TABLE habit_instance_dependencies;
DROP TABLE habit_instance_children;



-- Undo-journal triggers, straight from scripts/generate-undo-triggers.sh.

DROP TRIGGER IF EXISTS undo_journal_commitment_overlays_insert;
CREATE TRIGGER undo_journal_commitment_overlays_insert AFTER INSERT ON commitment_overlays BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'commitment_overlays', new.rowid, 'insert', NULL, json_object('id', new.id, 'flow_id', new.flow_id, 'item_type', new.item_type, 'item_id', new.item_id, 'iteration_scope', new.iteration_scope, 'cycle_id', new.cycle_id, 'verdict', new.verdict, 'resolved_at', new.resolved_at, 'tombstone', new.tombstone, 'title', new.title, 'is_private', new.is_private, 'beads_id', new.beads_id, 'beads_id_set', new.beads_id_set, 'position', new.position), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_commitment_overlays_update;
CREATE TRIGGER undo_journal_commitment_overlays_update AFTER UPDATE ON commitment_overlays BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'commitment_overlays', new.rowid, 'update', json_object('id', old.id, 'flow_id', old.flow_id, 'item_type', old.item_type, 'item_id', old.item_id, 'iteration_scope', old.iteration_scope, 'cycle_id', old.cycle_id, 'verdict', old.verdict, 'resolved_at', old.resolved_at, 'tombstone', old.tombstone, 'title', old.title, 'is_private', old.is_private, 'beads_id', old.beads_id, 'beads_id_set', old.beads_id_set, 'position', old.position), json_object('id', new.id, 'flow_id', new.flow_id, 'item_type', new.item_type, 'item_id', new.item_id, 'iteration_scope', new.iteration_scope, 'cycle_id', new.cycle_id, 'verdict', new.verdict, 'resolved_at', new.resolved_at, 'tombstone', new.tombstone, 'title', new.title, 'is_private', new.is_private, 'beads_id', new.beads_id, 'beads_id_set', new.beads_id_set, 'position', new.position), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_commitment_overlays_delete;
CREATE TRIGGER undo_journal_commitment_overlays_delete AFTER DELETE ON commitment_overlays BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'commitment_overlays', old.rowid, 'delete', json_object('id', old.id, 'flow_id', old.flow_id, 'item_type', old.item_type, 'item_id', old.item_id, 'iteration_scope', old.iteration_scope, 'cycle_id', old.cycle_id, 'verdict', old.verdict, 'resolved_at', old.resolved_at, 'tombstone', old.tombstone, 'title', old.title, 'is_private', old.is_private, 'beads_id', old.beads_id, 'beads_id_set', old.beads_id_set, 'position', old.position), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_derived_block_reasons_insert;
CREATE TRIGGER undo_journal_derived_block_reasons_insert AFTER INSERT ON derived_block_reasons BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'derived_block_reasons', new.rowid, 'insert', NULL, json_object('id', new.id, 'flow_id', new.flow_id, 'node_kind', new.node_kind, 'node_key', new.node_key, 'reason', new.reason, 'position', new.position), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_derived_block_reasons_update;
CREATE TRIGGER undo_journal_derived_block_reasons_update AFTER UPDATE ON derived_block_reasons BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'derived_block_reasons', new.rowid, 'update', json_object('id', old.id, 'flow_id', old.flow_id, 'node_kind', old.node_kind, 'node_key', old.node_key, 'reason', old.reason, 'position', old.position), json_object('id', new.id, 'flow_id', new.flow_id, 'node_kind', new.node_kind, 'node_key', new.node_key, 'reason', new.reason, 'position', new.position), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_derived_block_reasons_delete;
CREATE TRIGGER undo_journal_derived_block_reasons_delete AFTER DELETE ON derived_block_reasons BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'derived_block_reasons', old.rowid, 'delete', json_object('id', old.id, 'flow_id', old.flow_id, 'node_kind', old.node_kind, 'node_key', old.node_key, 'reason', old.reason, 'position', old.position), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_derived_children_insert;
CREATE TRIGGER undo_journal_derived_children_insert AFTER INSERT ON derived_children BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'derived_children', new.rowid, 'insert', NULL, json_object('id', new.id, 'flow_id', new.flow_id, 'parent_kind', new.parent_kind, 'parent_key', new.parent_key, 'window_start_scope_id', new.window_start_scope_id, 'window_end_scope_id', new.window_end_scope_id, 'child_type', new.child_type, 'child_id', new.child_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_derived_children_update;
CREATE TRIGGER undo_journal_derived_children_update AFTER UPDATE ON derived_children BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'derived_children', new.rowid, 'update', json_object('id', old.id, 'flow_id', old.flow_id, 'parent_kind', old.parent_kind, 'parent_key', old.parent_key, 'window_start_scope_id', old.window_start_scope_id, 'window_end_scope_id', old.window_end_scope_id, 'child_type', old.child_type, 'child_id', old.child_id), json_object('id', new.id, 'flow_id', new.flow_id, 'parent_kind', new.parent_kind, 'parent_key', new.parent_key, 'window_start_scope_id', new.window_start_scope_id, 'window_end_scope_id', new.window_end_scope_id, 'child_type', new.child_type, 'child_id', new.child_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_derived_children_delete;
CREATE TRIGGER undo_journal_derived_children_delete AFTER DELETE ON derived_children BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'derived_children', old.rowid, 'delete', json_object('id', old.id, 'flow_id', old.flow_id, 'parent_kind', old.parent_kind, 'parent_key', old.parent_key, 'window_start_scope_id', old.window_start_scope_id, 'window_end_scope_id', old.window_end_scope_id, 'child_type', old.child_type, 'child_id', old.child_id), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_derived_dependencies_insert;
CREATE TRIGGER undo_journal_derived_dependencies_insert AFTER INSERT ON derived_dependencies BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'derived_dependencies', new.rowid, 'insert', NULL, json_object('id', new.id, 'flow_id', new.flow_id, 'dependent_id', new.dependent_id, 'dependent_key', new.dependent_key, 'target_type', new.target_type, 'target_id', new.target_id, 'target_key', new.target_key, 'added', new.added), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_derived_dependencies_update;
CREATE TRIGGER undo_journal_derived_dependencies_update AFTER UPDATE ON derived_dependencies BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'derived_dependencies', new.rowid, 'update', json_object('id', old.id, 'flow_id', old.flow_id, 'dependent_id', old.dependent_id, 'dependent_key', old.dependent_key, 'target_type', old.target_type, 'target_id', old.target_id, 'target_key', old.target_key, 'added', old.added), json_object('id', new.id, 'flow_id', new.flow_id, 'dependent_id', new.dependent_id, 'dependent_key', new.dependent_key, 'target_type', new.target_type, 'target_id', new.target_id, 'target_key', new.target_key, 'added', new.added), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_derived_dependencies_delete;
CREATE TRIGGER undo_journal_derived_dependencies_delete AFTER DELETE ON derived_dependencies BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'derived_dependencies', old.rowid, 'delete', json_object('id', old.id, 'flow_id', old.flow_id, 'dependent_id', old.dependent_id, 'dependent_key', old.dependent_key, 'target_type', old.target_type, 'target_id', old.target_id, 'target_key', old.target_key, 'added', old.added), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_derived_tags_insert;
CREATE TRIGGER undo_journal_derived_tags_insert AFTER INSERT ON derived_tags BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'derived_tags', new.rowid, 'insert', NULL, json_object('id', new.id, 'flow_id', new.flow_id, 'node_kind', new.node_kind, 'node_key', new.node_key, 'tag_id', new.tag_id, 'added', new.added), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_derived_tags_update;
CREATE TRIGGER undo_journal_derived_tags_update AFTER UPDATE ON derived_tags BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'derived_tags', new.rowid, 'update', json_object('id', old.id, 'flow_id', old.flow_id, 'node_kind', old.node_kind, 'node_key', old.node_key, 'tag_id', old.tag_id, 'added', old.added), json_object('id', new.id, 'flow_id', new.flow_id, 'node_kind', new.node_kind, 'node_key', new.node_key, 'tag_id', new.tag_id, 'added', new.added), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_derived_tags_delete;
CREATE TRIGGER undo_journal_derived_tags_delete AFTER DELETE ON derived_tags BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'derived_tags', old.rowid, 'delete', json_object('id', old.id, 'flow_id', old.flow_id, 'node_kind', old.node_kind, 'node_key', old.node_key, 'tag_id', old.tag_id, 'added', old.added), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_goal_overlays_insert;
CREATE TRIGGER undo_journal_goal_overlays_insert AFTER INSERT ON goal_overlays BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'goal_overlays', new.rowid, 'insert', NULL, json_object('id', new.id, 'flow_id', new.flow_id, 'item_type', new.item_type, 'item_id', new.item_id, 'iteration_scope', new.iteration_scope, 'cycle_id', new.cycle_id, 'status', new.status, 'resolved_at', new.resolved_at, 'tombstone', new.tombstone, 'title', new.title, 'is_private', new.is_private, 'beads_id', new.beads_id, 'beads_id_set', new.beads_id_set, 'position', new.position, 'block_reasons_set', new.block_reasons_set), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_goal_overlays_update;
CREATE TRIGGER undo_journal_goal_overlays_update AFTER UPDATE ON goal_overlays BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'goal_overlays', new.rowid, 'update', json_object('id', old.id, 'flow_id', old.flow_id, 'item_type', old.item_type, 'item_id', old.item_id, 'iteration_scope', old.iteration_scope, 'cycle_id', old.cycle_id, 'status', old.status, 'resolved_at', old.resolved_at, 'tombstone', old.tombstone, 'title', old.title, 'is_private', old.is_private, 'beads_id', old.beads_id, 'beads_id_set', old.beads_id_set, 'position', old.position, 'block_reasons_set', old.block_reasons_set), json_object('id', new.id, 'flow_id', new.flow_id, 'item_type', new.item_type, 'item_id', new.item_id, 'iteration_scope', new.iteration_scope, 'cycle_id', new.cycle_id, 'status', new.status, 'resolved_at', new.resolved_at, 'tombstone', new.tombstone, 'title', new.title, 'is_private', new.is_private, 'beads_id', new.beads_id, 'beads_id_set', new.beads_id_set, 'position', new.position, 'block_reasons_set', new.block_reasons_set), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_goal_overlays_delete;
CREATE TRIGGER undo_journal_goal_overlays_delete AFTER DELETE ON goal_overlays BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'goal_overlays', old.rowid, 'delete', json_object('id', old.id, 'flow_id', old.flow_id, 'item_type', old.item_type, 'item_id', old.item_id, 'iteration_scope', old.iteration_scope, 'cycle_id', old.cycle_id, 'status', old.status, 'resolved_at', old.resolved_at, 'tombstone', old.tombstone, 'title', old.title, 'is_private', old.is_private, 'beads_id', old.beads_id, 'beads_id_set', old.beads_id_set, 'position', old.position, 'block_reasons_set', old.block_reasons_set), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_task_overlays_insert;
CREATE TRIGGER undo_journal_task_overlays_insert AFTER INSERT ON task_overlays BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'task_overlays', new.rowid, 'insert', NULL, json_object('id', new.id, 'origin', new.origin, 'flow_id', new.flow_id, 'item_type', new.item_type, 'item_id', new.item_id, 'iteration_scope', new.iteration_scope, 'cycle_id', new.cycle_id, 'wait_key', new.wait_key, 'due_at', new.due_at, 'status', new.status, 'resolved_at', new.resolved_at, 'tombstone', new.tombstone, 'title', new.title, 'plan_start_id', new.plan_start_id, 'plan_end_id', new.plan_end_id, 'plan_set', new.plan_set, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'delegate_set', new.delegate_set, 'agentic', new.agentic, 'agentic_set', new.agentic_set, 'asynchronous', new.asynchronous, 'archival', new.archival, 'is_private', new.is_private, 'beads_id', new.beads_id, 'beads_id_set', new.beads_id_set, 'position', new.position, 'block_reasons_set', new.block_reasons_set), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_task_overlays_update;
CREATE TRIGGER undo_journal_task_overlays_update AFTER UPDATE ON task_overlays BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'task_overlays', new.rowid, 'update', json_object('id', old.id, 'origin', old.origin, 'flow_id', old.flow_id, 'item_type', old.item_type, 'item_id', old.item_id, 'iteration_scope', old.iteration_scope, 'cycle_id', old.cycle_id, 'wait_key', old.wait_key, 'due_at', old.due_at, 'status', old.status, 'resolved_at', old.resolved_at, 'tombstone', old.tombstone, 'title', old.title, 'plan_start_id', old.plan_start_id, 'plan_end_id', old.plan_end_id, 'plan_set', old.plan_set, 'delegate_kind', old.delegate_kind, 'delegate_id', old.delegate_id, 'delegate_set', old.delegate_set, 'agentic', old.agentic, 'agentic_set', old.agentic_set, 'asynchronous', old.asynchronous, 'archival', old.archival, 'is_private', old.is_private, 'beads_id', old.beads_id, 'beads_id_set', old.beads_id_set, 'position', old.position, 'block_reasons_set', old.block_reasons_set), json_object('id', new.id, 'origin', new.origin, 'flow_id', new.flow_id, 'item_type', new.item_type, 'item_id', new.item_id, 'iteration_scope', new.iteration_scope, 'cycle_id', new.cycle_id, 'wait_key', new.wait_key, 'due_at', new.due_at, 'status', new.status, 'resolved_at', new.resolved_at, 'tombstone', new.tombstone, 'title', new.title, 'plan_start_id', new.plan_start_id, 'plan_end_id', new.plan_end_id, 'plan_set', new.plan_set, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'delegate_set', new.delegate_set, 'agentic', new.agentic, 'agentic_set', new.agentic_set, 'asynchronous', new.asynchronous, 'archival', new.archival, 'is_private', new.is_private, 'beads_id', new.beads_id, 'beads_id_set', new.beads_id_set, 'position', new.position, 'block_reasons_set', new.block_reasons_set), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_task_overlays_delete;
CREATE TRIGGER undo_journal_task_overlays_delete AFTER DELETE ON task_overlays BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'task_overlays', old.rowid, 'delete', json_object('id', old.id, 'origin', old.origin, 'flow_id', old.flow_id, 'item_type', old.item_type, 'item_id', old.item_id, 'iteration_scope', old.iteration_scope, 'cycle_id', old.cycle_id, 'wait_key', old.wait_key, 'due_at', old.due_at, 'status', old.status, 'resolved_at', old.resolved_at, 'tombstone', old.tombstone, 'title', old.title, 'plan_start_id', old.plan_start_id, 'plan_end_id', old.plan_end_id, 'plan_set', old.plan_set, 'delegate_kind', old.delegate_kind, 'delegate_id', old.delegate_id, 'delegate_set', old.delegate_set, 'agentic', old.agentic, 'agentic_set', old.agentic_set, 'asynchronous', old.asynchronous, 'archival', old.archival, 'is_private', old.is_private, 'beads_id', old.beads_id, 'beads_id_set', old.beads_id_set, 'position', old.position, 'block_reasons_set', old.block_reasons_set), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;
