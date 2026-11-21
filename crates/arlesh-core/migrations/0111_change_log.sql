-- The change log (ADR 0017, decision 5; Task ccc, PR 2): what a client's Replica hears from the
-- server, written by triggers so that no command has to remember to say what it changed.
--
-- Every replicated table (every table the undo journal covers, less the server-only ones: see
-- `arlesh_core::replication::UNREPLICATED_TABLES`) gets three triggers that report the row they
-- touched: `set` with the row's image after the change, or `del` for a row that is gone. They fire
-- for undo and redo too, which suppress the journal but are ordinary writes to these tables, and for
-- the rows a cascade removes. An update that changes no column of the image logs nothing. Two
-- `agents` columns hold stand-ins in the image: `token_sha256` (a credential never travels to a
-- device; the stand-in is `'redacted:' || id`, unique, so the row applies under this same schema) and
-- `last_seen_at` (bookkeeping rewritten on every request, a constant, so it is not logged).
--
-- The log is a **buffer, not a history**. It is written only while a publisher holds a lease on the
-- capture (`change_capture.leased_until` in the future). The one process that holds it (the server's
-- board publisher) renews it every turn, reads the log into each live event and deletes what it read
-- in the same transaction, so nothing accumulates; a crashed server's lease runs out by itself, and
-- a clean shutdown gives it up. Nothing
-- reads it for catch-up: a client that misses an event fetches a whole board
-- (docs/spec/client-mode.md, *Live sync*).
--
-- The triggers are generated: `scripts/generate-undo-triggers.sh change`. A new table needs its three
-- in a new migration, and `replication::tests` fails until it has them.

CREATE TABLE change_capture (
    id           INTEGER PRIMARY KEY CHECK (id = 1),
    -- The publisher that holds the capture, and until when (Unix seconds). The triggers log only
    -- while the lease is in the future; a publisher renews it every turn and gives it up at a clean
    -- shutdown, and another cannot take it while it is valid.
    owner        TEXT,
    leased_until INTEGER NOT NULL DEFAULT 0
);
INSERT INTO change_capture (id, owner, leased_until) VALUES (1, NULL, 0);

CREATE TABLE change_log (
    seq        INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name TEXT NOT NULL,
    row_id     INTEGER NOT NULL,
    operation  TEXT NOT NULL CHECK (operation IN ('set', 'del')),
    image      TEXT,
    CHECK ((operation = 'set') = (image IS NOT NULL))
);

