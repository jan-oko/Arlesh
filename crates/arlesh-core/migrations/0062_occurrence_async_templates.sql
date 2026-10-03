-- A Habit occurrence's own Expectation template, the wait it spawns, and that wait's checks
-- (Arlesh-pnn).
--
-- A stored Task keeps its Expectation template in `task_async_templates`, its spawned wait's state
-- in `spawned_waits` and each check made on that wait in `wait_checks`, all keyed by the Task's
-- integer id. A Habit occurrence has no integer id — it is named by its canonical node key — so
-- the same three things are kept for it under that key:
--
--   * `occurrence_async_templates` (+ `tags_on_occurrence_async_templates`): the template, exactly
--     the columns `task_async_templates` has;
--   * `occurrence_spawned_waits`: the wait's status and archive once changed, pending and live
--     until then;
--   * `wait_checks` gains `wait_kind = 'occurrence'`, whose wait is named by `wait_key` (the
--     occurrence's node key) instead of `wait_id`.
--
-- Deleting the Habit takes all of it with it (`flow_id … ON DELETE CASCADE`), as it takes the
-- occurrence's overlays. `wait_checks` holds no row at all when this runs for an occurrence, and
-- is copied aside and rebuilt with every row it had.

CREATE TABLE occurrence_async_templates (
    node_key         TEXT PRIMARY KEY,
    flow_id          INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    title            TEXT NOT NULL,
    time_scope_n     INTEGER,
    time_scope_kind  TEXT,
    check_every_n    INTEGER,
    check_every_kind TEXT,
    CHECK ((time_scope_n IS NULL) = (time_scope_kind IS NULL)),
    CHECK ((check_every_n IS NULL) = (check_every_kind IS NULL))
);

CREATE TABLE tags_on_occurrence_async_templates (
    node_key TEXT NOT NULL REFERENCES occurrence_async_templates(node_key) ON DELETE CASCADE,
    tag_id   INTEGER NOT NULL REFERENCES domains(id),
    PRIMARY KEY (node_key, tag_id)
);

CREATE TABLE occurrence_spawned_waits (
    node_key TEXT PRIMARY KEY,
    flow_id  INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    status   TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'released')),
    archival TEXT NOT NULL DEFAULT 'live' CHECK (archival IN ('live', 'archived'))
);

CREATE TABLE carry_wait_checks AS SELECT * FROM wait_checks;
DROP TABLE wait_checks;
CREATE TABLE wait_checks (
    id          INTEGER PRIMARY KEY,
    wait_kind   TEXT NOT NULL CHECK (wait_kind IN ('stored', 'spawned', 'occurrence')),
    wait_id     INTEGER,
    wait_key    TEXT,
    due_at      TEXT NOT NULL,
    resolved_at TEXT NOT NULL,
    CHECK ((wait_kind = 'occurrence') = (wait_key IS NOT NULL)),
    CHECK ((wait_id IS NULL) = (wait_key IS NOT NULL))
);
CREATE UNIQUE INDEX idx_wait_checks_check ON wait_checks (wait_kind, coalesce(wait_id, wait_key), due_at);
INSERT INTO wait_checks (id, wait_kind, wait_id, due_at, resolved_at)
    SELECT id, wait_kind, wait_id, due_at, resolved_at FROM carry_wait_checks;
DROP TABLE carry_wait_checks;

-- Undo-journal triggers, straight from scripts/generate-undo-triggers.sh.

