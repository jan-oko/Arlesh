-- The Expectation overlay (Arlesh-pnn, ADR 0008): what makes one derived wait differ from what it
-- is drawn from.
--
-- A spawned wait (the wait an Asynchronous Task's completion spawns) and a delegation wait (the
-- wait a delegated Task has on its delegate) are ordinary Expectation rows. Each is drawn from
-- something — a spawned wait from its Task's Expectation template, a delegation wait from its Task
-- — and, like a Habit occurrence, is edited in the ordinary editor, the edit landing on that one
-- wait. This is the Expectation kind's overlay, mirroring the `expectations` columns the editor
-- writes. Every column is nullable and NULL inherits; where NULL is itself a value (no window, no
-- Check every, no note, no answer) a `*_set` flag marks the column overridden **to** NULL. A row
-- whose every column inherits is deleted rather than kept.
--
-- It is keyed by the wait's canonical node key: `spawned_wait:{task}` or `delegation_wait:{task}`,
-- the Task being a stored id or an occurrence's UUID. `flow_id` names the Habit when the Task is
-- one of its occurrences, so deleting the Habit takes the row with it, and `occurrence_key` the
-- occurrence itself, so dropping its template item does too. A spawned wait's status and archive
-- stay where they were (`spawned_waits`, `occurrence_spawned_waits`); `archival` here is a
-- delegation wait's, which has no state table of its own. Tags are differences in
-- `derived_tags` under the same key, as every derived row's are.

CREATE TABLE expectation_overlays (
    node_key                 TEXT PRIMARY KEY,
    flow_id                  INTEGER REFERENCES flows(id) ON DELETE CASCADE,
    occurrence_key           TEXT,
    title                    TEXT,
    time_scope_start_id      TEXT,
    time_scope_end_id        TEXT,
    time_scope_duration_n    INTEGER,
    time_scope_duration_kind TEXT,
    time_scope_set           INTEGER NOT NULL DEFAULT 0 CHECK (time_scope_set IN (0, 1)),
    check_every_n            INTEGER,
    check_every_kind         TEXT,
    check_every_set          INTEGER NOT NULL DEFAULT 0 CHECK (check_every_set IN (0, 1)),
    check_starting           TEXT,
    is_private               INTEGER CHECK (is_private IN (0, 1)),
    archival                 TEXT CHECK (archival IN ('live', 'archived')),
    agentic                  INTEGER CHECK (agentic IN (0, 1)),
    agentic_note             TEXT,
    agentic_note_set         INTEGER NOT NULL DEFAULT 0 CHECK (agentic_note_set IN (0, 1)),
    agentic_question         INTEGER CHECK (agentic_question IN (0, 1)),
    agentic_answer           TEXT,
    agentic_answer_set       INTEGER NOT NULL DEFAULT 0 CHECK (agentic_answer_set IN (0, 1)),
    CHECK (time_scope_start_id IS NULL OR json_valid(time_scope_start_id)),
    CHECK (time_scope_end_id IS NULL OR json_valid(time_scope_end_id)),
    CHECK ((check_every_n IS NULL) = (check_every_kind IS NULL))
);
CREATE INDEX idx_expectation_overlays_flow ON expectation_overlays (flow_id);

-- Undo-journal triggers, straight from scripts/generate-undo-triggers.sh.

DROP TRIGGER IF EXISTS undo_journal_expectation_overlays_insert;
DROP TRIGGER IF EXISTS undo_journal_expectation_overlays_update;
DROP TRIGGER IF EXISTS undo_journal_expectation_overlays_delete;

CREATE TRIGGER undo_journal_expectation_overlays_insert AFTER INSERT ON expectation_overlays BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'expectation_overlays', new.rowid, 'insert', NULL, json_object('node_key', new.node_key, 'flow_id', new.flow_id, 'occurrence_key', new.occurrence_key, 'title', new.title, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'time_scope_set', new.time_scope_set, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind, 'check_every_set', new.check_every_set, 'check_starting', new.check_starting, 'is_private', new.is_private, 'archival', new.archival, 'agentic', new.agentic, 'agentic_note', new.agentic_note, 'agentic_note_set', new.agentic_note_set, 'agentic_question', new.agentic_question, 'agentic_answer', new.agentic_answer, 'agentic_answer_set', new.agentic_answer_set), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_expectation_overlays_update AFTER UPDATE ON expectation_overlays BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'expectation_overlays', new.rowid, 'update', json_object('node_key', old.node_key, 'flow_id', old.flow_id, 'occurrence_key', old.occurrence_key, 'title', old.title, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind, 'time_scope_set', old.time_scope_set, 'check_every_n', old.check_every_n, 'check_every_kind', old.check_every_kind, 'check_every_set', old.check_every_set, 'check_starting', old.check_starting, 'is_private', old.is_private, 'archival', old.archival, 'agentic', old.agentic, 'agentic_note', old.agentic_note, 'agentic_note_set', old.agentic_note_set, 'agentic_question', old.agentic_question, 'agentic_answer', old.agentic_answer, 'agentic_answer_set', old.agentic_answer_set), json_object('node_key', new.node_key, 'flow_id', new.flow_id, 'occurrence_key', new.occurrence_key, 'title', new.title, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'time_scope_set', new.time_scope_set, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind, 'check_every_set', new.check_every_set, 'check_starting', new.check_starting, 'is_private', new.is_private, 'archival', new.archival, 'agentic', new.agentic, 'agentic_note', new.agentic_note, 'agentic_note_set', new.agentic_note_set, 'agentic_question', new.agentic_question, 'agentic_answer', new.agentic_answer, 'agentic_answer_set', new.agentic_answer_set), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_expectation_overlays_delete AFTER DELETE ON expectation_overlays BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'expectation_overlays', old.rowid, 'delete', json_object('node_key', old.node_key, 'flow_id', old.flow_id, 'occurrence_key', old.occurrence_key, 'title', old.title, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind, 'time_scope_set', old.time_scope_set, 'check_every_n', old.check_every_n, 'check_every_kind', old.check_every_kind, 'check_every_set', old.check_every_set, 'check_starting', old.check_starting, 'is_private', old.is_private, 'archival', old.archival, 'agentic', old.agentic, 'agentic_note', old.agentic_note, 'agentic_note_set', old.agentic_note_set, 'agentic_question', old.agentic_question, 'agentic_answer', old.agentic_answer, 'agentic_answer_set', old.agentic_answer_set), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

