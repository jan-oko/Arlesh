-- The plain triggers 0107 dropped with the tables they sat on, put back unchanged. Their bodies
-- compare ids as opaque values, so they read the same over TEXT ids.

CREATE TRIGGER agents_forget_children AFTER DELETE ON agents
WHEN (SELECT suppressed FROM undo_context WHERE id = 1) = 0 BEGIN
    DELETE FROM agents WHERE parent_id = old.id;
END;

CREATE TRIGGER agents_forget_done_task AFTER UPDATE OF status ON tasks
WHEN new.status IN ('done', 'agentic_done') AND old.status NOT IN ('done', 'agentic_done')
     AND (SELECT suppressed FROM undo_context WHERE id = 1) = 0 BEGIN
    DELETE FROM agents WHERE parent_id IS NOT NULL AND claim_kind = 'task' AND claim_id = new.id;
END;

CREATE TRIGGER flow_tasks_refuse_agent_delegate_insert BEFORE INSERT ON flow_tasks
WHEN new.delegate_kind = 'agent' BEGIN
    SELECT RAISE(ABORT, 'the Agent delegate was removed; an agent holds a Task as On Agent');
END;

CREATE TRIGGER flow_tasks_refuse_agent_delegate_update BEFORE UPDATE OF delegate_kind ON flow_tasks
WHEN new.delegate_kind = 'agent' BEGIN
    SELECT RAISE(ABORT, 'the Agent delegate was removed; an agent holds a Task as On Agent');
END;

CREATE TRIGGER flows_refuse_agent_delegate_insert BEFORE INSERT ON flows
WHEN new.delegate_kind = 'agent' BEGIN
    SELECT RAISE(ABORT, 'the Agent delegate was removed; an agent holds a Task as On Agent');
END;

CREATE TRIGGER flows_refuse_agent_delegate_update BEFORE UPDATE OF delegate_kind ON flows
WHEN new.delegate_kind = 'agent' BEGIN
    SELECT RAISE(ABORT, 'the Agent delegate was removed; an agent holds a Task as On Agent');
END;

CREATE TRIGGER mcp_roots_forget_commitment AFTER DELETE ON commitments
WHEN (SELECT suppressed FROM undo_context WHERE id = 1) = 0 BEGIN
    DELETE FROM mcp_roots WHERE node_kind = 'commitment' AND node_id = old.id;
END;

CREATE TRIGGER mcp_roots_forget_domain AFTER DELETE ON domains
WHEN (SELECT suppressed FROM undo_context WHERE id = 1) = 0 BEGIN
    DELETE FROM mcp_roots WHERE node_kind = 'domain' AND node_id = old.id;
END;

CREATE TRIGGER mcp_roots_forget_expectation AFTER DELETE ON expectations
WHEN (SELECT suppressed FROM undo_context WHERE id = 1) = 0 BEGIN
    DELETE FROM mcp_roots WHERE node_kind = 'expectation' AND node_id = old.id;
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

CREATE TRIGGER mcp_roots_forget_goal AFTER DELETE ON goals
WHEN (SELECT suppressed FROM undo_context WHERE id = 1) = 0 BEGIN
    DELETE FROM mcp_roots WHERE node_kind = 'goal' AND node_id = old.id;
END;

CREATE TRIGGER mcp_roots_forget_info AFTER DELETE ON infos
WHEN (SELECT suppressed FROM undo_context WHERE id = 1) = 0 BEGIN
    DELETE FROM mcp_roots WHERE node_kind = 'info' AND node_id = old.id;
END;

CREATE TRIGGER mcp_roots_forget_task AFTER DELETE ON tasks
WHEN (SELECT suppressed FROM undo_context WHERE id = 1) = 0 BEGIN
    DELETE FROM mcp_roots WHERE node_kind = 'task' AND node_id = old.id;
END;
