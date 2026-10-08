-- Commitments: a kept-or-broken node kind for time-scoped obligations.
--
-- A Commitment is not a piece of work. It is a rule held over a window — "asleep by 23:00", "no
-- social media today" — and it resolves the opposite way round to a Task: a Task untouched when
-- its window closes is Missed, a Commitment untouched may well have been Kept. That inversion is
-- why this is its own table rather than a flag on `tasks`; see
-- docs/adr/0005-commitment-node-kind.md.
--
-- Columns, and the ones deliberately absent:
--
--   * `verdict` — unresolved | kept | broken, and **never derived**. Not from the window passing,
--     not from children completing. `unresolved` means "you have not said", which is real
--     information any defaulted verdict would destroy.
--   * `time_scope_*` — the same four flat columns a Task carries. A Commitment must have an
--     *effective* window (its own, or a scoped ancestor's); that is a write-time rule rather than
--     a NOT NULL, because inheritance means the column itself may legitimately be null.
--   * `verdict_window_n` / `verdict_window_kind` — the **Verdict Window**: how long past the end
--     of its scope a Commitment stays answerable, as the same `(n, kind)` Duration pair a Habit's
--     Gap and a Time Scope's Duration form already use. Its kind is independent of the
--     commitment's own window, so a monthly commitment can be answerable for two days. Null
--     inherits the nearest ancestor Commitment that sets one; there is no global default.
--   * **No `plan`** — the window *is* the commitment, so there is nothing to schedule it into.
--   * **No `on_scope_exit`** — a Commitment always Keeps; the Verdict Window is what eventually
--     ends that, and it moves Archival rather than the Verdict.
--   * **No `status`, no `archival`, no dependencies, no delegate, no block reasons** — it is a
--     rule held, not a unit of work in a graph.

CREATE TABLE commitments (
    id                       INTEGER PRIMARY KEY,
    title                    TEXT NOT NULL,
    parent_type              TEXT NOT NULL
                                 CHECK (parent_type IN ('project', 'goal', 'domain', 'task', 'commitment')),
    parent_id                INTEGER NOT NULL,
    verdict                  TEXT NOT NULL DEFAULT 'unresolved'
                                 CHECK (verdict IN ('unresolved', 'kept', 'broken')),
    time_scope_start_id      INTEGER REFERENCES scopes(id),
    time_scope_end_id        INTEGER REFERENCES scopes(id),
    time_scope_duration_n    INTEGER,
    time_scope_duration_kind TEXT,
    verdict_window_n         INTEGER,
    verdict_window_kind      TEXT,
    position                 INTEGER NOT NULL DEFAULT 0,
    is_private               BOOLEAN NOT NULL DEFAULT 0,
    beads_id                 TEXT,
    -- A Duration is a pair or it is nothing: half of one says neither how long nor in what.
    CHECK ((verdict_window_n IS NULL) = (verdict_window_kind IS NULL))
);

CREATE INDEX idx_commitments_parent ON commitments (parent_type, parent_id);

CREATE TABLE tags_on_commitments (
    commitment_id INTEGER NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
    tag_id        INTEGER NOT NULL REFERENCES domains(id),
    PRIMARY KEY (commitment_id, tag_id)
);

-- ===========================================================================
-- Widening four CHECK constraints
-- ===========================================================================
--
-- `tasks.parent_type` has to accept `commitment` (a Commitment holds Task children — "phone on
-- charger", "set alarm"), `flows.instance_type` has to accept `commitment` (a nightly rule recurs
-- through the Habit machinery rather than a second engine), and the two tables that record what a
-- started flow materialised — `flow_instances.root_type` and `flow_instance_nodes.node_type` —
-- have to accept the rows it now can.
--
-- SQLite cannot alter a CHECK, so each table is rebuilt, and the rebuild has one hazard worth
-- stating plainly. `tasks` is referenced with ON DELETE CASCADE by three tables and `flows` by
-- seven more; `DROP TABLE tasks` therefore fires those cascades and takes every tag, dependency
-- edge and knowledge-base link on the board with it. `PRAGMA defer_foreign_keys` does not help —
-- it defers constraint *violations*, not cascade *actions* — and `PRAGMA legacy_alter_table`,
-- which would let a RENAME leave the inbound references alone, is documented as having no effect
-- while foreign keys are enabled, which they are on every connection this app opens.
--
-- So each dependent table is copied to a constraint-free scratch table, dropped, and rebuilt
-- afterwards from its own unchanged definition. Nothing is inferred and nothing is cascaded.

-- --- tasks ------------------------------------------------------------------

CREATE TABLE carry_task_dependencies AS SELECT * FROM task_dependencies;
CREATE TABLE carry_tags_on_tasks AS SELECT * FROM tags_on_tasks;
CREATE TABLE carry_task_knowledge_base_links AS SELECT * FROM task_knowledge_base_links;

DROP TABLE task_dependencies;
DROP TABLE tags_on_tasks;
DROP TABLE task_knowledge_base_links;

CREATE TABLE tasks_new (
    id                       INTEGER PRIMARY KEY,
    title                    TEXT NOT NULL,
    parent_type              TEXT NOT NULL
                                 CHECK (parent_type IN ('project', 'goal', 'domain', 'task', 'commitment')),
    parent_id                INTEGER NOT NULL,
    status                   TEXT NOT NULL DEFAULT 'todo'
                                 CHECK (status IN ('todo', 'in_progress', 'done')),
    delegate_to              INTEGER REFERENCES people(id),
    position                 INTEGER NOT NULL DEFAULT 0,
    time_scope_start_id      INTEGER REFERENCES scopes(id),
    time_scope_end_id        INTEGER REFERENCES scopes(id),
    time_scope_duration_n    INTEGER,
    time_scope_duration_kind TEXT,
    plan_start_id            INTEGER REFERENCES scopes(id),
    plan_end_id              INTEGER REFERENCES scopes(id),
    on_scope_exit            TEXT CHECK (on_scope_exit IS NULL OR on_scope_exit IN ('archive', 'keep')),
    is_private               BOOLEAN NOT NULL DEFAULT 0,
    beads_id                 TEXT,
    archival                 TEXT NOT NULL DEFAULT 'live' CHECK (archival IN ('live', 'backlog'))
);
INSERT INTO tasks_new
    (id, title, parent_type, parent_id, status, delegate_to, position,
     time_scope_start_id, time_scope_end_id, time_scope_duration_n, time_scope_duration_kind,
     plan_start_id, plan_end_id, on_scope_exit, is_private, beads_id, archival)
SELECT
     id, title, parent_type, parent_id, status, delegate_to, position,
     time_scope_start_id, time_scope_end_id, time_scope_duration_n, time_scope_duration_kind,
     plan_start_id, plan_end_id, on_scope_exit, is_private, beads_id, archival
FROM tasks;
DROP TABLE tasks;
ALTER TABLE tasks_new RENAME TO tasks;

CREATE TABLE task_dependencies (
    task_id         INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    dependency_type TEXT NOT NULL CHECK (dependency_type IN ('task', 'goal')),
    dependency_id   INTEGER NOT NULL,
    PRIMARY KEY (task_id, dependency_type, dependency_id)
);
INSERT INTO task_dependencies (task_id, dependency_type, dependency_id)
    SELECT task_id, dependency_type, dependency_id FROM carry_task_dependencies;

CREATE TABLE tags_on_tasks (
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    tag_id  INTEGER NOT NULL REFERENCES domains(id),
    PRIMARY KEY (task_id, tag_id)
);
INSERT INTO tags_on_tasks (task_id, tag_id)
    SELECT task_id, tag_id FROM carry_tags_on_tasks;

CREATE TABLE task_knowledge_base_links (
    task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('person', 'event', 'thread', 'scope')),
    entity_id   INTEGER NOT NULL,
    PRIMARY KEY (task_id, entity_type, entity_id)
);
INSERT INTO task_knowledge_base_links (task_id, entity_type, entity_id)
    SELECT task_id, entity_type, entity_id FROM carry_task_knowledge_base_links;

