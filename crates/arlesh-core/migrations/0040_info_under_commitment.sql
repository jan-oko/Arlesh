-- An Info note can hang under a Commitment.
--
-- The frontend has offered it since Commitments arrived — `Shift+I` on a Commitment, and Info in
-- the type cycle under one — because a Commitment holds what a Task holds, and a Task holds notes.
-- The `infos.parent_type` CHECK was never widened to match, so every such write failed with a
-- constraint error. This widens it.
--
-- The number is reserved: 0035–0036 belong to Arlesh-qcb and 0037 onward to Arlesh-8wh, so this
-- takes 0040 to stay clear of both.
--
-- SQLite cannot alter a CHECK, so the table is rebuilt: copied into a new table with the widened
-- constraint, the old one dropped, the new one renamed into its place. Nothing references `infos`
-- by foreign key (its parent link is polymorphic, and `habit_instance_children.child_id` carries no
-- FK), so there are no dependent tables to copy aside, and `DROP TABLE` fires no cascade. The
-- columns keep their current order, so every row image the undo journal already holds still reads.
--
-- Dropping the table drops its three undo-journal triggers with it, so they are recreated below,
-- straight from scripts/generate-undo-triggers.sh.

CREATE TABLE infos_new (
    id          INTEGER PRIMARY KEY,
    body        TEXT NOT NULL,
    parent_type TEXT NOT NULL
                    CHECK (parent_type IN ('aspect', 'project', 'domain', 'goal', 'task', 'commitment', 'tag', 'info')),
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
