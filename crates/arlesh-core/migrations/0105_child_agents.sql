-- Child Agents (Task 077; ruled with the user 2026-11-13, ADR 0019). A subagent of a session is an
-- Agent row of its own, linked to the session's Agent. No foreign key, as for `mcp_roots`: the
-- children go with their parent by the trigger below, which the undo engine must be able to
-- suppress while it replays.
ALTER TABLE agents ADD COLUMN parent_id INTEGER;

-- One child per subagent: `session_uuid` holds the client's id for it.
CREATE UNIQUE INDEX agents_child_per_client ON agents (parent_id, session_uuid)
    WHERE parent_id IS NOT NULL;

-- A child goes with its parent. Guarded on `undo_context.suppressed`, as migration 0080's
-- `mcp_roots_forget_*` triggers are: an undo or redo replays the journal's own images.
CREATE TRIGGER agents_forget_children AFTER DELETE ON agents
WHEN (SELECT suppressed FROM undo_context WHERE id = 1) = 0 BEGIN
    DELETE FROM agents WHERE parent_id = old.id;
END;

-- A child whose sub-Claim is a Task is done when the Task is: removed when its stored status
-- becomes Done, whoever set it.
CREATE TRIGGER agents_forget_done_task AFTER UPDATE OF status ON tasks
WHEN new.status IN ('done', 'agentic_done') AND old.status NOT IN ('done', 'agentic_done')
     AND (SELECT suppressed FROM undo_context WHERE id = 1) = 0 BEGIN
    DELETE FROM agents WHERE parent_id IS NOT NULL AND claim_kind = 'task' AND claim_id = new.id;
END;
