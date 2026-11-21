-- The change log (ADR 0017, decision 5; Task ccc, PR 2): what a client's Replica hears from the
-- server, written by triggers so that no command has to remember to say what it changed.
--
-- Every replicated table (every table the undo journal covers, less the server-only ones: see
-- `arlesh_core::replication::UNREPLICATED_TABLES`) gets three triggers that report the row they
-- touched: `set` with the row's image after the change, or `del` for a row that is gone. They fire
-- for undo and redo too, which suppress the journal but are ordinary writes to these tables, and for
-- the rows a cascade removes. `agents.token_sha256` is left out of the image: a credential never
-- travels to a device.
--
-- The log is a **buffer, not a history**. It is written only while `change_capture.enabled` is 1, and
-- the one process that sets it (the server's board publisher) reads the log into each live event and
-- deletes what it read in the same transaction, so nothing accumulates; a restart clears it. Nothing
-- reads it for catch-up: a client that misses an event fetches a whole board
-- (docs/spec/client-mode.md, *Live sync*).
--
-- The triggers are generated: `scripts/generate-undo-triggers.sh change`. A new table needs its three
-- in a new migration, and `replication::tests` fails until it has them.

CREATE TABLE change_capture (
    id      INTEGER PRIMARY KEY CHECK (id = 1),
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1))
);
INSERT INTO change_capture (id, enabled) VALUES (1, 0);

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
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_agent_accounts_update AFTER UPDATE ON agent_accounts BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'agent_accounts', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'agent_accounts', new.rowid, 'set', json_object('label', new.label, 'locked', new.locked)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_agent_accounts_delete AFTER DELETE ON agent_accounts BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'agent_accounts', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_agents_insert AFTER INSERT ON agents BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'agents', new.rowid, 'set', json_object('id', new.id, 'name', new.name, 'account', new.account, 'session_uuid', new.session_uuid, 'claim_kind', new.claim_kind, 'claim_id', new.claim_id, 'claim_paused', new.claim_paused, 'claimed_at', new.claimed_at, 'locked', new.locked, 'created_at', new.created_at, 'last_seen_at', new.last_seen_at, 'parent_id', new.parent_id)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_agents_update AFTER UPDATE ON agents BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'agents', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'agents', new.rowid, 'set', json_object('id', new.id, 'name', new.name, 'account', new.account, 'session_uuid', new.session_uuid, 'claim_kind', new.claim_kind, 'claim_id', new.claim_id, 'claim_paused', new.claim_paused, 'claimed_at', new.claimed_at, 'locked', new.locked, 'created_at', new.created_at, 'last_seen_at', new.last_seen_at, 'parent_id', new.parent_id)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_agents_delete AFTER DELETE ON agents BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'agents', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_answer_drafts_insert AFTER INSERT ON answer_drafts BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'answer_drafts', new.rowid, 'set', json_object('wait_id', new.wait_id, 'answer', new.answer, 'verdict', new.verdict, 'saved_at', new.saved_at)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_answer_drafts_update AFTER UPDATE ON answer_drafts BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'answer_drafts', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'answer_drafts', new.rowid, 'set', json_object('wait_id', new.wait_id, 'answer', new.answer, 'verdict', new.verdict, 'saved_at', new.saved_at)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_answer_drafts_delete AFTER DELETE ON answer_drafts BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'answer_drafts', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_block_reasons_insert AFTER INSERT ON block_reasons BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'block_reasons', new.rowid, 'set', json_object('id', new.id, 'owner_type', new.owner_type, 'owner_id', new.owner_id, 'reason', new.reason, 'position', new.position, 'created_at', new.created_at)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_block_reasons_update AFTER UPDATE ON block_reasons BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'block_reasons', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'block_reasons', new.rowid, 'set', json_object('id', new.id, 'owner_type', new.owner_type, 'owner_id', new.owner_id, 'reason', new.reason, 'position', new.position, 'created_at', new.created_at)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_block_reasons_delete AFTER DELETE ON block_reasons BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'block_reasons', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_commitment_overlays_insert AFTER INSERT ON commitment_overlays BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'commitment_overlays', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'item_type', new.item_type, 'item_id', new.item_id, 'iteration_scope', new.iteration_scope, 'cycle_id', new.cycle_id, 'verdict', new.verdict, 'resolved_at', new.resolved_at, 'tombstone', new.tombstone, 'title', new.title, 'is_private', new.is_private, 'position', new.position)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_commitment_overlays_update AFTER UPDATE ON commitment_overlays BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'commitment_overlays', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'commitment_overlays', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'item_type', new.item_type, 'item_id', new.item_id, 'iteration_scope', new.iteration_scope, 'cycle_id', new.cycle_id, 'verdict', new.verdict, 'resolved_at', new.resolved_at, 'tombstone', new.tombstone, 'title', new.title, 'is_private', new.is_private, 'position', new.position)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_commitment_overlays_delete AFTER DELETE ON commitment_overlays BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'commitment_overlays', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_commitments_insert AFTER INSERT ON commitments BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'commitments', new.rowid, 'set', json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'verdict', new.verdict, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'verdict_window_n', new.verdict_window_n, 'verdict_window_kind', new.verdict_window_kind, 'position', new.position, 'is_private', new.is_private, 'verdict_at', new.verdict_at, 'archival', new.archival)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_commitments_update AFTER UPDATE ON commitments BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'commitments', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'commitments', new.rowid, 'set', json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'verdict', new.verdict, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'verdict_window_n', new.verdict_window_n, 'verdict_window_kind', new.verdict_window_kind, 'position', new.position, 'is_private', new.is_private, 'verdict_at', new.verdict_at, 'archival', new.archival)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_commitments_delete AFTER DELETE ON commitments BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'commitments', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_derived_block_reasons_insert AFTER INSERT ON derived_block_reasons BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'derived_block_reasons', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'node_kind', new.node_kind, 'node_key', new.node_key, 'reason', new.reason, 'position', new.position)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_derived_block_reasons_update AFTER UPDATE ON derived_block_reasons BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'derived_block_reasons', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'derived_block_reasons', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'node_kind', new.node_kind, 'node_key', new.node_key, 'reason', new.reason, 'position', new.position)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_derived_block_reasons_delete AFTER DELETE ON derived_block_reasons BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'derived_block_reasons', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_derived_children_insert AFTER INSERT ON derived_children BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'derived_children', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'parent_kind', new.parent_kind, 'parent_key', new.parent_key, 'window_start_scope_id', new.window_start_scope_id, 'window_end_scope_id', new.window_end_scope_id, 'child_type', new.child_type, 'child_id', new.child_id)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_derived_children_update AFTER UPDATE ON derived_children BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'derived_children', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'derived_children', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'parent_kind', new.parent_kind, 'parent_key', new.parent_key, 'window_start_scope_id', new.window_start_scope_id, 'window_end_scope_id', new.window_end_scope_id, 'child_type', new.child_type, 'child_id', new.child_id)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_derived_children_delete AFTER DELETE ON derived_children BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'derived_children', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_derived_dependencies_insert AFTER INSERT ON derived_dependencies BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'derived_dependencies', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'dependent_id', new.dependent_id, 'dependent_key', new.dependent_key, 'target_type', new.target_type, 'target_id', new.target_id, 'target_key', new.target_key, 'added', new.added)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_derived_dependencies_update AFTER UPDATE ON derived_dependencies BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'derived_dependencies', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'derived_dependencies', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'dependent_id', new.dependent_id, 'dependent_key', new.dependent_key, 'target_type', new.target_type, 'target_id', new.target_id, 'target_key', new.target_key, 'added', new.added)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_derived_dependencies_delete AFTER DELETE ON derived_dependencies BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'derived_dependencies', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_derived_tags_insert AFTER INSERT ON derived_tags BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'derived_tags', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'node_kind', new.node_kind, 'node_key', new.node_key, 'tag_id', new.tag_id, 'added', new.added)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_derived_tags_update AFTER UPDATE ON derived_tags BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'derived_tags', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'derived_tags', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'node_kind', new.node_kind, 'node_key', new.node_key, 'tag_id', new.tag_id, 'added', new.added)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_derived_tags_delete AFTER DELETE ON derived_tags BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'derived_tags', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_domains_insert AFTER INSERT ON domains BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'domains', new.rowid, 'set', json_object('id', new.id, 'title', new.title, 'description', new.description, 'subtype', new.subtype, 'parent_id', new.parent_id, 'color', new.color, 'status', new.status, 'knowledge_base_directory', new.knowledge_base_directory, 'position', new.position, 'is_private', new.is_private)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_domains_update AFTER UPDATE ON domains BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'domains', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'domains', new.rowid, 'set', json_object('id', new.id, 'title', new.title, 'description', new.description, 'subtype', new.subtype, 'parent_id', new.parent_id, 'color', new.color, 'status', new.status, 'knowledge_base_directory', new.knowledge_base_directory, 'position', new.position, 'is_private', new.is_private)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_domains_delete AFTER DELETE ON domains BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'domains', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_events_insert AFTER INSERT ON events BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'events', new.rowid, 'set', json_object('id', new.id, 'title', new.title, 'scope_id', new.scope_id, 'event_time', new.event_time, 'linked_note', new.linked_note)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_events_update AFTER UPDATE ON events BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'events', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'events', new.rowid, 'set', json_object('id', new.id, 'title', new.title, 'scope_id', new.scope_id, 'event_time', new.event_time, 'linked_note', new.linked_note)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_events_delete AFTER DELETE ON events BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'events', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_expectation_overlays_insert AFTER INSERT ON expectation_overlays BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'expectation_overlays', new.rowid, 'set', json_object('node_key', new.node_key, 'flow_id', new.flow_id, 'occurrence_key', new.occurrence_key, 'title', new.title, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'time_scope_set', new.time_scope_set, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind, 'check_every_set', new.check_every_set, 'check_starting', new.check_starting, 'is_private', new.is_private, 'archival', new.archival, 'agentic', new.agentic, 'agentic_note', new.agentic_note, 'agentic_note_set', new.agentic_note_set, 'agentic_question', new.agentic_question, 'agentic_answer', new.agentic_answer, 'agentic_answer_set', new.agentic_answer_set, 'status', new.status, 'released_at', new.released_at)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_expectation_overlays_update AFTER UPDATE ON expectation_overlays BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'expectation_overlays', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'expectation_overlays', new.rowid, 'set', json_object('node_key', new.node_key, 'flow_id', new.flow_id, 'occurrence_key', new.occurrence_key, 'title', new.title, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'time_scope_set', new.time_scope_set, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind, 'check_every_set', new.check_every_set, 'check_starting', new.check_starting, 'is_private', new.is_private, 'archival', new.archival, 'agentic', new.agentic, 'agentic_note', new.agentic_note, 'agentic_note_set', new.agentic_note_set, 'agentic_question', new.agentic_question, 'agentic_answer', new.agentic_answer, 'agentic_answer_set', new.agentic_answer_set, 'status', new.status, 'released_at', new.released_at)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_expectation_overlays_delete AFTER DELETE ON expectation_overlays BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'expectation_overlays', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_expectations_insert AFTER INSERT ON expectations BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'expectations', new.rowid, 'set', json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'status', new.status, 'archival', new.archival, 'position', new.position, 'is_private', new.is_private, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind, 'check_starting', new.check_starting, 'last_check_at', new.last_check_at, 'agentic', new.agentic, 'agentic_note', new.agentic_note, 'agentic_question', new.agentic_question, 'agentic_answer', new.agentic_answer, 'released_at', new.released_at, 'agentic_review', new.agentic_review, 'agentic_verdict', new.agentic_verdict)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_expectations_update AFTER UPDATE ON expectations BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'expectations', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'expectations', new.rowid, 'set', json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'status', new.status, 'archival', new.archival, 'position', new.position, 'is_private', new.is_private, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind, 'check_starting', new.check_starting, 'last_check_at', new.last_check_at, 'agentic', new.agentic, 'agentic_note', new.agentic_note, 'agentic_question', new.agentic_question, 'agentic_answer', new.agentic_answer, 'released_at', new.released_at, 'agentic_review', new.agentic_review, 'agentic_verdict', new.agentic_verdict)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_expectations_delete AFTER DELETE ON expectations BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'expectations', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_flow_async_templates_insert AFTER INSERT ON flow_async_templates BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_async_templates', new.rowid, 'set', json_object('flow_id', new.flow_id, 'title', new.title, 'time_scope_n', new.time_scope_n, 'time_scope_kind', new.time_scope_kind, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_flow_async_templates_update AFTER UPDATE ON flow_async_templates BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_async_templates', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_async_templates', new.rowid, 'set', json_object('flow_id', new.flow_id, 'title', new.title, 'time_scope_n', new.time_scope_n, 'time_scope_kind', new.time_scope_kind, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_flow_async_templates_delete AFTER DELETE ON flow_async_templates BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_async_templates', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_flow_commitments_insert AFTER INSERT ON flow_commitments BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_commitments', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'is_private', new.is_private, 'verdict_window_n', new.verdict_window_n, 'verdict_window_kind', new.verdict_window_kind)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_flow_commitments_update AFTER UPDATE ON flow_commitments BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_commitments', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_commitments', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'is_private', new.is_private, 'verdict_window_n', new.verdict_window_n, 'verdict_window_kind', new.verdict_window_kind)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_flow_commitments_delete AFTER DELETE ON flow_commitments BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_commitments', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_flow_dependencies_insert AFTER INSERT ON flow_dependencies BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_dependencies', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'dependent_type', new.dependent_type, 'dependent_id', new.dependent_id, 'depends_on_type', new.depends_on_type, 'depends_on_id', new.depends_on_id)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_flow_dependencies_update AFTER UPDATE ON flow_dependencies BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_dependencies', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_dependencies', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'dependent_type', new.dependent_type, 'dependent_id', new.dependent_id, 'depends_on_type', new.depends_on_type, 'depends_on_id', new.depends_on_id)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_flow_dependencies_delete AFTER DELETE ON flow_dependencies BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_dependencies', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_flow_expectations_insert AFTER INSERT ON flow_expectations BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_expectations', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'is_private', new.is_private, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind, 'first_check_kind', new.first_check_kind, 'first_check_index', new.first_check_index)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_flow_expectations_update AFTER UPDATE ON flow_expectations BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_expectations', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_expectations', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'is_private', new.is_private, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind, 'first_check_kind', new.first_check_kind, 'first_check_index', new.first_check_index)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_flow_expectations_delete AFTER DELETE ON flow_expectations BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_expectations', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_flow_goals_insert AFTER INSERT ON flow_goals BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_goals', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'is_private', new.is_private)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_flow_goals_update AFTER UPDATE ON flow_goals BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_goals', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_goals', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'is_private', new.is_private)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_flow_goals_delete AFTER DELETE ON flow_goals BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_goals', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_flow_instance_nodes_insert AFTER INSERT ON flow_instance_nodes BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_instance_nodes', new.rowid, 'set', json_object('id', new.id, 'flow_instance_id', new.flow_instance_id, 'node_type', new.node_type, 'node_id', new.node_id, 'source_item_type', new.source_item_type, 'source_item_id', new.source_item_id, 'original_parent_type', new.original_parent_type, 'original_parent_id', new.original_parent_id)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_flow_instance_nodes_update AFTER UPDATE ON flow_instance_nodes BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_instance_nodes', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_instance_nodes', new.rowid, 'set', json_object('id', new.id, 'flow_instance_id', new.flow_instance_id, 'node_type', new.node_type, 'node_id', new.node_id, 'source_item_type', new.source_item_type, 'source_item_id', new.source_item_id, 'original_parent_type', new.original_parent_type, 'original_parent_id', new.original_parent_id)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_flow_instance_nodes_delete AFTER DELETE ON flow_instance_nodes BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_instance_nodes', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_flow_instances_insert AFTER INSERT ON flow_instances BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_instances', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'root_type', new.root_type, 'root_id', new.root_id, 'started_at', new.started_at)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_flow_instances_update AFTER UPDATE ON flow_instances BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_instances', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_instances', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'root_type', new.root_type, 'root_id', new.root_id, 'started_at', new.started_at)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_flow_instances_delete AFTER DELETE ON flow_instances BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_instances', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_flow_item_cycles_insert AFTER INSERT ON flow_item_cycles BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_item_cycles', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'item_type', new.item_type, 'item_id', new.item_id, 'scope_kind', new.scope_kind, 'scope_index', new.scope_index, 'plan_kind', new.plan_kind, 'plan_start', new.plan_start, 'plan_end', new.plan_end, 'position', new.position)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_flow_item_cycles_update AFTER UPDATE ON flow_item_cycles BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_item_cycles', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_item_cycles', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'item_type', new.item_type, 'item_id', new.item_id, 'scope_kind', new.scope_kind, 'scope_index', new.scope_index, 'plan_kind', new.plan_kind, 'plan_start', new.plan_start, 'plan_end', new.plan_end, 'position', new.position)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_flow_item_cycles_delete AFTER DELETE ON flow_item_cycles BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_item_cycles', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_flow_recurrences_insert AFTER INSERT ON flow_recurrences BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_recurrences', new.rowid, 'set', json_object('flow_id', new.flow_id, 'start_scope_id', new.start_scope_id, 'gap_n', new.gap_n, 'gap_kind', new.gap_kind, 'end_scope_id', new.end_scope_id, 'clock', new.clock, 'miss_policy', new.miss_policy, 'cooldown_n', new.cooldown_n, 'cooldown_kind', new.cooldown_kind)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_flow_recurrences_update AFTER UPDATE ON flow_recurrences BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_recurrences', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_recurrences', new.rowid, 'set', json_object('flow_id', new.flow_id, 'start_scope_id', new.start_scope_id, 'gap_n', new.gap_n, 'gap_kind', new.gap_kind, 'end_scope_id', new.end_scope_id, 'clock', new.clock, 'miss_policy', new.miss_policy, 'cooldown_n', new.cooldown_n, 'cooldown_kind', new.cooldown_kind)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_flow_recurrences_delete AFTER DELETE ON flow_recurrences BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_recurrences', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_flow_task_async_templates_insert AFTER INSERT ON flow_task_async_templates BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_task_async_templates', new.rowid, 'set', json_object('flow_task_id', new.flow_task_id, 'title', new.title, 'time_scope_n', new.time_scope_n, 'time_scope_kind', new.time_scope_kind, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_flow_task_async_templates_update AFTER UPDATE ON flow_task_async_templates BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_task_async_templates', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_task_async_templates', new.rowid, 'set', json_object('flow_task_id', new.flow_task_id, 'title', new.title, 'time_scope_n', new.time_scope_n, 'time_scope_kind', new.time_scope_kind, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_flow_task_async_templates_delete AFTER DELETE ON flow_task_async_templates BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_task_async_templates', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_flow_tasks_insert AFTER INSERT ON flow_tasks BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_tasks', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'is_private', new.is_private, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'agentic', new.agentic, 'asynchronous', new.asynchronous, 'archival', new.archival, 'compound', new.compound)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_flow_tasks_update AFTER UPDATE ON flow_tasks BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_tasks', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_tasks', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'is_private', new.is_private, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'agentic', new.agentic, 'asynchronous', new.asynchronous, 'archival', new.archival, 'compound', new.compound)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_flow_tasks_delete AFTER DELETE ON flow_tasks BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flow_tasks', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_flows_insert AFTER INSERT ON flows BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flows', new.rowid, 'set', json_object('id', new.id, 'title', new.title, 'instance_type', new.instance_type, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'target_type', new.target_type, 'target_id', new.target_id, 'flow_duration_n', new.flow_duration_n, 'flow_duration_kind', new.flow_duration_kind, 'position', new.position, 'flow_window_part', new.flow_window_part, 'flow_window_time_start', new.flow_window_time_start, 'flow_window_time_end', new.flow_window_time_end, 'root_plan_kind', new.root_plan_kind, 'root_plan_start', new.root_plan_start, 'root_plan_end', new.root_plan_end, 'is_private', new.is_private, 'verdict_window_n', new.verdict_window_n, 'verdict_window_kind', new.verdict_window_kind, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'agentic', new.agentic, 'asynchronous', new.asynchronous, 'archival', new.archival, 'compound', new.compound)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_flows_update AFTER UPDATE ON flows BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flows', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flows', new.rowid, 'set', json_object('id', new.id, 'title', new.title, 'instance_type', new.instance_type, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'target_type', new.target_type, 'target_id', new.target_id, 'flow_duration_n', new.flow_duration_n, 'flow_duration_kind', new.flow_duration_kind, 'position', new.position, 'flow_window_part', new.flow_window_part, 'flow_window_time_start', new.flow_window_time_start, 'flow_window_time_end', new.flow_window_time_end, 'root_plan_kind', new.root_plan_kind, 'root_plan_start', new.root_plan_start, 'root_plan_end', new.root_plan_end, 'is_private', new.is_private, 'verdict_window_n', new.verdict_window_n, 'verdict_window_kind', new.verdict_window_kind, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'agentic', new.agentic, 'asynchronous', new.asynchronous, 'archival', new.archival, 'compound', new.compound)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_flows_delete AFTER DELETE ON flows BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'flows', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_goal_knowledge_base_links_insert AFTER INSERT ON goal_knowledge_base_links BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'goal_knowledge_base_links', new.rowid, 'set', json_object('goal_id', new.goal_id, 'entity_type', new.entity_type, 'entity_id', new.entity_id)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_goal_knowledge_base_links_update AFTER UPDATE ON goal_knowledge_base_links BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'goal_knowledge_base_links', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'goal_knowledge_base_links', new.rowid, 'set', json_object('goal_id', new.goal_id, 'entity_type', new.entity_type, 'entity_id', new.entity_id)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_goal_knowledge_base_links_delete AFTER DELETE ON goal_knowledge_base_links BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'goal_knowledge_base_links', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_goal_overlays_insert AFTER INSERT ON goal_overlays BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'goal_overlays', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'item_type', new.item_type, 'item_id', new.item_id, 'iteration_scope', new.iteration_scope, 'cycle_id', new.cycle_id, 'status', new.status, 'resolved_at', new.resolved_at, 'tombstone', new.tombstone, 'title', new.title, 'is_private', new.is_private, 'position', new.position, 'block_reasons_set', new.block_reasons_set)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_goal_overlays_update AFTER UPDATE ON goal_overlays BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'goal_overlays', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'goal_overlays', new.rowid, 'set', json_object('id', new.id, 'flow_id', new.flow_id, 'item_type', new.item_type, 'item_id', new.item_id, 'iteration_scope', new.iteration_scope, 'cycle_id', new.cycle_id, 'status', new.status, 'resolved_at', new.resolved_at, 'tombstone', new.tombstone, 'title', new.title, 'is_private', new.is_private, 'position', new.position, 'block_reasons_set', new.block_reasons_set)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_goal_overlays_delete AFTER DELETE ON goal_overlays BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'goal_overlays', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_goals_insert AFTER INSERT ON goals BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'goals', new.rowid, 'set', json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'status', new.status, 'position', new.position, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'on_scope_exit', new.on_scope_exit, 'is_private', new.is_private, 'achieved_at', new.achieved_at)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_goals_update AFTER UPDATE ON goals BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'goals', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'goals', new.rowid, 'set', json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'status', new.status, 'position', new.position, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'on_scope_exit', new.on_scope_exit, 'is_private', new.is_private, 'achieved_at', new.achieved_at)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_goals_delete AFTER DELETE ON goals BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'goals', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_infos_insert AFTER INSERT ON infos BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'infos', new.rowid, 'set', json_object('id', new.id, 'body', new.body, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'created_at', new.created_at, 'updated_at', new.updated_at, 'details', new.details, 'is_private', new.is_private)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_infos_update AFTER UPDATE ON infos BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'infos', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'infos', new.rowid, 'set', json_object('id', new.id, 'body', new.body, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'created_at', new.created_at, 'updated_at', new.updated_at, 'details', new.details, 'is_private', new.is_private)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_infos_delete AFTER DELETE ON infos BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'infos', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_mcp_roots_insert AFTER INSERT ON mcp_roots BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'mcp_roots', new.rowid, 'set', json_object('id', new.id, 'node_kind', new.node_kind, 'node_id', new.node_id)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_mcp_roots_update AFTER UPDATE ON mcp_roots BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'mcp_roots', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'mcp_roots', new.rowid, 'set', json_object('id', new.id, 'node_kind', new.node_kind, 'node_id', new.node_id)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_mcp_roots_delete AFTER DELETE ON mcp_roots BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'mcp_roots', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_occurrence_async_templates_insert AFTER INSERT ON occurrence_async_templates BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'occurrence_async_templates', new.rowid, 'set', json_object('node_key', new.node_key, 'flow_id', new.flow_id, 'title', new.title, 'time_scope_n', new.time_scope_n, 'time_scope_kind', new.time_scope_kind, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_occurrence_async_templates_update AFTER UPDATE ON occurrence_async_templates BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'occurrence_async_templates', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'occurrence_async_templates', new.rowid, 'set', json_object('node_key', new.node_key, 'flow_id', new.flow_id, 'title', new.title, 'time_scope_n', new.time_scope_n, 'time_scope_kind', new.time_scope_kind, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_occurrence_async_templates_delete AFTER DELETE ON occurrence_async_templates BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'occurrence_async_templates', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_occurrence_spawned_waits_insert AFTER INSERT ON occurrence_spawned_waits BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'occurrence_spawned_waits', new.rowid, 'set', json_object('node_key', new.node_key, 'flow_id', new.flow_id, 'status', new.status, 'archival', new.archival, 'released_at', new.released_at)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_occurrence_spawned_waits_update AFTER UPDATE ON occurrence_spawned_waits BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'occurrence_spawned_waits', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'occurrence_spawned_waits', new.rowid, 'set', json_object('node_key', new.node_key, 'flow_id', new.flow_id, 'status', new.status, 'archival', new.archival, 'released_at', new.released_at)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_occurrence_spawned_waits_delete AFTER DELETE ON occurrence_spawned_waits BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'occurrence_spawned_waits', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_people_insert AFTER INSERT ON people BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'people', new.rowid, 'set', json_object('id', new.id, 'name', new.name, 'aliases', new.aliases, 'linked_note', new.linked_note)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_people_update AFTER UPDATE ON people BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'people', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'people', new.rowid, 'set', json_object('id', new.id, 'name', new.name, 'aliases', new.aliases, 'linked_note', new.linked_note)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_people_delete AFTER DELETE ON people BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'people', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_retired_beads_ids_insert AFTER INSERT ON retired_beads_ids BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'retired_beads_ids', new.rowid, 'set', json_object('table_name', new.table_name, 'row_id', new.row_id, 'beads_id', new.beads_id)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_retired_beads_ids_update AFTER UPDATE ON retired_beads_ids BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'retired_beads_ids', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'retired_beads_ids', new.rowid, 'set', json_object('table_name', new.table_name, 'row_id', new.row_id, 'beads_id', new.beads_id)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_retired_beads_ids_delete AFTER DELETE ON retired_beads_ids BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'retired_beads_ids', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_spawned_waits_insert AFTER INSERT ON spawned_waits BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'spawned_waits', new.rowid, 'set', json_object('task_id', new.task_id, 'status', new.status, 'archival', new.archival, 'last_check_at', new.last_check_at, 'released_at', new.released_at)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_spawned_waits_update AFTER UPDATE ON spawned_waits BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'spawned_waits', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'spawned_waits', new.rowid, 'set', json_object('task_id', new.task_id, 'status', new.status, 'archival', new.archival, 'last_check_at', new.last_check_at, 'released_at', new.released_at)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_spawned_waits_delete AFTER DELETE ON spawned_waits BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'spawned_waits', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_tags_on_async_templates_insert AFTER INSERT ON tags_on_async_templates BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_async_templates', new.rowid, 'set', json_object('task_id', new.task_id, 'tag_id', new.tag_id)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_tags_on_async_templates_update AFTER UPDATE ON tags_on_async_templates BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_async_templates', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_async_templates', new.rowid, 'set', json_object('task_id', new.task_id, 'tag_id', new.tag_id)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_tags_on_async_templates_delete AFTER DELETE ON tags_on_async_templates BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_async_templates', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_tags_on_commitments_insert AFTER INSERT ON tags_on_commitments BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_commitments', new.rowid, 'set', json_object('commitment_id', new.commitment_id, 'tag_id', new.tag_id)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_tags_on_commitments_update AFTER UPDATE ON tags_on_commitments BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_commitments', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_commitments', new.rowid, 'set', json_object('commitment_id', new.commitment_id, 'tag_id', new.tag_id)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_tags_on_commitments_delete AFTER DELETE ON tags_on_commitments BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_commitments', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_tags_on_expectations_insert AFTER INSERT ON tags_on_expectations BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_expectations', new.rowid, 'set', json_object('expectation_id', new.expectation_id, 'tag_id', new.tag_id)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_tags_on_expectations_update AFTER UPDATE ON tags_on_expectations BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_expectations', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_expectations', new.rowid, 'set', json_object('expectation_id', new.expectation_id, 'tag_id', new.tag_id)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_tags_on_expectations_delete AFTER DELETE ON tags_on_expectations BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_expectations', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_tags_on_flow_async_templates_insert AFTER INSERT ON tags_on_flow_async_templates BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_flow_async_templates', new.rowid, 'set', json_object('flow_id', new.flow_id, 'tag_id', new.tag_id)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_tags_on_flow_async_templates_update AFTER UPDATE ON tags_on_flow_async_templates BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_flow_async_templates', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_flow_async_templates', new.rowid, 'set', json_object('flow_id', new.flow_id, 'tag_id', new.tag_id)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_tags_on_flow_async_templates_delete AFTER DELETE ON tags_on_flow_async_templates BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_flow_async_templates', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_tags_on_flow_task_async_templates_insert AFTER INSERT ON tags_on_flow_task_async_templates BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_flow_task_async_templates', new.rowid, 'set', json_object('flow_task_id', new.flow_task_id, 'tag_id', new.tag_id)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_tags_on_flow_task_async_templates_update AFTER UPDATE ON tags_on_flow_task_async_templates BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_flow_task_async_templates', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_flow_task_async_templates', new.rowid, 'set', json_object('flow_task_id', new.flow_task_id, 'tag_id', new.tag_id)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_tags_on_flow_task_async_templates_delete AFTER DELETE ON tags_on_flow_task_async_templates BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_flow_task_async_templates', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_tags_on_goals_insert AFTER INSERT ON tags_on_goals BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_goals', new.rowid, 'set', json_object('goal_id', new.goal_id, 'tag_id', new.tag_id)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_tags_on_goals_update AFTER UPDATE ON tags_on_goals BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_goals', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_goals', new.rowid, 'set', json_object('goal_id', new.goal_id, 'tag_id', new.tag_id)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_tags_on_goals_delete AFTER DELETE ON tags_on_goals BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_goals', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_tags_on_occurrence_async_templates_insert AFTER INSERT ON tags_on_occurrence_async_templates BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_occurrence_async_templates', new.rowid, 'set', json_object('node_key', new.node_key, 'tag_id', new.tag_id)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_tags_on_occurrence_async_templates_update AFTER UPDATE ON tags_on_occurrence_async_templates BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_occurrence_async_templates', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_occurrence_async_templates', new.rowid, 'set', json_object('node_key', new.node_key, 'tag_id', new.tag_id)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_tags_on_occurrence_async_templates_delete AFTER DELETE ON tags_on_occurrence_async_templates BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_occurrence_async_templates', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_tags_on_tasks_insert AFTER INSERT ON tags_on_tasks BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_tasks', new.rowid, 'set', json_object('task_id', new.task_id, 'tag_id', new.tag_id)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_tags_on_tasks_update AFTER UPDATE ON tags_on_tasks BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_tasks', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_tasks', new.rowid, 'set', json_object('task_id', new.task_id, 'tag_id', new.tag_id)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_tags_on_tasks_delete AFTER DELETE ON tags_on_tasks BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tags_on_tasks', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_task_agentic_briefs_insert AFTER INSERT ON task_agentic_briefs BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'task_agentic_briefs', new.rowid, 'set', json_object('task_id', new.task_id, 'priority', new.priority, 'spec', new.spec, 'design', new.design, 'acceptance', new.acceptance, 'notes', new.notes)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_task_agentic_briefs_update AFTER UPDATE ON task_agentic_briefs BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'task_agentic_briefs', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'task_agentic_briefs', new.rowid, 'set', json_object('task_id', new.task_id, 'priority', new.priority, 'spec', new.spec, 'design', new.design, 'acceptance', new.acceptance, 'notes', new.notes)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_task_agentic_briefs_delete AFTER DELETE ON task_agentic_briefs BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'task_agentic_briefs', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_task_async_templates_insert AFTER INSERT ON task_async_templates BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'task_async_templates', new.rowid, 'set', json_object('task_id', new.task_id, 'title', new.title, 'time_scope_n', new.time_scope_n, 'time_scope_kind', new.time_scope_kind, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_task_async_templates_update AFTER UPDATE ON task_async_templates BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'task_async_templates', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'task_async_templates', new.rowid, 'set', json_object('task_id', new.task_id, 'title', new.title, 'time_scope_n', new.time_scope_n, 'time_scope_kind', new.time_scope_kind, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_task_async_templates_delete AFTER DELETE ON task_async_templates BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'task_async_templates', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_task_dependencies_insert AFTER INSERT ON task_dependencies BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'task_dependencies', new.rowid, 'set', json_object('task_id', new.task_id, 'dependency_type', new.dependency_type, 'dependency_id', new.dependency_id)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_task_dependencies_update AFTER UPDATE ON task_dependencies BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'task_dependencies', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'task_dependencies', new.rowid, 'set', json_object('task_id', new.task_id, 'dependency_type', new.dependency_type, 'dependency_id', new.dependency_id)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_task_dependencies_delete AFTER DELETE ON task_dependencies BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'task_dependencies', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_task_knowledge_base_links_insert AFTER INSERT ON task_knowledge_base_links BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'task_knowledge_base_links', new.rowid, 'set', json_object('task_id', new.task_id, 'entity_type', new.entity_type, 'entity_id', new.entity_id)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_task_knowledge_base_links_update AFTER UPDATE ON task_knowledge_base_links BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'task_knowledge_base_links', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'task_knowledge_base_links', new.rowid, 'set', json_object('task_id', new.task_id, 'entity_type', new.entity_type, 'entity_id', new.entity_id)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_task_knowledge_base_links_delete AFTER DELETE ON task_knowledge_base_links BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'task_knowledge_base_links', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_task_overlays_insert AFTER INSERT ON task_overlays BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'task_overlays', new.rowid, 'set', json_object('id', new.id, 'origin', new.origin, 'flow_id', new.flow_id, 'item_type', new.item_type, 'item_id', new.item_id, 'iteration_scope', new.iteration_scope, 'cycle_id', new.cycle_id, 'wait_key', new.wait_key, 'due_at', new.due_at, 'status', new.status, 'resolved_at', new.resolved_at, 'tombstone', new.tombstone, 'title', new.title, 'plan_start_id', new.plan_start_id, 'plan_end_id', new.plan_end_id, 'plan_set', new.plan_set, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'delegate_set', new.delegate_set, 'agentic', new.agentic, 'agentic_set', new.agentic_set, 'asynchronous', new.asynchronous, 'archival', new.archival, 'is_private', new.is_private, 'position', new.position, 'block_reasons_set', new.block_reasons_set, 'brief_priority', new.brief_priority, 'brief_priority_set', new.brief_priority_set, 'brief_spec', new.brief_spec, 'brief_design', new.brief_design, 'brief_acceptance', new.brief_acceptance, 'brief_notes', new.brief_notes, 'due_scope_start_id', new.due_scope_start_id, 'due_scope_end_id', new.due_scope_end_id, 'compound', new.compound, 'async_template_set', new.async_template_set)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_task_overlays_update AFTER UPDATE ON task_overlays BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'task_overlays', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'task_overlays', new.rowid, 'set', json_object('id', new.id, 'origin', new.origin, 'flow_id', new.flow_id, 'item_type', new.item_type, 'item_id', new.item_id, 'iteration_scope', new.iteration_scope, 'cycle_id', new.cycle_id, 'wait_key', new.wait_key, 'due_at', new.due_at, 'status', new.status, 'resolved_at', new.resolved_at, 'tombstone', new.tombstone, 'title', new.title, 'plan_start_id', new.plan_start_id, 'plan_end_id', new.plan_end_id, 'plan_set', new.plan_set, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'delegate_set', new.delegate_set, 'agentic', new.agentic, 'agentic_set', new.agentic_set, 'asynchronous', new.asynchronous, 'archival', new.archival, 'is_private', new.is_private, 'position', new.position, 'block_reasons_set', new.block_reasons_set, 'brief_priority', new.brief_priority, 'brief_priority_set', new.brief_priority_set, 'brief_spec', new.brief_spec, 'brief_design', new.brief_design, 'brief_acceptance', new.brief_acceptance, 'brief_notes', new.brief_notes, 'due_scope_start_id', new.due_scope_start_id, 'due_scope_end_id', new.due_scope_end_id, 'compound', new.compound, 'async_template_set', new.async_template_set)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_task_overlays_delete AFTER DELETE ON task_overlays BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'task_overlays', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_tasks_insert AFTER INSERT ON tasks BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tasks', new.rowid, 'set', json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'status', new.status, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'position', new.position, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'plan_start_id', new.plan_start_id, 'plan_end_id', new.plan_end_id, 'on_scope_exit', new.on_scope_exit, 'is_private', new.is_private, 'archival', new.archival, 'agentic', new.agentic, 'asynchronous', new.asynchronous, 'done_at', new.done_at, 'due_scope_start_id', new.due_scope_start_id, 'due_scope_end_id', new.due_scope_end_id, 'compound', new.compound)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_tasks_update AFTER UPDATE ON tasks BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tasks', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tasks', new.rowid, 'set', json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'status', new.status, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'position', new.position, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'plan_start_id', new.plan_start_id, 'plan_end_id', new.plan_end_id, 'on_scope_exit', new.on_scope_exit, 'is_private', new.is_private, 'archival', new.archival, 'agentic', new.agentic, 'asynchronous', new.asynchronous, 'done_at', new.done_at, 'due_scope_start_id', new.due_scope_start_id, 'due_scope_end_id', new.due_scope_end_id, 'compound', new.compound)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_tasks_delete AFTER DELETE ON tasks BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'tasks', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_template_agentic_briefs_insert AFTER INSERT ON template_agentic_briefs BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'template_agentic_briefs', new.rowid, 'set', json_object('id', new.id, 'item_type', new.item_type, 'item_id', new.item_id, 'priority', new.priority, 'spec', new.spec, 'design', new.design, 'acceptance', new.acceptance, 'notes', new.notes)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_template_agentic_briefs_update AFTER UPDATE ON template_agentic_briefs BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'template_agentic_briefs', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'template_agentic_briefs', new.rowid, 'set', json_object('id', new.id, 'item_type', new.item_type, 'item_id', new.item_id, 'priority', new.priority, 'spec', new.spec, 'design', new.design, 'acceptance', new.acceptance, 'notes', new.notes)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_template_agentic_briefs_delete AFTER DELETE ON template_agentic_briefs BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'template_agentic_briefs', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_template_block_reasons_insert AFTER INSERT ON template_block_reasons BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'template_block_reasons', new.rowid, 'set', json_object('id', new.id, 'item_type', new.item_type, 'item_id', new.item_id, 'reason', new.reason, 'position', new.position)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_template_block_reasons_update AFTER UPDATE ON template_block_reasons BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'template_block_reasons', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'template_block_reasons', new.rowid, 'set', json_object('id', new.id, 'item_type', new.item_type, 'item_id', new.item_id, 'reason', new.reason, 'position', new.position)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_template_block_reasons_delete AFTER DELETE ON template_block_reasons BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'template_block_reasons', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_template_tags_insert AFTER INSERT ON template_tags BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'template_tags', new.rowid, 'set', json_object('id', new.id, 'item_type', new.item_type, 'item_id', new.item_id, 'tag_id', new.tag_id)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_template_tags_update AFTER UPDATE ON template_tags BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'template_tags', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'template_tags', new.rowid, 'set', json_object('id', new.id, 'item_type', new.item_type, 'item_id', new.item_id, 'tag_id', new.tag_id)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_template_tags_delete AFTER DELETE ON template_tags BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'template_tags', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_threads_insert AFTER INSERT ON threads BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'threads', new.rowid, 'set', json_object('id', new.id, 'title', new.title, 'linked_note', new.linked_note)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_threads_update AFTER UPDATE ON threads BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'threads', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'threads', new.rowid, 'set', json_object('id', new.id, 'title', new.title, 'linked_note', new.linked_note)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_threads_delete AFTER DELETE ON threads BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'threads', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_wait_checks_insert AFTER INSERT ON wait_checks BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'wait_checks', new.rowid, 'set', json_object('id', new.id, 'wait_kind', new.wait_kind, 'wait_id', new.wait_id, 'wait_key', new.wait_key, 'due_at', new.due_at, 'resolved_at', new.resolved_at)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_wait_checks_update AFTER UPDATE ON wait_checks BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'wait_checks', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'wait_checks', new.rowid, 'set', json_object('id', new.id, 'wait_kind', new.wait_kind, 'wait_id', new.wait_id, 'wait_key', new.wait_key, 'due_at', new.due_at, 'resolved_at', new.resolved_at)
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_wait_checks_delete AFTER DELETE ON wait_checks BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT 'wait_checks', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;
