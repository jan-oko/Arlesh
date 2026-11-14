-- Agentic reviews (Task 97f, specced with the user 2026-11-13).
--
-- A **review** is its own kind of agentic wait beside the question and the wait on something
-- non-human. It hangs on the stored Expectation row, so it needs no table of its own:
--
--   * `agentic_review` — NULL for every other wait; for a review a JSON object
--     {"links": [{"label", "url"}], "hand_tests": ["..."]}. The links and the hand tests are
--     written once, when the agent raises the review, and never edited per item, so one document
--     column holds them better than child rows nobody queries.
--   * `agentic_verdict` — the user's verdict, `approved` or `changes_requested`; NULL while open.
--
-- The review's title and summary are the wait's title and `agentic_note`, and the user's note is
-- its `agentic_answer`, as for a question. A review is a question (`agentic_question` = 1), so it
-- makes its Task read Review without any new derivation. Only a stored wait can be a review: the
-- overlays of derived waits carry neither column.
--
-- The undo journal's three expectation triggers list every column, so they are recreated with both.

ALTER TABLE expectations ADD COLUMN agentic_review TEXT CHECK (agentic_review IS NULL OR json_valid(agentic_review));
ALTER TABLE expectations ADD COLUMN agentic_verdict TEXT CHECK (agentic_verdict IS NULL OR agentic_verdict IN ('approved', 'changes_requested'));

DROP TRIGGER undo_journal_expectations_insert;
DROP TRIGGER undo_journal_expectations_update;
DROP TRIGGER undo_journal_expectations_delete;

CREATE TRIGGER undo_journal_expectations_insert AFTER INSERT ON expectations BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'expectations', new.rowid, 'insert', NULL, json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'status', new.status, 'archival', new.archival, 'position', new.position, 'is_private', new.is_private, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind, 'check_starting', new.check_starting, 'last_check_at', new.last_check_at, 'agentic', new.agentic, 'agentic_note', new.agentic_note, 'agentic_question', new.agentic_question, 'agentic_answer', new.agentic_answer, 'released_at', new.released_at, 'agentic_review', new.agentic_review, 'agentic_verdict', new.agentic_verdict), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_expectations_update AFTER UPDATE ON expectations BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'expectations', new.rowid, 'update', json_object('id', old.id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'status', old.status, 'archival', old.archival, 'position', old.position, 'is_private', old.is_private, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind, 'check_every_n', old.check_every_n, 'check_every_kind', old.check_every_kind, 'check_starting', old.check_starting, 'last_check_at', old.last_check_at, 'agentic', old.agentic, 'agentic_note', old.agentic_note, 'agentic_question', old.agentic_question, 'agentic_answer', old.agentic_answer, 'released_at', old.released_at, 'agentic_review', old.agentic_review, 'agentic_verdict', old.agentic_verdict), json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'status', new.status, 'archival', new.archival, 'position', new.position, 'is_private', new.is_private, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind, 'check_starting', new.check_starting, 'last_check_at', new.last_check_at, 'agentic', new.agentic, 'agentic_note', new.agentic_note, 'agentic_question', new.agentic_question, 'agentic_answer', new.agentic_answer, 'released_at', new.released_at, 'agentic_review', new.agentic_review, 'agentic_verdict', new.agentic_verdict), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_expectations_delete AFTER DELETE ON expectations BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'expectations', old.rowid, 'delete', json_object('id', old.id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'status', old.status, 'archival', old.archival, 'position', old.position, 'is_private', old.is_private, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind, 'check_every_n', old.check_every_n, 'check_every_kind', old.check_every_kind, 'check_starting', old.check_starting, 'last_check_at', old.last_check_at, 'agentic', old.agentic, 'agentic_note', old.agentic_note, 'agentic_question', old.agentic_question, 'agentic_answer', old.agentic_answer, 'released_at', old.released_at, 'agentic_review', old.agentic_review, 'agentic_verdict', old.agentic_verdict), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

