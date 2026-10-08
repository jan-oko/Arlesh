-- Delegation becomes a (kind, id) pair: a Task is delegated to a Person or to the Agent.
--
-- `delegate_to INTEGER REFERENCES people(id)` could only name a Person, so the one way to hand a
-- Task to an agent was to invent a Person row called "Agent" — a knowledge-base entity standing for
-- something that is not a person. The user chose, on 2026-09-19, to make Delegation polymorphic
-- instead of seeding such a row (Arlesh-8wh), so the model says what is true.
--
-- `delegate_to` is replaced by two columns:
--
--   delegate_kind  'person' | 'agent' | NULL (not delegated)
--   delegate_id    the Person's id when the kind is 'person'; NULL otherwise
--
-- There is one Agent target, so an Agent delegate carries no id. That is also why `delegate_id`
-- keeps its REFERENCES people(id): every non-NULL value it can hold is a Person, so the foreign key
-- is still true, and it keeps what the old column had — a delegate that names no Person is refused,
-- a Person who is still someone's delegate cannot be deleted out from under the Task, and the undo
-- replay's deferred foreign keys cover it. Naming individual agents later means giving the Agent
-- kind ids of its own, and that migration is the one that drops the reference. The table CHECK
-- admits exactly the three shapes the Rust `Delegate` enum can hold.
--
-- Every existing delegate was a Person, so `delegate_to` is copied across as ('person', id).
--
-- SQLite cannot drop a column that carries a foreign key, or add a CHECK spanning two columns to a
-- populated table, so `tasks` is rebuilt — with 0027's hazard and 0027's answer. `tasks` is
-- referenced ON DELETE CASCADE by `task_dependencies`, `tags_on_tasks` and
-- `task_knowledge_base_links`, so `DROP TABLE tasks` would take every dependency edge, tag and
-- knowledge-base link on the board with it. `PRAGMA defer_foreign_keys` defers violations, not
-- cascade actions, and `PRAGMA legacy_alter_table` does nothing while foreign keys are on, which
-- they are on every connection this app opens. So each dependent is copied to a constraint-free
-- scratch table, dropped, and rebuilt afterwards from its own unchanged definition.
--
-- Dropping a table drops its triggers, so the undo-journal triggers of all four tables are
-- regenerated at the end (scripts/generate-undo-triggers.sh). They are created last, after every
-- copy, so nothing this migration writes is journaled.

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
    delegate_kind            TEXT CHECK (delegate_kind IN ('person', 'agent')),
    delegate_id              INTEGER REFERENCES people(id),
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
    archival                 TEXT NOT NULL DEFAULT 'live' CHECK (archival IN ('live', 'backlog')),
    agentic                  INTEGER NULL CHECK (agentic IN (0, 1)),
    asynchronous             INTEGER NOT NULL DEFAULT 0 CHECK (asynchronous IN (0, 1)),
    CHECK (
        (delegate_kind IS NULL     AND delegate_id IS NULL)
     OR (delegate_kind = 'person'  AND delegate_id IS NOT NULL)
     OR (delegate_kind = 'agent'   AND delegate_id IS NULL)
    )
);
INSERT INTO tasks_new
    (id, title, parent_type, parent_id, status, delegate_kind, delegate_id, position,
     time_scope_start_id, time_scope_end_id, time_scope_duration_n, time_scope_duration_kind,
     plan_start_id, plan_end_id, on_scope_exit, is_private, beads_id, archival, agentic,
     asynchronous)
SELECT
     id, title, parent_type, parent_id, status,
     CASE WHEN delegate_to IS NULL THEN NULL ELSE 'person' END, delegate_to, position,
     time_scope_start_id, time_scope_end_id, time_scope_duration_n, time_scope_duration_kind,
     plan_start_id, plan_end_id, on_scope_exit, is_private, beads_id, archival, agentic,
     asynchronous
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

-- Undo-journal triggers for the four rebuilt tables, output taken straight from
-- scripts/generate-undo-triggers.sh. The DROPs are no-ops — the triggers went with their tables —
-- and are kept for the same re-runnability 0030, 0032 and 0033 give theirs.

