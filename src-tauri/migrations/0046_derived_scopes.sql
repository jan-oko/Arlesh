-- Scopes are derived, not stored (ADR 0009, Arlesh-9o1).
--
-- A canonical scope — Season, Month, Week, Day, Part of Day — is a pure function of its kind and
-- start date (and band), so the `scopes` table, filled in as a side effect of reading, goes. Every
-- column that referenced `scopes(id)` now holds the scope's **value key**, a canonical string:
--
--   season:2026-09-01   month:2026-09-01   week:2026-09-20   day:2026-09-23
--   part_of_day:2026-09-23:morning        exact:2026-09-23T14:00:00/2026-09-23T15:30:00
--
-- Column names keep their `_id`: a scope's id *is* its key. The containment columns on `scopes`
-- (`week_id`, `month_id`, `season_id`, `day_id`) were read by nothing and go with the table.
--
-- Exact windows are real data rather than calendar, so they stay rows, in `exact_scopes`, keyed by
-- the same value key. Every column that can hold a scope key gets a VIRTUAL generated companion,
-- `<column>_exact`, which is the key when it is an exact one and NULL otherwise, with a foreign key
-- into `exact_scopes`: an exact key must be registered before it is stored, exactly as an exact
-- scope row had to exist before. A canonical key needs no row.
--
-- The seventeen referencing columns, and the tables they sit in:
--
--   tasks.time_scope_start_id, time_scope_end_id, plan_start_id, plan_end_id
--   goals.time_scope_start_id, time_scope_end_id
--   commitments.time_scope_start_id, time_scope_end_id
--   expectations.time_scope_start_id, time_scope_end_id
--   events.scope_id
--   flow_recurrences.start_scope_id, end_scope_id
--   habit_instance_modifications.iteration_scope_id
--   habit_instance_dependencies.iteration_scope_id
--   habit_instance_children.iteration_scope_id, window_end_scope_id
--
-- Every one is rewritten through `scope_keys`, a map from each old scope id to its key built from
-- the row's own start_date / part / datetimes, which are exactly what the key spells.
--
-- SQLite rebuilds a table to change a column's type or drop a foreign key, with 0037's hazard and
-- 0037's answer: `tasks`, `goals`, `commitments` and `expectations` are referenced ON DELETE
-- CASCADE by their tag, link, dependency and wait tables (and `task_async_templates` by its tags),
-- so dropping them would take those rows too. `PRAGMA defer_foreign_keys` defers violations, not
-- cascades, and `PRAGMA legacy_alter_table` does nothing while foreign keys are on. So every such
-- dependent is copied to a constraint-free scratch table, dropped, and rebuilt afterwards from its
-- own unchanged definition.
--
-- Dropping a table drops its triggers; 0047 regenerates the undo-journal triggers of every table
-- rebuilt here. The journal itself is emptied: its images name the old integer ids, and it is
-- session-scoped anyway (`undo::reset_journal` empties it at every start).


-- 1. Exact windows keep their rows, keyed by value.

CREATE TABLE exact_scopes (
    id             TEXT PRIMARY KEY,
    start_datetime TEXT NOT NULL,
    end_datetime   TEXT NOT NULL,
    CHECK (start_datetime < end_datetime),
    CHECK (id = 'exact:' || start_datetime || '/' || end_datetime)
);

-- 2. Every old scope id, mapped to its value key. A canonical row's start_date is already its
--    scope's own start (the Sunday of a week, the 1st of a month or season), which is what the key
--    spells; a part keys on its day and band; an exact window on its two datetimes.

CREATE TABLE scope_keys (id INTEGER PRIMARY KEY, key TEXT NOT NULL);
INSERT INTO scope_keys (id, key)
SELECT id,
       CASE kind
           WHEN 'part_of_day' THEN 'part_of_day:' || start_date || ':' || part
           WHEN 'exact'       THEN 'exact:' || start_datetime || '/' || end_datetime
           ELSE kind || ':' || start_date
       END
  FROM scopes;

INSERT INTO exact_scopes (id, start_datetime, end_datetime)
SELECT 'exact:' || start_datetime || '/' || end_datetime, start_datetime, end_datetime
  FROM scopes WHERE kind = 'exact';

-- 3. Carry every ON DELETE CASCADE dependent aside, so dropping its parent takes nothing with it.

