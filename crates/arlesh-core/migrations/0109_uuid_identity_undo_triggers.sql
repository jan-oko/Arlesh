-- The undo-journal triggers 0107 dropped with the tables they sat on, put back unchanged: the
-- generator's output reads columns by name and journals `rowid`, so TEXT ids change nothing in them.
-- `tests/undo_journal.rs` still fails on a table left without its three.

CREATE TRIGGER undo_journal_agents_delete AFTER DELETE ON agents BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'agents', old.rowid, 'delete', json_object('id', old.id, 'name', old.name, 'account', old.account, 'session_uuid', old.session_uuid, 'token_sha256', old.token_sha256, 'claim_kind', old.claim_kind, 'claim_id', old.claim_id, 'claim_paused', old.claim_paused, 'claimed_at', old.claimed_at, 'locked', old.locked, 'created_at', old.created_at, 'last_seen_at', old.last_seen_at, 'parent_id', old.parent_id), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_agents_insert AFTER INSERT ON agents BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'agents', new.rowid, 'insert', NULL, json_object('id', new.id, 'name', new.name, 'account', new.account, 'session_uuid', new.session_uuid, 'token_sha256', new.token_sha256, 'claim_kind', new.claim_kind, 'claim_id', new.claim_id, 'claim_paused', new.claim_paused, 'claimed_at', new.claimed_at, 'locked', new.locked, 'created_at', new.created_at, 'last_seen_at', new.last_seen_at, 'parent_id', new.parent_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_agents_update AFTER UPDATE ON agents BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'agents', new.rowid, 'update', json_object('id', old.id, 'name', old.name, 'account', old.account, 'session_uuid', old.session_uuid, 'token_sha256', old.token_sha256, 'claim_kind', old.claim_kind, 'claim_id', old.claim_id, 'claim_paused', old.claim_paused, 'claimed_at', old.claimed_at, 'locked', old.locked, 'created_at', old.created_at, 'last_seen_at', old.last_seen_at, 'parent_id', old.parent_id), json_object('id', new.id, 'name', new.name, 'account', new.account, 'session_uuid', new.session_uuid, 'token_sha256', new.token_sha256, 'claim_kind', new.claim_kind, 'claim_id', new.claim_id, 'claim_paused', new.claim_paused, 'claimed_at', new.claimed_at, 'locked', new.locked, 'created_at', new.created_at, 'last_seen_at', new.last_seen_at, 'parent_id', new.parent_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_block_reasons_delete AFTER DELETE ON block_reasons BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'block_reasons', old.rowid, 'delete', json_object('id', old.id, 'owner_type', old.owner_type, 'owner_id', old.owner_id, 'reason', old.reason, 'position', old.position, 'created_at', old.created_at), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_block_reasons_insert AFTER INSERT ON block_reasons BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'block_reasons', new.rowid, 'insert', NULL, json_object('id', new.id, 'owner_type', new.owner_type, 'owner_id', new.owner_id, 'reason', new.reason, 'position', new.position, 'created_at', new.created_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_block_reasons_update AFTER UPDATE ON block_reasons BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'block_reasons', new.rowid, 'update', json_object('id', old.id, 'owner_type', old.owner_type, 'owner_id', old.owner_id, 'reason', old.reason, 'position', old.position, 'created_at', old.created_at), json_object('id', new.id, 'owner_type', new.owner_type, 'owner_id', new.owner_id, 'reason', new.reason, 'position', new.position, 'created_at', new.created_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_commitment_overlays_delete AFTER DELETE ON commitment_overlays BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'commitment_overlays', old.rowid, 'delete', json_object('id', old.id, 'flow_id', old.flow_id, 'item_type', old.item_type, 'item_id', old.item_id, 'iteration_scope', old.iteration_scope, 'cycle_id', old.cycle_id, 'verdict', old.verdict, 'resolved_at', old.resolved_at, 'tombstone', old.tombstone, 'title', old.title, 'is_private', old.is_private, 'position', old.position), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_commitment_overlays_insert AFTER INSERT ON commitment_overlays BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'commitment_overlays', new.rowid, 'insert', NULL, json_object('id', new.id, 'flow_id', new.flow_id, 'item_type', new.item_type, 'item_id', new.item_id, 'iteration_scope', new.iteration_scope, 'cycle_id', new.cycle_id, 'verdict', new.verdict, 'resolved_at', new.resolved_at, 'tombstone', new.tombstone, 'title', new.title, 'is_private', new.is_private, 'position', new.position), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_commitment_overlays_update AFTER UPDATE ON commitment_overlays BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'commitment_overlays', new.rowid, 'update', json_object('id', old.id, 'flow_id', old.flow_id, 'item_type', old.item_type, 'item_id', old.item_id, 'iteration_scope', old.iteration_scope, 'cycle_id', old.cycle_id, 'verdict', old.verdict, 'resolved_at', old.resolved_at, 'tombstone', old.tombstone, 'title', old.title, 'is_private', old.is_private, 'position', old.position), json_object('id', new.id, 'flow_id', new.flow_id, 'item_type', new.item_type, 'item_id', new.item_id, 'iteration_scope', new.iteration_scope, 'cycle_id', new.cycle_id, 'verdict', new.verdict, 'resolved_at', new.resolved_at, 'tombstone', new.tombstone, 'title', new.title, 'is_private', new.is_private, 'position', new.position), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_commitments_delete AFTER DELETE ON commitments BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'commitments', old.rowid, 'delete', json_object('id', old.id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'verdict', old.verdict, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind, 'verdict_window_n', old.verdict_window_n, 'verdict_window_kind', old.verdict_window_kind, 'position', old.position, 'is_private', old.is_private, 'verdict_at', old.verdict_at, 'archival', old.archival), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_commitments_insert AFTER INSERT ON commitments BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'commitments', new.rowid, 'insert', NULL, json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'verdict', new.verdict, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'verdict_window_n', new.verdict_window_n, 'verdict_window_kind', new.verdict_window_kind, 'position', new.position, 'is_private', new.is_private, 'verdict_at', new.verdict_at, 'archival', new.archival), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_commitments_update AFTER UPDATE ON commitments BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'commitments', new.rowid, 'update', json_object('id', old.id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'verdict', old.verdict, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind, 'verdict_window_n', old.verdict_window_n, 'verdict_window_kind', old.verdict_window_kind, 'position', old.position, 'is_private', old.is_private, 'verdict_at', old.verdict_at, 'archival', old.archival), json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'verdict', new.verdict, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'verdict_window_n', new.verdict_window_n, 'verdict_window_kind', new.verdict_window_kind, 'position', new.position, 'is_private', new.is_private, 'verdict_at', new.verdict_at, 'archival', new.archival), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_derived_block_reasons_delete AFTER DELETE ON derived_block_reasons BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'derived_block_reasons', old.rowid, 'delete', json_object('id', old.id, 'flow_id', old.flow_id, 'node_kind', old.node_kind, 'node_key', old.node_key, 'reason', old.reason, 'position', old.position), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_derived_block_reasons_insert AFTER INSERT ON derived_block_reasons BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'derived_block_reasons', new.rowid, 'insert', NULL, json_object('id', new.id, 'flow_id', new.flow_id, 'node_kind', new.node_kind, 'node_key', new.node_key, 'reason', new.reason, 'position', new.position), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_derived_block_reasons_update AFTER UPDATE ON derived_block_reasons BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'derived_block_reasons', new.rowid, 'update', json_object('id', old.id, 'flow_id', old.flow_id, 'node_kind', old.node_kind, 'node_key', old.node_key, 'reason', old.reason, 'position', old.position), json_object('id', new.id, 'flow_id', new.flow_id, 'node_kind', new.node_kind, 'node_key', new.node_key, 'reason', new.reason, 'position', new.position), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_derived_children_delete AFTER DELETE ON derived_children BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'derived_children', old.rowid, 'delete', json_object('id', old.id, 'flow_id', old.flow_id, 'parent_kind', old.parent_kind, 'parent_key', old.parent_key, 'window_start_scope_id', old.window_start_scope_id, 'window_end_scope_id', old.window_end_scope_id, 'child_type', old.child_type, 'child_id', old.child_id), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_derived_children_insert AFTER INSERT ON derived_children BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'derived_children', new.rowid, 'insert', NULL, json_object('id', new.id, 'flow_id', new.flow_id, 'parent_kind', new.parent_kind, 'parent_key', new.parent_key, 'window_start_scope_id', new.window_start_scope_id, 'window_end_scope_id', new.window_end_scope_id, 'child_type', new.child_type, 'child_id', new.child_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_derived_children_update AFTER UPDATE ON derived_children BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'derived_children', new.rowid, 'update', json_object('id', old.id, 'flow_id', old.flow_id, 'parent_kind', old.parent_kind, 'parent_key', old.parent_key, 'window_start_scope_id', old.window_start_scope_id, 'window_end_scope_id', old.window_end_scope_id, 'child_type', old.child_type, 'child_id', old.child_id), json_object('id', new.id, 'flow_id', new.flow_id, 'parent_kind', new.parent_kind, 'parent_key', new.parent_key, 'window_start_scope_id', new.window_start_scope_id, 'window_end_scope_id', new.window_end_scope_id, 'child_type', new.child_type, 'child_id', new.child_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_derived_dependencies_delete AFTER DELETE ON derived_dependencies BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'derived_dependencies', old.rowid, 'delete', json_object('id', old.id, 'flow_id', old.flow_id, 'dependent_id', old.dependent_id, 'dependent_key', old.dependent_key, 'target_type', old.target_type, 'target_id', old.target_id, 'target_key', old.target_key, 'added', old.added), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_derived_dependencies_insert AFTER INSERT ON derived_dependencies BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'derived_dependencies', new.rowid, 'insert', NULL, json_object('id', new.id, 'flow_id', new.flow_id, 'dependent_id', new.dependent_id, 'dependent_key', new.dependent_key, 'target_type', new.target_type, 'target_id', new.target_id, 'target_key', new.target_key, 'added', new.added), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_derived_dependencies_update AFTER UPDATE ON derived_dependencies BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'derived_dependencies', new.rowid, 'update', json_object('id', old.id, 'flow_id', old.flow_id, 'dependent_id', old.dependent_id, 'dependent_key', old.dependent_key, 'target_type', old.target_type, 'target_id', old.target_id, 'target_key', old.target_key, 'added', old.added), json_object('id', new.id, 'flow_id', new.flow_id, 'dependent_id', new.dependent_id, 'dependent_key', new.dependent_key, 'target_type', new.target_type, 'target_id', new.target_id, 'target_key', new.target_key, 'added', new.added), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_derived_tags_delete AFTER DELETE ON derived_tags BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'derived_tags', old.rowid, 'delete', json_object('id', old.id, 'flow_id', old.flow_id, 'node_kind', old.node_kind, 'node_key', old.node_key, 'tag_id', old.tag_id, 'added', old.added), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_derived_tags_insert AFTER INSERT ON derived_tags BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'derived_tags', new.rowid, 'insert', NULL, json_object('id', new.id, 'flow_id', new.flow_id, 'node_kind', new.node_kind, 'node_key', new.node_key, 'tag_id', new.tag_id, 'added', new.added), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_derived_tags_update AFTER UPDATE ON derived_tags BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'derived_tags', new.rowid, 'update', json_object('id', old.id, 'flow_id', old.flow_id, 'node_kind', old.node_kind, 'node_key', old.node_key, 'tag_id', old.tag_id, 'added', old.added), json_object('id', new.id, 'flow_id', new.flow_id, 'node_kind', new.node_kind, 'node_key', new.node_key, 'tag_id', new.tag_id, 'added', new.added), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_domains_delete AFTER DELETE ON domains BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'domains', old.rowid, 'delete', json_object('id', old.id, 'title', old.title, 'description', old.description, 'subtype', old.subtype, 'parent_id', old.parent_id, 'color', old.color, 'status', old.status, 'knowledge_base_directory', old.knowledge_base_directory, 'position', old.position, 'is_private', old.is_private), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_domains_insert AFTER INSERT ON domains BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'domains', new.rowid, 'insert', NULL, json_object('id', new.id, 'title', new.title, 'description', new.description, 'subtype', new.subtype, 'parent_id', new.parent_id, 'color', new.color, 'status', new.status, 'knowledge_base_directory', new.knowledge_base_directory, 'position', new.position, 'is_private', new.is_private), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_domains_update AFTER UPDATE ON domains BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'domains', new.rowid, 'update', json_object('id', old.id, 'title', old.title, 'description', old.description, 'subtype', old.subtype, 'parent_id', old.parent_id, 'color', old.color, 'status', old.status, 'knowledge_base_directory', old.knowledge_base_directory, 'position', old.position, 'is_private', old.is_private), json_object('id', new.id, 'title', new.title, 'description', new.description, 'subtype', new.subtype, 'parent_id', new.parent_id, 'color', new.color, 'status', new.status, 'knowledge_base_directory', new.knowledge_base_directory, 'position', new.position, 'is_private', new.is_private), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_events_delete AFTER DELETE ON events BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'events', old.rowid, 'delete', json_object('id', old.id, 'title', old.title, 'scope_id', old.scope_id, 'event_time', old.event_time, 'linked_note', old.linked_note), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_events_insert AFTER INSERT ON events BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'events', new.rowid, 'insert', NULL, json_object('id', new.id, 'title', new.title, 'scope_id', new.scope_id, 'event_time', new.event_time, 'linked_note', new.linked_note), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_events_update AFTER UPDATE ON events BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'events', new.rowid, 'update', json_object('id', old.id, 'title', old.title, 'scope_id', old.scope_id, 'event_time', old.event_time, 'linked_note', old.linked_note), json_object('id', new.id, 'title', new.title, 'scope_id', new.scope_id, 'event_time', new.event_time, 'linked_note', new.linked_note), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_expectation_overlays_delete AFTER DELETE ON expectation_overlays BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'expectation_overlays', old.rowid, 'delete', json_object('node_key', old.node_key, 'flow_id', old.flow_id, 'occurrence_key', old.occurrence_key, 'title', old.title, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind, 'time_scope_set', old.time_scope_set, 'check_every_n', old.check_every_n, 'check_every_kind', old.check_every_kind, 'check_every_set', old.check_every_set, 'check_starting', old.check_starting, 'is_private', old.is_private, 'archival', old.archival, 'agentic', old.agentic, 'agentic_note', old.agentic_note, 'agentic_note_set', old.agentic_note_set, 'agentic_question', old.agentic_question, 'agentic_answer', old.agentic_answer, 'agentic_answer_set', old.agentic_answer_set, 'status', old.status, 'released_at', old.released_at), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_expectation_overlays_insert AFTER INSERT ON expectation_overlays BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'expectation_overlays', new.rowid, 'insert', NULL, json_object('node_key', new.node_key, 'flow_id', new.flow_id, 'occurrence_key', new.occurrence_key, 'title', new.title, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'time_scope_set', new.time_scope_set, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind, 'check_every_set', new.check_every_set, 'check_starting', new.check_starting, 'is_private', new.is_private, 'archival', new.archival, 'agentic', new.agentic, 'agentic_note', new.agentic_note, 'agentic_note_set', new.agentic_note_set, 'agentic_question', new.agentic_question, 'agentic_answer', new.agentic_answer, 'agentic_answer_set', new.agentic_answer_set, 'status', new.status, 'released_at', new.released_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_expectation_overlays_update AFTER UPDATE ON expectation_overlays BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'expectation_overlays', new.rowid, 'update', json_object('node_key', old.node_key, 'flow_id', old.flow_id, 'occurrence_key', old.occurrence_key, 'title', old.title, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind, 'time_scope_set', old.time_scope_set, 'check_every_n', old.check_every_n, 'check_every_kind', old.check_every_kind, 'check_every_set', old.check_every_set, 'check_starting', old.check_starting, 'is_private', old.is_private, 'archival', old.archival, 'agentic', old.agentic, 'agentic_note', old.agentic_note, 'agentic_note_set', old.agentic_note_set, 'agentic_question', old.agentic_question, 'agentic_answer', old.agentic_answer, 'agentic_answer_set', old.agentic_answer_set, 'status', old.status, 'released_at', old.released_at), json_object('node_key', new.node_key, 'flow_id', new.flow_id, 'occurrence_key', new.occurrence_key, 'title', new.title, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'time_scope_set', new.time_scope_set, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind, 'check_every_set', new.check_every_set, 'check_starting', new.check_starting, 'is_private', new.is_private, 'archival', new.archival, 'agentic', new.agentic, 'agentic_note', new.agentic_note, 'agentic_note_set', new.agentic_note_set, 'agentic_question', new.agentic_question, 'agentic_answer', new.agentic_answer, 'agentic_answer_set', new.agentic_answer_set, 'status', new.status, 'released_at', new.released_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_expectations_delete AFTER DELETE ON expectations BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'expectations', old.rowid, 'delete', json_object('id', old.id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'status', old.status, 'archival', old.archival, 'position', old.position, 'is_private', old.is_private, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind, 'check_every_n', old.check_every_n, 'check_every_kind', old.check_every_kind, 'check_starting', old.check_starting, 'last_check_at', old.last_check_at, 'agentic', old.agentic, 'agentic_note', old.agentic_note, 'agentic_question', old.agentic_question, 'agentic_answer', old.agentic_answer, 'released_at', old.released_at, 'agentic_review', old.agentic_review, 'agentic_verdict', old.agentic_verdict), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

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

CREATE TRIGGER undo_journal_flow_async_templates_delete AFTER DELETE ON flow_async_templates BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_async_templates', old.rowid, 'delete', json_object('flow_id', old.flow_id, 'title', old.title, 'time_scope_n', old.time_scope_n, 'time_scope_kind', old.time_scope_kind, 'check_every_n', old.check_every_n, 'check_every_kind', old.check_every_kind), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_async_templates_insert AFTER INSERT ON flow_async_templates BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_async_templates', new.rowid, 'insert', NULL, json_object('flow_id', new.flow_id, 'title', new.title, 'time_scope_n', new.time_scope_n, 'time_scope_kind', new.time_scope_kind, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_async_templates_update AFTER UPDATE ON flow_async_templates BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_async_templates', new.rowid, 'update', json_object('flow_id', old.flow_id, 'title', old.title, 'time_scope_n', old.time_scope_n, 'time_scope_kind', old.time_scope_kind, 'check_every_n', old.check_every_n, 'check_every_kind', old.check_every_kind), json_object('flow_id', new.flow_id, 'title', new.title, 'time_scope_n', new.time_scope_n, 'time_scope_kind', new.time_scope_kind, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_commitments_delete AFTER DELETE ON flow_commitments BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_commitments', old.rowid, 'delete', json_object('id', old.id, 'flow_id', old.flow_id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'position', old.position, 'is_private', old.is_private, 'verdict_window_n', old.verdict_window_n, 'verdict_window_kind', old.verdict_window_kind), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_commitments_insert AFTER INSERT ON flow_commitments BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_commitments', new.rowid, 'insert', NULL, json_object('id', new.id, 'flow_id', new.flow_id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'is_private', new.is_private, 'verdict_window_n', new.verdict_window_n, 'verdict_window_kind', new.verdict_window_kind), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_commitments_update AFTER UPDATE ON flow_commitments BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_commitments', new.rowid, 'update', json_object('id', old.id, 'flow_id', old.flow_id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'position', old.position, 'is_private', old.is_private, 'verdict_window_n', old.verdict_window_n, 'verdict_window_kind', old.verdict_window_kind), json_object('id', new.id, 'flow_id', new.flow_id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'is_private', new.is_private, 'verdict_window_n', new.verdict_window_n, 'verdict_window_kind', new.verdict_window_kind), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_dependencies_delete AFTER DELETE ON flow_dependencies BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_dependencies', old.rowid, 'delete', json_object('id', old.id, 'flow_id', old.flow_id, 'dependent_type', old.dependent_type, 'dependent_id', old.dependent_id, 'depends_on_type', old.depends_on_type, 'depends_on_id', old.depends_on_id), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_dependencies_insert AFTER INSERT ON flow_dependencies BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_dependencies', new.rowid, 'insert', NULL, json_object('id', new.id, 'flow_id', new.flow_id, 'dependent_type', new.dependent_type, 'dependent_id', new.dependent_id, 'depends_on_type', new.depends_on_type, 'depends_on_id', new.depends_on_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_dependencies_update AFTER UPDATE ON flow_dependencies BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_dependencies', new.rowid, 'update', json_object('id', old.id, 'flow_id', old.flow_id, 'dependent_type', old.dependent_type, 'dependent_id', old.dependent_id, 'depends_on_type', old.depends_on_type, 'depends_on_id', old.depends_on_id), json_object('id', new.id, 'flow_id', new.flow_id, 'dependent_type', new.dependent_type, 'dependent_id', new.dependent_id, 'depends_on_type', new.depends_on_type, 'depends_on_id', new.depends_on_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_expectations_delete AFTER DELETE ON flow_expectations BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_expectations', old.rowid, 'delete', json_object('id', old.id, 'flow_id', old.flow_id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'position', old.position, 'is_private', old.is_private, 'check_every_n', old.check_every_n, 'check_every_kind', old.check_every_kind, 'first_check_kind', old.first_check_kind, 'first_check_index', old.first_check_index), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_expectations_insert AFTER INSERT ON flow_expectations BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_expectations', new.rowid, 'insert', NULL, json_object('id', new.id, 'flow_id', new.flow_id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'is_private', new.is_private, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind, 'first_check_kind', new.first_check_kind, 'first_check_index', new.first_check_index), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_expectations_update AFTER UPDATE ON flow_expectations BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_expectations', new.rowid, 'update', json_object('id', old.id, 'flow_id', old.flow_id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'position', old.position, 'is_private', old.is_private, 'check_every_n', old.check_every_n, 'check_every_kind', old.check_every_kind, 'first_check_kind', old.first_check_kind, 'first_check_index', old.first_check_index), json_object('id', new.id, 'flow_id', new.flow_id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'is_private', new.is_private, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind, 'first_check_kind', new.first_check_kind, 'first_check_index', new.first_check_index), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_goals_delete AFTER DELETE ON flow_goals BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_goals', old.rowid, 'delete', json_object('id', old.id, 'flow_id', old.flow_id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'position', old.position, 'is_private', old.is_private), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_goals_insert AFTER INSERT ON flow_goals BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_goals', new.rowid, 'insert', NULL, json_object('id', new.id, 'flow_id', new.flow_id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'is_private', new.is_private), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_goals_update AFTER UPDATE ON flow_goals BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_goals', new.rowid, 'update', json_object('id', old.id, 'flow_id', old.flow_id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'position', old.position, 'is_private', old.is_private), json_object('id', new.id, 'flow_id', new.flow_id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'is_private', new.is_private), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_instance_nodes_delete AFTER DELETE ON flow_instance_nodes BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_instance_nodes', old.rowid, 'delete', json_object('id', old.id, 'flow_instance_id', old.flow_instance_id, 'node_type', old.node_type, 'node_id', old.node_id, 'source_item_type', old.source_item_type, 'source_item_id', old.source_item_id, 'original_parent_type', old.original_parent_type, 'original_parent_id', old.original_parent_id), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_instance_nodes_insert AFTER INSERT ON flow_instance_nodes BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_instance_nodes', new.rowid, 'insert', NULL, json_object('id', new.id, 'flow_instance_id', new.flow_instance_id, 'node_type', new.node_type, 'node_id', new.node_id, 'source_item_type', new.source_item_type, 'source_item_id', new.source_item_id, 'original_parent_type', new.original_parent_type, 'original_parent_id', new.original_parent_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_instance_nodes_update AFTER UPDATE ON flow_instance_nodes BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_instance_nodes', new.rowid, 'update', json_object('id', old.id, 'flow_instance_id', old.flow_instance_id, 'node_type', old.node_type, 'node_id', old.node_id, 'source_item_type', old.source_item_type, 'source_item_id', old.source_item_id, 'original_parent_type', old.original_parent_type, 'original_parent_id', old.original_parent_id), json_object('id', new.id, 'flow_instance_id', new.flow_instance_id, 'node_type', new.node_type, 'node_id', new.node_id, 'source_item_type', new.source_item_type, 'source_item_id', new.source_item_id, 'original_parent_type', new.original_parent_type, 'original_parent_id', new.original_parent_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_instances_delete AFTER DELETE ON flow_instances BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_instances', old.rowid, 'delete', json_object('id', old.id, 'flow_id', old.flow_id, 'root_type', old.root_type, 'root_id', old.root_id, 'started_at', old.started_at), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_instances_insert AFTER INSERT ON flow_instances BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_instances', new.rowid, 'insert', NULL, json_object('id', new.id, 'flow_id', new.flow_id, 'root_type', new.root_type, 'root_id', new.root_id, 'started_at', new.started_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_instances_update AFTER UPDATE ON flow_instances BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_instances', new.rowid, 'update', json_object('id', old.id, 'flow_id', old.flow_id, 'root_type', old.root_type, 'root_id', old.root_id, 'started_at', old.started_at), json_object('id', new.id, 'flow_id', new.flow_id, 'root_type', new.root_type, 'root_id', new.root_id, 'started_at', new.started_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_item_cycles_delete AFTER DELETE ON flow_item_cycles BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_item_cycles', old.rowid, 'delete', json_object('id', old.id, 'flow_id', old.flow_id, 'item_type', old.item_type, 'item_id', old.item_id, 'scope_kind', old.scope_kind, 'scope_index', old.scope_index, 'plan_kind', old.plan_kind, 'plan_start', old.plan_start, 'plan_end', old.plan_end, 'position', old.position), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_item_cycles_insert AFTER INSERT ON flow_item_cycles BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_item_cycles', new.rowid, 'insert', NULL, json_object('id', new.id, 'flow_id', new.flow_id, 'item_type', new.item_type, 'item_id', new.item_id, 'scope_kind', new.scope_kind, 'scope_index', new.scope_index, 'plan_kind', new.plan_kind, 'plan_start', new.plan_start, 'plan_end', new.plan_end, 'position', new.position), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_item_cycles_update AFTER UPDATE ON flow_item_cycles BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_item_cycles', new.rowid, 'update', json_object('id', old.id, 'flow_id', old.flow_id, 'item_type', old.item_type, 'item_id', old.item_id, 'scope_kind', old.scope_kind, 'scope_index', old.scope_index, 'plan_kind', old.plan_kind, 'plan_start', old.plan_start, 'plan_end', old.plan_end, 'position', old.position), json_object('id', new.id, 'flow_id', new.flow_id, 'item_type', new.item_type, 'item_id', new.item_id, 'scope_kind', new.scope_kind, 'scope_index', new.scope_index, 'plan_kind', new.plan_kind, 'plan_start', new.plan_start, 'plan_end', new.plan_end, 'position', new.position), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_recurrences_delete AFTER DELETE ON flow_recurrences BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_recurrences', old.rowid, 'delete', json_object('flow_id', old.flow_id, 'start_scope_id', old.start_scope_id, 'gap_n', old.gap_n, 'gap_kind', old.gap_kind, 'end_scope_id', old.end_scope_id, 'clock', old.clock, 'miss_policy', old.miss_policy, 'cooldown_n', old.cooldown_n, 'cooldown_kind', old.cooldown_kind), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

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

CREATE TRIGGER undo_journal_flow_task_async_templates_delete AFTER DELETE ON flow_task_async_templates BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_task_async_templates', old.rowid, 'delete', json_object('flow_task_id', old.flow_task_id, 'title', old.title, 'time_scope_n', old.time_scope_n, 'time_scope_kind', old.time_scope_kind, 'check_every_n', old.check_every_n, 'check_every_kind', old.check_every_kind), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_task_async_templates_insert AFTER INSERT ON flow_task_async_templates BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_task_async_templates', new.rowid, 'insert', NULL, json_object('flow_task_id', new.flow_task_id, 'title', new.title, 'time_scope_n', new.time_scope_n, 'time_scope_kind', new.time_scope_kind, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_task_async_templates_update AFTER UPDATE ON flow_task_async_templates BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_task_async_templates', new.rowid, 'update', json_object('flow_task_id', old.flow_task_id, 'title', old.title, 'time_scope_n', old.time_scope_n, 'time_scope_kind', old.time_scope_kind, 'check_every_n', old.check_every_n, 'check_every_kind', old.check_every_kind), json_object('flow_task_id', new.flow_task_id, 'title', new.title, 'time_scope_n', new.time_scope_n, 'time_scope_kind', new.time_scope_kind, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_tasks_delete AFTER DELETE ON flow_tasks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_tasks', old.rowid, 'delete', json_object('id', old.id, 'flow_id', old.flow_id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'position', old.position, 'is_private', old.is_private, 'delegate_kind', old.delegate_kind, 'delegate_id', old.delegate_id, 'agentic', old.agentic, 'asynchronous', old.asynchronous, 'archival', old.archival, 'compound', old.compound), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_tasks_insert AFTER INSERT ON flow_tasks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_tasks', new.rowid, 'insert', NULL, json_object('id', new.id, 'flow_id', new.flow_id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'is_private', new.is_private, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'agentic', new.agentic, 'asynchronous', new.asynchronous, 'archival', new.archival, 'compound', new.compound), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flow_tasks_update AFTER UPDATE ON flow_tasks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flow_tasks', new.rowid, 'update', json_object('id', old.id, 'flow_id', old.flow_id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'position', old.position, 'is_private', old.is_private, 'delegate_kind', old.delegate_kind, 'delegate_id', old.delegate_id, 'agentic', old.agentic, 'asynchronous', old.asynchronous, 'archival', old.archival, 'compound', old.compound), json_object('id', new.id, 'flow_id', new.flow_id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'is_private', new.is_private, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'agentic', new.agentic, 'asynchronous', new.asynchronous, 'archival', new.archival, 'compound', new.compound), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flows_delete AFTER DELETE ON flows BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flows', old.rowid, 'delete', json_object('id', old.id, 'title', old.title, 'instance_type', old.instance_type, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'target_type', old.target_type, 'target_id', old.target_id, 'flow_duration_n', old.flow_duration_n, 'flow_duration_kind', old.flow_duration_kind, 'position', old.position, 'flow_window_part', old.flow_window_part, 'flow_window_time_start', old.flow_window_time_start, 'flow_window_time_end', old.flow_window_time_end, 'root_plan_kind', old.root_plan_kind, 'root_plan_start', old.root_plan_start, 'root_plan_end', old.root_plan_end, 'is_private', old.is_private, 'verdict_window_n', old.verdict_window_n, 'verdict_window_kind', old.verdict_window_kind, 'delegate_kind', old.delegate_kind, 'delegate_id', old.delegate_id, 'agentic', old.agentic, 'asynchronous', old.asynchronous, 'archival', old.archival, 'compound', old.compound), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flows_insert AFTER INSERT ON flows BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flows', new.rowid, 'insert', NULL, json_object('id', new.id, 'title', new.title, 'instance_type', new.instance_type, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'target_type', new.target_type, 'target_id', new.target_id, 'flow_duration_n', new.flow_duration_n, 'flow_duration_kind', new.flow_duration_kind, 'position', new.position, 'flow_window_part', new.flow_window_part, 'flow_window_time_start', new.flow_window_time_start, 'flow_window_time_end', new.flow_window_time_end, 'root_plan_kind', new.root_plan_kind, 'root_plan_start', new.root_plan_start, 'root_plan_end', new.root_plan_end, 'is_private', new.is_private, 'verdict_window_n', new.verdict_window_n, 'verdict_window_kind', new.verdict_window_kind, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'agentic', new.agentic, 'asynchronous', new.asynchronous, 'archival', new.archival, 'compound', new.compound), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_flows_update AFTER UPDATE ON flows BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'flows', new.rowid, 'update', json_object('id', old.id, 'title', old.title, 'instance_type', old.instance_type, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'target_type', old.target_type, 'target_id', old.target_id, 'flow_duration_n', old.flow_duration_n, 'flow_duration_kind', old.flow_duration_kind, 'position', old.position, 'flow_window_part', old.flow_window_part, 'flow_window_time_start', old.flow_window_time_start, 'flow_window_time_end', old.flow_window_time_end, 'root_plan_kind', old.root_plan_kind, 'root_plan_start', old.root_plan_start, 'root_plan_end', old.root_plan_end, 'is_private', old.is_private, 'verdict_window_n', old.verdict_window_n, 'verdict_window_kind', old.verdict_window_kind, 'delegate_kind', old.delegate_kind, 'delegate_id', old.delegate_id, 'agentic', old.agentic, 'asynchronous', old.asynchronous, 'archival', old.archival, 'compound', old.compound), json_object('id', new.id, 'title', new.title, 'instance_type', new.instance_type, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'target_type', new.target_type, 'target_id', new.target_id, 'flow_duration_n', new.flow_duration_n, 'flow_duration_kind', new.flow_duration_kind, 'position', new.position, 'flow_window_part', new.flow_window_part, 'flow_window_time_start', new.flow_window_time_start, 'flow_window_time_end', new.flow_window_time_end, 'root_plan_kind', new.root_plan_kind, 'root_plan_start', new.root_plan_start, 'root_plan_end', new.root_plan_end, 'is_private', new.is_private, 'verdict_window_n', new.verdict_window_n, 'verdict_window_kind', new.verdict_window_kind, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'agentic', new.agentic, 'asynchronous', new.asynchronous, 'archival', new.archival, 'compound', new.compound), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_goal_knowledge_base_links_delete AFTER DELETE ON goal_knowledge_base_links BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'goal_knowledge_base_links', old.rowid, 'delete', json_object('goal_id', old.goal_id, 'entity_type', old.entity_type, 'entity_id', old.entity_id), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_goal_knowledge_base_links_insert AFTER INSERT ON goal_knowledge_base_links BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'goal_knowledge_base_links', new.rowid, 'insert', NULL, json_object('goal_id', new.goal_id, 'entity_type', new.entity_type, 'entity_id', new.entity_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_goal_knowledge_base_links_update AFTER UPDATE ON goal_knowledge_base_links BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'goal_knowledge_base_links', new.rowid, 'update', json_object('goal_id', old.goal_id, 'entity_type', old.entity_type, 'entity_id', old.entity_id), json_object('goal_id', new.goal_id, 'entity_type', new.entity_type, 'entity_id', new.entity_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_goal_overlays_delete AFTER DELETE ON goal_overlays BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'goal_overlays', old.rowid, 'delete', json_object('id', old.id, 'flow_id', old.flow_id, 'item_type', old.item_type, 'item_id', old.item_id, 'iteration_scope', old.iteration_scope, 'cycle_id', old.cycle_id, 'status', old.status, 'resolved_at', old.resolved_at, 'tombstone', old.tombstone, 'title', old.title, 'is_private', old.is_private, 'position', old.position, 'block_reasons_set', old.block_reasons_set), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_goal_overlays_insert AFTER INSERT ON goal_overlays BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'goal_overlays', new.rowid, 'insert', NULL, json_object('id', new.id, 'flow_id', new.flow_id, 'item_type', new.item_type, 'item_id', new.item_id, 'iteration_scope', new.iteration_scope, 'cycle_id', new.cycle_id, 'status', new.status, 'resolved_at', new.resolved_at, 'tombstone', new.tombstone, 'title', new.title, 'is_private', new.is_private, 'position', new.position, 'block_reasons_set', new.block_reasons_set), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_goal_overlays_update AFTER UPDATE ON goal_overlays BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'goal_overlays', new.rowid, 'update', json_object('id', old.id, 'flow_id', old.flow_id, 'item_type', old.item_type, 'item_id', old.item_id, 'iteration_scope', old.iteration_scope, 'cycle_id', old.cycle_id, 'status', old.status, 'resolved_at', old.resolved_at, 'tombstone', old.tombstone, 'title', old.title, 'is_private', old.is_private, 'position', old.position, 'block_reasons_set', old.block_reasons_set), json_object('id', new.id, 'flow_id', new.flow_id, 'item_type', new.item_type, 'item_id', new.item_id, 'iteration_scope', new.iteration_scope, 'cycle_id', new.cycle_id, 'status', new.status, 'resolved_at', new.resolved_at, 'tombstone', new.tombstone, 'title', new.title, 'is_private', new.is_private, 'position', new.position, 'block_reasons_set', new.block_reasons_set), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_goals_delete AFTER DELETE ON goals BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'goals', old.rowid, 'delete', json_object('id', old.id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'status', old.status, 'position', old.position, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind, 'on_scope_exit', old.on_scope_exit, 'is_private', old.is_private, 'achieved_at', old.achieved_at), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_goals_insert AFTER INSERT ON goals BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'goals', new.rowid, 'insert', NULL, json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'status', new.status, 'position', new.position, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'on_scope_exit', new.on_scope_exit, 'is_private', new.is_private, 'achieved_at', new.achieved_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_goals_update AFTER UPDATE ON goals BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'goals', new.rowid, 'update', json_object('id', old.id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'status', old.status, 'position', old.position, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind, 'on_scope_exit', old.on_scope_exit, 'is_private', old.is_private, 'achieved_at', old.achieved_at), json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'status', new.status, 'position', new.position, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'on_scope_exit', new.on_scope_exit, 'is_private', new.is_private, 'achieved_at', new.achieved_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_infos_delete AFTER DELETE ON infos BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'infos', old.rowid, 'delete', json_object('id', old.id, 'body', old.body, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'position', old.position, 'created_at', old.created_at, 'updated_at', old.updated_at, 'details', old.details, 'is_private', old.is_private), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_infos_insert AFTER INSERT ON infos BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'infos', new.rowid, 'insert', NULL, json_object('id', new.id, 'body', new.body, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'created_at', new.created_at, 'updated_at', new.updated_at, 'details', new.details, 'is_private', new.is_private), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_infos_update AFTER UPDATE ON infos BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'infos', new.rowid, 'update', json_object('id', old.id, 'body', old.body, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'position', old.position, 'created_at', old.created_at, 'updated_at', old.updated_at, 'details', old.details, 'is_private', old.is_private), json_object('id', new.id, 'body', new.body, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'position', new.position, 'created_at', new.created_at, 'updated_at', new.updated_at, 'details', new.details, 'is_private', new.is_private), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_mcp_roots_delete AFTER DELETE ON mcp_roots BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'mcp_roots', old.rowid, 'delete', json_object('id', old.id, 'node_kind', old.node_kind, 'node_id', old.node_id), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_mcp_roots_insert AFTER INSERT ON mcp_roots BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'mcp_roots', new.rowid, 'insert', NULL, json_object('id', new.id, 'node_kind', new.node_kind, 'node_id', new.node_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_mcp_roots_update AFTER UPDATE ON mcp_roots BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'mcp_roots', new.rowid, 'update', json_object('id', old.id, 'node_kind', old.node_kind, 'node_id', old.node_id), json_object('id', new.id, 'node_kind', new.node_kind, 'node_id', new.node_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_occurrence_async_templates_delete AFTER DELETE ON occurrence_async_templates BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'occurrence_async_templates', old.rowid, 'delete', json_object('node_key', old.node_key, 'flow_id', old.flow_id, 'title', old.title, 'time_scope_n', old.time_scope_n, 'time_scope_kind', old.time_scope_kind, 'check_every_n', old.check_every_n, 'check_every_kind', old.check_every_kind), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_occurrence_async_templates_insert AFTER INSERT ON occurrence_async_templates BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'occurrence_async_templates', new.rowid, 'insert', NULL, json_object('node_key', new.node_key, 'flow_id', new.flow_id, 'title', new.title, 'time_scope_n', new.time_scope_n, 'time_scope_kind', new.time_scope_kind, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_occurrence_async_templates_update AFTER UPDATE ON occurrence_async_templates BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'occurrence_async_templates', new.rowid, 'update', json_object('node_key', old.node_key, 'flow_id', old.flow_id, 'title', old.title, 'time_scope_n', old.time_scope_n, 'time_scope_kind', old.time_scope_kind, 'check_every_n', old.check_every_n, 'check_every_kind', old.check_every_kind), json_object('node_key', new.node_key, 'flow_id', new.flow_id, 'title', new.title, 'time_scope_n', new.time_scope_n, 'time_scope_kind', new.time_scope_kind, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_occurrence_spawned_waits_delete AFTER DELETE ON occurrence_spawned_waits BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'occurrence_spawned_waits', old.rowid, 'delete', json_object('node_key', old.node_key, 'flow_id', old.flow_id, 'status', old.status, 'archival', old.archival, 'released_at', old.released_at), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_occurrence_spawned_waits_insert AFTER INSERT ON occurrence_spawned_waits BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'occurrence_spawned_waits', new.rowid, 'insert', NULL, json_object('node_key', new.node_key, 'flow_id', new.flow_id, 'status', new.status, 'archival', new.archival, 'released_at', new.released_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_occurrence_spawned_waits_update AFTER UPDATE ON occurrence_spawned_waits BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'occurrence_spawned_waits', new.rowid, 'update', json_object('node_key', old.node_key, 'flow_id', old.flow_id, 'status', old.status, 'archival', old.archival, 'released_at', old.released_at), json_object('node_key', new.node_key, 'flow_id', new.flow_id, 'status', new.status, 'archival', new.archival, 'released_at', new.released_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_people_delete AFTER DELETE ON people BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'people', old.rowid, 'delete', json_object('id', old.id, 'name', old.name, 'aliases', old.aliases, 'linked_note', old.linked_note), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_people_insert AFTER INSERT ON people BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'people', new.rowid, 'insert', NULL, json_object('id', new.id, 'name', new.name, 'aliases', new.aliases, 'linked_note', new.linked_note), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_people_update AFTER UPDATE ON people BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'people', new.rowid, 'update', json_object('id', old.id, 'name', old.name, 'aliases', old.aliases, 'linked_note', old.linked_note), json_object('id', new.id, 'name', new.name, 'aliases', new.aliases, 'linked_note', new.linked_note), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_retired_beads_ids_delete AFTER DELETE ON retired_beads_ids BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'retired_beads_ids', old.rowid, 'delete', json_object('table_name', old.table_name, 'row_id', old.row_id, 'beads_id', old.beads_id), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_retired_beads_ids_insert AFTER INSERT ON retired_beads_ids BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'retired_beads_ids', new.rowid, 'insert', NULL, json_object('table_name', new.table_name, 'row_id', new.row_id, 'beads_id', new.beads_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_retired_beads_ids_update AFTER UPDATE ON retired_beads_ids BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'retired_beads_ids', new.rowid, 'update', json_object('table_name', old.table_name, 'row_id', old.row_id, 'beads_id', old.beads_id), json_object('table_name', new.table_name, 'row_id', new.row_id, 'beads_id', new.beads_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_spawned_waits_delete AFTER DELETE ON spawned_waits BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'spawned_waits', old.rowid, 'delete', json_object('task_id', old.task_id, 'status', old.status, 'archival', old.archival, 'last_check_at', old.last_check_at, 'released_at', old.released_at), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_spawned_waits_insert AFTER INSERT ON spawned_waits BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'spawned_waits', new.rowid, 'insert', NULL, json_object('task_id', new.task_id, 'status', new.status, 'archival', new.archival, 'last_check_at', new.last_check_at, 'released_at', new.released_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_spawned_waits_update AFTER UPDATE ON spawned_waits BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'spawned_waits', new.rowid, 'update', json_object('task_id', old.task_id, 'status', old.status, 'archival', old.archival, 'last_check_at', old.last_check_at, 'released_at', old.released_at), json_object('task_id', new.task_id, 'status', new.status, 'archival', new.archival, 'last_check_at', new.last_check_at, 'released_at', new.released_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_tags_on_async_templates_delete AFTER DELETE ON tags_on_async_templates BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tags_on_async_templates', old.rowid, 'delete', json_object('task_id', old.task_id, 'tag_id', old.tag_id), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_tags_on_async_templates_insert AFTER INSERT ON tags_on_async_templates BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tags_on_async_templates', new.rowid, 'insert', NULL, json_object('task_id', new.task_id, 'tag_id', new.tag_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_tags_on_async_templates_update AFTER UPDATE ON tags_on_async_templates BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tags_on_async_templates', new.rowid, 'update', json_object('task_id', old.task_id, 'tag_id', old.tag_id), json_object('task_id', new.task_id, 'tag_id', new.tag_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_tags_on_commitments_delete AFTER DELETE ON tags_on_commitments BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tags_on_commitments', old.rowid, 'delete', json_object('commitment_id', old.commitment_id, 'tag_id', old.tag_id), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_tags_on_commitments_insert AFTER INSERT ON tags_on_commitments BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tags_on_commitments', new.rowid, 'insert', NULL, json_object('commitment_id', new.commitment_id, 'tag_id', new.tag_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_tags_on_commitments_update AFTER UPDATE ON tags_on_commitments BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tags_on_commitments', new.rowid, 'update', json_object('commitment_id', old.commitment_id, 'tag_id', old.tag_id), json_object('commitment_id', new.commitment_id, 'tag_id', new.tag_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_tags_on_expectations_delete AFTER DELETE ON tags_on_expectations BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tags_on_expectations', old.rowid, 'delete', json_object('expectation_id', old.expectation_id, 'tag_id', old.tag_id), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_tags_on_expectations_insert AFTER INSERT ON tags_on_expectations BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tags_on_expectations', new.rowid, 'insert', NULL, json_object('expectation_id', new.expectation_id, 'tag_id', new.tag_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_tags_on_expectations_update AFTER UPDATE ON tags_on_expectations BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tags_on_expectations', new.rowid, 'update', json_object('expectation_id', old.expectation_id, 'tag_id', old.tag_id), json_object('expectation_id', new.expectation_id, 'tag_id', new.tag_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_tags_on_flow_async_templates_delete AFTER DELETE ON tags_on_flow_async_templates BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tags_on_flow_async_templates', old.rowid, 'delete', json_object('flow_id', old.flow_id, 'tag_id', old.tag_id), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_tags_on_flow_async_templates_insert AFTER INSERT ON tags_on_flow_async_templates BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tags_on_flow_async_templates', new.rowid, 'insert', NULL, json_object('flow_id', new.flow_id, 'tag_id', new.tag_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_tags_on_flow_async_templates_update AFTER UPDATE ON tags_on_flow_async_templates BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tags_on_flow_async_templates', new.rowid, 'update', json_object('flow_id', old.flow_id, 'tag_id', old.tag_id), json_object('flow_id', new.flow_id, 'tag_id', new.tag_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_tags_on_flow_task_async_templates_delete AFTER DELETE ON tags_on_flow_task_async_templates BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tags_on_flow_task_async_templates', old.rowid, 'delete', json_object('flow_task_id', old.flow_task_id, 'tag_id', old.tag_id), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_tags_on_flow_task_async_templates_insert AFTER INSERT ON tags_on_flow_task_async_templates BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tags_on_flow_task_async_templates', new.rowid, 'insert', NULL, json_object('flow_task_id', new.flow_task_id, 'tag_id', new.tag_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_tags_on_flow_task_async_templates_update AFTER UPDATE ON tags_on_flow_task_async_templates BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tags_on_flow_task_async_templates', new.rowid, 'update', json_object('flow_task_id', old.flow_task_id, 'tag_id', old.tag_id), json_object('flow_task_id', new.flow_task_id, 'tag_id', new.tag_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_tags_on_goals_delete AFTER DELETE ON tags_on_goals BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tags_on_goals', old.rowid, 'delete', json_object('goal_id', old.goal_id, 'tag_id', old.tag_id), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_tags_on_goals_insert AFTER INSERT ON tags_on_goals BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tags_on_goals', new.rowid, 'insert', NULL, json_object('goal_id', new.goal_id, 'tag_id', new.tag_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_tags_on_goals_update AFTER UPDATE ON tags_on_goals BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tags_on_goals', new.rowid, 'update', json_object('goal_id', old.goal_id, 'tag_id', old.tag_id), json_object('goal_id', new.goal_id, 'tag_id', new.tag_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_tags_on_occurrence_async_templates_delete AFTER DELETE ON tags_on_occurrence_async_templates BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tags_on_occurrence_async_templates', old.rowid, 'delete', json_object('node_key', old.node_key, 'tag_id', old.tag_id), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_tags_on_occurrence_async_templates_insert AFTER INSERT ON tags_on_occurrence_async_templates BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tags_on_occurrence_async_templates', new.rowid, 'insert', NULL, json_object('node_key', new.node_key, 'tag_id', new.tag_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_tags_on_occurrence_async_templates_update AFTER UPDATE ON tags_on_occurrence_async_templates BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tags_on_occurrence_async_templates', new.rowid, 'update', json_object('node_key', old.node_key, 'tag_id', old.tag_id), json_object('node_key', new.node_key, 'tag_id', new.tag_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_tags_on_tasks_delete AFTER DELETE ON tags_on_tasks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tags_on_tasks', old.rowid, 'delete', json_object('task_id', old.task_id, 'tag_id', old.tag_id), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_tags_on_tasks_insert AFTER INSERT ON tags_on_tasks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tags_on_tasks', new.rowid, 'insert', NULL, json_object('task_id', new.task_id, 'tag_id', new.tag_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_tags_on_tasks_update AFTER UPDATE ON tags_on_tasks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tags_on_tasks', new.rowid, 'update', json_object('task_id', old.task_id, 'tag_id', old.tag_id), json_object('task_id', new.task_id, 'tag_id', new.tag_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_task_agentic_briefs_delete AFTER DELETE ON task_agentic_briefs BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'task_agentic_briefs', old.rowid, 'delete', json_object('task_id', old.task_id, 'priority', old.priority, 'spec', old.spec, 'design', old.design, 'acceptance', old.acceptance, 'notes', old.notes), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_task_agentic_briefs_insert AFTER INSERT ON task_agentic_briefs BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'task_agentic_briefs', new.rowid, 'insert', NULL, json_object('task_id', new.task_id, 'priority', new.priority, 'spec', new.spec, 'design', new.design, 'acceptance', new.acceptance, 'notes', new.notes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_task_agentic_briefs_update AFTER UPDATE ON task_agentic_briefs BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'task_agentic_briefs', new.rowid, 'update', json_object('task_id', old.task_id, 'priority', old.priority, 'spec', old.spec, 'design', old.design, 'acceptance', old.acceptance, 'notes', old.notes), json_object('task_id', new.task_id, 'priority', new.priority, 'spec', new.spec, 'design', new.design, 'acceptance', new.acceptance, 'notes', new.notes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_task_async_templates_delete AFTER DELETE ON task_async_templates BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'task_async_templates', old.rowid, 'delete', json_object('task_id', old.task_id, 'title', old.title, 'time_scope_n', old.time_scope_n, 'time_scope_kind', old.time_scope_kind, 'check_every_n', old.check_every_n, 'check_every_kind', old.check_every_kind), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_task_async_templates_insert AFTER INSERT ON task_async_templates BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'task_async_templates', new.rowid, 'insert', NULL, json_object('task_id', new.task_id, 'title', new.title, 'time_scope_n', new.time_scope_n, 'time_scope_kind', new.time_scope_kind, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_task_async_templates_update AFTER UPDATE ON task_async_templates BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'task_async_templates', new.rowid, 'update', json_object('task_id', old.task_id, 'title', old.title, 'time_scope_n', old.time_scope_n, 'time_scope_kind', old.time_scope_kind, 'check_every_n', old.check_every_n, 'check_every_kind', old.check_every_kind), json_object('task_id', new.task_id, 'title', new.title, 'time_scope_n', new.time_scope_n, 'time_scope_kind', new.time_scope_kind, 'check_every_n', new.check_every_n, 'check_every_kind', new.check_every_kind), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_task_dependencies_delete AFTER DELETE ON task_dependencies BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'task_dependencies', old.rowid, 'delete', json_object('task_id', old.task_id, 'dependency_type', old.dependency_type, 'dependency_id', old.dependency_id), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_task_dependencies_insert AFTER INSERT ON task_dependencies BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'task_dependencies', new.rowid, 'insert', NULL, json_object('task_id', new.task_id, 'dependency_type', new.dependency_type, 'dependency_id', new.dependency_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_task_dependencies_update AFTER UPDATE ON task_dependencies BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'task_dependencies', new.rowid, 'update', json_object('task_id', old.task_id, 'dependency_type', old.dependency_type, 'dependency_id', old.dependency_id), json_object('task_id', new.task_id, 'dependency_type', new.dependency_type, 'dependency_id', new.dependency_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_task_knowledge_base_links_delete AFTER DELETE ON task_knowledge_base_links BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'task_knowledge_base_links', old.rowid, 'delete', json_object('task_id', old.task_id, 'entity_type', old.entity_type, 'entity_id', old.entity_id), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_task_knowledge_base_links_insert AFTER INSERT ON task_knowledge_base_links BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'task_knowledge_base_links', new.rowid, 'insert', NULL, json_object('task_id', new.task_id, 'entity_type', new.entity_type, 'entity_id', new.entity_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_task_knowledge_base_links_update AFTER UPDATE ON task_knowledge_base_links BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'task_knowledge_base_links', new.rowid, 'update', json_object('task_id', old.task_id, 'entity_type', old.entity_type, 'entity_id', old.entity_id), json_object('task_id', new.task_id, 'entity_type', new.entity_type, 'entity_id', new.entity_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_task_overlays_delete AFTER DELETE ON task_overlays BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'task_overlays', old.rowid, 'delete', json_object('id', old.id, 'origin', old.origin, 'flow_id', old.flow_id, 'item_type', old.item_type, 'item_id', old.item_id, 'iteration_scope', old.iteration_scope, 'cycle_id', old.cycle_id, 'wait_key', old.wait_key, 'due_at', old.due_at, 'status', old.status, 'resolved_at', old.resolved_at, 'tombstone', old.tombstone, 'title', old.title, 'plan_start_id', old.plan_start_id, 'plan_end_id', old.plan_end_id, 'plan_set', old.plan_set, 'delegate_kind', old.delegate_kind, 'delegate_id', old.delegate_id, 'delegate_set', old.delegate_set, 'agentic', old.agentic, 'agentic_set', old.agentic_set, 'asynchronous', old.asynchronous, 'archival', old.archival, 'is_private', old.is_private, 'position', old.position, 'block_reasons_set', old.block_reasons_set, 'brief_priority', old.brief_priority, 'brief_priority_set', old.brief_priority_set, 'brief_spec', old.brief_spec, 'brief_design', old.brief_design, 'brief_acceptance', old.brief_acceptance, 'brief_notes', old.brief_notes, 'due_scope_start_id', old.due_scope_start_id, 'due_scope_end_id', old.due_scope_end_id, 'compound', old.compound, 'async_template_set', old.async_template_set), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_task_overlays_insert AFTER INSERT ON task_overlays BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'task_overlays', new.rowid, 'insert', NULL, json_object('id', new.id, 'origin', new.origin, 'flow_id', new.flow_id, 'item_type', new.item_type, 'item_id', new.item_id, 'iteration_scope', new.iteration_scope, 'cycle_id', new.cycle_id, 'wait_key', new.wait_key, 'due_at', new.due_at, 'status', new.status, 'resolved_at', new.resolved_at, 'tombstone', new.tombstone, 'title', new.title, 'plan_start_id', new.plan_start_id, 'plan_end_id', new.plan_end_id, 'plan_set', new.plan_set, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'delegate_set', new.delegate_set, 'agentic', new.agentic, 'agentic_set', new.agentic_set, 'asynchronous', new.asynchronous, 'archival', new.archival, 'is_private', new.is_private, 'position', new.position, 'block_reasons_set', new.block_reasons_set, 'brief_priority', new.brief_priority, 'brief_priority_set', new.brief_priority_set, 'brief_spec', new.brief_spec, 'brief_design', new.brief_design, 'brief_acceptance', new.brief_acceptance, 'brief_notes', new.brief_notes, 'due_scope_start_id', new.due_scope_start_id, 'due_scope_end_id', new.due_scope_end_id, 'compound', new.compound, 'async_template_set', new.async_template_set), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_task_overlays_update AFTER UPDATE ON task_overlays BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'task_overlays', new.rowid, 'update', json_object('id', old.id, 'origin', old.origin, 'flow_id', old.flow_id, 'item_type', old.item_type, 'item_id', old.item_id, 'iteration_scope', old.iteration_scope, 'cycle_id', old.cycle_id, 'wait_key', old.wait_key, 'due_at', old.due_at, 'status', old.status, 'resolved_at', old.resolved_at, 'tombstone', old.tombstone, 'title', old.title, 'plan_start_id', old.plan_start_id, 'plan_end_id', old.plan_end_id, 'plan_set', old.plan_set, 'delegate_kind', old.delegate_kind, 'delegate_id', old.delegate_id, 'delegate_set', old.delegate_set, 'agentic', old.agentic, 'agentic_set', old.agentic_set, 'asynchronous', old.asynchronous, 'archival', old.archival, 'is_private', old.is_private, 'position', old.position, 'block_reasons_set', old.block_reasons_set, 'brief_priority', old.brief_priority, 'brief_priority_set', old.brief_priority_set, 'brief_spec', old.brief_spec, 'brief_design', old.brief_design, 'brief_acceptance', old.brief_acceptance, 'brief_notes', old.brief_notes, 'due_scope_start_id', old.due_scope_start_id, 'due_scope_end_id', old.due_scope_end_id, 'compound', old.compound, 'async_template_set', old.async_template_set), json_object('id', new.id, 'origin', new.origin, 'flow_id', new.flow_id, 'item_type', new.item_type, 'item_id', new.item_id, 'iteration_scope', new.iteration_scope, 'cycle_id', new.cycle_id, 'wait_key', new.wait_key, 'due_at', new.due_at, 'status', new.status, 'resolved_at', new.resolved_at, 'tombstone', new.tombstone, 'title', new.title, 'plan_start_id', new.plan_start_id, 'plan_end_id', new.plan_end_id, 'plan_set', new.plan_set, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'delegate_set', new.delegate_set, 'agentic', new.agentic, 'agentic_set', new.agentic_set, 'asynchronous', new.asynchronous, 'archival', new.archival, 'is_private', new.is_private, 'position', new.position, 'block_reasons_set', new.block_reasons_set, 'brief_priority', new.brief_priority, 'brief_priority_set', new.brief_priority_set, 'brief_spec', new.brief_spec, 'brief_design', new.brief_design, 'brief_acceptance', new.brief_acceptance, 'brief_notes', new.brief_notes, 'due_scope_start_id', new.due_scope_start_id, 'due_scope_end_id', new.due_scope_end_id, 'compound', new.compound, 'async_template_set', new.async_template_set), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_tasks_delete AFTER DELETE ON tasks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tasks', old.rowid, 'delete', json_object('id', old.id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'status', old.status, 'delegate_kind', old.delegate_kind, 'delegate_id', old.delegate_id, 'position', old.position, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind, 'plan_start_id', old.plan_start_id, 'plan_end_id', old.plan_end_id, 'on_scope_exit', old.on_scope_exit, 'is_private', old.is_private, 'archival', old.archival, 'agentic', old.agentic, 'asynchronous', old.asynchronous, 'done_at', old.done_at, 'due_scope_start_id', old.due_scope_start_id, 'due_scope_end_id', old.due_scope_end_id, 'compound', old.compound), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_tasks_insert AFTER INSERT ON tasks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tasks', new.rowid, 'insert', NULL, json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'status', new.status, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'position', new.position, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'plan_start_id', new.plan_start_id, 'plan_end_id', new.plan_end_id, 'on_scope_exit', new.on_scope_exit, 'is_private', new.is_private, 'archival', new.archival, 'agentic', new.agentic, 'asynchronous', new.asynchronous, 'done_at', new.done_at, 'due_scope_start_id', new.due_scope_start_id, 'due_scope_end_id', new.due_scope_end_id, 'compound', new.compound), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_tasks_update AFTER UPDATE ON tasks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'tasks', new.rowid, 'update', json_object('id', old.id, 'title', old.title, 'parent_type', old.parent_type, 'parent_id', old.parent_id, 'status', old.status, 'delegate_kind', old.delegate_kind, 'delegate_id', old.delegate_id, 'position', old.position, 'time_scope_start_id', old.time_scope_start_id, 'time_scope_end_id', old.time_scope_end_id, 'time_scope_duration_n', old.time_scope_duration_n, 'time_scope_duration_kind', old.time_scope_duration_kind, 'plan_start_id', old.plan_start_id, 'plan_end_id', old.plan_end_id, 'on_scope_exit', old.on_scope_exit, 'is_private', old.is_private, 'archival', old.archival, 'agentic', old.agentic, 'asynchronous', old.asynchronous, 'done_at', old.done_at, 'due_scope_start_id', old.due_scope_start_id, 'due_scope_end_id', old.due_scope_end_id, 'compound', old.compound), json_object('id', new.id, 'title', new.title, 'parent_type', new.parent_type, 'parent_id', new.parent_id, 'status', new.status, 'delegate_kind', new.delegate_kind, 'delegate_id', new.delegate_id, 'position', new.position, 'time_scope_start_id', new.time_scope_start_id, 'time_scope_end_id', new.time_scope_end_id, 'time_scope_duration_n', new.time_scope_duration_n, 'time_scope_duration_kind', new.time_scope_duration_kind, 'plan_start_id', new.plan_start_id, 'plan_end_id', new.plan_end_id, 'on_scope_exit', new.on_scope_exit, 'is_private', new.is_private, 'archival', new.archival, 'agentic', new.agentic, 'asynchronous', new.asynchronous, 'done_at', new.done_at, 'due_scope_start_id', new.due_scope_start_id, 'due_scope_end_id', new.due_scope_end_id, 'compound', new.compound), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_template_agentic_briefs_delete AFTER DELETE ON template_agentic_briefs BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'template_agentic_briefs', old.rowid, 'delete', json_object('id', old.id, 'item_type', old.item_type, 'item_id', old.item_id, 'priority', old.priority, 'spec', old.spec, 'design', old.design, 'acceptance', old.acceptance, 'notes', old.notes), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_template_agentic_briefs_insert AFTER INSERT ON template_agentic_briefs BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'template_agentic_briefs', new.rowid, 'insert', NULL, json_object('id', new.id, 'item_type', new.item_type, 'item_id', new.item_id, 'priority', new.priority, 'spec', new.spec, 'design', new.design, 'acceptance', new.acceptance, 'notes', new.notes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_template_agentic_briefs_update AFTER UPDATE ON template_agentic_briefs BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'template_agentic_briefs', new.rowid, 'update', json_object('id', old.id, 'item_type', old.item_type, 'item_id', old.item_id, 'priority', old.priority, 'spec', old.spec, 'design', old.design, 'acceptance', old.acceptance, 'notes', old.notes), json_object('id', new.id, 'item_type', new.item_type, 'item_id', new.item_id, 'priority', new.priority, 'spec', new.spec, 'design', new.design, 'acceptance', new.acceptance, 'notes', new.notes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_template_block_reasons_delete AFTER DELETE ON template_block_reasons BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'template_block_reasons', old.rowid, 'delete', json_object('id', old.id, 'item_type', old.item_type, 'item_id', old.item_id, 'reason', old.reason, 'position', old.position), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_template_block_reasons_insert AFTER INSERT ON template_block_reasons BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'template_block_reasons', new.rowid, 'insert', NULL, json_object('id', new.id, 'item_type', new.item_type, 'item_id', new.item_id, 'reason', new.reason, 'position', new.position), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_template_block_reasons_update AFTER UPDATE ON template_block_reasons BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'template_block_reasons', new.rowid, 'update', json_object('id', old.id, 'item_type', old.item_type, 'item_id', old.item_id, 'reason', old.reason, 'position', old.position), json_object('id', new.id, 'item_type', new.item_type, 'item_id', new.item_id, 'reason', new.reason, 'position', new.position), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_template_tags_delete AFTER DELETE ON template_tags BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'template_tags', old.rowid, 'delete', json_object('id', old.id, 'item_type', old.item_type, 'item_id', old.item_id, 'tag_id', old.tag_id), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_template_tags_insert AFTER INSERT ON template_tags BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'template_tags', new.rowid, 'insert', NULL, json_object('id', new.id, 'item_type', new.item_type, 'item_id', new.item_id, 'tag_id', new.tag_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_template_tags_update AFTER UPDATE ON template_tags BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'template_tags', new.rowid, 'update', json_object('id', old.id, 'item_type', old.item_type, 'item_id', old.item_id, 'tag_id', old.tag_id), json_object('id', new.id, 'item_type', new.item_type, 'item_id', new.item_id, 'tag_id', new.tag_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_threads_delete AFTER DELETE ON threads BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'threads', old.rowid, 'delete', json_object('id', old.id, 'title', old.title, 'linked_note', old.linked_note), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_threads_insert AFTER INSERT ON threads BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'threads', new.rowid, 'insert', NULL, json_object('id', new.id, 'title', new.title, 'linked_note', new.linked_note), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_threads_update AFTER UPDATE ON threads BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'threads', new.rowid, 'update', json_object('id', old.id, 'title', old.title, 'linked_note', old.linked_note), json_object('id', new.id, 'title', new.title, 'linked_note', new.linked_note), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_wait_checks_delete AFTER DELETE ON wait_checks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'wait_checks', old.rowid, 'delete', json_object('id', old.id, 'wait_kind', old.wait_kind, 'wait_id', old.wait_id, 'wait_key', old.wait_key, 'due_at', old.due_at, 'resolved_at', old.resolved_at), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_wait_checks_insert AFTER INSERT ON wait_checks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'wait_checks', new.rowid, 'insert', NULL, json_object('id', new.id, 'wait_kind', new.wait_kind, 'wait_id', new.wait_id, 'wait_key', new.wait_key, 'due_at', new.due_at, 'resolved_at', new.resolved_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_wait_checks_update AFTER UPDATE ON wait_checks BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'wait_checks', new.rowid, 'update', json_object('id', old.id, 'wait_kind', old.wait_kind, 'wait_id', old.wait_id, 'wait_key', old.wait_key, 'due_at', old.due_at, 'resolved_at', old.resolved_at), json_object('id', new.id, 'wait_kind', new.wait_kind, 'wait_id', new.wait_id, 'wait_key', new.wait_key, 'due_at', new.due_at, 'resolved_at', new.resolved_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;