DROP TRIGGER IF EXISTS undo_journal_tasks_insert;
CREATE TRIGGER undo_journal_tasks_insert AFTER INSERT ON tasks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tasks', new.rowid, 'insert', NULL, json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'status', new.status, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'position', new.position, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'plan_start_id', new.plan_start_id, 'plan_end_id', new.plan_end_id, 'on_scope_exit', new.on_scope_exit, 'is_private', new.is_private, 'beads_id', new.beads_id, 'archival', new.archival, 'agentic', new.agentic, 'asynchronous', new.asynchronous), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_tasks_update;
CREATE TRIGGER undo_journal_tasks_update AFTER UPDATE ON tasks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tasks', new.rowid, 'update', json_object('id', old.id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'status', old.status, 'delegate_kind', old.delegate_kind, 'delegate_id', old.delegate_id, 'position', old.position, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind, 'plan_start_id', old.plan_start_id, 'plan_end_id', old.plan_end_id, 'on_scope_exit', old.on_scope_exit, 'is_private', old.is_private, 'beads_id', old.beads_id, 'archival', old.archival, 'agentic', old.agentic, 'asynchronous', old.asynchronous), json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'status', new.status, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'position', new.position, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'plan_start_id', new.plan_start_id, 'plan_end_id', new.plan_end_id, 'on_scope_exit', new.on_scope_exit, 'is_private', new.is_private, 'beads_id', new.beads_id, 'archival', new.archival, 'agentic', new.agentic, 'asynchronous', new.asynchronous), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_tasks_delete;
CREATE TRIGGER undo_journal_tasks_delete AFTER DELETE ON tasks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tasks', old.rowid, 'delete', json_object('id', old.id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'status', old.status, 'delegate_kind', old.delegate_kind, 'delegate_id', old.delegate_id, 'position', old.position, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind, 'plan_start_id', old.plan_start_id, 'plan_end_id', old.plan_end_id, 'on_scope_exit', old.on_scope_exit, 'is_private', old.is_private, 'beads_id', old.beads_id, 'archival', old.archival, 'agentic', old.agentic, 'asynchronous', old.asynchronous), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
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

DROP TRIGGER IF EXISTS undo_journal_tags_on_tasks_insert;
CREATE TRIGGER undo_journal_tags_on_tasks_insert AFTER INSERT ON tags_on_tasks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tags_on_tasks', new.rowid, 'insert', NULL, json_object('task_id', new.task_id, 'tag_id', new.tag_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_tags_on_tasks_update;
CREATE TRIGGER undo_journal_tags_on_tasks_update AFTER UPDATE ON tags_on_tasks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tags_on_tasks', new.rowid, 'update', json_object('task_id', old.task_id, 'tag_id', old.tag_id), json_object('task_id', new.task_id, 'tag_id', new.tag_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_tags_on_tasks_delete;
CREATE TRIGGER undo_journal_tags_on_tasks_delete AFTER DELETE ON tags_on_tasks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tags_on_tasks', old.rowid, 'delete', json_object('task_id', old.task_id, 'tag_id', old.tag_id), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_task_knowledge_base_links_insert;
CREATE TRIGGER undo_journal_task_knowledge_base_links_insert AFTER INSERT ON task_knowledge_base_links BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'task_knowledge_base_links', new.rowid, 'insert', NULL, json_object('task_id', new.task_id, 'entity_type', new.entity_type, 'entity_id', new.entity_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_task_knowledge_base_links_update;
CREATE TRIGGER undo_journal_task_knowledge_base_links_update AFTER UPDATE ON task_knowledge_base_links BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'task_knowledge_base_links', new.rowid, 'update', json_object('task_id', old.task_id, 'entity_type', old.entity_type, 'entity_id', old.entity_id), json_object('task_id', new.task_id, 'entity_type', new.entity_type, 'entity_id', new.entity_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_task_knowledge_base_links_delete;
CREATE TRIGGER undo_journal_task_knowledge_base_links_delete AFTER DELETE ON task_knowledge_base_links BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'task_knowledge_base_links', old.rowid, 'delete', json_object('task_id', old.task_id, 'entity_type', old.entity_type, 'entity_id', old.entity_id), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;