CREATE TABLE carry_tags_on_tasks AS SELECT * FROM tags_on_tasks;
CREATE TABLE carry_task_knowledge_base_links AS SELECT * FROM task_knowledge_base_links;
CREATE TABLE carry_task_dependencies AS SELECT * FROM task_dependencies;
CREATE TABLE carry_task_async_templates AS SELECT * FROM task_async_templates;
CREATE TABLE carry_tags_on_async_templates AS SELECT * FROM tags_on_async_templates;
CREATE TABLE carry_spawned_waits AS SELECT * FROM spawned_waits;
CREATE TABLE carry_tags_on_goals AS SELECT * FROM tags_on_goals;
CREATE TABLE carry_goal_knowledge_base_links AS SELECT * FROM goal_knowledge_base_links;
CREATE TABLE carry_tags_on_commitments AS SELECT * FROM tags_on_commitments;
CREATE TABLE carry_tags_on_expectations AS SELECT * FROM tags_on_expectations;

DROP TABLE tags_on_expectations;
DROP TABLE tags_on_commitments;
DROP TABLE goal_knowledge_base_links;
DROP TABLE tags_on_goals;
DROP TABLE spawned_waits;
DROP TABLE tags_on_async_templates;
DROP TABLE task_async_templates;
DROP TABLE task_dependencies;
DROP TABLE task_knowledge_base_links;
DROP TABLE tags_on_tasks;

-- 4. Rebuild each referencing table with TEXT keys, rewriting every reference.

CREATE TABLE tasks_new (
    id                       INTEGER PRIMARY KEY,
    title                    TEXT NOT NULL,
    parent_type              TEXT NOT NULL
                                 CHECK (parent_type IN ('project', 'goal', 'domain', 'task', 'commitment')),
    parent_id                INTEGER NOT NULL,
    status                   TEXT NOT NULL DEFAULT 'todo'
                                 CHECK (status IN ('todo', 'in_progress', 'done')),
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
    time_scope_start_id_exact TEXT GENERATED ALWAYS AS (CASE WHEN time_scope_start_id LIKE 'exact:%' THEN time_scope_start_id END) VIRTUAL REFERENCES exact_scopes(id),
    time_scope_end_id_exact TEXT GENERATED ALWAYS AS (CASE WHEN time_scope_end_id LIKE 'exact:%' THEN time_scope_end_id END) VIRTUAL REFERENCES exact_scopes(id),
    plan_start_id_exact TEXT GENERATED ALWAYS AS (CASE WHEN plan_start_id LIKE 'exact:%' THEN plan_start_id END) VIRTUAL REFERENCES exact_scopes(id),
    plan_end_id_exact TEXT GENERATED ALWAYS AS (CASE WHEN plan_end_id LIKE 'exact:%' THEN plan_end_id END) VIRTUAL REFERENCES exact_scopes(id),
    CHECK (
        (delegate_kind IS NULL     AND delegate_id IS NULL)
     OR (delegate_kind = 'person'  AND delegate_id IS NOT NULL)
     OR (delegate_kind = 'agent'   AND delegate_id IS NULL)
    )
);
INSERT INTO tasks_new (id, title, parent_type, parent_id, status, delegate_kind, delegate_id, position, time_scope_start_id, time_scope_end_id, time_scope_duration_n, time_scope_duration_kind, plan_start_id, plan_end_id, on_scope_exit, is_private, beads_id, archival, agentic, asynchronous, done_at)
SELECT t.id,
       t.title,
       t.parent_type,
       t.parent_id,
       t.status,
       t.delegate_kind,
       t.delegate_id,
       t.position,
       (SELECT key FROM scope_keys WHERE id = t.time_scope_start_id),
       (SELECT key FROM scope_keys WHERE id = t.time_scope_end_id),
       t.time_scope_duration_n,
       t.time_scope_duration_kind,
       (SELECT key FROM scope_keys WHERE id = t.plan_start_id),
       (SELECT key FROM scope_keys WHERE id = t.plan_end_id),
       t.on_scope_exit,
       t.is_private,
       t.beads_id,
       t.archival,
       t.agentic,
       t.asynchronous,
       t.done_at
  FROM tasks t;
DROP TABLE tasks;
ALTER TABLE tasks_new RENAME TO tasks;