DROP TABLE carry_task_dependencies;
DROP TABLE carry_tags_on_tasks;
DROP TABLE carry_task_knowledge_base_links;

-- --- flows ------------------------------------------------------------------

CREATE TABLE carry_flow_goals AS SELECT * FROM flow_goals;
CREATE TABLE carry_flow_tasks AS SELECT * FROM flow_tasks;
CREATE TABLE carry_flow_item_cycles AS SELECT * FROM flow_item_cycles;
CREATE TABLE carry_flow_dependencies AS SELECT * FROM flow_dependencies;
CREATE TABLE carry_flow_recurrences AS SELECT * FROM flow_recurrences;
CREATE TABLE carry_habit_instance_dependencies AS SELECT * FROM habit_instance_dependencies;
CREATE TABLE carry_habit_instance_modifications AS SELECT * FROM habit_instance_modifications;
CREATE TABLE carry_flow_instances AS SELECT * FROM flow_instances;
CREATE TABLE carry_flow_instance_nodes AS SELECT * FROM flow_instance_nodes;

DROP TABLE flow_instance_nodes;
DROP TABLE flow_instances;
DROP TABLE habit_instance_modifications;
DROP TABLE habit_instance_dependencies;
DROP TABLE flow_recurrences;
DROP TABLE flow_dependencies;
DROP TABLE flow_item_cycles;
DROP TABLE flow_tasks;
DROP TABLE flow_goals;

