-- Drops the four triggers that refused the Agent delegate (added in 0088, 2026-10-01).
--
-- The Agent delegate no longer exists: `Delegate` has only a Person, the wire and the MCP parameters
-- cannot say anything else, and 0088 cleared every stored one. Nothing can write
-- `delegate_kind = 'agent'` any more, so the guards have nothing left to refuse.
DROP TRIGGER flows_refuse_agent_delegate_insert;
DROP TRIGGER flows_refuse_agent_delegate_update;
DROP TRIGGER flow_tasks_refuse_agent_delegate_insert;
DROP TRIGGER flow_tasks_refuse_agent_delegate_update;