CREATE TABLE goals_new (
    id                       INTEGER PRIMARY KEY,
    title                    TEXT NOT NULL,
    parent_type              TEXT NOT NULL CHECK (parent_type IN ('project', 'goal', 'domain')),
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
    beads_id                 TEXT,
    time_scope_start_id_exact TEXT GENERATED ALWAYS AS (CASE WHEN time_scope_start_id LIKE 'exact:%' THEN time_scope_start_id END) VIRTUAL REFERENCES exact_scopes(id),
    time_scope_end_id_exact TEXT GENERATED ALWAYS AS (CASE WHEN time_scope_end_id LIKE 'exact:%' THEN time_scope_end_id END) VIRTUAL REFERENCES exact_scopes(id)
);
INSERT INTO goals_new (id, title, parent_type, parent_id, status, position, time_scope_start_id, time_scope_end_id, time_scope_duration_n, time_scope_duration_kind, on_scope_exit, is_private, beads_id)
SELECT t.id,
       t.title,
       t.parent_type,
       t.parent_id,
       t.status,
       t.position,
       (SELECT key FROM scope_keys WHERE id = t.time_scope_start_id),
       (SELECT key FROM scope_keys WHERE id = t.time_scope_end_id),
       t.time_scope_duration_n,
       t.time_scope_duration_kind,
       t.on_scope_exit,
       t.is_private,
       t.beads_id
  FROM goals t;
DROP TABLE goals;
ALTER TABLE goals_new RENAME TO goals;

CREATE TABLE commitments_new (
    id                       INTEGER PRIMARY KEY,
    title                    TEXT NOT NULL,
    parent_type              TEXT NOT NULL
                                 CHECK (parent_type IN ('project', 'goal', 'domain', 'task', 'commitment')),
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
    beads_id                 TEXT,
    time_scope_start_id_exact TEXT GENERATED ALWAYS AS (CASE WHEN time_scope_start_id LIKE 'exact:%' THEN time_scope_start_id END) VIRTUAL REFERENCES exact_scopes(id),
    time_scope_end_id_exact TEXT GENERATED ALWAYS AS (CASE WHEN time_scope_end_id LIKE 'exact:%' THEN time_scope_end_id END) VIRTUAL REFERENCES exact_scopes(id),
    CHECK ((verdict_window_n IS NULL) = (verdict_window_kind IS NULL))
);
INSERT INTO commitments_new (id, title, parent_type, parent_id, verdict, time_scope_start_id, time_scope_end_id, time_scope_duration_n, time_scope_duration_kind, verdict_window_n, verdict_window_kind, position, is_private, beads_id)
SELECT t.id,
       t.title,
       t.parent_type,
       t.parent_id,
       t.verdict,
       (SELECT key FROM scope_keys WHERE id = t.time_scope_start_id),
       (SELECT key FROM scope_keys WHERE id = t.time_scope_end_id),
       t.time_scope_duration_n,
       t.time_scope_duration_kind,
       t.verdict_window_n,
       t.verdict_window_kind,
       t.position,
       t.is_private,
       t.beads_id
  FROM commitments t;
DROP TABLE commitments;
ALTER TABLE commitments_new RENAME TO commitments;
CREATE INDEX idx_commitments_parent ON commitments (parent_type, parent_id);

CREATE TABLE expectations_new (
    id                       INTEGER PRIMARY KEY,
    title                    TEXT NOT NULL,
    parent_type              TEXT NOT NULL
                                 CHECK (parent_type IN ('project', 'goal', 'domain', 'task', 'commitment')),
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
    last_check_at            TEXT,
    time_scope_start_id_exact TEXT GENERATED ALWAYS AS (CASE WHEN time_scope_start_id LIKE 'exact:%' THEN time_scope_start_id END) VIRTUAL REFERENCES exact_scopes(id),
    time_scope_end_id_exact TEXT GENERATED ALWAYS AS (CASE WHEN time_scope_end_id LIKE 'exact:%' THEN time_scope_end_id END) VIRTUAL REFERENCES exact_scopes(id),
    CHECK ((check_every_n IS NULL) = (check_every_kind IS NULL))
);
INSERT INTO expectations_new (id, title, parent_type, parent_id, status, archival, position, is_private, time_scope_start_id, time_scope_end_id, time_scope_duration_n, time_scope_duration_kind, check_every_n, check_every_kind, check_starting, last_check_at)
SELECT t.id,
       t.title,
       t.parent_type,
       t.parent_id,
       t.status,
       t.archival,
       t.position,
       t.is_private,
       (SELECT key FROM scope_keys WHERE id = t.time_scope_start_id),
       (SELECT key FROM scope_keys WHERE id = t.time_scope_end_id),
       t.time_scope_duration_n,
       t.time_scope_duration_kind,
       t.check_every_n,
       t.check_every_kind,
       t.check_starting,
       t.last_check_at
  FROM expectations t;