CREATE TABLE flows_new (
    id                     INTEGER PRIMARY KEY,
    title                  TEXT NOT NULL,
    instance_type          TEXT NOT NULL CHECK (instance_type IN ('goal', 'task', 'commitment')),
    parent_type            TEXT NOT NULL CHECK (parent_type IN ('aspect', 'project', 'domain', 'goal')),
    parent_id              INTEGER NOT NULL,
    target_type            TEXT,
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
);
INSERT INTO flows_new
    (id, title, instance_type, parent_type, parent_id, target_type, target_id,
     flow_duration_n, flow_duration_kind, position, flow_window_part,
     flow_window_time_start, flow_window_time_end,
     root_plan_kind, root_plan_start, root_plan_end, is_private)
SELECT
     id, title, instance_type, parent_type, parent_id, target_type, target_id,
     flow_duration_n, flow_duration_kind, position, flow_window_part,
     flow_window_time_start, flow_window_time_end,
     root_plan_kind, root_plan_start, root_plan_end, is_private
FROM flows;
DROP TABLE flows;
ALTER TABLE flows_new RENAME TO flows;

CREATE TABLE flow_goals (
    id          INTEGER PRIMARY KEY,
    flow_id     INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    parent_type TEXT NOT NULL CHECK (parent_type IN ('flow', 'flow_goal')),
    parent_id   INTEGER NOT NULL,
    position    INTEGER NOT NULL DEFAULT 0,
    is_private  BOOLEAN NOT NULL DEFAULT 0
);
INSERT INTO flow_goals (id, flow_id, title, parent_type, parent_id, position, is_private)
    SELECT id, flow_id, title, parent_type, parent_id, position, is_private FROM carry_flow_goals;

CREATE TABLE flow_tasks (
    id          INTEGER PRIMARY KEY,
    flow_id     INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    parent_type TEXT NOT NULL CHECK (parent_type IN ('flow', 'flow_goal', 'flow_task')),
    parent_id   INTEGER NOT NULL,
    position    INTEGER NOT NULL DEFAULT 0,
    is_private  BOOLEAN NOT NULL DEFAULT 0
);
INSERT INTO flow_tasks (id, flow_id, title, parent_type, parent_id, position, is_private)
    SELECT id, flow_id, title, parent_type, parent_id, position, is_private FROM carry_flow_tasks;

