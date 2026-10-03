-- An Asynchronous Task gains an optional Expectation template, and a wait's single check-by
-- becomes a repeating check. Ruled by the user on 2026-09-23; see docs/spec/resources.md, "Tasks"
-- and "Expectations".
--
-- 1. **Asynchronous stays a flag** (`tasks.asynchronous`, unchanged) and gains an optional
--    **Expectation template**, which exists only while the flag is on: a title, tags, a Time Scope
--    *rule* (a Duration counted from the day the wait begins) and Check every — no status, because
--    a status only exists once a wait does. A Task that is asynchronous with no template spawns
--    nothing; existing asynchronous Tasks arrive exactly like that, so no data moves.
-- 2. The spawned wait is **derived**: it exists while its Task is done and has a template, and is
--    never a row of its own. `tasks.done_at` records when the Task was last completed, which is
--    when the wait began; it is written by the Task's own status change and nothing else.
-- 3. `spawned_waits` is the wait's **overlay** — status, archive and the last check — keyed by the
--    Task and written only when the wait itself is changed. When the wait stops being derived (the
--    Task is reopened, or its template removed) the row is left where it is and ignored, so
--    re-completing brings its state back and undo/redo of the completion needs no special code.
--    Arlesh-pnn's virtual node tables (ADR 0008) will generalise it.
-- 4. An Expectation's **check-by** (one window) becomes **Check every** (a Duration) from a
--    **Starting** instant, with the time the last check was made. The next check falls due one
--    interval after that — anchored to the resolution, not to the schedule.
--
-- `expectations` is rebuilt to drop the check-by columns. `tags_on_expectations` references it
-- with ON DELETE CASCADE, so it is copied aside first — `PRAGMA legacy_alter_table` does nothing
-- while foreign keys are on — and rebuilt afterwards. `tasks` only gains a column, which needs no
-- rebuild; its journal triggers are regenerated to carry it.

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
    status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'released')),
    archival      TEXT NOT NULL DEFAULT 'live' CHECK (archival IN ('live', 'archived')),
    last_check_at TEXT
);

ALTER TABLE tasks ADD COLUMN done_at TEXT;
-- Tasks already done have no recorded completion; the migration is the earliest time known.
UPDATE tasks SET done_at = strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime') WHERE status = 'done';

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
DROP TRIGGER IF EXISTS undo_journal_tasks_insert;
CREATE TRIGGER undo_journal_tasks_insert AFTER INSERT ON tasks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tasks', new.rowid, 'insert', NULL, json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'status', new.status, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'position', new.position, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'plan_start_id', new.plan_start_id, 'plan_end_id', new.plan_end_id, 'on_scope_exit', new.on_scope_exit, 'is_private', new.is_private, 'beads_id', new.beads_id, 'archival', new.archival, 'agentic', new.agentic, 'asynchronous', new.asynchronous, 'done_at', new.done_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_tasks_update;
CREATE TRIGGER undo_journal_tasks_update AFTER UPDATE ON tasks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tasks', new.rowid, 'update', json_object('id', old.id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'status', old.status, 'delegate_kind', old.delegate_kind, 'delegate_id', old.delegate_id, 'position', old.position, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind, 'plan_start_id', old.plan_start_id, 'plan_end_id', old.plan_end_id, 'on_scope_exit', old.on_scope_exit, 'is_private', old.is_private, 'beads_id', old.beads_id, 'archival', old.archival, 'agentic', old.agentic, 'asynchronous', old.asynchronous, 'done_at', old.done_at), json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'status', new.status, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'position', new.position, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'plan_start_id', new.plan_start_id, 'plan_end_id', new.plan_end_id, 'on_scope_exit', new.on_scope_exit, 'is_private', new.is_private, 'beads_id', new.beads_id, 'archival', new.archival, 'agentic', new.agentic, 'asynchronous', new.asynchronous, 'done_at', new.done_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_tasks_delete;
CREATE TRIGGER undo_journal_tasks_delete AFTER DELETE ON tasks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tasks', old.rowid, 'delete', json_object('id', old.id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'status', old.status, 'delegate_kind', old.delegate_kind, 'delegate_id', old.delegate_id, 'position', old.position, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind, 'plan_start_id', old.plan_start_id, 'plan_end_id', old.plan_end_id, 'on_scope_exit', old.on_scope_exit, 'is_private', old.is_private, 'beads_id', old.beads_id, 'archival', old.archival, 'agentic', old.agentic, 'asynchronous', old.asynchronous, 'done_at', old.done_at), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

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
    SELECT gesture_id, source, 'spawned_waits', new.rowid, 'insert', NULL, json_object('task_id', new.task_id, 'status', new.status, 'archival', new.archival, 'last_check_at', new.last_check_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_spawned_waits_update;
CREATE TRIGGER undo_journal_spawned_waits_update AFTER UPDATE ON spawned_waits BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'spawned_waits', new.rowid, 'update', json_object('task_id', old.task_id, 'status', old.status, 'archival', old.archival, 'last_check_at', old.last_check_at), json_object('task_id', new.task_id, 'status', new.status, 'archival', new.archival, 'last_check_at', new.last_check_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_spawned_waits_delete;
CREATE TRIGGER undo_journal_spawned_waits_delete AFTER DELETE ON spawned_waits BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'spawned_waits', old.rowid, 'delete', json_object('task_id', old.task_id, 'status', old.status, 'archival', old.archival, 'last_check_at', old.last_check_at), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
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