DROP TABLE expectations;
ALTER TABLE expectations_new RENAME TO expectations;
CREATE INDEX idx_expectations_parent ON expectations (parent_type, parent_id);

CREATE TABLE events_new (
    id                       INTEGER PRIMARY KEY,
    title                    TEXT NOT NULL,
    scope_id                 TEXT,
    event_time               TEXT,
    linked_note              TEXT,
    scope_id_exact TEXT GENERATED ALWAYS AS (CASE WHEN scope_id LIKE 'exact:%' THEN scope_id END) VIRTUAL REFERENCES exact_scopes(id)
);
INSERT INTO events_new (id, title, scope_id, event_time, linked_note)
SELECT t.id,
       t.title,
       (SELECT key FROM scope_keys WHERE id = t.scope_id),
       t.event_time,
       t.linked_note
  FROM events t;
DROP TABLE events;
ALTER TABLE events_new RENAME TO events;

CREATE TABLE flow_recurrences_new (
    flow_id                  INTEGER PRIMARY KEY REFERENCES flows(id) ON DELETE CASCADE,
    start_scope_id           TEXT NOT NULL,
    gap_n                    INTEGER,
    gap_kind                 TEXT CHECK (gap_kind IN ('day', 'week', 'month', 'season')),
    end_scope_id             TEXT,
    consumption_kind         TEXT NOT NULL CHECK (consumption_kind IN ('destructive', 'accumulating')),
    blocking_mode            TEXT CHECK (blocking_mode IN ('overlapping', 'blocking')),
    catchup_policy           TEXT CHECK (catchup_policy IN ('all_pending', 'next', 'latest')),
    start_scope_id_exact TEXT GENERATED ALWAYS AS (CASE WHEN start_scope_id LIKE 'exact:%' THEN start_scope_id END) VIRTUAL REFERENCES exact_scopes(id),
    end_scope_id_exact TEXT GENERATED ALWAYS AS (CASE WHEN end_scope_id LIKE 'exact:%' THEN end_scope_id END) VIRTUAL REFERENCES exact_scopes(id),
    CHECK ((gap_n IS NULL) = (gap_kind IS NULL)),
    CHECK ((consumption_kind = 'accumulating') = (blocking_mode IS NOT NULL)),
    CHECK (catchup_policy IS NULL OR blocking_mode = 'blocking'),
    CHECK (blocking_mode IS NOT 'blocking' OR catchup_policy IS NOT NULL)
);
INSERT INTO flow_recurrences_new (flow_id, start_scope_id, gap_n, gap_kind, end_scope_id, consumption_kind, blocking_mode, catchup_policy)
SELECT t.flow_id,
       (SELECT key FROM scope_keys WHERE id = t.start_scope_id),
       t.gap_n,
       t.gap_kind,
       (SELECT key FROM scope_keys WHERE id = t.end_scope_id),
       t.consumption_kind,
       t.blocking_mode,
       t.catchup_policy
  FROM flow_recurrences t;
DROP TABLE flow_recurrences;
ALTER TABLE flow_recurrences_new RENAME TO flow_recurrences;

CREATE TABLE habit_instance_modifications_new (
    id                       INTEGER PRIMARY KEY,
    flow_id                  INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    item_type                TEXT NOT NULL CHECK (item_type IN ('flow_goal', 'flow_task', 'flow_root')),
    item_id                  INTEGER NOT NULL,
    iteration_scope_id       TEXT NOT NULL,
    cycle_id                 INTEGER NOT NULL DEFAULT 0,
    status                   TEXT,
    title                    TEXT,
    blocked_reason           TEXT,
    tombstone_kind           TEXT CHECK (tombstone_kind IN ('deleted', 'archived', 'missed')),
    resolved_at              INTEGER,
    iteration_scope_id_exact TEXT GENERATED ALWAYS AS (CASE WHEN iteration_scope_id LIKE 'exact:%' THEN iteration_scope_id END) VIRTUAL REFERENCES exact_scopes(id),
    UNIQUE (item_type, item_id, iteration_scope_id, cycle_id)
);
INSERT INTO habit_instance_modifications_new (id, flow_id, item_type, item_id, iteration_scope_id, cycle_id, status, title, blocked_reason, tombstone_kind, resolved_at)
SELECT t.id,
       t.flow_id,
       t.item_type,
       t.item_id,
       (SELECT key FROM scope_keys WHERE id = t.iteration_scope_id),
       t.cycle_id,
       t.status,
       t.title,
       t.blocked_reason,
       t.tombstone_kind,
       t.resolved_at
  FROM habit_instance_modifications t;
