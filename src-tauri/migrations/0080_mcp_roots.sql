-- MCP roots (Arlesh-rz0). Settled with the user on 2026-09-24; see docs/spec/mcp-server.md,
-- "Access".
--
-- The nodes whose subtrees the MCP endpoint may see. It sees nothing by default: with no rows here
-- every tool reads an empty board. Inside a root, everything is readable except private nodes,
-- and Agentic Tasks are writable too; outside every root, nothing is.
--
-- `node_kind` names the **table** the node is a row of, not its display kind: every domain-table
-- subtype (Aspect, Project, Domain, Tag) is `domain`, keyed by `domains.id`. There is no foreign
-- key for the same reason `task_dependencies` has none — the target is polymorphic. Only stored
-- rows can be roots.
--
-- The list belongs to the board rather than to one window's preferences, so it lives here, and it
-- is journaled like every board table: adding or removing a root is an ordinary Gesture that
-- Ctrl+Z reverses.
CREATE TABLE mcp_roots (
    id        INTEGER PRIMARY KEY,
    node_kind TEXT NOT NULL CHECK (node_kind IN
                  ('domain', 'goal', 'task', 'commitment', 'expectation', 'info',
                   'flow', 'flow_goal', 'flow_task')),
    node_id   INTEGER NOT NULL,
    UNIQUE (node_kind, node_id)
);

-- A root belongs to its row. When the row goes, so does the root — otherwise SQLite reusing the
-- highest freed rowid would open an unrelated new node to the MCP.
--
-- Guarded on `undo_context.suppressed`: while the undo engine replays a Gesture it restores and
-- removes rows itself, root rows included, from what the journal recorded. Firing here as well
-- would delete a root the replay is about to restore, or delete one twice.
CREATE TRIGGER mcp_roots_forget_domain AFTER DELETE ON domains
WHEN (SELECT suppressed FROM undo_context WHERE id = 1) = 0 BEGIN
    DELETE FROM mcp_roots WHERE node_kind = 'domain' AND node_id = old.id;
END;
CREATE TRIGGER mcp_roots_forget_goal AFTER DELETE ON goals
WHEN (SELECT suppressed FROM undo_context WHERE id = 1) = 0 BEGIN
    DELETE FROM mcp_roots WHERE node_kind = 'goal' AND node_id = old.id;
END;
CREATE TRIGGER mcp_roots_forget_task AFTER DELETE ON tasks
WHEN (SELECT suppressed FROM undo_context WHERE id = 1) = 0 BEGIN
    DELETE FROM mcp_roots WHERE node_kind = 'task' AND node_id = old.id;
END;
CREATE TRIGGER mcp_roots_forget_commitment AFTER DELETE ON commitments
WHEN (SELECT suppressed FROM undo_context WHERE id = 1) = 0 BEGIN
    DELETE FROM mcp_roots WHERE node_kind = 'commitment' AND node_id = old.id;
END;
CREATE TRIGGER mcp_roots_forget_expectation AFTER DELETE ON expectations
WHEN (SELECT suppressed FROM undo_context WHERE id = 1) = 0 BEGIN
    DELETE FROM mcp_roots WHERE node_kind = 'expectation' AND node_id = old.id;
END;
CREATE TRIGGER mcp_roots_forget_info AFTER DELETE ON infos
WHEN (SELECT suppressed FROM undo_context WHERE id = 1) = 0 BEGIN
    DELETE FROM mcp_roots WHERE node_kind = 'info' AND node_id = old.id;
END;
CREATE TRIGGER mcp_roots_forget_flow AFTER DELETE ON flows
WHEN (SELECT suppressed FROM undo_context WHERE id = 1) = 0 BEGIN
    DELETE FROM mcp_roots WHERE node_kind = 'flow' AND node_id = old.id;
END;
CREATE TRIGGER mcp_roots_forget_flow_goal AFTER DELETE ON flow_goals
WHEN (SELECT suppressed FROM undo_context WHERE id = 1) = 0 BEGIN
    DELETE FROM mcp_roots WHERE node_kind = 'flow_goal' AND node_id = old.id;
END;
CREATE TRIGGER mcp_roots_forget_flow_task AFTER DELETE ON flow_tasks
WHEN (SELECT suppressed FROM undo_context WHERE id = 1) = 0 BEGIN
    DELETE FROM mcp_roots WHERE node_kind = 'flow_task' AND node_id = old.id;
END;

-- Undo-journal triggers, straight from scripts/generate-undo-triggers.sh
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

CREATE TRIGGER undo_journal_mcp_roots_delete AFTER DELETE ON mcp_roots BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'mcp_roots', old.rowid, 'delete', json_object('id', old.id, 'node_kind', old.node_kind, 'node_id', old.node_id), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;
