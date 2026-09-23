-- Asynchronous becomes a template, and a wait's single check-by becomes a repeating check.
-- Ruled by the user on 2026-09-23; see docs/spec/resources.md, "Tasks" and "Expectations".
--
-- 1. A Task's **Asynchronous** is no longer a boolean. It is a nullable **Expectation template**:
--    no row here means not asynchronous, a row means asynchronous. The template carries only what
--    the wait needs up front — a title, tags, a Time Scope *rule* (a Duration counted from the day
--    the wait begins) and Check every — and no status, because a status only exists once a wait
--    does. Completing the Task spawns a **virtual** Expectation from it.
-- 2. `spawned_waits` is that virtual Expectation's **overlay**: keyed by the Task, written when
--    the Task is completed, deleted when it is un-completed. It holds only the state the wait
--    itself has since — its status, its archive, and when its last check was made. The node is
--    drawn from the template and this row; nothing else is stored. Arlesh-pnn's virtual node
--    tables (ADR 0008) will generalise it.
-- 3. An Expectation's **check-by** (one window) becomes **Check every** (a Duration) from a
--    **Starting** instant, with the time the last check was made. The next check falls due one
--    interval after that — anchored to the resolution, not to the schedule.
--
-- `tasks.asynchronous` is left in place but **retired**: nothing reads or writes it after this
-- migration. Dropping it means rebuilding `tasks`, which ten tables reference; it goes with the
-- next rebuild that has to happen anyway. Every Task it flagged gets a template first, titled
-- "Waiting on <the task's title>", and the column is then zeroed so nothing can mistake it for
-- current.
--
-- `expectations` is rebuilt to drop the check-by columns. `tags_on_expectations` references it
-- with ON DELETE CASCADE, so it is copied aside first — `PRAGMA legacy_alter_table` does nothing
-- while foreign keys are on — and rebuilt afterwards.

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

CREATE TABLE tags_on_async_templates (
    task_id INTEGER NOT NULL REFERENCES task_async_templates(task_id) ON DELETE CASCADE,
    tag_id  INTEGER NOT NULL REFERENCES domains(id),
    PRIMARY KEY (task_id, tag_id)
);

CREATE TABLE spawned_waits (
    task_id       INTEGER PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
    spawned_at    TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'released')),
    archival      TEXT NOT NULL DEFAULT 'live' CHECK (archival IN ('live', 'archived')),
    last_check_at TEXT
);

INSERT INTO task_async_templates (task_id, title)
    SELECT id, 'Waiting on ' || title FROM tasks WHERE asynchronous = 1;
UPDATE tasks SET asynchronous = 0 WHERE asynchronous = 1;

-- --- expectations: check-by → check every ------------------------------------

CREATE TABLE carry_tags_on_expectations AS SELECT * FROM tags_on_expectations;
DROP TABLE tags_on_expectations;

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
    time_scope_start_id      INTEGER REFERENCES scopes(id),
    time_scope_end_id        INTEGER REFERENCES scopes(id),
    time_scope_duration_n    INTEGER,
    time_scope_duration_kind TEXT,
    check_every_n            INTEGER,
    check_every_kind         TEXT,
    check_starting           TEXT,
    last_check_at            TEXT,
    CHECK ((check_every_n IS NULL) = (check_every_kind IS NULL))
);
-- A stored check-by has no interval to carry over, so it becomes none: the next check is set again.
INSERT INTO expectations_new
    (id, title, parent_type, parent_id, status, archival, position, is_private,
     time_scope_start_id, time_scope_end_id, time_scope_duration_n, time_scope_duration_kind)
SELECT id, title, parent_type, parent_id, status, archival, position, is_private,
       time_scope_start_id, time_scope_end_id, time_scope_duration_n, time_scope_duration_kind
FROM expectations;
DROP TABLE expectations;
ALTER TABLE expectations_new RENAME TO expectations;
CREATE INDEX idx_expectations_parent ON expectations (parent_type, parent_id);

CREATE TABLE tags_on_expectations (
    expectation_id INTEGER NOT NULL REFERENCES expectations(id) ON DELETE CASCADE,
    tag_id         INTEGER NOT NULL REFERENCES domains(id),
    PRIMARY KEY (expectation_id, tag_id)
);
INSERT INTO tags_on_expectations (expectation_id, tag_id)
    SELECT expectation_id, tag_id FROM carry_tags_on_expectations;
DROP TABLE carry_tags_on_expectations;