DROP TABLE habit_instance_modifications;
ALTER TABLE habit_instance_modifications_new RENAME TO habit_instance_modifications;
CREATE INDEX idx_habit_mods_item ON habit_instance_modifications (item_type, item_id);

CREATE TABLE habit_instance_dependencies_new (
    id                       INTEGER PRIMARY KEY,
    flow_id                  INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    iteration_scope_id       TEXT NOT NULL,
    dependent_type           TEXT NOT NULL CHECK (dependent_type IN ('flow_goal', 'flow_task')),
    dependent_id             INTEGER NOT NULL,
    depends_on_type          TEXT NOT NULL CHECK (depends_on_type IN ('flow_goal', 'flow_task')),
    depends_on_id            INTEGER NOT NULL,
    added                    INTEGER NOT NULL CHECK (added IN (0, 1)),
    iteration_scope_id_exact TEXT GENERATED ALWAYS AS (CASE WHEN iteration_scope_id LIKE 'exact:%' THEN iteration_scope_id END) VIRTUAL REFERENCES exact_scopes(id),
    UNIQUE (iteration_scope_id, dependent_type, dependent_id, depends_on_type, depends_on_id)
);
INSERT INTO habit_instance_dependencies_new (id, flow_id, iteration_scope_id, dependent_type, dependent_id, depends_on_type, depends_on_id, added)
SELECT t.id,
       t.flow_id,
       (SELECT key FROM scope_keys WHERE id = t.iteration_scope_id),
       t.dependent_type,
       t.dependent_id,
       t.depends_on_type,
       t.depends_on_id,
       t.added
  FROM habit_instance_dependencies t;
DROP TABLE habit_instance_dependencies;
ALTER TABLE habit_instance_dependencies_new RENAME TO habit_instance_dependencies;
CREATE INDEX idx_habit_deps_flow ON habit_instance_dependencies (flow_id, iteration_scope_id);

CREATE TABLE habit_instance_children_new (
    id                       INTEGER PRIMARY KEY,
    flow_id                  INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    item_type                TEXT NOT NULL CHECK (item_type IN ('flow_goal', 'flow_task', 'flow_root')),
    item_id                  INTEGER NOT NULL,
    iteration_scope_id       TEXT NOT NULL,
    cycle_id                 INTEGER NOT NULL DEFAULT 0,
    window_end_scope_id      TEXT NOT NULL,
    child_type               TEXT NOT NULL CHECK (child_type IN ('task', 'goal', 'commitment', 'info')),
    child_id                 INTEGER NOT NULL,
    iteration_scope_id_exact TEXT GENERATED ALWAYS AS (CASE WHEN iteration_scope_id LIKE 'exact:%' THEN iteration_scope_id END) VIRTUAL REFERENCES exact_scopes(id),
    window_end_scope_id_exact TEXT GENERATED ALWAYS AS (CASE WHEN window_end_scope_id LIKE 'exact:%' THEN window_end_scope_id END) VIRTUAL REFERENCES exact_scopes(id),
    UNIQUE (child_type, child_id)
);
INSERT INTO habit_instance_children_new (id, flow_id, item_type, item_id, iteration_scope_id, cycle_id, window_end_scope_id, child_type, child_id)
SELECT t.id,
       t.flow_id,
       t.item_type,
       t.item_id,
       (SELECT key FROM scope_keys WHERE id = t.iteration_scope_id),
       t.cycle_id,
       (SELECT key FROM scope_keys WHERE id = t.window_end_scope_id),
       t.child_type,
       t.child_id
  FROM habit_instance_children t;
DROP TABLE habit_instance_children;
ALTER TABLE habit_instance_children_new RENAME TO habit_instance_children;
CREATE INDEX idx_habit_children_instance
    ON habit_instance_children (item_type, item_id, iteration_scope_id, cycle_id);