CREATE TABLE flow_item_cycles (
    id          INTEGER PRIMARY KEY,
    flow_id     INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    item_type   TEXT NOT NULL CHECK (item_type IN ('flow_goal', 'flow_task')),
    item_id     INTEGER NOT NULL,
    scope_kind  TEXT,
    scope_index INTEGER,
    plan_kind   TEXT,
    plan_start  INTEGER,
    plan_end    INTEGER,
    position    INTEGER NOT NULL DEFAULT 0
);
INSERT INTO flow_item_cycles
    (id, flow_id, item_type, item_id, scope_kind, scope_index, plan_kind, plan_start, plan_end, position)
    SELECT id, flow_id, item_type, item_id, scope_kind, scope_index, plan_kind, plan_start, plan_end, position
    FROM carry_flow_item_cycles;
CREATE INDEX idx_flow_item_cycles_item ON flow_item_cycles (item_type, item_id);

CREATE TABLE flow_dependencies (
    id              INTEGER PRIMARY KEY,
    flow_id         INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    dependent_type  TEXT NOT NULL CHECK (dependent_type IN ('flow_goal', 'flow_task')),
    dependent_id    INTEGER NOT NULL,
    depends_on_type TEXT NOT NULL CHECK (depends_on_type IN ('flow_goal', 'flow_task')),
    depends_on_id   INTEGER NOT NULL,
    UNIQUE (dependent_type, dependent_id, depends_on_type, depends_on_id)
);
INSERT INTO flow_dependencies
    (id, flow_id, dependent_type, dependent_id, depends_on_type, depends_on_id)
    SELECT id, flow_id, dependent_type, dependent_id, depends_on_type, depends_on_id
    FROM carry_flow_dependencies;

CREATE TABLE flow_recurrences (
    flow_id          INTEGER PRIMARY KEY REFERENCES flows(id) ON DELETE CASCADE,
    start_scope_id   INTEGER NOT NULL REFERENCES scopes(id),
    gap_n            INTEGER,
    gap_kind         TEXT CHECK (gap_kind IN ('day', 'week', 'month', 'season')),
    end_scope_id     INTEGER REFERENCES scopes(id),
    consumption_kind TEXT NOT NULL CHECK (consumption_kind IN ('destructive', 'accumulating')),
    blocking_mode    TEXT CHECK (blocking_mode IN ('overlapping', 'blocking')),
    catchup_policy   TEXT CHECK (catchup_policy IN ('all_pending', 'next', 'latest')),
    CHECK ((gap_n IS NULL) = (gap_kind IS NULL)),
    CHECK ((consumption_kind = 'accumulating') = (blocking_mode IS NOT NULL)),
    CHECK (catchup_policy IS NULL OR blocking_mode = 'blocking'),
    CHECK (blocking_mode IS NOT 'blocking' OR catchup_policy IS NOT NULL)
);
INSERT INTO flow_recurrences
    (flow_id, start_scope_id, gap_n, gap_kind, end_scope_id, consumption_kind, blocking_mode, catchup_policy)
    SELECT flow_id, start_scope_id, gap_n, gap_kind, end_scope_id, consumption_kind, blocking_mode, catchup_policy
    FROM carry_flow_recurrences;

CREATE TABLE habit_instance_dependencies (
    id                 INTEGER PRIMARY KEY,
    flow_id            INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    iteration_scope_id INTEGER NOT NULL REFERENCES scopes(id),
    dependent_type     TEXT NOT NULL CHECK (dependent_type IN ('flow_goal', 'flow_task')),
    dependent_id       INTEGER NOT NULL,
    depends_on_type    TEXT NOT NULL CHECK (depends_on_type IN ('flow_goal', 'flow_task')),
    depends_on_id      INTEGER NOT NULL,
    added              INTEGER NOT NULL CHECK (added IN (0, 1)),
    UNIQUE (iteration_scope_id, dependent_type, dependent_id, depends_on_type, depends_on_id)
);
INSERT INTO habit_instance_dependencies
    (id, flow_id, iteration_scope_id, dependent_type, dependent_id, depends_on_type, depends_on_id, added)
    SELECT id, flow_id, iteration_scope_id, dependent_type, dependent_id, depends_on_type, depends_on_id, added
    FROM carry_habit_instance_dependencies;
