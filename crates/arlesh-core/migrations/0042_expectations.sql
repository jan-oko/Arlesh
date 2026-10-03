-- Expectations: waits that tasks depend on.
--
-- An Expectation is something outside your own action that you are waiting on to be released —
-- a training run finishing, someone replying. It is not an action item: nothing about it is
-- *done*, it is released. Tasks can depend on one, and a Pending one blocks them the way an
-- unfinished dependency does. See docs/spec/resources.md, "Expectations".
--
-- The number is reserved: 0035–0037 belong to other branches and 0041 is held, so this takes 0042.
--
-- Columns, and the ones deliberately absent:
--
--   * `status` — pending | released. Released is what unblocks the Tasks depending on it.
--   * `archival` — live | archived: the usual archive, orthogonal to the status, so a pending
--     wait can be put away without pretending it was released.
--   * `check_by_*` — the optional **check-by**, in the same four flat columns a Time Scope takes
--     (boundaries plus the Duration it was set in). There is no default: an Expectation you have
--     no plan to look in on simply has none. While it is set and the Expectation is pending, a
--     *virtual* "check on it" Task is derived under it at read time; nothing about that task is
--     stored here or anywhere.
--   * **No `time_scope` and no `plan`.** A wait has no relevance window of its own and cannot be
--     scheduled — you do not do it. The check-by is the only date it carries.
--   * **No tags, no beads id, no block reasons, no dependencies of its own.** An Expectation
--     depends on nothing; only Tasks depend on it.
--
-- `parent_type` takes the four spellings a Task's parent link takes: every domains-table parent
-- is written `project`, as for tasks and commitments.

CREATE TABLE expectations (
    id                     INTEGER PRIMARY KEY,
    title                  TEXT NOT NULL,
    parent_type            TEXT NOT NULL
                               CHECK (parent_type IN ('project', 'goal', 'domain', 'task', 'commitment')),
    parent_id              INTEGER NOT NULL,
    status                 TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'released')),
    archival               TEXT NOT NULL DEFAULT 'live' CHECK (archival IN ('live', 'archived')),
    check_by_start_id      INTEGER REFERENCES scopes(id),
    check_by_end_id        INTEGER REFERENCES scopes(id),
    check_by_duration_n    INTEGER,
    check_by_duration_kind TEXT,
    position               INTEGER NOT NULL DEFAULT 0,
    is_private             BOOLEAN NOT NULL DEFAULT 0,
    -- A check-by is a whole window or nothing: one boundary alone says neither when nor until.
    CHECK ((check_by_start_id IS NULL) = (check_by_end_id IS NULL)),
    CHECK ((check_by_duration_n IS NULL) = (check_by_duration_kind IS NULL))
);

CREATE INDEX idx_expectations_parent ON expectations (parent_type, parent_id);

-- ===========================================================================
-- Widening two CHECK constraints
-- ===========================================================================
--
-- `task_dependencies.dependency_type` has to accept `expectation`, and `infos.parent_type` has to
-- accept it too — an Expectation's only stored children are Info notes.
--
-- SQLite cannot alter a CHECK, so both tables are rebuilt: copied into a new table carrying the
-- widened constraint, the old one dropped, the new one renamed into its place. Neither table is
-- referenced by any foreign key — `task_dependencies` only *holds* one (onto `tasks`), and an
-- info's parent link is polymorphic — so `DROP TABLE` fires no cascade and there are no dependent
-- tables to copy aside. (Had there been, `PRAGMA legacy_alter_table` would not have helped: it
-- has no effect while foreign keys are on, which they are on every connection; see 0027.)
--
-- The columns keep their current order, so every row image the undo journal already holds still
-- reads. Dropping a table drops its three undo-journal triggers with it, so they are recreated
-- below, straight from scripts/generate-undo-triggers.sh.

-- --- task_dependencies -------------------------------------------------------

CREATE TABLE task_dependencies_new (
    task_id         INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    dependency_type TEXT NOT NULL CHECK (dependency_type IN ('task', 'goal', 'expectation')),
    dependency_id   INTEGER NOT NULL,
    PRIMARY KEY (task_id, dependency_type, dependency_id)
);
INSERT INTO task_dependencies_new (task_id, dependency_type, dependency_id)
    SELECT task_id, dependency_type, dependency_id FROM task_dependencies;
DROP TABLE task_dependencies;
ALTER TABLE task_dependencies_new RENAME TO task_dependencies;

-- --- infos ---------------------------------------------------------------------

