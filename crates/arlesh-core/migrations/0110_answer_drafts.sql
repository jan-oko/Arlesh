-- Staged answers (Task de16, ADR 0021): the user's answer to an agent's question, or a review's
-- verdict, written down but not yet sent. A row means "staged"; Send releases the waits and deletes
-- the rows. `wait_id` is the wait's NodeId (a stored UUID or a derived one) with no foreign key: a
-- derived wait has no `expectations` row. Agents never read this table.

CREATE TABLE answer_drafts (
    wait_id  TEXT PRIMARY KEY NOT NULL,
    answer   TEXT,
    verdict  TEXT CHECK (verdict IS NULL OR verdict IN ('approved', 'changes_requested')),
    saved_at TEXT NOT NULL,
    CHECK (answer IS NOT NULL OR verdict IS NOT NULL)
);

CREATE TRIGGER undo_journal_answer_drafts_insert AFTER INSERT ON answer_drafts BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'answer_drafts', new.rowid, 'insert', NULL, json_object('wait_id', new.wait_id, 'answer', new.answer, 'verdict', new.verdict, 'saved_at', new.saved_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_answer_drafts_update AFTER UPDATE ON answer_drafts BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'answer_drafts', new.rowid, 'update', json_object('wait_id', old.wait_id, 'answer', old.answer, 'verdict', old.verdict, 'saved_at', old.saved_at), json_object('wait_id', new.wait_id, 'answer', new.answer, 'verdict', new.verdict, 'saved_at', new.saved_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_answer_drafts_delete AFTER DELETE ON answer_drafts BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'answer_drafts', old.rowid, 'delete', json_object('wait_id', old.wait_id, 'answer', old.answer, 'verdict', old.verdict, 'saved_at', old.saved_at), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;