CREATE TRIGGER change_log_agent_accounts_insert AFTER INSERT ON agent_accounts BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'agent_accounts', new.rowid, 'set', json_object('label', new.label, 'locked', new.locked)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_agent_accounts_update AFTER UPDATE ON agent_accounts WHEN old.rowid IS NOT new.rowid OR old.label IS NOT new.label OR old.locked IS NOT new.locked BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'agent_accounts', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'agent_accounts', new.rowid, 'set', json_object('label', new.label, 'locked', new.locked)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_agent_accounts_delete AFTER DELETE ON agent_accounts BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'agent_accounts', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_agents_insert AFTER INSERT ON agents BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'agents', new.rowid, 'set', json_object('id', new.id, 'name', new.name, 'account', new.account, 'session_uuid', new.session_uuid, 'token_sha256', 'redacted:' || new.id, 'claim_kind', new.claim_kind, 'claim_id', new.claim_id, 'claim_paused', new.claim_paused, 'claimed_at', new.claimed_at, 'locked', new.locked, 'created_at', new.created_at, 'last_seen_at', NULL, 'parent_id', new.parent_id)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_agents_update AFTER UPDATE ON agents WHEN old.rowid IS NOT new.rowid OR old.id IS NOT new.id OR old.name IS NOT new.name OR old.account IS NOT new.account OR old.session_uuid IS NOT new.session_uuid OR old.claim_kind IS NOT new.claim_kind OR old.claim_id IS NOT new.claim_id OR old.claim_paused IS NOT new.claim_paused OR old.claimed_at IS NOT new.claimed_at OR old.locked IS NOT new.locked OR old.created_at IS NOT new.created_at OR old.parent_id IS NOT new.parent_id BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'agents', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'agents', new.rowid, 'set', json_object('id', new.id, 'name', new.name, 'account', new.account, 'session_uuid', new.session_uuid, 'token_sha256', 'redacted:' || new.id, 'claim_kind', new.claim_kind, 'claim_id', new.claim_id, 'claim_paused', new.claim_paused, 'claimed_at', new.claimed_at, 'locked', new.locked, 'created_at', new.created_at, 'last_seen_at', NULL, 'parent_id', new.parent_id)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_agents_delete AFTER DELETE ON agents BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'agents', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_answer_drafts_insert AFTER INSERT ON answer_drafts BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'answer_drafts', new.rowid, 'set', json_object('wait_id', new.wait_id, 'answer', new.answer, 'verdict', new.verdict, 'saved_at', new.saved_at)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_answer_drafts_update AFTER UPDATE ON answer_drafts WHEN old.rowid IS NOT new.rowid OR old.wait_id IS NOT new.wait_id OR old.answer IS NOT new.answer OR old.verdict IS NOT new.verdict OR old.saved_at IS NOT new.saved_at BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'answer_drafts', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'answer_drafts', new.rowid, 'set', json_object('wait_id', new.wait_id, 'answer', new.answer, 'verdict', new.verdict, 'saved_at', new.saved_at)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_answer_drafts_delete AFTER DELETE ON answer_drafts BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'answer_drafts', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_block_reasons_insert AFTER INSERT ON block_reasons BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'block_reasons', new.rowid, 'set', json_object('id', new.id, 'owner_type', new.owner_type, 'owner_id', new.owner_id, 'reason', new.reason, 'position', new.position, 'created_at', new.created_at)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_block_reasons_update AFTER UPDATE ON block_reasons WHEN old.rowid IS NOT new.rowid OR old.id IS NOT new.id OR old.owner_type IS NOT new.owner_type OR old.owner_id IS NOT new.owner_id OR old.reason IS NOT new.reason OR old.position IS NOT new.position OR old.created_at IS NOT new.created_at BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'block_reasons', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'block_reasons', new.rowid, 'set', json_object('id', new.id, 'owner_type', new.owner_type, 'owner_id', new.owner_id, 'reason', new.reason, 'position', new.position, 'created_at', new.created_at)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_block_reasons_delete AFTER DELETE ON block_reasons BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'block_reasons', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_commitment_overlays_insert AFTER INSERT ON commitment_overlays BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'commitment_overlays', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'item_type', new.item_type, 'item_id', new.item_id, 'iteration_scope', new.iteration_scope, 'cycle_id', new.cycle_id, 'verdict', new.verdict, 'resolved_at', new.resolved_at, 'tombstone', new.tombstone, 'title', new.title, 'is_private', new.is_private, 'position', new.position)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_commitment_overlays_update AFTER UPDATE ON commitment_overlays WHEN old.rowid IS NOT new.rowid OR old.id IS NOT new.id OR old.flow_id IS NOT new.flow_id OR old.item_type IS NOT new.item_type OR old.item_id IS NOT new.item_id OR old.iteration_scope IS NOT new.iteration_scope OR old.cycle_id IS NOT new.cycle_id OR old.verdict IS NOT new.verdict OR old.resolved_at IS NOT new.resolved_at OR old.tombstone IS NOT new.tombstone OR old.title IS NOT new.title OR old.is_private IS NOT new.is_private OR old.position IS NOT new.position BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'commitment_overlays', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'commitment_overlays', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'item_type', new.item_type, 'item_id', new.item_id, 'iteration_scope', new.iteration_scope, 'cycle_id', new.cycle_id, 'verdict', new.verdict, 'resolved_at', new.resolved_at, 'tombstone', new.tombstone, 'title', new.title, 'is_private', new.is_private, 'position', new.position)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_commitment_overlays_delete AFTER DELETE ON commitment_overlays BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'commitment_overlays', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_commitments_insert AFTER INSERT ON commitments BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'commitments', new.rowid, 'set', json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'verdict', new.verdict, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'verdict_window_n', new.verdict_window_n, 'verdict_window_kind', new.verdict_window_kind, 'position', new.position, 'is_private', new.is_private, 'verdict_at', new.verdict_at, 'archival', new.archival)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_commitments_update AFTER UPDATE ON commitments WHEN old.rowid IS NOT new.rowid OR old.id IS NOT new.id OR old.title IS NOT new.title OR old.parent_type IS NOT new.parent_type OR old.parent_id IS NOT new.parent_id OR old.verdict IS NOT new.verdict OR old.time_scope_start_id IS NOT new.time_scope_start_id OR old.time_scope_end_id IS NOT new.time_scope_end_id OR old.time_scope_duration_n IS NOT new.time_scope_duration_n OR old.time_scope_duration_kind IS NOT new.time_scope_duration_kind OR old.verdict_window_n IS NOT new.verdict_window_n OR old.verdict_window_kind IS NOT new.verdict_window_kind OR old.position IS NOT new.position OR old.is_private IS NOT new.is_private OR old.verdict_at IS NOT new.verdict_at OR old.archival IS NOT new.archival BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'commitments', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'commitments', new.rowid, 'set', json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'verdict', new.verdict, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'verdict_window_n', new.verdict_window_n, 'verdict_window_kind', new.verdict_window_kind, 'position', new.position, 'is_private', new.is_private, 'verdict_at', new.verdict_at, 'archival', new.archival)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_commitments_delete AFTER DELETE ON commitments BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'commitments', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_derived_block_reasons_insert AFTER INSERT ON derived_block_reasons BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'derived_block_reasons', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'node_kind', new.node_kind, 'node_key', new.node_key, 'reason', new.reason, 'position', new.position)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_derived_block_reasons_update AFTER UPDATE ON derived_block_reasons WHEN old.rowid IS NOT new.rowid OR old.id IS NOT new.id OR old.flow_id IS NOT new.flow_id OR old.node_kind IS NOT new.node_kind OR old.node_key IS NOT new.node_key OR old.reason IS NOT new.reason OR old.position IS NOT new.position BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'derived_block_reasons', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'derived_block_reasons', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'node_kind', new.node_kind, 'node_key', new.node_key, 'reason', new.reason, 'position', new.position)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_derived_block_reasons_delete AFTER DELETE ON derived_block_reasons BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'derived_block_reasons', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_derived_children_insert AFTER INSERT ON derived_children BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'derived_children', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'parent_kind', new.parent_kind, 'parent_key', new.parent_key, 'window_start_scope_id', new.window_start_scope_id, 'window_end_scope_id', new.window_end_scope_id, 'child_type', new.child_type, 'child_id', new.child_id)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_derived_children_update AFTER UPDATE ON derived_children WHEN old.rowid IS NOT new.rowid OR old.id IS NOT new.id OR old.flow_id IS NOT new.flow_id OR old.parent_kind IS NOT new.parent_kind OR old.parent_key IS NOT new.parent_key OR old.window_start_scope_id IS NOT new.window_start_scope_id OR old.window_end_scope_id IS NOT new.window_end_scope_id OR old.child_type IS NOT new.child_type OR old.child_id IS NOT new.child_id BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'derived_children', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'derived_children', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'parent_kind', new.parent_kind, 'parent_key', new.parent_key, 'window_start_scope_id', new.window_start_scope_id, 'window_end_scope_id', new.window_end_scope_id, 'child_type', new.child_type, 'child_id', new.child_id)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_derived_children_delete AFTER DELETE ON derived_children BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'derived_children', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_derived_dependencies_insert AFTER INSERT ON derived_dependencies BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'derived_dependencies', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'dependent_id', new.dependent_id, 'dependent_key', new.dependent_key, 'target_type', new.target_type, 'target_id', new.target_id, 'target_key', new.target_key, 'added', new.added)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_derived_dependencies_update AFTER UPDATE ON derived_dependencies WHEN old.rowid IS NOT new.rowid OR old.id IS NOT new.id OR old.flow_id IS NOT new.flow_id OR old.dependent_id IS NOT new.dependent_id OR old.dependent_key IS NOT new.dependent_key OR old.target_type IS NOT new.target_type OR old.target_id IS NOT new.target_id OR old.target_key IS NOT new.target_key OR old.added IS NOT new.added BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'derived_dependencies', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'derived_dependencies', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'dependent_id', new.dependent_id, 'dependent_key', new.dependent_key, 'target_type', new.target_type, 'target_id', new.target_id, 'target_key', new.target_key, 'added', new.added)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_derived_dependencies_delete AFTER DELETE ON derived_dependencies BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'derived_dependencies', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_derived_tags_insert AFTER INSERT ON derived_tags BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'derived_tags', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'node_kind', new.node_kind, 'node_key', new.node_key, 'tag_id', new.tag_id, 'added', new.added)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_derived_tags_update AFTER UPDATE ON derived_tags WHEN old.rowid IS NOT new.rowid OR old.id IS NOT new.id OR old.flow_id IS NOT new.flow_id OR old.node_kind IS NOT new.node_kind OR old.node_key IS NOT new.node_key OR old.tag_id IS NOT new.tag_id OR old.added IS NOT new.added BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'derived_tags', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'derived_tags', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'node_kind', new.node_kind, 'node_key', new.node_key, 'tag_id', new.tag_id, 'added', new.added)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_derived_tags_delete AFTER DELETE ON derived_tags BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'derived_tags', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_domains_insert AFTER INSERT ON domains BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'domains', new.rowid, 'set', json_object('id', new.id, 'title', new.title, 'description', new.description, 'subtype', new.subtype, 'parent_id', new.parent_id, 'color', new.color, 'status', new.status, 'knowledge_base_directory', new.knowledge_base_directory, 'position', new.position, 'is_private', new.is_private)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_domains_update AFTER UPDATE ON domains WHEN old.rowid IS NOT new.rowid OR old.id IS NOT new.id OR old.title IS NOT new.title OR old.description IS NOT new.description OR old.subtype IS NOT new.subtype OR old.parent_id IS NOT new.parent_id OR old.color IS NOT new.color OR old.status IS NOT new.status OR old.knowledge_base_directory IS NOT new.knowledge_base_directory OR old.position IS NOT new.position OR old.is_private IS NOT new.is_private BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'domains', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'domains', new.rowid, 'set', json_object('id', new.id, 'title', new.title, 'description', new.description, 'subtype', new.subtype, 'parent_id', new.parent_id, 'color', new.color, 'status', new.status, 'knowledge_base_directory', new.knowledge_base_directory, 'position', new.position, 'is_private', new.is_private)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_domains_delete AFTER DELETE ON domains BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'domains', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_events_insert AFTER INSERT ON events BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'events', new.rowid, 'set', json_object('id', new.id, 'title', new.title, 'scope_id', new.scope_id, 'event_time', new.event_time, 'linked_note', new.linked_note)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_events_update AFTER UPDATE ON events WHEN old.rowid IS NOT new.rowid OR old.id IS NOT new.id OR old.title IS NOT new.title OR old.scope_id IS NOT new.scope_id OR old.event_time IS NOT new.event_time OR old.linked_note IS NOT new.linked_note BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'events', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'events', new.rowid, 'set', json_object('id', new.id, 'title', new.title, 'scope_id', new.scope_id, 'event_time', new.event_time, 'linked_note', new.linked_note)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_events_delete AFTER DELETE ON events BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'events', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_expectation_overlays_insert AFTER INSERT ON expectation_overlays BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'expectation_overlays', new.rowid, 'set', json_object('node_key', new.node_key, 'flow_id', new.flow_id, 'occurrence_key', new.occurrence_key, 'title', new.title, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'time_scope_set', new.time_scope_set, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind, 'check_every_set', new.check_every_set, 'check_starting', new.check_starting, 'is_private', new.is_private, 'archival', new.archival, 'agentic', new.agentic, 'agentic_note', new.agentic_note, 'agentic_note_set', new.agentic_note_set, 'agentic_question', new.agentic_question, 'agentic_answer', new.agentic_answer, 'agentic_answer_set', new.agentic_answer_set, 'status', new.status, 'released_at', new.released_at)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_expectation_overlays_update AFTER UPDATE ON expectation_overlays WHEN old.rowid IS NOT new.rowid OR old.node_key IS NOT new.node_key OR old.flow_id IS NOT new.flow_id OR old.occurrence_key IS NOT new.occurrence_key OR old.title IS NOT new.title OR old.time_scope_start_id IS NOT new.time_scope_start_id OR old.time_scope_end_id IS NOT new.time_scope_end_id OR old.time_scope_duration_n IS NOT new.time_scope_duration_n OR old.time_scope_duration_kind IS NOT new.time_scope_duration_kind OR old.time_scope_set IS NOT new.time_scope_set OR old.check_every_n IS NOT new.check_every_n OR old.check_every_kind IS NOT new.check_every_kind OR old.check_every_set IS NOT new.check_every_set OR old.check_starting IS NOT new.check_starting OR old.is_private IS NOT new.is_private OR old.archival IS NOT new.archival OR old.agentic IS NOT new.agentic OR old.agentic_note IS NOT new.agentic_note OR old.agentic_note_set IS NOT new.agentic_note_set OR old.agentic_question IS NOT new.agentic_question OR old.agentic_answer IS NOT new.agentic_answer OR old.agentic_answer_set IS NOT new.agentic_answer_set OR old.status IS NOT new.status OR old.released_at IS NOT new.released_at BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'expectation_overlays', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'expectation_overlays', new.rowid, 'set', json_object('node_key', new.node_key, 'flow_id', new.flow_id, 'occurrence_key', new.occurrence_key, 'title', new.title, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'time_scope_set', new.time_scope_set, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind, 'check_every_set', new.check_every_set, 'check_starting', new.check_starting, 'is_private', new.is_private, 'archival', new.archival, 'agentic', new.agentic, 'agentic_note', new.agentic_note, 'agentic_note_set', new.agentic_note_set, 'agentic_question', new.agentic_question, 'agentic_answer', new.agentic_answer, 'agentic_answer_set', new.agentic_answer_set, 'status', new.status, 'released_at', new.released_at)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_expectation_overlays_delete AFTER DELETE ON expectation_overlays BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'expectation_overlays', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_expectations_insert AFTER INSERT ON expectations BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'expectations', new.rowid, 'set', json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'status', new.status, 'archival', new.archival, 'position', new.position, 'is_private', new.is_private, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind, 'check_starting', new.check_starting, 'last_check_at', new.last_check_at, 'agentic', new.agentic, 'agentic_note', new.agentic_note, 'agentic_question', new.agentic_question, 'agentic_answer', new.agentic_answer, 'released_at', new.released_at, 'agentic_review', new.agentic_review, 'agentic_verdict', new.agentic_verdict)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_expectations_update AFTER UPDATE ON expectations WHEN old.rowid IS NOT new.rowid OR old.id IS NOT new.id OR old.title IS NOT new.title OR old.parent_type IS NOT new.parent_type OR old.parent_id IS NOT new.parent_id OR old.status IS NOT new.status OR old.archival IS NOT new.archival OR old.position IS NOT new.position OR old.is_private IS NOT new.is_private OR old.time_scope_start_id IS NOT new.time_scope_start_id OR old.time_scope_end_id IS NOT new.time_scope_end_id OR old.time_scope_duration_n IS NOT new.time_scope_duration_n OR old.time_scope_duration_kind IS NOT new.time_scope_duration_kind OR old.check_every_n IS NOT new.check_every_n OR old.check_every_kind IS NOT new.check_every_kind OR old.check_starting IS NOT new.check_starting OR old.last_check_at IS NOT new.last_check_at OR old.agentic IS NOT new.agentic OR old.agentic_note IS NOT new.agentic_note OR old.agentic_question IS NOT new.agentic_question OR old.agentic_answer IS NOT new.agentic_answer OR old.released_at IS NOT new.released_at OR old.agentic_review IS NOT new.agentic_review OR old.agentic_verdict IS NOT new.agentic_verdict BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'expectations', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'expectations', new.rowid, 'set', json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'status', new.status, 'archival', new.archival, 'position', new.position, 'is_private', new.is_private, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind, 'check_starting', new.check_starting, 'last_check_at', new.last_check_at, 'agentic', new.agentic, 'agentic_note', new.agentic_note, 'agentic_question', new.agentic_question, 'agentic_answer', new.agentic_answer, 'released_at', new.released_at, 'agentic_review', new.agentic_review, 'agentic_verdict', new.agentic_verdict)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_expectations_delete AFTER DELETE ON expectations BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'expectations', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_flow_async_templates_insert AFTER INSERT ON flow_async_templates BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_async_templates', new.rowid, 'set', json_object('flow_id', new.flow_id, 'title', new.title, 'time_scope_n', new.time_scope_n, 'time_scope_kind', new.time_scope_kind, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_flow_async_templates_update AFTER UPDATE ON flow_async_templates WHEN old.rowid IS NOT new.rowid OR old.flow_id IS NOT new.flow_id OR old.title IS NOT new.title OR old.time_scope_n IS NOT new.time_scope_n OR old.time_scope_kind IS NOT new.time_scope_kind OR old.check_every_n IS NOT new.check_every_n OR old.check_every_kind IS NOT new.check_every_kind BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_async_templates', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_async_templates', new.rowid, 'set', json_object('flow_id', new.flow_id, 'title', new.title, 'time_scope_n', new.time_scope_n, 'time_scope_kind', new.time_scope_kind, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_flow_async_templates_delete AFTER DELETE ON flow_async_templates BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_async_templates', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_flow_commitments_insert AFTER INSERT ON flow_commitments BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_commitments', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'is_private', new.is_private, 'verdict_window_n', new.verdict_window_n, 'verdict_window_kind', new.verdict_window_kind)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_flow_commitments_update AFTER UPDATE ON flow_commitments WHEN old.rowid IS NOT new.rowid OR old.id IS NOT new.id OR old.flow_id IS NOT new.flow_id OR old.title IS NOT new.title OR old.parent_type IS NOT new.parent_type OR old.parent_id IS NOT new.parent_id OR old.position IS NOT new.position OR old.is_private IS NOT new.is_private OR old.verdict_window_n IS NOT new.verdict_window_n OR old.verdict_window_kind IS NOT new.verdict_window_kind BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_commitments', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_commitments', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'is_private', new.is_private, 'verdict_window_n', new.verdict_window_n, 'verdict_window_kind', new.verdict_window_kind)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_flow_commitments_delete AFTER DELETE ON flow_commitments BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_commitments', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_flow_dependencies_insert AFTER INSERT ON flow_dependencies BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_dependencies', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'dependent_type', new.dependent_type, 'dependent_id', new.dependent_id, 'depends_on_type', new.depends_on_type, 'depends_on_id', new.depends_on_id)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_flow_dependencies_update AFTER UPDATE ON flow_dependencies WHEN old.rowid IS NOT new.rowid OR old.id IS NOT new.id OR old.flow_id IS NOT new.flow_id OR old.dependent_type IS NOT new.dependent_type OR old.dependent_id IS NOT new.dependent_id OR old.depends_on_type IS NOT new.depends_on_type OR old.depends_on_id IS NOT new.depends_on_id BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_dependencies', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_dependencies', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'dependent_type', new.dependent_type, 'dependent_id', new.dependent_id, 'depends_on_type', new.depends_on_type, 'depends_on_id', new.depends_on_id)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_flow_dependencies_delete AFTER DELETE ON flow_dependencies BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_dependencies', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_flow_expectations_insert AFTER INSERT ON flow_expectations BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_expectations', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'is_private', new.is_private, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind, 'first_check_kind', new.first_check_kind, 'first_check_index', new.first_check_index)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_flow_expectations_update AFTER UPDATE ON flow_expectations WHEN old.rowid IS NOT new.rowid OR old.id IS NOT new.id OR old.flow_id IS NOT new.flow_id OR old.title IS NOT new.title OR old.parent_type IS NOT new.parent_type OR old.parent_id IS NOT new.parent_id OR old.position IS NOT new.position OR old.is_private IS NOT new.is_private OR old.check_every_n IS NOT new.check_every_n OR old.check_every_kind IS NOT new.check_every_kind OR old.first_check_kind IS NOT new.first_check_kind OR old.first_check_index IS NOT new.first_check_index BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_expectations', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_expectations', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'is_private', new.is_private, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind, 'first_check_kind', new.first_check_kind, 'first_check_index', new.first_check_index)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_flow_expectations_delete AFTER DELETE ON flow_expectations BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_expectations', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_flow_goals_insert AFTER INSERT ON flow_goals BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_goals', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'is_private', new.is_private)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_flow_goals_update AFTER UPDATE ON flow_goals WHEN old.rowid IS NOT new.rowid OR old.id IS NOT new.id OR old.flow_id IS NOT new.flow_id OR old.title IS NOT new.title OR old.parent_type IS NOT new.parent_type OR old.parent_id IS NOT new.parent_id OR old.position IS NOT new.position OR old.is_private IS NOT new.is_private BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_goals', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_goals', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'is_private', new.is_private)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_flow_goals_delete AFTER DELETE ON flow_goals BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_goals', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_flow_instance_nodes_insert AFTER INSERT ON flow_instance_nodes BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_instance_nodes', new.rowid, 'set', json_object('id', new.id, 'flow_instance_id', new.flow_instance_id, 'node_type', new.node_type, 'node_id', new.node_id, 'source_item_type', new.source_item_type, 'source_item_id', new.source_item_id, 'original_parent_type', new.original_parent_type, 'original_parent_id', new.original_parent_id)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_flow_instance_nodes_update AFTER UPDATE ON flow_instance_nodes WHEN old.rowid IS NOT new.rowid OR old.id IS NOT new.id OR old.flow_instance_id IS NOT new.flow_instance_id OR old.node_type IS NOT new.node_type OR old.node_id IS NOT new.node_id OR old.source_item_type IS NOT new.source_item_type OR old.source_item_id IS NOT new.source_item_id OR old.original_parent_type IS NOT new.original_parent_type OR old.original_parent_id IS NOT new.original_parent_id BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_instance_nodes', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_instance_nodes', new.rowid, 'set', json_object('id', new.id, 'flow_instance_id', new.flow_instance_id, 'node_type', new.node_type, 'node_id', new.node_id, 'source_item_type', new.source_item_type, 'source_item_id', new.source_item_id, 'original_parent_type', new.original_parent_type, 'original_parent_id', new.original_parent_id)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_flow_instance_nodes_delete AFTER DELETE ON flow_instance_nodes BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_instance_nodes', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_flow_instances_insert AFTER INSERT ON flow_instances BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_instances', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'root_type', new.root_type, 'root_id', new.root_id, 'started_at', new.started_at)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_flow_instances_update AFTER UPDATE ON flow_instances WHEN old.rowid IS NOT new.rowid OR old.id IS NOT new.id OR old.flow_id IS NOT new.flow_id OR old.root_type IS NOT new.root_type OR old.root_id IS NOT new.root_id OR old.started_at IS NOT new.started_at BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_instances', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_instances', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'root_type', new.root_type, 'root_id', new.root_id, 'started_at', new.started_at)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_flow_instances_delete AFTER DELETE ON flow_instances BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_instances', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_flow_item_cycles_insert AFTER INSERT ON flow_item_cycles BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_item_cycles', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'item_type', new.item_type, 'item_id', new.item_id, 'scope_kind', new.scope_kind, 'scope_index', new.scope_index, 'plan_kind', new.plan_kind, 'plan_start', new.plan_start, 'plan_end', new.plan_end, 'position', new.position)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_flow_item_cycles_update AFTER UPDATE ON flow_item_cycles WHEN old.rowid IS NOT new.rowid OR old.id IS NOT new.id OR old.flow_id IS NOT new.flow_id OR old.item_type IS NOT new.item_type OR old.item_id IS NOT new.item_id OR old.scope_kind IS NOT new.scope_kind OR old.scope_index IS NOT new.scope_index OR old.plan_kind IS NOT new.plan_kind OR old.plan_start IS NOT new.plan_start OR old.plan_end IS NOT new.plan_end OR old.position IS NOT new.position BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_item_cycles', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_item_cycles', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'item_type', new.item_type, 'item_id', new.item_id, 'scope_kind', new.scope_kind, 'scope_index', new.scope_index, 'plan_kind', new.plan_kind, 'plan_start', new.plan_start, 'plan_end', new.plan_end, 'position', new.position)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_flow_item_cycles_delete AFTER DELETE ON flow_item_cycles BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_item_cycles', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_flow_recurrences_insert AFTER INSERT ON flow_recurrences BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_recurrences', new.rowid, 'set', json_object('flow_id', new.flow_id, 'start_scope_id', new.start_scope_id, 'gap_n', new.gap_n, 'gap_kind', new.gap_kind, 'end_scope_id', new.end_scope_id, 'clock', new.clock, 'miss_policy', new.miss_policy, 'cooldown_n', new.cooldown_n, 'cooldown_kind', new.cooldown_kind)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_flow_recurrences_update AFTER UPDATE ON flow_recurrences WHEN old.rowid IS NOT new.rowid OR old.flow_id IS NOT new.flow_id OR old.start_scope_id IS NOT new.start_scope_id OR old.gap_n IS NOT new.gap_n OR old.gap_kind IS NOT new.gap_kind OR old.end_scope_id IS NOT new.end_scope_id OR old.clock IS NOT new.clock OR old.miss_policy IS NOT new.miss_policy OR old.cooldown_n IS NOT new.cooldown_n OR old.cooldown_kind IS NOT new.cooldown_kind BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_recurrences', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_recurrences', new.rowid, 'set', json_object('flow_id', new.flow_id, 'start_scope_id', new.start_scope_id, 'gap_n', new.gap_n, 'gap_kind', new.gap_kind, 'end_scope_id', new.end_scope_id, 'clock', new.clock, 'miss_policy', new.miss_policy, 'cooldown_n', new.cooldown_n, 'cooldown_kind', new.cooldown_kind)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_flow_recurrences_delete AFTER DELETE ON flow_recurrences BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_recurrences', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_flow_task_async_templates_insert AFTER INSERT ON flow_task_async_templates BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_task_async_templates', new.rowid, 'set', json_object('flow_task_id', new.flow_task_id, 'title', new.title, 'time_scope_n', new.time_scope_n, 'time_scope_kind', new.time_scope_kind, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_flow_task_async_templates_update AFTER UPDATE ON flow_task_async_templates WHEN old.rowid IS NOT new.rowid OR old.flow_task_id IS NOT new.flow_task_id OR old.title IS NOT new.title OR old.time_scope_n IS NOT new.time_scope_n OR old.time_scope_kind IS NOT new.time_scope_kind OR old.check_every_n IS NOT new.check_every_n OR old.check_every_kind IS NOT new.check_every_kind BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_task_async_templates', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_task_async_templates', new.rowid, 'set', json_object('flow_task_id', new.flow_task_id, 'title', new.title, 'time_scope_n', new.time_scope_n, 'time_scope_kind', new.time_scope_kind, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_flow_task_async_templates_delete AFTER DELETE ON flow_task_async_templates BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_task_async_templates', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_flow_tasks_insert AFTER INSERT ON flow_tasks BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_tasks', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'is_private', new.is_private, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'agentic', new.agentic, 'asynchronous', new.asynchronous, 'archival', new.archival, 'compound', new.compound)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_flow_tasks_update AFTER UPDATE ON flow_tasks WHEN old.rowid IS NOT new.rowid OR old.id IS NOT new.id OR old.flow_id IS NOT new.flow_id OR old.title IS NOT new.title OR old.parent_type IS NOT new.parent_type OR old.parent_id IS NOT new.parent_id OR old.position IS NOT new.position OR old.is_private IS NOT new.is_private OR old.delegate_kind IS NOT new.delegate_kind OR old.delegate_id IS NOT new.delegate_id OR old.agentic IS NOT new.agentic OR old.asynchronous IS NOT new.asynchronous OR old.archival IS NOT new.archival OR old.compound IS NOT new.compound BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_tasks', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_tasks', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'is_private', new.is_private, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'agentic', new.agentic, 'asynchronous', new.asynchronous, 'archival', new.archival, 'compound', new.compound)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_flow_tasks_delete AFTER DELETE ON flow_tasks BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_tasks', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_flows_insert AFTER INSERT ON flows BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flows', new.rowid, 'set', json_object('id', new.id, 'title', new.title, 'instance_type', new.instance_type, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'target_type', new.target_type, 'target_id', new.target_id, 'flow_duration_n', new.flow_duration_n, 'flow_duration_kind', new.flow_duration_kind, 'position', new.position, 'flow_window_part', new.flow_window_part, 'flow_window_time_start', new.flow_window_time_start, 'flow_window_time_end', new.flow_window_time_end, 'root_plan_kind', new.root_plan_kind, 'root_plan_start', new.root_plan_start, 'root_plan_end', new.root_plan_end, 'is_private', new.is_private, 'verdict_window_n', new.verdict_window_n, 'verdict_window_kind', new.verdict_window_kind, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'agentic', new.agentic, 'asynchronous', new.asynchronous, 'archival', new.archival, 'compound', new.compound)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_flows_update AFTER UPDATE ON flows WHEN old.rowid IS NOT new.rowid OR old.id IS NOT new.id OR old.title IS NOT new.title OR old.instance_type IS NOT new.instance_type OR old.parent_type IS NOT new.parent_type OR old.parent_id IS NOT new.parent_id OR old.target_type IS NOT new.target_type OR old.target_id IS NOT new.target_id OR old.flow_duration_n IS NOT new.flow_duration_n OR old.flow_duration_kind IS NOT new.flow_duration_kind OR old.position IS NOT new.position OR old.flow_window_part IS NOT new.flow_window_part OR old.flow_window_time_start IS NOT new.flow_window_time_start OR old.flow_window_time_end IS NOT new.flow_window_time_end OR old.root_plan_kind IS NOT new.root_plan_kind OR old.root_plan_start IS NOT new.root_plan_start OR old.root_plan_end IS NOT new.root_plan_end OR old.is_private IS NOT new.is_private OR old.verdict_window_n IS NOT new.verdict_window_n OR old.verdict_window_kind IS NOT new.verdict_window_kind OR old.delegate_kind IS NOT new.delegate_kind OR old.delegate_id IS NOT new.delegate_id OR old.agentic IS NOT new.agentic OR old.asynchronous IS NOT new.asynchronous OR old.archival IS NOT new.archival OR old.compound IS NOT new.compound BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flows', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flows', new.rowid, 'set', json_object('id', new.id, 'title', new.title, 'instance_type', new.instance_type, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'target_type', new.target_type, 'target_id', new.target_id, 'flow_duration_n', new.flow_duration_n, 'flow_duration_kind', new.flow_duration_kind, 'position', new.position, 'flow_window_part', new.flow_window_part, 'flow_window_time_start', new.flow_window_time_start, 'flow_window_time_end', new.flow_window_time_end, 'root_plan_kind', new.root_plan_kind, 'root_plan_start', new.root_plan_start, 'root_plan_end', new.root_plan_end, 'is_private', new.is_private, 'verdict_window_n', new.verdict_window_n, 'verdict_window_kind', new.verdict_window_kind, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'agentic', new.agentic, 'asynchronous', new.asynchronous, 'archival', new.archival, 'compound', new.compound)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_flows_delete AFTER DELETE ON flows BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flows', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_goal_knowledge_base_links_insert AFTER INSERT ON goal_knowledge_base_links BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'goal_knowledge_base_links', new.rowid, 'set', json_object('goal_id', new.goal_id, 'entity_type', new.entity_type, 'entity_id', new.entity_id)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_goal_knowledge_base_links_update AFTER UPDATE ON goal_knowledge_base_links WHEN old.rowid IS NOT new.rowid OR old.goal_id IS NOT new.goal_id OR old.entity_type IS NOT new.entity_type OR old.entity_id IS NOT new.entity_id BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'goal_knowledge_base_links', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'goal_knowledge_base_links', new.rowid, 'set', json_object('goal_id', new.goal_id, 'entity_type', new.entity_type, 'entity_id', new.entity_id)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_goal_knowledge_base_links_delete AFTER DELETE ON goal_knowledge_base_links BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'goal_knowledge_base_links', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_goal_overlays_insert AFTER INSERT ON goal_overlays BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'goal_overlays', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'item_type', new.item_type, 'item_id', new.item_id, 'iteration_scope', new.iteration_scope, 'cycle_id', new.cycle_id, 'status', new.status, 'resolved_at', new.resolved_at, 'tombstone', new.tombstone, 'title', new.title, 'is_private', new.is_private, 'position', new.position, 'block_reasons_set', new.block_reasons_set)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_goal_overlays_update AFTER UPDATE ON goal_overlays WHEN old.rowid IS NOT new.rowid OR old.id IS NOT new.id OR old.flow_id IS NOT new.flow_id OR old.item_type IS NOT new.item_type OR old.item_id IS NOT new.item_id OR old.iteration_scope IS NOT new.iteration_scope OR old.cycle_id IS NOT new.cycle_id OR old.status IS NOT new.status OR old.resolved_at IS NOT new.resolved_at OR old.tombstone IS NOT new.tombstone OR old.title IS NOT new.title OR old.is_private IS NOT new.is_private OR old.position IS NOT new.position OR old.block_reasons_set IS NOT new.block_reasons_set BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'goal_overlays', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'goal_overlays', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'item_type', new.item_type, 'item_id', new.item_id, 'iteration_scope', new.iteration_scope, 'cycle_id', new.cycle_id, 'status', new.status, 'resolved_at', new.resolved_at, 'tombstone', new.tombstone, 'title', new.title, 'is_private', new.is_private, 'position', new.position, 'block_reasons_set', new.block_reasons_set)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_goal_overlays_delete AFTER DELETE ON goal_overlays BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'goal_overlays', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_goals_insert AFTER INSERT ON goals BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'goals', new.rowid, 'set', json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'status', new.status, 'position', new.position, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'on_scope_exit', new.on_scope_exit, 'is_private', new.is_private, 'achieved_at', new.achieved_at)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_goals_update AFTER UPDATE ON goals WHEN old.rowid IS NOT new.rowid OR old.id IS NOT new.id OR old.title IS NOT new.title OR old.parent_type IS NOT new.parent_type OR old.parent_id IS NOT new.parent_id OR old.status IS NOT new.status OR old.position IS NOT new.position OR old.time_scope_start_id IS NOT new.time_scope_start_id OR old.time_scope_end_id IS NOT new.time_scope_end_id OR old.time_scope_duration_n IS NOT new.time_scope_duration_n OR old.time_scope_duration_kind IS NOT new.time_scope_duration_kind OR old.on_scope_exit IS NOT new.on_scope_exit OR old.is_private IS NOT new.is_private OR old.achieved_at IS NOT new.achieved_at BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'goals', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'goals', new.rowid, 'set', json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'status', new.status, 'position', new.position, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'on_scope_exit', new.on_scope_exit, 'is_private', new.is_private, 'achieved_at', new.achieved_at)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_goals_delete AFTER DELETE ON goals BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'goals', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_infos_insert AFTER INSERT ON infos BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'infos', new.rowid, 'set', json_object('id', new.id, 'body', new.body, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'created_at', new.created_at, 'updated_at', new.updated_at, 'details', new.details, 'is_private', new.is_private)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_infos_update AFTER UPDATE ON infos WHEN old.rowid IS NOT new.rowid OR old.id IS NOT new.id OR old.body IS NOT new.body OR old.parent_type IS NOT new.parent_type OR old.parent_id IS NOT new.parent_id OR old.position IS NOT new.position OR old.created_at IS NOT new.created_at OR old.updated_at IS NOT new.updated_at OR old.details IS NOT new.details OR old.is_private IS NOT new.is_private BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'infos', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'infos', new.rowid, 'set', json_object('id', new.id, 'body', new.body, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'created_at', new.created_at, 'updated_at', new.updated_at, 'details', new.details, 'is_private', new.is_private)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_infos_delete AFTER DELETE ON infos BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'infos', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_mcp_roots_insert AFTER INSERT ON mcp_roots BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'mcp_roots', new.rowid, 'set', json_object('id', new.id, 'node_kind', new.node_kind, 'node_id', new.node_id)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_mcp_roots_update AFTER UPDATE ON mcp_roots WHEN old.rowid IS NOT new.rowid OR old.id IS NOT new.id OR old.node_kind IS NOT new.node_kind OR old.node_id IS NOT new.node_id BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'mcp_roots', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'mcp_roots', new.rowid, 'set', json_object('id', new.id, 'node_kind', new.node_kind, 'node_id', new.node_id)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_mcp_roots_delete AFTER DELETE ON mcp_roots BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'mcp_roots', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_occurrence_async_templates_insert AFTER INSERT ON occurrence_async_templates BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'occurrence_async_templates', new.rowid, 'set', json_object('node_key', new.node_key, 'flow_id', new.flow_id, 'title', new.title, 'time_scope_n', new.time_scope_n, 'time_scope_kind', new.time_scope_kind, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_occurrence_async_templates_update AFTER UPDATE ON occurrence_async_templates WHEN old.rowid IS NOT new.rowid OR old.node_key IS NOT new.node_key OR old.flow_id IS NOT new.flow_id OR old.title IS NOT new.title OR old.time_scope_n IS NOT new.time_scope_n OR old.time_scope_kind IS NOT new.time_scope_kind OR old.check_every_n IS NOT new.check_every_n OR old.check_every_kind IS NOT new.check_every_kind BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'occurrence_async_templates', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'occurrence_async_templates', new.rowid, 'set', json_object('node_key', new.node_key, 'flow_id', new.flow_id, 'title', new.title, 'time_scope_n', new.time_scope_n, 'time_scope_kind', new.time_scope_kind, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_occurrence_async_templates_delete AFTER DELETE ON occurrence_async_templates BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'occurrence_async_templates', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_occurrence_spawned_waits_insert AFTER INSERT ON occurrence_spawned_waits BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'occurrence_spawned_waits', new.rowid, 'set', json_object('node_key', new.node_key, 'flow_id', new.flow_id, 'status', new.status, 'archival', new.archival, 'released_at', new.released_at)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_occurrence_spawned_waits_update AFTER UPDATE ON occurrence_spawned_waits WHEN old.rowid IS NOT new.rowid OR old.node_key IS NOT new.node_key OR old.flow_id IS NOT new.flow_id OR old.status IS NOT new.status OR old.archival IS NOT new.archival OR old.released_at IS NOT new.released_at BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'occurrence_spawned_waits', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'occurrence_spawned_waits', new.rowid, 'set', json_object('node_key', new.node_key, 'flow_id', new.flow_id, 'status', new.status, 'archival', new.archival, 'released_at', new.released_at)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_occurrence_spawned_waits_delete AFTER DELETE ON occurrence_spawned_waits BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'occurrence_spawned_waits', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_people_insert AFTER INSERT ON people BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'people', new.rowid, 'set', json_object('id', new.id, 'name', new.name, 'aliases', new.aliases, 'linked_note', new.linked_note)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_people_update AFTER UPDATE ON people WHEN old.rowid IS NOT new.rowid OR old.id IS NOT new.id OR old.name IS NOT new.name OR old.aliases IS NOT new.aliases OR old.linked_note IS NOT new.linked_note BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'people', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'people', new.rowid, 'set', json_object('id', new.id, 'name', new.name, 'aliases', new.aliases, 'linked_note', new.linked_note)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_people_delete AFTER DELETE ON people BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'people', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_retired_beads_ids_insert AFTER INSERT ON retired_beads_ids BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'retired_beads_ids', new.rowid, 'set', json_object('table_name', new.table_name, 'row_id', new.row_id, 'beads_id', new.beads_id)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_retired_beads_ids_update AFTER UPDATE ON retired_beads_ids WHEN old.rowid IS NOT new.rowid OR old.table_name IS NOT new.table_name OR old.row_id IS NOT new.row_id OR old.beads_id IS NOT new.beads_id BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'retired_beads_ids', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'retired_beads_ids', new.rowid, 'set', json_object('table_name', new.table_name, 'row_id', new.row_id, 'beads_id', new.beads_id)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_retired_beads_ids_delete AFTER DELETE ON retired_beads_ids BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'retired_beads_ids', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_spawned_waits_insert AFTER INSERT ON spawned_waits BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'spawned_waits', new.rowid, 'set', json_object('task_id', new.task_id, 'status', new.status, 'archival', new.archival, 'last_check_at', new.last_check_at, 'released_at', new.released_at)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_spawned_waits_update AFTER UPDATE ON spawned_waits WHEN old.rowid IS NOT new.rowid OR old.task_id IS NOT new.task_id OR old.status IS NOT new.status OR old.archival IS NOT new.archival OR old.last_check_at IS NOT new.last_check_at OR old.released_at IS NOT new.released_at BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'spawned_waits', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'spawned_waits', new.rowid, 'set', json_object('task_id', new.task_id, 'status', new.status, 'archival', new.archival, 'last_check_at', new.last_check_at, 'released_at', new.released_at)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_spawned_waits_delete AFTER DELETE ON spawned_waits BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'spawned_waits', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_tags_on_async_templates_insert AFTER INSERT ON tags_on_async_templates BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_async_templates', new.rowid, 'set', json_object('task_id', new.task_id, 'tag_id', new.tag_id)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_tags_on_async_templates_update AFTER UPDATE ON tags_on_async_templates WHEN old.rowid IS NOT new.rowid OR old.task_id IS NOT new.task_id OR old.tag_id IS NOT new.tag_id BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_async_templates', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_async_templates', new.rowid, 'set', json_object('task_id', new.task_id, 'tag_id', new.tag_id)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_tags_on_async_templates_delete AFTER DELETE ON tags_on_async_templates BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_async_templates', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_tags_on_commitments_insert AFTER INSERT ON tags_on_commitments BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_commitments', new.rowid, 'set', json_object('commitment_id', new.commitment_id, 'tag_id', new.tag_id)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_tags_on_commitments_update AFTER UPDATE ON tags_on_commitments WHEN old.rowid IS NOT new.rowid OR old.commitment_id IS NOT new.commitment_id OR old.tag_id IS NOT new.tag_id BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_commitments', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_commitments', new.rowid, 'set', json_object('commitment_id', new.commitment_id, 'tag_id', new.tag_id)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_tags_on_commitments_delete AFTER DELETE ON tags_on_commitments BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_commitments', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_tags_on_expectations_insert AFTER INSERT ON tags_on_expectations BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_expectations', new.rowid, 'set', json_object('expectation_id', new.expectation_id, 'tag_id', new.tag_id)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_tags_on_expectations_update AFTER UPDATE ON tags_on_expectations WHEN old.rowid IS NOT new.rowid OR old.expectation_id IS NOT new.expectation_id OR old.tag_id IS NOT new.tag_id BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_expectations', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_expectations', new.rowid, 'set', json_object('expectation_id', new.expectation_id, 'tag_id', new.tag_id)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_tags_on_expectations_delete AFTER DELETE ON tags_on_expectations BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_expectations', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_tags_on_flow_async_templates_insert AFTER INSERT ON tags_on_flow_async_templates BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_flow_async_templates', new.rowid, 'set', json_object('flow_id', new.flow_id, 'tag_id', new.tag_id)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_tags_on_flow_async_templates_update AFTER UPDATE ON tags_on_flow_async_templates WHEN old.rowid IS NOT new.rowid OR old.flow_id IS NOT new.flow_id OR old.tag_id IS NOT new.tag_id BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_flow_async_templates', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_flow_async_templates', new.rowid, 'set', json_object('flow_id', new.flow_id, 'tag_id', new.tag_id)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_tags_on_flow_async_templates_delete AFTER DELETE ON tags_on_flow_async_templates BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_flow_async_templates', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_tags_on_flow_task_async_templates_insert AFTER INSERT ON tags_on_flow_task_async_templates BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_flow_task_async_templates', new.rowid, 'set', json_object('flow_task_id', new.flow_task_id, 'tag_id', new.tag_id)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_tags_on_flow_task_async_templates_update AFTER UPDATE ON tags_on_flow_task_async_templates WHEN old.rowid IS NOT new.rowid OR old.flow_task_id IS NOT new.flow_task_id OR old.tag_id IS NOT new.tag_id BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_flow_task_async_templates', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_flow_task_async_templates', new.rowid, 'set', json_object('flow_task_id', new.flow_task_id, 'tag_id', new.tag_id)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_tags_on_flow_task_async_templates_delete AFTER DELETE ON tags_on_flow_task_async_templates BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_flow_task_async_templates', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_tags_on_goals_insert AFTER INSERT ON tags_on_goals BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_goals', new.rowid, 'set', json_object('goal_id', new.goal_id, 'tag_id', new.tag_id)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_tags_on_goals_update AFTER UPDATE ON tags_on_goals WHEN old.rowid IS NOT new.rowid OR old.goal_id IS NOT new.goal_id OR old.tag_id IS NOT new.tag_id BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_goals', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_goals', new.rowid, 'set', json_object('goal_id', new.goal_id, 'tag_id', new.tag_id)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_tags_on_goals_delete AFTER DELETE ON tags_on_goals BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_goals', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_tags_on_occurrence_async_templates_insert AFTER INSERT ON tags_on_occurrence_async_templates BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_occurrence_async_templates', new.rowid, 'set', json_object('node_key', new.node_key, 'tag_id', new.tag_id)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_tags_on_occurrence_async_templates_update AFTER UPDATE ON tags_on_occurrence_async_templates WHEN old.rowid IS NOT new.rowid OR old.node_key IS NOT new.node_key OR old.tag_id IS NOT new.tag_id BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_occurrence_async_templates', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_occurrence_async_templates', new.rowid, 'set', json_object('node_key', new.node_key, 'tag_id', new.tag_id)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_tags_on_occurrence_async_templates_delete AFTER DELETE ON tags_on_occurrence_async_templates BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_occurrence_async_templates', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_tags_on_tasks_insert AFTER INSERT ON tags_on_tasks BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_tasks', new.rowid, 'set', json_object('task_id', new.task_id, 'tag_id', new.tag_id)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_tags_on_tasks_update AFTER UPDATE ON tags_on_tasks WHEN old.rowid IS NOT new.rowid OR old.task_id IS NOT new.task_id OR old.tag_id IS NOT new.tag_id BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_tasks', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_tasks', new.rowid, 'set', json_object('task_id', new.task_id, 'tag_id', new.tag_id)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_tags_on_tasks_delete AFTER DELETE ON tags_on_tasks BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_tasks', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_task_agentic_briefs_insert AFTER INSERT ON task_agentic_briefs BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'task_agentic_briefs', new.rowid, 'set', json_object('task_id', new.task_id, 'priority', new.priority, 'spec', new.spec, 'design', new.design, 'acceptance', new.acceptance, 'notes', new.notes)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_task_agentic_briefs_update AFTER UPDATE ON task_agentic_briefs WHEN old.rowid IS NOT new.rowid OR old.task_id IS NOT new.task_id OR old.priority IS NOT new.priority OR old.spec IS NOT new.spec OR old.design IS NOT new.design OR old.acceptance IS NOT new.acceptance OR old.notes IS NOT new.notes BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'task_agentic_briefs', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'task_agentic_briefs', new.rowid, 'set', json_object('task_id', new.task_id, 'priority', new.priority, 'spec', new.spec, 'design', new.design, 'acceptance', new.acceptance, 'notes', new.notes)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_task_agentic_briefs_delete AFTER DELETE ON task_agentic_briefs BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'task_agentic_briefs', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_task_async_templates_insert AFTER INSERT ON task_async_templates BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'task_async_templates', new.rowid, 'set', json_object('task_id', new.task_id, 'title', new.title, 'time_scope_n', new.time_scope_n, 'time_scope_kind', new.time_scope_kind, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_task_async_templates_update AFTER UPDATE ON task_async_templates WHEN old.rowid IS NOT new.rowid OR old.task_id IS NOT new.task_id OR old.title IS NOT new.title OR old.time_scope_n IS NOT new.time_scope_n OR old.time_scope_kind IS NOT new.time_scope_kind OR old.check_every_n IS NOT new.check_every_n OR old.check_every_kind IS NOT new.check_every_kind BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'task_async_templates', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'task_async_templates', new.rowid, 'set', json_object('task_id', new.task_id, 'title', new.title, 'time_scope_n', new.time_scope_n, 'time_scope_kind', new.time_scope_kind, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_task_async_templates_delete AFTER DELETE ON task_async_templates BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'task_async_templates', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_task_dependencies_insert AFTER INSERT ON task_dependencies BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'task_dependencies', new.rowid, 'set', json_object('task_id', new.task_id, 'dependency_type', new.dependency_type, 'dependency_id', new.dependency_id)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_task_dependencies_update AFTER UPDATE ON task_dependencies WHEN old.rowid IS NOT new.rowid OR old.task_id IS NOT new.task_id OR old.dependency_type IS NOT new.dependency_type OR old.dependency_id IS NOT new.dependency_id BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'task_dependencies', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'task_dependencies', new.rowid, 'set', json_object('task_id', new.task_id, 'dependency_type', new.dependency_type, 'dependency_id', new.dependency_id)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_task_dependencies_delete AFTER DELETE ON task_dependencies BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'task_dependencies', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_task_knowledge_base_links_insert AFTER INSERT ON task_knowledge_base_links BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'task_knowledge_base_links', new.rowid, 'set', json_object('task_id', new.task_id, 'entity_type', new.entity_type, 'entity_id', new.entity_id)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_task_knowledge_base_links_update AFTER UPDATE ON task_knowledge_base_links WHEN old.rowid IS NOT new.rowid OR old.task_id IS NOT new.task_id OR old.entity_type IS NOT new.entity_type OR old.entity_id IS NOT new.entity_id BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'task_knowledge_base_links', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'task_knowledge_base_links', new.rowid, 'set', json_object('task_id', new.task_id, 'entity_type', new.entity_type, 'entity_id', new.entity_id)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_task_knowledge_base_links_delete AFTER DELETE ON task_knowledge_base_links BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'task_knowledge_base_links', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_task_overlays_insert AFTER INSERT ON task_overlays BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'task_overlays', new.rowid, 'set', json_object('id', new.id, 'origin', new.origin, 'flow_id', new.flow_id, 'item_type', new.item_type, 'item_id', new.item_id, 'iteration_scope', new.iteration_scope, 'cycle_id', new.cycle_id, 'wait_key', new.wait_key, 'due_at', new.due_at, 'status', new.status, 'resolved_at', new.resolved_at, 'tombstone', new.tombstone, 'title', new.title, 'plan_start_id', new.plan_start_id, 'plan_end_id', new.plan_end_id, 'plan_set', new.plan_set, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'delegate_set', new.delegate_set, 'agentic', new.agentic, 'agentic_set', new.agentic_set, 'asynchronous', new.asynchronous, 'archival', new.archival, 'is_private', new.is_private, 'position', new.position, 'block_reasons_set', new.block_reasons_set, 'brief_priority', new.brief_priority, 'brief_priority_set', new.brief_priority_set, 'brief_spec', new.brief_spec, 'brief_design', new.brief_design, 'brief_acceptance', new.brief_acceptance, 'brief_notes', new.brief_notes, 'due_scope_start_id', new.due_scope_start_id, 'due_scope_end_id', new.due_scope_end_id, 'compound', new.compound, 'async_template_set', new.async_template_set)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_task_overlays_update AFTER UPDATE ON task_overlays WHEN old.rowid IS NOT new.rowid OR old.id IS NOT new.id OR old.origin IS NOT new.origin OR old.flow_id IS NOT new.flow_id OR old.item_type IS NOT new.item_type OR old.item_id IS NOT new.item_id OR old.iteration_scope IS NOT new.iteration_scope OR old.cycle_id IS NOT new.cycle_id OR old.wait_key IS NOT new.wait_key OR old.due_at IS NOT new.due_at OR old.status IS NOT new.status OR old.resolved_at IS NOT new.resolved_at OR old.tombstone IS NOT new.tombstone OR old.title IS NOT new.title OR old.plan_start_id IS NOT new.plan_start_id OR old.plan_end_id IS NOT new.plan_end_id OR old.plan_set IS NOT new.plan_set OR old.delegate_kind IS NOT new.delegate_kind OR old.delegate_id IS NOT new.delegate_id OR old.delegate_set IS NOT new.delegate_set OR old.agentic IS NOT new.agentic OR old.agentic_set IS NOT new.agentic_set OR old.asynchronous IS NOT new.asynchronous OR old.archival IS NOT new.archival OR old.is_private IS NOT new.is_private OR old.position IS NOT new.position OR old.block_reasons_set IS NOT new.block_reasons_set OR old.brief_priority IS NOT new.brief_priority OR old.brief_priority_set IS NOT new.brief_priority_set OR old.brief_spec IS NOT new.brief_spec OR old.brief_design IS NOT new.brief_design OR old.brief_acceptance IS NOT new.brief_acceptance OR old.brief_notes IS NOT new.brief_notes OR old.due_scope_start_id IS NOT new.due_scope_start_id OR old.due_scope_end_id IS NOT new.due_scope_end_id OR old.compound IS NOT new.compound OR old.async_template_set IS NOT new.async_template_set BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'task_overlays', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'task_overlays', new.rowid, 'set', json_object('id', new.id, 'origin', new.origin, 'flow_id', new.flow_id, 'item_type', new.item_type, 'item_id', new.item_id, 'iteration_scope', new.iteration_scope, 'cycle_id', new.cycle_id, 'wait_key', new.wait_key, 'due_at', new.due_at, 'status', new.status, 'resolved_at', new.resolved_at, 'tombstone', new.tombstone, 'title', new.title, 'plan_start_id', new.plan_start_id, 'plan_end_id', new.plan_end_id, 'plan_set', new.plan_set, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'delegate_set', new.delegate_set, 'agentic', new.agentic, 'agentic_set', new.agentic_set, 'asynchronous', new.asynchronous, 'archival', new.archival, 'is_private', new.is_private, 'position', new.position, 'block_reasons_set', new.block_reasons_set, 'brief_priority', new.brief_priority, 'brief_priority_set', new.brief_priority_set, 'brief_spec', new.brief_spec, 'brief_design', new.brief_design, 'brief_acceptance', new.brief_acceptance, 'brief_notes', new.brief_notes, 'due_scope_start_id', new.due_scope_start_id, 'due_scope_end_id', new.due_scope_end_id, 'compound', new.compound, 'async_template_set', new.async_template_set)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_task_overlays_delete AFTER DELETE ON task_overlays BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'task_overlays', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_tasks_insert AFTER INSERT ON tasks BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tasks', new.rowid, 'set', json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'status', new.status, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'position', new.position, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'plan_start_id', new.plan_start_id, 'plan_end_id', new.plan_end_id, 'on_scope_exit', new.on_scope_exit, 'is_private', new.is_private, 'archival', new.archival, 'agentic', new.agentic, 'asynchronous', new.asynchronous, 'done_at', new.done_at, 'due_scope_start_id', new.due_scope_start_id, 'due_scope_end_id', new.due_scope_end_id, 'compound', new.compound)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_tasks_update AFTER UPDATE ON tasks WHEN old.rowid IS NOT new.rowid OR old.id IS NOT new.id OR old.title IS NOT new.title OR old.parent_type IS NOT new.parent_type OR old.parent_id IS NOT new.parent_id OR old.status IS NOT new.status OR old.delegate_kind IS NOT new.delegate_kind OR old.delegate_id IS NOT new.delegate_id OR old.position IS NOT new.position OR old.time_scope_start_id IS NOT new.time_scope_start_id OR old.time_scope_end_id IS NOT new.time_scope_end_id OR old.time_scope_duration_n IS NOT new.time_scope_duration_n OR old.time_scope_duration_kind IS NOT new.time_scope_duration_kind OR old.plan_start_id IS NOT new.plan_start_id OR old.plan_end_id IS NOT new.plan_end_id OR old.on_scope_exit IS NOT new.on_scope_exit OR old.is_private IS NOT new.is_private OR old.archival IS NOT new.archival OR old.agentic IS NOT new.agentic OR old.asynchronous IS NOT new.asynchronous OR old.done_at IS NOT new.done_at OR old.due_scope_start_id IS NOT new.due_scope_start_id OR old.due_scope_end_id IS NOT new.due_scope_end_id OR old.compound IS NOT new.compound BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tasks', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tasks', new.rowid, 'set', json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'status', new.status, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'position', new.position, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'plan_start_id', new.plan_start_id, 'plan_end_id', new.plan_end_id, 'on_scope_exit', new.on_scope_exit, 'is_private', new.is_private, 'archival', new.archival, 'agentic', new.agentic, 'asynchronous', new.asynchronous, 'done_at', new.done_at, 'due_scope_start_id', new.due_scope_start_id, 'due_scope_end_id', new.due_scope_end_id, 'compound', new.compound)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_tasks_delete AFTER DELETE ON tasks BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tasks', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_template_agentic_briefs_insert AFTER INSERT ON template_agentic_briefs BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'template_agentic_briefs', new.rowid, 'set', json_object('id', new.id, 'item_type', new.item_type, 'item_id', new.item_id, 'priority', new.priority, 'spec', new.spec, 'design', new.design, 'acceptance', new.acceptance, 'notes', new.notes)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_template_agentic_briefs_update AFTER UPDATE ON template_agentic_briefs WHEN old.rowid IS NOT new.rowid OR old.id IS NOT new.id OR old.item_type IS NOT new.item_type OR old.item_id IS NOT new.item_id OR old.priority IS NOT new.priority OR old.spec IS NOT new.spec OR old.design IS NOT new.design OR old.acceptance IS NOT new.acceptance OR old.notes IS NOT new.notes BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'template_agentic_briefs', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'template_agentic_briefs', new.rowid, 'set', json_object('id', new.id, 'item_type', new.item_type, 'item_id', new.item_id, 'priority', new.priority, 'spec', new.spec, 'design', new.design, 'acceptance', new.acceptance, 'notes', new.notes)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_template_agentic_briefs_delete AFTER DELETE ON template_agentic_briefs BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'template_agentic_briefs', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_template_block_reasons_insert AFTER INSERT ON template_block_reasons BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'template_block_reasons', new.rowid, 'set', json_object('id', new.id, 'item_type', new.item_type, 'item_id', new.item_id, 'reason', new.reason, 'position', new.position)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_template_block_reasons_update AFTER UPDATE ON template_block_reasons WHEN old.rowid IS NOT new.rowid OR old.id IS NOT new.id OR old.item_type IS NOT new.item_type OR old.item_id IS NOT new.item_id OR old.reason IS NOT new.reason OR old.position IS NOT new.position BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'template_block_reasons', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'template_block_reasons', new.rowid, 'set', json_object('id', new.id, 'item_type', new.item_type, 'item_id', new.item_id, 'reason', new.reason, 'position', new.position)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_template_block_reasons_delete AFTER DELETE ON template_block_reasons BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'template_block_reasons', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_template_tags_insert AFTER INSERT ON template_tags BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'template_tags', new.rowid, 'set', json_object('id', new.id, 'item_type', new.item_type, 'item_id', new.item_id, 'tag_id', new.tag_id)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_template_tags_update AFTER UPDATE ON template_tags WHEN old.rowid IS NOT new.rowid OR old.id IS NOT new.id OR old.item_type IS NOT new.item_type OR old.item_id IS NOT new.item_id OR old.tag_id IS NOT new.tag_id BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'template_tags', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'template_tags', new.rowid, 'set', json_object('id', new.id, 'item_type', new.item_type, 'item_id', new.item_id, 'tag_id', new.tag_id)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_template_tags_delete AFTER DELETE ON template_tags BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'template_tags', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_threads_insert AFTER INSERT ON threads BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'threads', new.rowid, 'set', json_object('id', new.id, 'title', new.title, 'linked_note', new.linked_note)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_threads_update AFTER UPDATE ON threads WHEN old.rowid IS NOT new.rowid OR old.id IS NOT new.id OR old.title IS NOT new.title OR old.linked_note IS NOT new.linked_note BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'threads', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'threads', new.rowid, 'set', json_object('id', new.id, 'title', new.title, 'linked_note', new.linked_note)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_threads_delete AFTER DELETE ON threads BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'threads', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_wait_checks_insert AFTER INSERT ON wait_checks BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'wait_checks', new.rowid, 'set', json_object('id', new.id, 'wait_kind', new.wait_kind, 'wait_id', new.wait_id, 'wait_key', new.wait_key, 'due_at', new.due_at, 'resolved_at', new.resolved_at)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_wait_checks_update AFTER UPDATE ON wait_checks WHEN old.rowid IS NOT new.rowid OR old.id IS NOT new.id OR old.wait_kind IS NOT new.wait_kind OR old.wait_id IS NOT new.wait_id OR old.wait_key IS NOT new.wait_key OR old.due_at IS NOT new.due_at OR old.resolved_at IS NOT new.resolved_at BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'wait_checks', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER) AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'wait_checks', new.rowid, 'set', json_object('id', new.id, 'wait_kind', new.wait_kind, 'wait_id', new.wait_id, 'wait_key', new.wait_key, 'due_at', new.due_at, 'resolved_at', new.resolved_at)
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;

CREATE TRIGGER change_log_wait_checks_delete AFTER DELETE ON wait_checks BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'wait_checks', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND leased_until > CAST(strftime('%s', 'now') AS INTEGER);
END;
