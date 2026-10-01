-- Habit cooldown (Task 199): a Window Habit may carry a cooldown — N units of a scope kind finer
-- than the habit's own (a weekly habit's in days, a monthly one's in weeks or days, a daily one's
-- in parts of the day). After an iteration is done, the next one — under Owed, every one still
-- open — is blocked until the cooldown has passed (docs/spec/habits.md, "Cooldown").
--
-- Two nullable columns, set together, and only on a Window clock: an Interval's Gap already counts
-- from completion. Every existing Habit has none, so nothing is rewritten.

ALTER TABLE flow_recurrences ADD COLUMN cooldown_n INTEGER
    CHECK (cooldown_n IS NULL OR cooldown_n >= 1);
ALTER TABLE flow_recurrences ADD COLUMN cooldown_kind TEXT
    CHECK ((cooldown_kind IS NULL) = (cooldown_n IS NULL)
           AND (cooldown_kind IS NULL OR (cooldown_kind IN ('part', 'day', 'week', 'month')
                                          AND clock = 'window')));

-- The undo journal's images name every column, so the three `flow_recurrences` triggers are
-- rebuilt with the two new ones.
DROP TRIGGER undo_journal_flow_recurrences_insert;
DROP TRIGGER undo_journal_flow_recurrences_update;
DROP TRIGGER undo_journal_flow_recurrences_delete;

CREATE TRIGGER undo_journal_flow_recurrences_insert AFTER INSERT ON flow_recurrences BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_recurrences', new.rowid, 'insert', NULL, json_object('flow_id', new.flow_id, 'start_scope_id', new.start_scope_id, 'gap_n', new.gap_n, 'gap_kind', new.gap_kind, 'end_scope_id', new.end_scope_id, 'clock', new.clock, 'miss_policy', new.miss_policy, 'cooldown_n', new.cooldown_n, 'cooldown_kind', new.cooldown_kind), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_recurrences_update AFTER UPDATE ON flow_recurrences BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_recurrences', new.rowid, 'update', json_object('flow_id', old.flow_id, 'start_scope_id', old.start_scope_id, 'gap_n', old.gap_n, 'gap_kind', old.gap_kind, 'end_scope_id', old.end_scope_id, 'clock', old.clock, 'miss_policy', old.miss_policy, 'cooldown_n', old.cooldown_n, 'cooldown_kind', old.cooldown_kind), json_object('flow_id', new.flow_id, 'start_scope_id', new.start_scope_id, 'gap_n', new.gap_n, 'gap_kind', new.gap_kind, 'end_scope_id', new.end_scope_id, 'clock', new.clock, 'miss_policy', new.miss_policy, 'cooldown_n', new.cooldown_n, 'cooldown_kind', new.cooldown_kind), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_recurrences_delete AFTER DELETE ON flow_recurrences BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_recurrences', old.rowid, 'delete', json_object('flow_id', old.flow_id, 'start_scope_id', old.start_scope_id, 'gap_n', old.gap_n, 'gap_kind', old.gap_kind, 'end_scope_id', old.end_scope_id, 'clock', old.clock, 'miss_policy', old.miss_policy, 'cooldown_n', old.cooldown_n, 'cooldown_kind', old.cooldown_kind), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;
