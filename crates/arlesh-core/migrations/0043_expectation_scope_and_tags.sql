-- An Expectation carries a Time Scope and tags, like a Task (ruled by the user, 2026-09-23).
--
-- The Time Scope is the same four flat columns a Task's is: boundaries, plus the Duration it was set
-- in. It is the wait's relevance window, and is separate from the check-by (0042), which is only
-- when to look in on it. There is deliberately still **no Plan** — a wait is not something you
-- schedule — and **no `on_scope_exit`**: a wait is never Missed, so a window that passes with the
-- wait still pending reads Overdue, as a Keep-on-exit Task does.
--
-- Tags hang off their own relation table, the shape `tags_on_tasks` and `tags_on_commitments`
-- already have, so the tag filter reads a wait exactly as it reads those.
--
-- `ALTER TABLE … ADD COLUMN` is enough for the columns: SQLite accepts a REFERENCES clause on an
-- added column whose default is NULL, and nothing about the existing CHECKs changes. The three
-- journal triggers on `expectations` name every column, so they are regenerated below, and the new
-- table gets its three; all straight from scripts/generate-undo-triggers.sh.

ALTER TABLE expectations ADD COLUMN time_scope_start_id INTEGER REFERENCES scopes(id);
ALTER TABLE expectations ADD COLUMN time_scope_end_id INTEGER REFERENCES scopes(id);
ALTER TABLE expectations ADD COLUMN time_scope_duration_n INTEGER;
ALTER TABLE expectations ADD COLUMN time_scope_duration_kind TEXT;

CREATE TABLE tags_on_expectations (
    expectation_id INTEGER NOT NULL REFERENCES expectations(id) ON DELETE CASCADE,
    tag_id         INTEGER NOT NULL REFERENCES domains(id),
    PRIMARY KEY (expectation_id, tag_id)
);

DROP TRIGGER IF EXISTS undo_journal_expectations_insert;
CREATE TRIGGER undo_journal_expectations_insert AFTER INSERT ON expectations BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'expectations', new.rowid, 'insert', NULL, json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'status', new.status, 'archival', new.archival, 'check_by_start_id', new.check_by_start_id, 'check_by_end_id', new.check_by_end_id, 'check_by_duration_n', new.check_by_duration_n, 'check_by_duration_kind', new.check_by_duration_kind, 'position', new.position, 'is_private', new.is_private, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_expectations_update;
CREATE TRIGGER undo_journal_expectations_update AFTER UPDATE ON expectations BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'expectations', new.rowid, 'update', json_object('id', old.id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'status', old.status, 'archival', old.archival, 'check_by_start_id', old.check_by_start_id, 'check_by_end_id', old.check_by_end_id, 'check_by_duration_n', old.check_by_duration_n, 'check_by_duration_kind', old.check_by_duration_kind, 'position', old.position, 'is_private', old.is_private, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind), json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'status', new.status, 'archival', new.archival, 'check_by_start_id', new.check_by_start_id, 'check_by_end_id', new.check_by_end_id, 'check_by_duration_n', new.check_by_duration_n, 'check_by_duration_kind', new.check_by_duration_kind, 'position', new.position, 'is_private', new.is_private, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER IF EXISTS undo_journal_expectations_delete;
CREATE TRIGGER undo_journal_expectations_delete AFTER DELETE ON expectations BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'expectations', old.rowid, 'delete', json_object('id', old.id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'status', old.status, 'archival', old.archival, 'check_by_start_id', old.check_by_start_id, 'check_by_end_id', old.check_by_end_id, 'check_by_duration_n', old.check_by_duration_n, 'check_by_duration_kind', old.check_by_duration_kind, 'position', old.position, 'is_private', old.is_private, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
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