CREATE TABLE infos_new (
    id          INTEGER PRIMARY KEY,
    body        TEXT NOT NULL,
    parent_type TEXT NOT NULL
                    CHECK (parent_type IN ('aspect', 'project', 'domain', 'goal', 'task', 'commitment', 'expectation', 'tag', 'info')),
    parent_id   INTEGER NOT NULL,
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    details     TEXT,
    is_private  BOOLEAN NOT NULL DEFAULT 0
);
INSERT INTO infos_new (id, body, parent_type, parent_id, position, created_at, updated_at, details, is_private)
SELECT id, body, parent_type, parent_id, position, created_at, updated_at, details, is_private
FROM infos;
DROP TABLE infos;
ALTER TABLE infos_new RENAME TO infos;

-- ===========================================================================
-- Undo-journal triggers
-- ===========================================================================
--
-- Three for the new table, and the three each rebuilt table lost with its DROP. Output taken
-- straight from scripts/generate-undo-triggers.sh; each is dropped before it is created, as in
-- 0030, so the migration stays re-runnable.
DROP TRIGGER IF EXISTS undo_journal_expectations_insert;
CREATE TRIGGER undo_journal_expectations_insert AFTER INSERT ON expectations BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'expectations', new.rowid, 'insert', NULL, json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'status', new.status, 'archival', new.archival, 'check_by_start_id', new.check_by_start_id, 'check_by_end_id', new.check_by_end_id, 'check_by_duration_n', new.check_by_duration_n, 'check_by_duration_kind', new.check_by_duration_kind, 'position', new.position, 'is_private', new.is_private), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_expectations_update;
CREATE TRIGGER undo_journal_expectations_update AFTER UPDATE ON expectations BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'expectations', new.rowid, 'update', json_object('id', old.id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'status', old.status, 'archival', old.archival, 'check_by_start_id', old.check_by_start_id, 'check_by_end_id', old.check_by_end_id, 'check_by_duration_n', old.check_by_duration_n, 'check_by_duration_kind', old.check_by_duration_kind, 'position', old.position, 'is_private', old.is_private), json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'status', new.status, 'archival', new.archival, 'check_by_start_id', new.check_by_start_id, 'check_by_end_id', new.check_by_end_id, 'check_by_duration_n', new.check_by_duration_n, 'check_by_duration_kind', new.check_by_duration_kind, 'position', new.position, 'is_private', new.is_private), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_expectations_delete;
CREATE TRIGGER undo_journal_expectations_delete AFTER DELETE ON expectations BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'expectations', old.rowid, 'delete', json_object('id', old.id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'status', old.status, 'archival', old.archival, 'check_by_start_id', old.check_by_start_id, 'check_by_end_id', old.check_by_end_id, 'check_by_duration_n', old.check_by_duration_n, 'check_by_duration_kind', old.check_by_duration_kind, 'position', old.position, 'is_private', old.is_private), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_task_dependencies_insert;
CREATE TRIGGER undo_journal_task_dependencies_insert AFTER INSERT ON task_dependencies BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'task_dependencies', new.rowid, 'insert', NULL, json_object('task_id', new.task_id, 'dependency_type', new.dependency_type, 'dependency_id', new.dependency_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_task_dependencies_update;
CREATE TRIGGER undo_journal_task_dependencies_update AFTER UPDATE ON task_dependencies BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'task_dependencies', new.rowid, 'update', json_object('task_id', old.task_id, 'dependency_type', old.dependency_type, 'dependency_id', old.dependency_id), json_object('task_id', new.task_id, 'dependency_type', new.dependency_type, 'dependency_id', new.dependency_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_task_dependencies_delete;
CREATE TRIGGER undo_journal_task_dependencies_delete AFTER DELETE ON task_dependencies BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'task_dependencies', old.rowid, 'delete', json_object('task_id', old.task_id, 'dependency_type', old.dependency_type, 'dependency_id', old.dependency_id), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_infos_insert;
CREATE TRIGGER undo_journal_infos_insert AFTER INSERT ON infos BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'infos', new.rowid, 'insert', NULL, json_object('id', new.id, 'body', new.body, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'created_at', new.created_at, 'updated_at', new.updated_at, 'details', new.details, 'is_private', new.is_private), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_infos_update;
CREATE TRIGGER undo_journal_infos_update AFTER UPDATE ON infos BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'infos', new.rowid, 'update', json_object('id', old.id, 'body', old.body, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'position', old.position, 'created_at', old.created_at, 'updated_at', old.updated_at, 'details', old.details, 'is_private', old.is_private), json_object('id', new.id, 'body', new.body, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'created_at', new.created_at, 'updated_at', new.updated_at, 'details', new.details, 'is_private', new.is_private), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_infos_delete;
CREATE TRIGGER undo_journal_infos_delete AFTER DELETE ON infos BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'infos', old.rowid, 'delete', json_object('id', old.id, 'body', old.body, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'position', old.position, 'created_at', old.created_at, 'updated_at', old.updated_at, 'details', old.details, 'is_private', old.is_private), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;
