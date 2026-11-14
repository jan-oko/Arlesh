-- Child Agents (Task 077, ADR 0019): the journal images of `agents` carry `parent_id`, so an undo
-- brings a child back under its parent. Migration 0102's three triggers, recreated with one more key.

DROP TRIGGER undo_journal_agents_insert;
CREATE TRIGGER undo_journal_agents_insert AFTER INSERT ON agents BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'agents', new.rowid, 'insert', NULL, json_object('id', new.id, 'name', new.name, 'account', new.account, 'session_uuid', new.session_uuid, 'token_sha256', new.token_sha256, 'claim_kind', new.claim_kind, 'claim_id', new.claim_id, 'claim_paused', new.claim_paused, 'claimed_at', new.claimed_at, 'locked', new.locked, 'created_at', new.created_at, 'last_seen_at', new.last_seen_at, 'parent_id', new.parent_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER undo_journal_agents_update;
CREATE TRIGGER undo_journal_agents_update AFTER UPDATE ON agents BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'agents', new.rowid, 'update', json_object('id', old.id, 'name', old.name, 'account', old.account, 'session_uuid', old.session_uuid, 'token_sha256', old.token_sha256, 'claim_kind', old.claim_kind, 'claim_id', old.claim_id, 'claim_paused', old.claim_paused, 'claimed_at', old.claimed_at, 'locked', old.locked, 'created_at', old.created_at, 'last_seen_at', old.last_seen_at, 'parent_id', old.parent_id), json_object('id', new.id, 'name', new.name, 'account', new.account, 'session_uuid', new.session_uuid, 'token_sha256', new.token_sha256, 'claim_kind', new.claim_kind, 'claim_id', new.claim_id, 'claim_paused', new.claim_paused, 'claimed_at', new.claimed_at, 'locked', new.locked, 'created_at', new.created_at, 'last_seen_at', new.last_seen_at, 'parent_id', new.parent_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

DROP TRIGGER undo_journal_agents_delete;
CREATE TRIGGER undo_journal_agents_delete AFTER DELETE ON agents BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'agents', old.rowid, 'delete', json_object('id', old.id, 'name', old.name, 'account', old.account, 'session_uuid', old.session_uuid, 'token_sha256', old.token_sha256, 'claim_kind', old.claim_kind, 'claim_id', old.claim_id, 'claim_paused', old.claim_paused, 'claimed_at', old.claimed_at, 'locked', old.locked, 'created_at', old.created_at, 'last_seen_at', old.last_seen_at, 'parent_id', old.parent_id), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;