DROP TRIGGER IF EXISTS undo_journal_occurrence_async_templates_insert;
CREATE TRIGGER undo_journal_occurrence_async_templates_insert AFTER INSERT ON occurrence_async_templates BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'occurrence_async_templates', new.rowid, 'insert', NULL, json_object('node_key', new.node_key, 'flow_id', new.flow_id, 'title', new.title, 'time_scope_n', new.time_scope_n, 'time_scope_kind', new.time_scope_kind, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_occurrence_async_templates_update;
CREATE TRIGGER undo_journal_occurrence_async_templates_update AFTER UPDATE ON occurrence_async_templates BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'occurrence_async_templates', new.rowid, 'update', json_object('node_key', old.node_key, 'flow_id', old.flow_id, 'title', old.title, 'time_scope_n', old.time_scope_n, 'time_scope_kind', old.time_scope_kind, 'check_every_n', old.check_every_n, 'check_every_kind', old.check_every_kind), json_object('node_key', new.node_key, 'flow_id', new.flow_id, 'title', new.title, 'time_scope_n', new.time_scope_n, 'time_scope_kind', new.time_scope_kind, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_occurrence_async_templates_delete;
CREATE TRIGGER undo_journal_occurrence_async_templates_delete AFTER DELETE ON occurrence_async_templates BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'occurrence_async_templates', old.rowid, 'delete', json_object('node_key', old.node_key, 'flow_id', old.flow_id, 'title', old.title, 'time_scope_n', old.time_scope_n, 'time_scope_kind', old.time_scope_kind, 'check_every_n', old.check_every_n, 'check_every_kind', old.check_every_kind), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_occurrence_spawned_waits_insert;
CREATE TRIGGER undo_journal_occurrence_spawned_waits_insert AFTER INSERT ON occurrence_spawned_waits BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'occurrence_spawned_waits', new.rowid, 'insert', NULL, json_object('node_key', new.node_key, 'flow_id', new.flow_id, 'status', new.status, 'archival', new.archival), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_occurrence_spawned_waits_update;
CREATE TRIGGER undo_journal_occurrence_spawned_waits_update AFTER UPDATE ON occurrence_spawned_waits BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'occurrence_spawned_waits', new.rowid, 'update', json_object('node_key', old.node_key, 'flow_id', old.flow_id, 'status', old.status, 'archival', old.archival), json_object('node_key', new.node_key, 'flow_id', new.flow_id, 'status', new.status, 'archival', new.archival), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_occurrence_spawned_waits_delete;
CREATE TRIGGER undo_journal_occurrence_spawned_waits_delete AFTER DELETE ON occurrence_spawned_waits BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'occurrence_spawned_waits', old.rowid, 'delete', json_object('node_key', old.node_key, 'flow_id', old.flow_id, 'status', old.status, 'archival', old.archival), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_tags_on_occurrence_async_templates_insert;
CREATE TRIGGER undo_journal_tags_on_occurrence_async_templates_insert AFTER INSERT ON tags_on_occurrence_async_templates BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tags_on_occurrence_async_templates', new.rowid, 'insert', NULL, json_object('node_key', new.node_key, 'tag_id', new.tag_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_tags_on_occurrence_async_templates_update;
CREATE TRIGGER undo_journal_tags_on_occurrence_async_templates_update AFTER UPDATE ON tags_on_occurrence_async_templates BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tags_on_occurrence_async_templates', new.rowid, 'update', json_object('node_key', old.node_key, 'tag_id', old.tag_id), json_object('node_key', new.node_key, 'tag_id', new.tag_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_tags_on_occurrence_async_templates_delete;
CREATE TRIGGER undo_journal_tags_on_occurrence_async_templates_delete AFTER DELETE ON tags_on_occurrence_async_templates BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tags_on_occurrence_async_templates', old.rowid, 'delete', json_object('node_key', old.node_key, 'tag_id', old.tag_id), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_wait_checks_insert;
CREATE TRIGGER undo_journal_wait_checks_insert AFTER INSERT ON wait_checks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'wait_checks', new.rowid, 'insert', NULL, json_object('id', new.id, 'wait_kind', new.wait_kind, 'wait_id', new.wait_id, 'wait_key', new.wait_key, 'due_at', new.due_at, 'resolved_at', new.resolved_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_wait_checks_update;
CREATE TRIGGER undo_journal_wait_checks_update AFTER UPDATE ON wait_checks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'wait_checks', new.rowid, 'update', json_object('id', old.id, 'wait_kind', old.wait_kind, 'wait_id', old.wait_id, 'wait_key', old.wait_key, 'due_at', old.due_at, 'resolved_at', old.resolved_at), json_object('id', new.id, 'wait_kind', new.wait_kind, 'wait_id', new.wait_id, 'wait_key', new.wait_key, 'due_at', new.due_at, 'resolved_at', new.resolved_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_wait_checks_delete;
CREATE TRIGGER undo_journal_wait_checks_delete AFTER DELETE ON wait_checks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'wait_checks', old.rowid, 'delete', json_object('id', old.id, 'wait_kind', old.wait_kind, 'wait_id', old.wait_id, 'wait_key', old.wait_key, 'due_at', old.due_at, 'resolved_at', old.resolved_at), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;