CREATE INDEX idx_habit_deps_flow ON habit_instance_dependencies (flow_id, iteration_scope_id);

CREATE TABLE habit_instance_modifications (
    id                 INTEGER PRIMARY KEY,
    flow_id            INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    item_type          TEXT NOT NULL CHECK (item_type IN ('flow_goal', 'flow_task', 'flow_root')),
    item_id            INTEGER NOT NULL,
    iteration_scope_id INTEGER NOT NULL REFERENCES scopes(id),
    -- Free text, and deliberately so: it already held a task status or a goal status, and now
    -- holds a commitment's `kept`/`broken` verdict for one iteration as well.
    status             TEXT,
    title              TEXT,
    blocked_reason     TEXT,
    tombstone_kind     TEXT CHECK (tombstone_kind IN ('deleted', 'archived', 'missed')),
    resolved_at        INTEGER,
    UNIQUE (item_type, item_id, iteration_scope_id)
);
INSERT INTO habit_instance_modifications
    (id, flow_id, item_type, item_id, iteration_scope_id, status, title, blocked_reason, tombstone_kind, resolved_at)
    SELECT id, flow_id, item_type, item_id, iteration_scope_id, status, title, blocked_reason, tombstone_kind, resolved_at
    FROM carry_habit_instance_modifications;
CREATE INDEX idx_habit_mods_item ON habit_instance_modifications (item_type, item_id);

CREATE TABLE flow_instances (
    id         INTEGER PRIMARY KEY,
    flow_id    INTEGER REFERENCES flows(id) ON DELETE SET NULL,
    root_type  TEXT NOT NULL CHECK (root_type IN ('goal', 'task', 'commitment')),
    root_id    INTEGER NOT NULL,
    started_at INTEGER NOT NULL
);
INSERT INTO flow_instances (id, flow_id, root_type, root_id, started_at)
    SELECT id, flow_id, root_type, root_id, started_at FROM carry_flow_instances;

CREATE TABLE flow_instance_nodes (
    id                   INTEGER PRIMARY KEY,
    flow_instance_id     INTEGER NOT NULL REFERENCES flow_instances(id) ON DELETE CASCADE,
    node_type            TEXT NOT NULL CHECK (node_type IN ('goal', 'task', 'commitment')),
    node_id              INTEGER NOT NULL,
    source_item_type     TEXT NOT NULL CHECK (source_item_type IN ('flow', 'flow_goal', 'flow_task')),
    source_item_id       INTEGER NOT NULL,
    original_parent_type TEXT NOT NULL,
    original_parent_id   INTEGER NOT NULL
);
INSERT INTO flow_instance_nodes
    (id, flow_instance_id, node_type, node_id, source_item_type, source_item_id, original_parent_type, original_parent_id)
    SELECT id, flow_instance_id, node_type, node_id, source_item_type, source_item_id, original_parent_type, original_parent_id
    FROM carry_flow_instance_nodes;
CREATE INDEX idx_flow_instance_nodes_instance ON flow_instance_nodes (flow_instance_id);
CREATE INDEX idx_flow_instance_nodes_node ON flow_instance_nodes (node_type, node_id);

DROP TABLE carry_flow_goals;
DROP TABLE carry_flow_tasks;
DROP TABLE carry_flow_item_cycles;
DROP TABLE carry_flow_dependencies;
DROP TABLE carry_flow_recurrences;
DROP TABLE carry_habit_instance_dependencies;
DROP TABLE carry_habit_instance_modifications;
DROP TABLE carry_flow_instances;
DROP TABLE carry_flow_instance_nodes;