CREATE INDEX idx_habit_children_flow ON habit_instance_children (flow_id);

-- 5. The dependents, from their own unchanged definitions.

CREATE TABLE tags_on_tasks (
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    tag_id  INTEGER NOT NULL REFERENCES domains(id),
    PRIMARY KEY (task_id, tag_id)
);
INSERT INTO tags_on_tasks SELECT * FROM carry_tags_on_tasks;
DROP TABLE carry_tags_on_tasks;

CREATE TABLE task_knowledge_base_links (
    task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('person', 'event', 'thread', 'scope')),
    entity_id   INTEGER NOT NULL,
    PRIMARY KEY (task_id, entity_type, entity_id)
);
INSERT INTO task_knowledge_base_links SELECT * FROM carry_task_knowledge_base_links;
DROP TABLE carry_task_knowledge_base_links;

CREATE TABLE task_dependencies (
    task_id         INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    dependency_type TEXT NOT NULL CHECK (dependency_type IN ('task', 'goal', 'expectation')),
    dependency_id   INTEGER NOT NULL,
    PRIMARY KEY (task_id, dependency_type, dependency_id)
);
INSERT INTO task_dependencies SELECT * FROM carry_task_dependencies;
DROP TABLE carry_task_dependencies;

CREATE TABLE task_async_templates (
    task_id          INTEGER PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
    title            TEXT NOT NULL,
    time_scope_n     INTEGER,
    time_scope_kind  TEXT,
    check_every_n    INTEGER,
    check_every_kind TEXT,
    CHECK ((time_scope_n IS NULL) = (time_scope_kind IS NULL)),
    CHECK ((check_every_n IS NULL) = (check_every_kind IS NULL))
);
INSERT INTO task_async_templates SELECT * FROM carry_task_async_templates;
DROP TABLE carry_task_async_templates;

CREATE TABLE tags_on_async_templates (
    task_id INTEGER NOT NULL REFERENCES task_async_templates(task_id) ON DELETE CASCADE,
    tag_id  INTEGER NOT NULL REFERENCES domains(id),
    PRIMARY KEY (task_id, tag_id)
);
INSERT INTO tags_on_async_templates SELECT * FROM carry_tags_on_async_templates;
DROP TABLE carry_tags_on_async_templates;

CREATE TABLE spawned_waits (
    task_id       INTEGER PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
    status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'released')),
    archival      TEXT NOT NULL DEFAULT 'live' CHECK (archival IN ('live', 'archived')),
    last_check_at TEXT
);
INSERT INTO spawned_waits SELECT * FROM carry_spawned_waits;
DROP TABLE carry_spawned_waits;

CREATE TABLE tags_on_goals (
    goal_id INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    tag_id  INTEGER NOT NULL REFERENCES domains(id),
    PRIMARY KEY (goal_id, tag_id)
);
INSERT INTO tags_on_goals SELECT * FROM carry_tags_on_goals;
DROP TABLE carry_tags_on_goals;

CREATE TABLE goal_knowledge_base_links (
    goal_id     INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('person', 'event', 'thread', 'scope')),
    entity_id   INTEGER NOT NULL,
    PRIMARY KEY (goal_id, entity_type, entity_id)
);
INSERT INTO goal_knowledge_base_links SELECT * FROM carry_goal_knowledge_base_links;
DROP TABLE carry_goal_knowledge_base_links;

CREATE TABLE tags_on_commitments (
    commitment_id INTEGER NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
    tag_id        INTEGER NOT NULL REFERENCES domains(id),
    PRIMARY KEY (commitment_id, tag_id)
);
INSERT INTO tags_on_commitments SELECT * FROM carry_tags_on_commitments;
DROP TABLE carry_tags_on_commitments;

CREATE TABLE tags_on_expectations (
    expectation_id INTEGER NOT NULL REFERENCES expectations(id) ON DELETE CASCADE,
    tag_id         INTEGER NOT NULL REFERENCES domains(id),
    PRIMARY KEY (expectation_id, tag_id)
);
INSERT INTO tags_on_expectations SELECT * FROM carry_tags_on_expectations;
DROP TABLE carry_tags_on_expectations;

-- 6. The calendar is derived from here on.

DROP TABLE scope_keys;
DROP TABLE scopes;

DELETE FROM undo_journal;