-- ===========================================================================
-- Undo-journal triggers, straight from scripts/generate-undo-triggers.sh
-- ===========================================================================
DROP TRIGGER IF EXISTS undo_journal_task_async_templates_insert;
CREATE TRIGGER undo_journal_task_async_templates_insert AFTER INSERT ON task_async_templates BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'task_async_templates', new.rowid, 'insert', NULL, json_object('task_id', new.task_id, 'title', new.title, 'time_scope_n', new.time_scope_n, 'time_scope_kind', new.time_scope_kind, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_task_async_templates_update;
CREATE TRIGGER undo_journal_task_async_templates_update AFTER UPDATE ON task_async_templates BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'task_async_templates', new.rowid, 'update', json_object('task_id', old.task_id, 'title', old.title, 'time_scope_n', old.time_scope_n, 'time_scope_kind', old.time_scope_kind, 'check_every_n', old.check_every_n, 'check_every_kind', old.check_every_kind), json_object('task_id', new.task_id, 'title', new.title, 'time_scope_n', new.time_scope_n, 'time_scope_kind', new.time_scope_kind, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_task_async_templates_delete;
CREATE TRIGGER undo_journal_task_async_templates_delete AFTER DELETE ON task_async_templates BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'task_async_templates', old.rowid, 'delete', json_object('task_id', old.task_id, 'title', old.title, 'time_scope_n', old.time_scope_n, 'time_scope_kind', old.time_scope_kind, 'check_every_n', old.check_every_n, 'check_every_kind', old.check_every_kind), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_tags_on_async_templates_insert;
CREATE TRIGGER undo_journal_tags_on_async_templates_insert AFTER INSERT ON tags_on_async_templates BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tags_on_async_templates', new.rowid, 'insert', NULL, json_object('task_id', new.task_id, 'tag_id', new.tag_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_tags_on_async_templates_update;
CREATE TRIGGER undo_journal_tags_on_async_templates_update AFTER UPDATE ON tags_on_async_templates BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tags_on_async_templates', new.rowid, 'update', json_object('task_id', old.task_id, 'tag_id', old.tag_id), json_object('task_id', new.task_id, 'tag_id', new.tag_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_tags_on_async_templates_delete;
CREATE TRIGGER undo_journal_tags_on_async_templates_delete AFTER DELETE ON tags_on_async_templates BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tags_on_async_templates', old.rowid, 'delete', json_object('task_id', old.task_id, 'tag_id', old.tag_id), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_spawned_waits_insert;
CREATE TRIGGER undo_journal_spawned_waits_insert AFTER INSERT ON spawned_waits BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'spawned_waits', new.rowid, 'insert', NULL, json_object('task_id', new.task_id, 'spawned_at', new.spawned_at, 'status', new.status, 'archival', new.archival, 'last_check_at', new.last_check_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_spawned_waits_update;
CREATE TRIGGER undo_journal_spawned_waits_update AFTER UPDATE ON spawned_waits BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'spawned_waits', new.rowid, 'update', json_object('task_id', old.task_id, 'spawned_at', old.spawned_at, 'status', old.status, 'archival', old.archival, 'last_check_at', old.last_check_at), json_object('task_id', new.task_id, 'spawned_at', new.spawned_at, 'status', new.status, 'archival', new.archival, 'last_check_at', new.last_check_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_spawned_waits_delete;
CREATE TRIGGER undo_journal_spawned_waits_delete AFTER DELETE ON spawned_waits BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'spawned_waits', old.rowid, 'delete', json_object('task_id', old.task_id, 'spawned_at', old.spawned_at, 'status', old.status, 'archival', old.archival, 'last_check_at', old.last_check_at), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_expectations_insert;
CREATE TRIGGER undo_journal_expectations_insert AFTER INSERT ON expectations BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'expectations', new.rowid, 'insert', NULL, json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'status', new.status, 'archival', new.archival, 'position', new.position, 'is_private', new.is_private, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind, 'check_starting', new.check_starting, 'last_check_at', new.last_check_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_expectations_update;
CREATE TRIGGER undo_journal_expectations_update AFTER UPDATE ON expectations BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'expectations', new.rowid, 'update', json_object('id', old.id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'status', old.status, 'archival', old.archival, 'position', old.position, 'is_private', old.is_private, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind, 'check_every_n', old.check_every_n, 'check_every_kind', old.check_every_kind, 'check_starting', old.check_starting, 'last_check_at', old.last_check_at), json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'status', new.status, 'archival', new.archival, 'position', new.position, 'is_private', new.is_private, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind, 'check_starting', new.check_starting, 'last_check_at', new.last_check_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_expectations_delete;
CREATE TRIGGER undo_journal_expectations_delete AFTER DELETE ON expectations BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'expectations', old.rowid, 'delete', json_object('id', old.id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'status', old.status, 'archival', old.archival, 'position', old.position, 'is_private', old.is_private, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind, 'check_every_n', old.check_every_n, 'check_every_kind', old.check_every_kind, 'check_starting', old.check_starting, 'last_check_at', old.last_check_at), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_tags_on_expectations_insert;
CREATE TRIGGER undo_journal_tags_on_expectations_insert AFTER INSERT ON tags_on_expectations BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tags_on_expectations', new.rowid, 'insert', NULL, json_object('expectation_id', new.expectation_id, 'tag_id', new.tag_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_tags_on_expectations_update;
CREATE TRIGGER undo_journal_tags_on_expectations_update AFTER UPDATE ON tags_on_expectations BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tags_on_expectations', new.rowid, 'update', json_object('expectation_id', old.expectation_id, 'tag_id', old.tag_id), json_object('expectation_id', new.expectation_id, 'tag_id', new.tag_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_tags_on_expectations_delete;
CREATE TRIGGER undo_journal_tags_on_expectations_delete AFTER DELETE ON tags_on_expectations BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tags_on_expectations', old.rowid, 'delete', json_object('expectation_id', old.expectation_id, 'tag_id', old.tag_id), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;
