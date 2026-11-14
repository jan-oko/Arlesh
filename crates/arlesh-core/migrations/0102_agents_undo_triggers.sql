-- Claims are part of the undo journal (Task 7a0; settled with the user 2026-11-08).
--
-- Migration 0101 kept the agents out of the journal, so that no Ctrl+Z could revoke an Agent. The
-- user asked for Claim management to be undoable instead: pausing, resuming or releasing a Claim,
-- locking an agent or an account, and removing an agent, each made from Settings -> Agents as one
-- Gesture, reverse with Ctrl+Z like any other write.
--
-- `agents` and `agent_accounts` are therefore journaled. The rest stays out
-- (`undo::EXCLUDED_TABLES`): PINs and their failures, usage reports and the connect token are
-- operational state, not choices to take back. An agent's own writes (attach, claim, a usage-driven
-- change) are journaled under the `mcp` source like its board writes, and stay off every stack.
--
-- Undoing restores the row as it was, which can leave two active Claims overlapping if another
-- agent claimed the subtree meanwhile; the Claim rules already tolerate that (the older keeps its
-- place, the younger is shadowed until the overlap goes), so the invariant needs no check here.
-- A removed agent comes back with its token, which is kept as a digest like everywhere else.

CREATE TRIGGER undo_journal_agent_accounts_insert AFTER INSERT ON agent_accounts BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'agent_accounts', new.rowid, 'insert', NULL, json_object('label', new.label, 'locked', new.locked), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_agent_accounts_update AFTER UPDATE ON agent_accounts BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'agent_accounts', new.rowid, 'update', json_object('label', old.label, 'locked', old.locked), json_object('label', new.label, 'locked', new.locked), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_agent_accounts_delete AFTER DELETE ON agent_accounts BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'agent_accounts', old.rowid, 'delete', json_object('label', old.label, 'locked', old.locked), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_agents_insert AFTER INSERT ON agents BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'agents', new.rowid, 'insert', NULL, json_object('id', new.id, 'name', new.name, 'account', new.account, 'session_uuid', new.session_uuid, 'token_sha256', new.token_sha256, 'claim_kind', new.claim_kind, 'claim_id', new.claim_id, 'claim_paused', new.claim_paused, 'claimed_at', new.claimed_at, 'locked', new.locked, 'created_at', new.created_at, 'last_seen_at', new.last_seen_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_agents_update AFTER UPDATE ON agents BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'agents', new.rowid, 'update', json_object('id', old.id, 'name', old.name, 'account', old.account, 'session_uuid', old.session_uuid, 'token_sha256', old.token_sha256, 'claim_kind', old.claim_kind, 'claim_id', old.claim_id, 'claim_paused', old.claim_paused, 'claimed_at', old.claimed_at, 'locked', old.locked, 'created_at', old.created_at, 'last_seen_at', old.last_seen_at), json_object('id', new.id, 'name', new.name, 'account', new.account, 'session_uuid', new.session_uuid, 'token_sha256', new.token_sha256, 'claim_kind', new.claim_kind, 'claim_id', new.claim_id, 'claim_paused', new.claim_paused, 'claimed_at', new.claimed_at, 'locked', new.locked, 'created_at', new.created_at, 'last_seen_at', new.last_seen_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_agents_delete AFTER DELETE ON agents BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'agents', old.rowid, 'delete', json_object('id', old.id, 'name', old.name, 'account', old.account, 'session_uuid', old.session_uuid, 'token_sha256', old.token_sha256, 'claim_kind', old.claim_kind, 'claim_id', old.claim_id, 'claim_paused', old.claim_paused, 'claimed_at', old.claimed_at, 'locked', old.locked, 'created_at', old.created_at, 'last_seen_at', old.last_seen_at), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;
