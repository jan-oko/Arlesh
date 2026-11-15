-- Stored identity becomes a UUID (ADR 0017, decision 9; Task ccc, PR 1).
--
-- Every replicated table with a surrogate integer id is rebuilt with a TEXT primary key, and every
-- column naming such a row follows. An existing row's new id is its current `full_id`
-- (`uuid_v5('{kind}:{old id}')`, the id the MCP has always shown), so short ids and links do not
-- change. SQLite has no SHA-1, so `database::row_ids` computes the old-to-new map in Rust before this
-- file runs and leaves it in `uuid_map`; the node keys that spell a row id inside (a Habit
-- occurrence's `flow_task:12:{scope}:3`) are rewritten the same way through `key_map`. Both tables are
-- empty on a database with no rows, and are dropped at the end.
--
-- sqlx runs a SQLite migration in one transaction and foreign keys are on, so the usual rebuild (new
-- table, copy, drop, rename) is not open to it: `DROP TABLE` of a parent deletes its rows first and
-- would take every `ON DELETE CASCADE` child with it. Instead every table is copied, with its ids
-- already converted, into a constraint-free `carry_` table; the tables are dropped children first
-- (`PRAGMA foreign_key_list` orders them), recreated parents first, refilled from the carry tables,
-- and the carry tables dropped. Dropping a table drops its indexes and triggers: every trigger is
-- dropped first, the indexes are recreated with their table, and 0108 and 0109 put the triggers back.
--
-- Not rebuilt: `agents` keeps its integer id (a server-side session, never created by a client) but its
-- `claim_id` names a node and follows; `undo_journal.row_id` is a SQLite rowid, not a row id.

CREATE TABLE IF NOT EXISTS uuid_map (kind TEXT NOT NULL, old_id INTEGER NOT NULL, new_id TEXT NOT NULL, PRIMARY KEY (kind, old_id)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS key_map (old_key TEXT PRIMARY KEY NOT NULL, new_key TEXT NOT NULL) WITHOUT ROWID;

DROP TRIGGER IF EXISTS agents_forget_children;
DROP TRIGGER IF EXISTS agents_forget_done_task;
DROP TRIGGER IF EXISTS flow_tasks_refuse_agent_delegate_insert;
DROP TRIGGER IF EXISTS flow_tasks_refuse_agent_delegate_update;
DROP TRIGGER IF EXISTS flows_refuse_agent_delegate_insert;
DROP TRIGGER IF EXISTS flows_refuse_agent_delegate_update;
DROP TRIGGER IF EXISTS mcp_roots_forget_commitment;
DROP TRIGGER IF EXISTS mcp_roots_forget_domain;
DROP TRIGGER IF EXISTS mcp_roots_forget_expectation;
DROP TRIGGER IF EXISTS mcp_roots_forget_flow;
DROP TRIGGER IF EXISTS mcp_roots_forget_flow_goal;
DROP TRIGGER IF EXISTS mcp_roots_forget_flow_task;
DROP TRIGGER IF EXISTS mcp_roots_forget_goal;
DROP TRIGGER IF EXISTS mcp_roots_forget_info;
DROP TRIGGER IF EXISTS mcp_roots_forget_task;
DROP TRIGGER IF EXISTS undo_journal_agents_delete;
DROP TRIGGER IF EXISTS undo_journal_agents_insert;
DROP TRIGGER IF EXISTS undo_journal_agents_update;
DROP TRIGGER IF EXISTS undo_journal_block_reasons_delete;
DROP TRIGGER IF EXISTS undo_journal_block_reasons_insert;
DROP TRIGGER IF EXISTS undo_journal_block_reasons_update;
DROP TRIGGER IF EXISTS undo_journal_commitment_overlays_delete;
DROP TRIGGER IF EXISTS undo_journal_commitment_overlays_insert;
DROP TRIGGER IF EXISTS undo_journal_commitment_overlays_update;
DROP TRIGGER IF EXISTS undo_journal_commitments_delete;
DROP TRIGGER IF EXISTS undo_journal_commitments_insert;
DROP TRIGGER IF EXISTS undo_journal_commitments_update;
DROP TRIGGER IF EXISTS undo_journal_derived_block_reasons_delete;
DROP TRIGGER IF EXISTS undo_journal_derived_block_reasons_insert;
DROP TRIGGER IF EXISTS undo_journal_derived_block_reasons_update;
DROP TRIGGER IF EXISTS undo_journal_derived_children_delete;
DROP TRIGGER IF EXISTS undo_journal_derived_children_insert;
DROP TRIGGER IF EXISTS undo_journal_derived_children_update;
DROP TRIGGER IF EXISTS undo_journal_derived_dependencies_delete;
DROP TRIGGER IF EXISTS undo_journal_derived_dependencies_insert;
DROP TRIGGER IF EXISTS undo_journal_derived_dependencies_update;
DROP TRIGGER IF EXISTS undo_journal_derived_tags_delete;
DROP TRIGGER IF EXISTS undo_journal_derived_tags_insert;
DROP TRIGGER IF EXISTS undo_journal_derived_tags_update;
DROP TRIGGER IF EXISTS undo_journal_domains_delete;
DROP TRIGGER IF EXISTS undo_journal_domains_insert;
DROP TRIGGER IF EXISTS undo_journal_domains_update;
DROP TRIGGER IF EXISTS undo_journal_events_delete;
DROP TRIGGER IF EXISTS undo_journal_events_insert;
DROP TRIGGER IF EXISTS undo_journal_events_update;
DROP TRIGGER IF EXISTS undo_journal_expectation_overlays_delete;
DROP TRIGGER IF EXISTS undo_journal_expectation_overlays_insert;
DROP TRIGGER IF EXISTS undo_journal_expectation_overlays_update;
DROP TRIGGER IF EXISTS undo_journal_expectations_delete;
DROP TRIGGER IF EXISTS undo_journal_expectations_insert;
DROP TRIGGER IF EXISTS undo_journal_expectations_update;
DROP TRIGGER IF EXISTS undo_journal_flow_async_templates_delete;
DROP TRIGGER IF EXISTS undo_journal_flow_async_templates_insert;
DROP TRIGGER IF EXISTS undo_journal_flow_async_templates_update;
DROP TRIGGER IF EXISTS undo_journal_flow_commitments_delete;
DROP TRIGGER IF EXISTS undo_journal_flow_commitments_insert;
DROP TRIGGER IF EXISTS undo_journal_flow_commitments_update;
DROP TRIGGER IF EXISTS undo_journal_flow_dependencies_delete;
DROP TRIGGER IF EXISTS undo_journal_flow_dependencies_insert;
DROP TRIGGER IF EXISTS undo_journal_flow_dependencies_update;
DROP TRIGGER IF EXISTS undo_journal_flow_expectations_delete;
DROP TRIGGER IF EXISTS undo_journal_flow_expectations_insert;
DROP TRIGGER IF EXISTS undo_journal_flow_expectations_update;
DROP TRIGGER IF EXISTS undo_journal_flow_goals_delete;
DROP TRIGGER IF EXISTS undo_journal_flow_goals_insert;
DROP TRIGGER IF EXISTS undo_journal_flow_goals_update;
DROP TRIGGER IF EXISTS undo_journal_flow_instance_nodes_delete;
DROP TRIGGER IF EXISTS undo_journal_flow_instance_nodes_insert;
DROP TRIGGER IF EXISTS undo_journal_flow_instance_nodes_update;
DROP TRIGGER IF EXISTS undo_journal_flow_instances_delete;
DROP TRIGGER IF EXISTS undo_journal_flow_instances_insert;
DROP TRIGGER IF EXISTS undo_journal_flow_instances_update;
DROP TRIGGER IF EXISTS undo_journal_flow_item_cycles_delete;
DROP TRIGGER IF EXISTS undo_journal_flow_item_cycles_insert;
DROP TRIGGER IF EXISTS undo_journal_flow_item_cycles_update;
DROP TRIGGER IF EXISTS undo_journal_flow_recurrences_delete;
DROP TRIGGER IF EXISTS undo_journal_flow_recurrences_insert;
DROP TRIGGER IF EXISTS undo_journal_flow_recurrences_update;
DROP TRIGGER IF EXISTS undo_journal_flow_task_async_templates_delete;
DROP TRIGGER IF EXISTS undo_journal_flow_task_async_templates_insert;
DROP TRIGGER IF EXISTS undo_journal_flow_task_async_templates_update;
DROP TRIGGER IF EXISTS undo_journal_flow_tasks_delete;
DROP TRIGGER IF EXISTS undo_journal_flow_tasks_insert;
DROP TRIGGER IF EXISTS undo_journal_flow_tasks_update;
DROP TRIGGER IF EXISTS undo_journal_flows_delete;
DROP TRIGGER IF EXISTS undo_journal_flows_insert;
DROP TRIGGER IF EXISTS undo_journal_flows_update;
DROP TRIGGER IF EXISTS undo_journal_goal_knowledge_base_links_delete;
DROP TRIGGER IF EXISTS undo_journal_goal_knowledge_base_links_insert;
DROP TRIGGER IF EXISTS undo_journal_goal_knowledge_base_links_update;
DROP TRIGGER IF EXISTS undo_journal_goal_overlays_delete;
DROP TRIGGER IF EXISTS undo_journal_goal_overlays_insert;
DROP TRIGGER IF EXISTS undo_journal_goal_overlays_update;
DROP TRIGGER IF EXISTS undo_journal_goals_delete;
DROP TRIGGER IF EXISTS undo_journal_goals_insert;
DROP TRIGGER IF EXISTS undo_journal_goals_update;
DROP TRIGGER IF EXISTS undo_journal_infos_delete;
DROP TRIGGER IF EXISTS undo_journal_infos_insert;
DROP TRIGGER IF EXISTS undo_journal_infos_update;
DROP TRIGGER IF EXISTS undo_journal_mcp_roots_delete;
DROP TRIGGER IF EXISTS undo_journal_mcp_roots_insert;
DROP TRIGGER IF EXISTS undo_journal_mcp_roots_update;
DROP TRIGGER IF EXISTS undo_journal_occurrence_async_templates_delete;
DROP TRIGGER IF EXISTS undo_journal_occurrence_async_templates_insert;
DROP TRIGGER IF EXISTS undo_journal_occurrence_async_templates_update;
DROP TRIGGER IF EXISTS undo_journal_occurrence_spawned_waits_delete;
DROP TRIGGER IF EXISTS undo_journal_occurrence_spawned_waits_insert;
DROP TRIGGER IF EXISTS undo_journal_occurrence_spawned_waits_update;
DROP TRIGGER IF EXISTS undo_journal_people_delete;
DROP TRIGGER IF EXISTS undo_journal_people_insert;
DROP TRIGGER IF EXISTS undo_journal_people_update;
DROP TRIGGER IF EXISTS undo_journal_retired_beads_ids_delete;
DROP TRIGGER IF EXISTS undo_journal_retired_beads_ids_insert;
DROP TRIGGER IF EXISTS undo_journal_retired_beads_ids_update;
DROP TRIGGER IF EXISTS undo_journal_spawned_waits_delete;
DROP TRIGGER IF EXISTS undo_journal_spawned_waits_insert;
DROP TRIGGER IF EXISTS undo_journal_spawned_waits_update;
DROP TRIGGER IF EXISTS undo_journal_tags_on_async_templates_delete;
DROP TRIGGER IF EXISTS undo_journal_tags_on_async_templates_insert;
DROP TRIGGER IF EXISTS undo_journal_tags_on_async_templates_update;
DROP TRIGGER IF EXISTS undo_journal_tags_on_commitments_delete;
DROP TRIGGER IF EXISTS undo_journal_tags_on_commitments_insert;
DROP TRIGGER IF EXISTS undo_journal_tags_on_commitments_update;
DROP TRIGGER IF EXISTS undo_journal_tags_on_expectations_delete;
DROP TRIGGER IF EXISTS undo_journal_tags_on_expectations_insert;
DROP TRIGGER IF EXISTS undo_journal_tags_on_expectations_update;
DROP TRIGGER IF EXISTS undo_journal_tags_on_flow_async_templates_delete;
DROP TRIGGER IF EXISTS undo_journal_tags_on_flow_async_templates_insert;
DROP TRIGGER IF EXISTS undo_journal_tags_on_flow_async_templates_update;
DROP TRIGGER IF EXISTS undo_journal_tags_on_flow_task_async_templates_delete;
DROP TRIGGER IF EXISTS undo_journal_tags_on_flow_task_async_templates_insert;
DROP TRIGGER IF EXISTS undo_journal_tags_on_flow_task_async_templates_update;
DROP TRIGGER IF EXISTS undo_journal_tags_on_goals_delete;
DROP TRIGGER IF EXISTS undo_journal_tags_on_goals_insert;
DROP TRIGGER IF EXISTS undo_journal_tags_on_goals_update;
DROP TRIGGER IF EXISTS undo_journal_tags_on_occurrence_async_templates_delete;
DROP TRIGGER IF EXISTS undo_journal_tags_on_occurrence_async_templates_insert;
DROP TRIGGER IF EXISTS undo_journal_tags_on_occurrence_async_templates_update;
DROP TRIGGER IF EXISTS undo_journal_tags_on_tasks_delete;
DROP TRIGGER IF EXISTS undo_journal_tags_on_tasks_insert;
DROP TRIGGER IF EXISTS undo_journal_tags_on_tasks_update;
DROP TRIGGER IF EXISTS undo_journal_task_agentic_briefs_delete;
DROP TRIGGER IF EXISTS undo_journal_task_agentic_briefs_insert;
DROP TRIGGER IF EXISTS undo_journal_task_agentic_briefs_update;
DROP TRIGGER IF EXISTS undo_journal_task_async_templates_delete;
DROP TRIGGER IF EXISTS undo_journal_task_async_templates_insert;
DROP TRIGGER IF EXISTS undo_journal_task_async_templates_update;
DROP TRIGGER IF EXISTS undo_journal_task_dependencies_delete;
DROP TRIGGER IF EXISTS undo_journal_task_dependencies_insert;
DROP TRIGGER IF EXISTS undo_journal_task_dependencies_update;
DROP TRIGGER IF EXISTS undo_journal_task_knowledge_base_links_delete;
DROP TRIGGER IF EXISTS undo_journal_task_knowledge_base_links_insert;
DROP TRIGGER IF EXISTS undo_journal_task_knowledge_base_links_update;
DROP TRIGGER IF EXISTS undo_journal_task_overlays_delete;
DROP TRIGGER IF EXISTS undo_journal_task_overlays_insert;
DROP TRIGGER IF EXISTS undo_journal_task_overlays_update;
DROP TRIGGER IF EXISTS undo_journal_tasks_delete;
DROP TRIGGER IF EXISTS undo_journal_tasks_insert;
DROP TRIGGER IF EXISTS undo_journal_tasks_update;
DROP TRIGGER IF EXISTS undo_journal_template_agentic_briefs_delete;
DROP TRIGGER IF EXISTS undo_journal_template_agentic_briefs_insert;
DROP TRIGGER IF EXISTS undo_journal_template_agentic_briefs_update;
DROP TRIGGER IF EXISTS undo_journal_template_block_reasons_delete;
DROP TRIGGER IF EXISTS undo_journal_template_block_reasons_insert;
DROP TRIGGER IF EXISTS undo_journal_template_block_reasons_update;
DROP TRIGGER IF EXISTS undo_journal_template_tags_delete;
DROP TRIGGER IF EXISTS undo_journal_template_tags_insert;
DROP TRIGGER IF EXISTS undo_journal_template_tags_update;
DROP TRIGGER IF EXISTS undo_journal_threads_delete;
DROP TRIGGER IF EXISTS undo_journal_threads_insert;
DROP TRIGGER IF EXISTS undo_journal_threads_update;
DROP TRIGGER IF EXISTS undo_journal_wait_checks_delete;
DROP TRIGGER IF EXISTS undo_journal_wait_checks_insert;
DROP TRIGGER IF EXISTS undo_journal_wait_checks_update;

CREATE TABLE carry_agents AS
SELECT id AS id,
       name AS name,
       account AS account,
       session_uuid AS session_uuid,
       token_sha256 AS token_sha256,
       claim_kind AS claim_kind,
       CASE claim_kind
                WHEN 'aspect' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = claim_id), CASE WHEN claim_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', claim_id) END)
                WHEN 'project' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = claim_id), CASE WHEN claim_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', claim_id) END)
                WHEN 'domain' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = claim_id), CASE WHEN claim_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', claim_id) END)
                WHEN 'tag' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = claim_id), CASE WHEN claim_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', claim_id) END)
                WHEN 'goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'goal' AND old_id = claim_id), CASE WHEN claim_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', claim_id) END)
                WHEN 'task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'task' AND old_id = claim_id), CASE WHEN claim_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', claim_id) END)
                WHEN 'commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'commitment' AND old_id = claim_id), CASE WHEN claim_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', claim_id) END)
                WHEN 'expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'expectation' AND old_id = claim_id), CASE WHEN claim_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', claim_id) END)
                WHEN 'info' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'info' AND old_id = claim_id), CASE WHEN claim_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', claim_id) END)
                WHEN 'flow' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = claim_id), CASE WHEN claim_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', claim_id) END)
                WHEN 'flow_root' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = claim_id), CASE WHEN claim_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', claim_id) END)
                WHEN 'flow_goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_goal' AND old_id = claim_id), CASE WHEN claim_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', claim_id) END)
                WHEN 'flow_task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_task' AND old_id = claim_id), CASE WHEN claim_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', claim_id) END)
                WHEN 'flow_commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_commitment' AND old_id = claim_id), CASE WHEN claim_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', claim_id) END)
                WHEN 'flow_expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_expectation' AND old_id = claim_id), CASE WHEN claim_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', claim_id) END)
                WHEN 'person' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'person' AND old_id = claim_id), CASE WHEN claim_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', claim_id) END)
                WHEN 'event' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'event' AND old_id = claim_id), CASE WHEN claim_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', claim_id) END)
                WHEN 'thread' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'thread' AND old_id = claim_id), CASE WHEN claim_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', claim_id) END)
                ELSE CASE WHEN claim_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', claim_id) END END AS claim_id,
       claim_paused AS claim_paused,
       claimed_at AS claimed_at,
       locked AS locked,
       created_at AS created_at,
       last_seen_at AS last_seen_at,
       parent_id AS parent_id
  FROM agents;

CREATE TABLE carry_block_reasons AS
SELECT (SELECT new_id FROM uuid_map WHERE kind = 'block_reason' AND old_id = id) AS id,
       owner_type AS owner_type,
       CASE owner_type
                WHEN 'aspect' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = owner_id), CASE WHEN owner_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', owner_id) END)
                WHEN 'project' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = owner_id), CASE WHEN owner_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', owner_id) END)
                WHEN 'domain' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = owner_id), CASE WHEN owner_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', owner_id) END)
                WHEN 'tag' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = owner_id), CASE WHEN owner_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', owner_id) END)
                WHEN 'goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'goal' AND old_id = owner_id), CASE WHEN owner_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', owner_id) END)
                WHEN 'task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'task' AND old_id = owner_id), CASE WHEN owner_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', owner_id) END)
                WHEN 'commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'commitment' AND old_id = owner_id), CASE WHEN owner_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', owner_id) END)
                WHEN 'expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'expectation' AND old_id = owner_id), CASE WHEN owner_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', owner_id) END)
                WHEN 'info' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'info' AND old_id = owner_id), CASE WHEN owner_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', owner_id) END)
                WHEN 'flow' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = owner_id), CASE WHEN owner_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', owner_id) END)
                WHEN 'flow_root' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = owner_id), CASE WHEN owner_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', owner_id) END)
                WHEN 'flow_goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_goal' AND old_id = owner_id), CASE WHEN owner_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', owner_id) END)
                WHEN 'flow_task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_task' AND old_id = owner_id), CASE WHEN owner_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', owner_id) END)
                WHEN 'flow_commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_commitment' AND old_id = owner_id), CASE WHEN owner_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', owner_id) END)
                WHEN 'flow_expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_expectation' AND old_id = owner_id), CASE WHEN owner_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', owner_id) END)
                WHEN 'person' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'person' AND old_id = owner_id), CASE WHEN owner_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', owner_id) END)
                WHEN 'event' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'event' AND old_id = owner_id), CASE WHEN owner_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', owner_id) END)
                WHEN 'thread' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'thread' AND old_id = owner_id), CASE WHEN owner_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', owner_id) END)
                ELSE CASE WHEN owner_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', owner_id) END END AS owner_id,
       reason AS reason,
       position AS position,
       created_at AS created_at
  FROM block_reasons;

CREATE TABLE carry_commitment_overlays AS
SELECT (SELECT new_id FROM uuid_map WHERE kind = 'commitment_overlay' AND old_id = id) AS id,
       coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = flow_id), CASE WHEN flow_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', flow_id) END) AS flow_id,
       item_type AS item_type,
       CASE item_type
                WHEN 'aspect' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'project' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'domain' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'tag' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'goal' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'task' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'commitment' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'expectation' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'info' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'info' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'flow' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'flow_root' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'flow_goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_goal' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'flow_task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_task' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'flow_commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_commitment' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'flow_expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_expectation' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'person' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'person' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'event' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'event' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'thread' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'thread' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                ELSE CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END END AS item_id,
       iteration_scope AS iteration_scope,
       CASE WHEN cycle_id = 0 THEN '00000000-0000-0000-0000-000000000000' ELSE coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_item_cycle' AND old_id = cycle_id), CASE WHEN cycle_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', cycle_id) END) END AS cycle_id,
       verdict AS verdict,
       resolved_at AS resolved_at,
       tombstone AS tombstone,
       title AS title,
       is_private AS is_private,
       position AS position
  FROM commitment_overlays;

CREATE TABLE carry_commitments AS
SELECT (SELECT new_id FROM uuid_map WHERE kind = 'commitment' AND old_id = id) AS id,
       title AS title,
       parent_type AS parent_type,
       CASE parent_type
                WHEN 'aspect' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'project' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'domain' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'tag' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'goal' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'task' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'commitment' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'expectation' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'info' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'info' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_root' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_goal' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_task' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_commitment' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_expectation' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'person' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'person' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'event' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'event' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'thread' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'thread' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                ELSE CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END END AS parent_id,
       verdict AS verdict,
       time_scope_start_id AS time_scope_start_id,
       time_scope_end_id AS time_scope_end_id,
       time_scope_duration_n AS time_scope_duration_n,
       time_scope_duration_kind AS time_scope_duration_kind,
       verdict_window_n AS verdict_window_n,
       verdict_window_kind AS verdict_window_kind,
       position AS position,
       is_private AS is_private,
       verdict_at AS verdict_at,
       archival AS archival
  FROM commitments;

CREATE TABLE carry_derived_block_reasons AS
SELECT (SELECT new_id FROM uuid_map WHERE kind = 'derived_block_reason' AND old_id = id) AS id,
       coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = flow_id), CASE WHEN flow_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', flow_id) END) AS flow_id,
       node_kind AS node_kind,
       coalesce((SELECT new_key FROM key_map WHERE old_key = node_key), node_key) AS node_key,
       reason AS reason,
       position AS position
  FROM derived_block_reasons;

CREATE TABLE carry_derived_children AS
SELECT (SELECT new_id FROM uuid_map WHERE kind = 'derived_child' AND old_id = id) AS id,
       coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = flow_id), CASE WHEN flow_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', flow_id) END) AS flow_id,
       parent_kind AS parent_kind,
       coalesce((SELECT new_key FROM key_map WHERE old_key = parent_key), parent_key) AS parent_key,
       window_start_scope_id AS window_start_scope_id,
       window_end_scope_id AS window_end_scope_id,
       child_type AS child_type,
       CASE child_type
                WHEN 'aspect' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = child_id), CASE WHEN child_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', child_id) END)
                WHEN 'project' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = child_id), CASE WHEN child_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', child_id) END)
                WHEN 'domain' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = child_id), CASE WHEN child_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', child_id) END)
                WHEN 'tag' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = child_id), CASE WHEN child_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', child_id) END)
                WHEN 'goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'goal' AND old_id = child_id), CASE WHEN child_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', child_id) END)
                WHEN 'task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'task' AND old_id = child_id), CASE WHEN child_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', child_id) END)
                WHEN 'commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'commitment' AND old_id = child_id), CASE WHEN child_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', child_id) END)
                WHEN 'expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'expectation' AND old_id = child_id), CASE WHEN child_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', child_id) END)
                WHEN 'info' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'info' AND old_id = child_id), CASE WHEN child_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', child_id) END)
                WHEN 'flow' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = child_id), CASE WHEN child_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', child_id) END)
                WHEN 'flow_root' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = child_id), CASE WHEN child_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', child_id) END)
                WHEN 'flow_goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_goal' AND old_id = child_id), CASE WHEN child_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', child_id) END)
                WHEN 'flow_task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_task' AND old_id = child_id), CASE WHEN child_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', child_id) END)
                WHEN 'flow_commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_commitment' AND old_id = child_id), CASE WHEN child_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', child_id) END)
                WHEN 'flow_expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_expectation' AND old_id = child_id), CASE WHEN child_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', child_id) END)
                WHEN 'person' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'person' AND old_id = child_id), CASE WHEN child_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', child_id) END)
                WHEN 'event' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'event' AND old_id = child_id), CASE WHEN child_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', child_id) END)
                WHEN 'thread' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'thread' AND old_id = child_id), CASE WHEN child_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', child_id) END)
                ELSE CASE WHEN child_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', child_id) END END AS child_id
  FROM derived_children;

CREATE TABLE carry_derived_dependencies AS
SELECT (SELECT new_id FROM uuid_map WHERE kind = 'derived_dependency' AND old_id = id) AS id,
       coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = flow_id), CASE WHEN flow_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', flow_id) END) AS flow_id,
       coalesce((SELECT new_id FROM uuid_map WHERE kind = 'task' AND old_id = dependent_id), CASE WHEN dependent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', dependent_id) END) AS dependent_id,
       coalesce((SELECT new_key FROM key_map WHERE old_key = dependent_key), dependent_key) AS dependent_key,
       target_type AS target_type,
       CASE target_type
                WHEN 'aspect' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = target_id), CASE WHEN target_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', target_id) END)
                WHEN 'project' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = target_id), CASE WHEN target_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', target_id) END)
                WHEN 'domain' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = target_id), CASE WHEN target_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', target_id) END)
                WHEN 'tag' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = target_id), CASE WHEN target_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', target_id) END)
                WHEN 'goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'goal' AND old_id = target_id), CASE WHEN target_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', target_id) END)
                WHEN 'task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'task' AND old_id = target_id), CASE WHEN target_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', target_id) END)
                WHEN 'commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'commitment' AND old_id = target_id), CASE WHEN target_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', target_id) END)
                WHEN 'expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'expectation' AND old_id = target_id), CASE WHEN target_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', target_id) END)
                WHEN 'info' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'info' AND old_id = target_id), CASE WHEN target_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', target_id) END)
                WHEN 'flow' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = target_id), CASE WHEN target_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', target_id) END)
                WHEN 'flow_root' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = target_id), CASE WHEN target_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', target_id) END)
                WHEN 'flow_goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_goal' AND old_id = target_id), CASE WHEN target_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', target_id) END)
                WHEN 'flow_task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_task' AND old_id = target_id), CASE WHEN target_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', target_id) END)
                WHEN 'flow_commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_commitment' AND old_id = target_id), CASE WHEN target_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', target_id) END)
                WHEN 'flow_expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_expectation' AND old_id = target_id), CASE WHEN target_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', target_id) END)
                WHEN 'person' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'person' AND old_id = target_id), CASE WHEN target_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', target_id) END)
                WHEN 'event' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'event' AND old_id = target_id), CASE WHEN target_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', target_id) END)
                WHEN 'thread' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'thread' AND old_id = target_id), CASE WHEN target_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', target_id) END)
                ELSE CASE WHEN target_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', target_id) END END AS target_id,
       coalesce((SELECT new_key FROM key_map WHERE old_key = target_key), target_key) AS target_key,
       added AS added
  FROM derived_dependencies;

CREATE TABLE carry_derived_tags AS
SELECT (SELECT new_id FROM uuid_map WHERE kind = 'derived_tag' AND old_id = id) AS id,
       coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = flow_id), CASE WHEN flow_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', flow_id) END) AS flow_id,
       node_kind AS node_kind,
       coalesce((SELECT new_key FROM key_map WHERE old_key = node_key), node_key) AS node_key,
       coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = tag_id), CASE WHEN tag_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', tag_id) END) AS tag_id,
       added AS added
  FROM derived_tags;

CREATE TABLE carry_domains AS
SELECT (SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = id) AS id,
       title AS title,
       description AS description,
       subtype AS subtype,
       coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END) AS parent_id,
       color AS color,
       status AS status,
       knowledge_base_directory AS knowledge_base_directory,
       position AS position,
       is_private AS is_private
  FROM domains;

CREATE TABLE carry_events AS
SELECT (SELECT new_id FROM uuid_map WHERE kind = 'event' AND old_id = id) AS id,
       title AS title,
       scope_id AS scope_id,
       event_time AS event_time,
       linked_note AS linked_note
  FROM events;

CREATE TABLE carry_expectation_overlays AS
SELECT coalesce((SELECT new_key FROM key_map WHERE old_key = node_key), node_key) AS node_key,
       coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = flow_id), CASE WHEN flow_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', flow_id) END) AS flow_id,
       coalesce((SELECT new_key FROM key_map WHERE old_key = occurrence_key), occurrence_key) AS occurrence_key,
       title AS title,
       time_scope_start_id AS time_scope_start_id,
       time_scope_end_id AS time_scope_end_id,
       time_scope_duration_n AS time_scope_duration_n,
       time_scope_duration_kind AS time_scope_duration_kind,
       time_scope_set AS time_scope_set,
       check_every_n AS check_every_n,
       check_every_kind AS check_every_kind,
       check_every_set AS check_every_set,
       check_starting AS check_starting,
       is_private AS is_private,
       archival AS archival,
       agentic AS agentic,
       agentic_note AS agentic_note,
       agentic_note_set AS agentic_note_set,
       agentic_question AS agentic_question,
       agentic_answer AS agentic_answer,
       agentic_answer_set AS agentic_answer_set,
       status AS status,
       released_at AS released_at
  FROM expectation_overlays;

CREATE TABLE carry_expectations AS
SELECT (SELECT new_id FROM uuid_map WHERE kind = 'expectation' AND old_id = id) AS id,
       title AS title,
       parent_type AS parent_type,
       CASE parent_type
                WHEN 'aspect' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'project' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'domain' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'tag' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'goal' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'task' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'commitment' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'expectation' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'info' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'info' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_root' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_goal' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_task' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_commitment' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_expectation' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'person' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'person' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'event' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'event' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'thread' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'thread' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                ELSE CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END END AS parent_id,
       status AS status,
       archival AS archival,
       position AS position,
       is_private AS is_private,
       time_scope_start_id AS time_scope_start_id,
       time_scope_end_id AS time_scope_end_id,
       time_scope_duration_n AS time_scope_duration_n,
       time_scope_duration_kind AS time_scope_duration_kind,
       check_every_n AS check_every_n,
       check_every_kind AS check_every_kind,
       check_starting AS check_starting,
       last_check_at AS last_check_at,
       agentic AS agentic,
       agentic_note AS agentic_note,
       agentic_question AS agentic_question,
       agentic_answer AS agentic_answer,
       released_at AS released_at,
       agentic_review AS agentic_review,
       agentic_verdict AS agentic_verdict
  FROM expectations;

CREATE TABLE carry_flow_async_templates AS
SELECT coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = flow_id), CASE WHEN flow_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', flow_id) END) AS flow_id,
       title AS title,
       time_scope_n AS time_scope_n,
       time_scope_kind AS time_scope_kind,
       check_every_n AS check_every_n,
       check_every_kind AS check_every_kind
  FROM flow_async_templates;

CREATE TABLE carry_flow_commitments AS
SELECT (SELECT new_id FROM uuid_map WHERE kind = 'flow_commitment' AND old_id = id) AS id,
       coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = flow_id), CASE WHEN flow_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', flow_id) END) AS flow_id,
       title AS title,
       parent_type AS parent_type,
       CASE parent_type
                WHEN 'aspect' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'project' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'domain' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'tag' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'goal' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'task' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'commitment' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'expectation' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'info' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'info' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_root' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_goal' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_task' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_commitment' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_expectation' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'person' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'person' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'event' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'event' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'thread' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'thread' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                ELSE CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END END AS parent_id,
       position AS position,
       is_private AS is_private,
       verdict_window_n AS verdict_window_n,
       verdict_window_kind AS verdict_window_kind
  FROM flow_commitments;

CREATE TABLE carry_flow_dependencies AS
SELECT (SELECT new_id FROM uuid_map WHERE kind = 'flow_dependency' AND old_id = id) AS id,
       coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = flow_id), CASE WHEN flow_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', flow_id) END) AS flow_id,
       dependent_type AS dependent_type,
       CASE dependent_type
                WHEN 'aspect' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = dependent_id), CASE WHEN dependent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', dependent_id) END)
                WHEN 'project' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = dependent_id), CASE WHEN dependent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', dependent_id) END)
                WHEN 'domain' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = dependent_id), CASE WHEN dependent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', dependent_id) END)
                WHEN 'tag' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = dependent_id), CASE WHEN dependent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', dependent_id) END)
                WHEN 'goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'goal' AND old_id = dependent_id), CASE WHEN dependent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', dependent_id) END)
                WHEN 'task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'task' AND old_id = dependent_id), CASE WHEN dependent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', dependent_id) END)
                WHEN 'commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'commitment' AND old_id = dependent_id), CASE WHEN dependent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', dependent_id) END)
                WHEN 'expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'expectation' AND old_id = dependent_id), CASE WHEN dependent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', dependent_id) END)
                WHEN 'info' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'info' AND old_id = dependent_id), CASE WHEN dependent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', dependent_id) END)
                WHEN 'flow' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = dependent_id), CASE WHEN dependent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', dependent_id) END)
                WHEN 'flow_root' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = dependent_id), CASE WHEN dependent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', dependent_id) END)
                WHEN 'flow_goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_goal' AND old_id = dependent_id), CASE WHEN dependent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', dependent_id) END)
                WHEN 'flow_task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_task' AND old_id = dependent_id), CASE WHEN dependent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', dependent_id) END)
                WHEN 'flow_commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_commitment' AND old_id = dependent_id), CASE WHEN dependent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', dependent_id) END)
                WHEN 'flow_expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_expectation' AND old_id = dependent_id), CASE WHEN dependent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', dependent_id) END)
                WHEN 'person' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'person' AND old_id = dependent_id), CASE WHEN dependent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', dependent_id) END)
                WHEN 'event' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'event' AND old_id = dependent_id), CASE WHEN dependent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', dependent_id) END)
                WHEN 'thread' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'thread' AND old_id = dependent_id), CASE WHEN dependent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', dependent_id) END)
                ELSE CASE WHEN dependent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', dependent_id) END END AS dependent_id,
       depends_on_type AS depends_on_type,
       CASE depends_on_type
                WHEN 'aspect' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = depends_on_id), CASE WHEN depends_on_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', depends_on_id) END)
                WHEN 'project' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = depends_on_id), CASE WHEN depends_on_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', depends_on_id) END)
                WHEN 'domain' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = depends_on_id), CASE WHEN depends_on_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', depends_on_id) END)
                WHEN 'tag' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = depends_on_id), CASE WHEN depends_on_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', depends_on_id) END)
                WHEN 'goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'goal' AND old_id = depends_on_id), CASE WHEN depends_on_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', depends_on_id) END)
                WHEN 'task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'task' AND old_id = depends_on_id), CASE WHEN depends_on_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', depends_on_id) END)
                WHEN 'commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'commitment' AND old_id = depends_on_id), CASE WHEN depends_on_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', depends_on_id) END)
                WHEN 'expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'expectation' AND old_id = depends_on_id), CASE WHEN depends_on_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', depends_on_id) END)
                WHEN 'info' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'info' AND old_id = depends_on_id), CASE WHEN depends_on_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', depends_on_id) END)
                WHEN 'flow' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = depends_on_id), CASE WHEN depends_on_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', depends_on_id) END)
                WHEN 'flow_root' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = depends_on_id), CASE WHEN depends_on_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', depends_on_id) END)
                WHEN 'flow_goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_goal' AND old_id = depends_on_id), CASE WHEN depends_on_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', depends_on_id) END)
                WHEN 'flow_task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_task' AND old_id = depends_on_id), CASE WHEN depends_on_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', depends_on_id) END)
                WHEN 'flow_commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_commitment' AND old_id = depends_on_id), CASE WHEN depends_on_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', depends_on_id) END)
                WHEN 'flow_expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_expectation' AND old_id = depends_on_id), CASE WHEN depends_on_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', depends_on_id) END)
                WHEN 'person' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'person' AND old_id = depends_on_id), CASE WHEN depends_on_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', depends_on_id) END)
                WHEN 'event' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'event' AND old_id = depends_on_id), CASE WHEN depends_on_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', depends_on_id) END)
                WHEN 'thread' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'thread' AND old_id = depends_on_id), CASE WHEN depends_on_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', depends_on_id) END)
                ELSE CASE WHEN depends_on_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', depends_on_id) END END AS depends_on_id
  FROM flow_dependencies;

CREATE TABLE carry_flow_expectations AS
SELECT (SELECT new_id FROM uuid_map WHERE kind = 'flow_expectation' AND old_id = id) AS id,
       coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = flow_id), CASE WHEN flow_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', flow_id) END) AS flow_id,
       title AS title,
       parent_type AS parent_type,
       CASE parent_type
                WHEN 'aspect' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'project' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'domain' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'tag' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'goal' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'task' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'commitment' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'expectation' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'info' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'info' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_root' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_goal' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_task' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_commitment' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_expectation' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'person' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'person' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'event' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'event' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'thread' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'thread' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                ELSE CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END END AS parent_id,
       position AS position,
       is_private AS is_private,
       check_every_n AS check_every_n,
       check_every_kind AS check_every_kind,
       first_check_kind AS first_check_kind,
       first_check_index AS first_check_index
  FROM flow_expectations;

CREATE TABLE carry_flow_goals AS
SELECT (SELECT new_id FROM uuid_map WHERE kind = 'flow_goal' AND old_id = id) AS id,
       coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = flow_id), CASE WHEN flow_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', flow_id) END) AS flow_id,
       title AS title,
       parent_type AS parent_type,
       CASE parent_type
                WHEN 'aspect' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'project' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'domain' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'tag' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'goal' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'task' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'commitment' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'expectation' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'info' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'info' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_root' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_goal' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_task' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_commitment' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_expectation' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'person' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'person' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'event' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'event' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'thread' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'thread' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                ELSE CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END END AS parent_id,
       position AS position,
       is_private AS is_private
  FROM flow_goals;

CREATE TABLE carry_flow_instance_nodes AS
SELECT (SELECT new_id FROM uuid_map WHERE kind = 'flow_instance_node' AND old_id = id) AS id,
       coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_instance' AND old_id = flow_instance_id), CASE WHEN flow_instance_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', flow_instance_id) END) AS flow_instance_id,
       node_type AS node_type,
       CASE node_type
                WHEN 'aspect' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = node_id), CASE WHEN node_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', node_id) END)
                WHEN 'project' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = node_id), CASE WHEN node_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', node_id) END)
                WHEN 'domain' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = node_id), CASE WHEN node_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', node_id) END)
                WHEN 'tag' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = node_id), CASE WHEN node_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', node_id) END)
                WHEN 'goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'goal' AND old_id = node_id), CASE WHEN node_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', node_id) END)
                WHEN 'task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'task' AND old_id = node_id), CASE WHEN node_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', node_id) END)
                WHEN 'commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'commitment' AND old_id = node_id), CASE WHEN node_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', node_id) END)
                WHEN 'expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'expectation' AND old_id = node_id), CASE WHEN node_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', node_id) END)
                WHEN 'info' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'info' AND old_id = node_id), CASE WHEN node_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', node_id) END)
                WHEN 'flow' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = node_id), CASE WHEN node_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', node_id) END)
                WHEN 'flow_root' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = node_id), CASE WHEN node_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', node_id) END)
                WHEN 'flow_goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_goal' AND old_id = node_id), CASE WHEN node_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', node_id) END)
                WHEN 'flow_task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_task' AND old_id = node_id), CASE WHEN node_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', node_id) END)
                WHEN 'flow_commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_commitment' AND old_id = node_id), CASE WHEN node_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', node_id) END)
                WHEN 'flow_expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_expectation' AND old_id = node_id), CASE WHEN node_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', node_id) END)
                WHEN 'person' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'person' AND old_id = node_id), CASE WHEN node_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', node_id) END)
                WHEN 'event' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'event' AND old_id = node_id), CASE WHEN node_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', node_id) END)
                WHEN 'thread' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'thread' AND old_id = node_id), CASE WHEN node_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', node_id) END)
                ELSE CASE WHEN node_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', node_id) END END AS node_id,
       source_item_type AS source_item_type,
       CASE source_item_type
                WHEN 'aspect' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = source_item_id), CASE WHEN source_item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', source_item_id) END)
                WHEN 'project' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = source_item_id), CASE WHEN source_item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', source_item_id) END)
                WHEN 'domain' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = source_item_id), CASE WHEN source_item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', source_item_id) END)
                WHEN 'tag' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = source_item_id), CASE WHEN source_item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', source_item_id) END)
                WHEN 'goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'goal' AND old_id = source_item_id), CASE WHEN source_item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', source_item_id) END)
                WHEN 'task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'task' AND old_id = source_item_id), CASE WHEN source_item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', source_item_id) END)
                WHEN 'commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'commitment' AND old_id = source_item_id), CASE WHEN source_item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', source_item_id) END)
                WHEN 'expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'expectation' AND old_id = source_item_id), CASE WHEN source_item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', source_item_id) END)
                WHEN 'info' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'info' AND old_id = source_item_id), CASE WHEN source_item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', source_item_id) END)
                WHEN 'flow' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = source_item_id), CASE WHEN source_item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', source_item_id) END)
                WHEN 'flow_root' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = source_item_id), CASE WHEN source_item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', source_item_id) END)
                WHEN 'flow_goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_goal' AND old_id = source_item_id), CASE WHEN source_item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', source_item_id) END)
                WHEN 'flow_task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_task' AND old_id = source_item_id), CASE WHEN source_item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', source_item_id) END)
                WHEN 'flow_commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_commitment' AND old_id = source_item_id), CASE WHEN source_item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', source_item_id) END)
                WHEN 'flow_expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_expectation' AND old_id = source_item_id), CASE WHEN source_item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', source_item_id) END)
                WHEN 'person' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'person' AND old_id = source_item_id), CASE WHEN source_item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', source_item_id) END)
                WHEN 'event' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'event' AND old_id = source_item_id), CASE WHEN source_item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', source_item_id) END)
                WHEN 'thread' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'thread' AND old_id = source_item_id), CASE WHEN source_item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', source_item_id) END)
                ELSE CASE WHEN source_item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', source_item_id) END END AS source_item_id,
       original_parent_type AS original_parent_type,
       CASE original_parent_type
                WHEN 'aspect' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = original_parent_id), CASE WHEN original_parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', original_parent_id) END)
                WHEN 'project' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = original_parent_id), CASE WHEN original_parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', original_parent_id) END)
                WHEN 'domain' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = original_parent_id), CASE WHEN original_parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', original_parent_id) END)
                WHEN 'tag' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = original_parent_id), CASE WHEN original_parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', original_parent_id) END)
                WHEN 'goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'goal' AND old_id = original_parent_id), CASE WHEN original_parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', original_parent_id) END)
                WHEN 'task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'task' AND old_id = original_parent_id), CASE WHEN original_parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', original_parent_id) END)
                WHEN 'commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'commitment' AND old_id = original_parent_id), CASE WHEN original_parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', original_parent_id) END)
                WHEN 'expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'expectation' AND old_id = original_parent_id), CASE WHEN original_parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', original_parent_id) END)
                WHEN 'info' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'info' AND old_id = original_parent_id), CASE WHEN original_parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', original_parent_id) END)
                WHEN 'flow' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = original_parent_id), CASE WHEN original_parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', original_parent_id) END)
                WHEN 'flow_root' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = original_parent_id), CASE WHEN original_parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', original_parent_id) END)
                WHEN 'flow_goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_goal' AND old_id = original_parent_id), CASE WHEN original_parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', original_parent_id) END)
                WHEN 'flow_task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_task' AND old_id = original_parent_id), CASE WHEN original_parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', original_parent_id) END)
                WHEN 'flow_commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_commitment' AND old_id = original_parent_id), CASE WHEN original_parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', original_parent_id) END)
                WHEN 'flow_expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_expectation' AND old_id = original_parent_id), CASE WHEN original_parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', original_parent_id) END)
                WHEN 'person' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'person' AND old_id = original_parent_id), CASE WHEN original_parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', original_parent_id) END)
                WHEN 'event' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'event' AND old_id = original_parent_id), CASE WHEN original_parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', original_parent_id) END)
                WHEN 'thread' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'thread' AND old_id = original_parent_id), CASE WHEN original_parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', original_parent_id) END)
                ELSE CASE WHEN original_parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', original_parent_id) END END AS original_parent_id
  FROM flow_instance_nodes;

CREATE TABLE carry_flow_instances AS
SELECT (SELECT new_id FROM uuid_map WHERE kind = 'flow_instance' AND old_id = id) AS id,
       coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = flow_id), CASE WHEN flow_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', flow_id) END) AS flow_id,
       root_type AS root_type,
       CASE root_type
                WHEN 'aspect' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = root_id), CASE WHEN root_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', root_id) END)
                WHEN 'project' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = root_id), CASE WHEN root_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', root_id) END)
                WHEN 'domain' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = root_id), CASE WHEN root_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', root_id) END)
                WHEN 'tag' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = root_id), CASE WHEN root_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', root_id) END)
                WHEN 'goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'goal' AND old_id = root_id), CASE WHEN root_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', root_id) END)
                WHEN 'task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'task' AND old_id = root_id), CASE WHEN root_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', root_id) END)
                WHEN 'commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'commitment' AND old_id = root_id), CASE WHEN root_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', root_id) END)
                WHEN 'expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'expectation' AND old_id = root_id), CASE WHEN root_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', root_id) END)
                WHEN 'info' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'info' AND old_id = root_id), CASE WHEN root_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', root_id) END)
                WHEN 'flow' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = root_id), CASE WHEN root_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', root_id) END)
                WHEN 'flow_root' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = root_id), CASE WHEN root_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', root_id) END)
                WHEN 'flow_goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_goal' AND old_id = root_id), CASE WHEN root_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', root_id) END)
                WHEN 'flow_task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_task' AND old_id = root_id), CASE WHEN root_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', root_id) END)
                WHEN 'flow_commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_commitment' AND old_id = root_id), CASE WHEN root_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', root_id) END)
                WHEN 'flow_expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_expectation' AND old_id = root_id), CASE WHEN root_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', root_id) END)
                WHEN 'person' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'person' AND old_id = root_id), CASE WHEN root_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', root_id) END)
                WHEN 'event' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'event' AND old_id = root_id), CASE WHEN root_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', root_id) END)
                WHEN 'thread' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'thread' AND old_id = root_id), CASE WHEN root_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', root_id) END)
                ELSE CASE WHEN root_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', root_id) END END AS root_id,
       started_at AS started_at
  FROM flow_instances;

CREATE TABLE carry_flow_item_cycles AS
SELECT (SELECT new_id FROM uuid_map WHERE kind = 'flow_item_cycle' AND old_id = id) AS id,
       coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = flow_id), CASE WHEN flow_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', flow_id) END) AS flow_id,
       item_type AS item_type,
       CASE item_type
                WHEN 'aspect' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'project' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'domain' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'tag' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'goal' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'task' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'commitment' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'expectation' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'info' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'info' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'flow' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'flow_root' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'flow_goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_goal' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'flow_task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_task' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'flow_commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_commitment' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'flow_expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_expectation' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'person' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'person' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'event' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'event' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'thread' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'thread' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                ELSE CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END END AS item_id,
       scope_kind AS scope_kind,
       scope_index AS scope_index,
       plan_kind AS plan_kind,
       plan_start AS plan_start,
       plan_end AS plan_end,
       position AS position
  FROM flow_item_cycles;

CREATE TABLE carry_flow_recurrences AS
SELECT coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = flow_id), CASE WHEN flow_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', flow_id) END) AS flow_id,
       start_scope_id AS start_scope_id,
       gap_n AS gap_n,
       gap_kind AS gap_kind,
       end_scope_id AS end_scope_id,
       clock AS clock,
       miss_policy AS miss_policy,
       cooldown_n AS cooldown_n,
       cooldown_kind AS cooldown_kind
  FROM flow_recurrences;

CREATE TABLE carry_flow_task_async_templates AS
SELECT coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_task' AND old_id = flow_task_id), CASE WHEN flow_task_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', flow_task_id) END) AS flow_task_id,
       title AS title,
       time_scope_n AS time_scope_n,
       time_scope_kind AS time_scope_kind,
       check_every_n AS check_every_n,
       check_every_kind AS check_every_kind
  FROM flow_task_async_templates;

CREATE TABLE carry_flow_tasks AS
SELECT (SELECT new_id FROM uuid_map WHERE kind = 'flow_task' AND old_id = id) AS id,
       coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = flow_id), CASE WHEN flow_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', flow_id) END) AS flow_id,
       title AS title,
       parent_type AS parent_type,
       CASE parent_type
                WHEN 'aspect' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'project' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'domain' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'tag' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'goal' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'task' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'commitment' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'expectation' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'info' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'info' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_root' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_goal' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_task' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_commitment' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_expectation' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'person' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'person' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'event' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'event' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'thread' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'thread' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                ELSE CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END END AS parent_id,
       position AS position,
       is_private AS is_private,
       delegate_kind AS delegate_kind,
       coalesce((SELECT new_id FROM uuid_map WHERE kind = 'person' AND old_id = delegate_id), CASE WHEN delegate_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', delegate_id) END) AS delegate_id,
       agentic AS agentic,
       asynchronous AS asynchronous,
       archival AS archival,
       compound AS compound
  FROM flow_tasks;

CREATE TABLE carry_flows AS
SELECT (SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = id) AS id,
       title AS title,
       instance_type AS instance_type,
       parent_type AS parent_type,
       CASE parent_type
                WHEN 'aspect' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'project' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'domain' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'tag' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'goal' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'task' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'commitment' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'expectation' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'info' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'info' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_root' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_goal' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_task' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_commitment' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_expectation' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'person' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'person' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'event' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'event' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'thread' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'thread' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                ELSE CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END END AS parent_id,
       target_type AS target_type,
       CASE target_type
                WHEN 'aspect' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = target_id), CASE WHEN target_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', target_id) END)
                WHEN 'project' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = target_id), CASE WHEN target_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', target_id) END)
                WHEN 'domain' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = target_id), CASE WHEN target_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', target_id) END)
                WHEN 'tag' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = target_id), CASE WHEN target_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', target_id) END)
                WHEN 'goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'goal' AND old_id = target_id), CASE WHEN target_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', target_id) END)
                WHEN 'task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'task' AND old_id = target_id), CASE WHEN target_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', target_id) END)
                WHEN 'commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'commitment' AND old_id = target_id), CASE WHEN target_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', target_id) END)
                WHEN 'expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'expectation' AND old_id = target_id), CASE WHEN target_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', target_id) END)
                WHEN 'info' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'info' AND old_id = target_id), CASE WHEN target_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', target_id) END)
                WHEN 'flow' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = target_id), CASE WHEN target_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', target_id) END)
                WHEN 'flow_root' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = target_id), CASE WHEN target_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', target_id) END)
                WHEN 'flow_goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_goal' AND old_id = target_id), CASE WHEN target_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', target_id) END)
                WHEN 'flow_task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_task' AND old_id = target_id), CASE WHEN target_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', target_id) END)
                WHEN 'flow_commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_commitment' AND old_id = target_id), CASE WHEN target_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', target_id) END)
                WHEN 'flow_expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_expectation' AND old_id = target_id), CASE WHEN target_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', target_id) END)
                WHEN 'person' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'person' AND old_id = target_id), CASE WHEN target_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', target_id) END)
                WHEN 'event' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'event' AND old_id = target_id), CASE WHEN target_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', target_id) END)
                WHEN 'thread' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'thread' AND old_id = target_id), CASE WHEN target_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', target_id) END)
                ELSE CASE WHEN target_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', target_id) END END AS target_id,
       flow_duration_n AS flow_duration_n,
       flow_duration_kind AS flow_duration_kind,
       position AS position,
       flow_window_part AS flow_window_part,
       flow_window_time_start AS flow_window_time_start,
       flow_window_time_end AS flow_window_time_end,
       root_plan_kind AS root_plan_kind,
       root_plan_start AS root_plan_start,
       root_plan_end AS root_plan_end,
       is_private AS is_private,
       verdict_window_n AS verdict_window_n,
       verdict_window_kind AS verdict_window_kind,
       delegate_kind AS delegate_kind,
       coalesce((SELECT new_id FROM uuid_map WHERE kind = 'person' AND old_id = delegate_id), CASE WHEN delegate_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', delegate_id) END) AS delegate_id,
       agentic AS agentic,
       asynchronous AS asynchronous,
       archival AS archival,
       compound AS compound
  FROM flows;

CREATE TABLE carry_goal_knowledge_base_links AS
SELECT coalesce((SELECT new_id FROM uuid_map WHERE kind = 'goal' AND old_id = goal_id), CASE WHEN goal_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', goal_id) END) AS goal_id,
       entity_type AS entity_type,
       CASE entity_type
                WHEN 'aspect' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = entity_id), CASE WHEN entity_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', entity_id) END)
                WHEN 'project' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = entity_id), CASE WHEN entity_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', entity_id) END)
                WHEN 'domain' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = entity_id), CASE WHEN entity_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', entity_id) END)
                WHEN 'tag' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = entity_id), CASE WHEN entity_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', entity_id) END)
                WHEN 'goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'goal' AND old_id = entity_id), CASE WHEN entity_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', entity_id) END)
                WHEN 'task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'task' AND old_id = entity_id), CASE WHEN entity_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', entity_id) END)
                WHEN 'commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'commitment' AND old_id = entity_id), CASE WHEN entity_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', entity_id) END)
                WHEN 'expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'expectation' AND old_id = entity_id), CASE WHEN entity_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', entity_id) END)
                WHEN 'info' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'info' AND old_id = entity_id), CASE WHEN entity_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', entity_id) END)
                WHEN 'flow' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = entity_id), CASE WHEN entity_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', entity_id) END)
                WHEN 'flow_root' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = entity_id), CASE WHEN entity_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', entity_id) END)
                WHEN 'flow_goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_goal' AND old_id = entity_id), CASE WHEN entity_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', entity_id) END)
                WHEN 'flow_task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_task' AND old_id = entity_id), CASE WHEN entity_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', entity_id) END)
                WHEN 'flow_commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_commitment' AND old_id = entity_id), CASE WHEN entity_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', entity_id) END)
                WHEN 'flow_expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_expectation' AND old_id = entity_id), CASE WHEN entity_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', entity_id) END)
                WHEN 'person' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'person' AND old_id = entity_id), CASE WHEN entity_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', entity_id) END)
                WHEN 'event' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'event' AND old_id = entity_id), CASE WHEN entity_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', entity_id) END)
                WHEN 'thread' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'thread' AND old_id = entity_id), CASE WHEN entity_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', entity_id) END)
                ELSE CASE WHEN entity_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', entity_id) END END AS entity_id
  FROM goal_knowledge_base_links;

CREATE TABLE carry_goal_overlays AS
SELECT (SELECT new_id FROM uuid_map WHERE kind = 'goal_overlay' AND old_id = id) AS id,
       coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = flow_id), CASE WHEN flow_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', flow_id) END) AS flow_id,
       item_type AS item_type,
       CASE item_type
                WHEN 'aspect' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'project' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'domain' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'tag' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'goal' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'task' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'commitment' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'expectation' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'info' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'info' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'flow' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'flow_root' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'flow_goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_goal' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'flow_task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_task' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'flow_commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_commitment' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'flow_expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_expectation' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'person' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'person' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'event' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'event' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'thread' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'thread' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                ELSE CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END END AS item_id,
       iteration_scope AS iteration_scope,
       CASE WHEN cycle_id = 0 THEN '00000000-0000-0000-0000-000000000000' ELSE coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_item_cycle' AND old_id = cycle_id), CASE WHEN cycle_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', cycle_id) END) END AS cycle_id,
       status AS status,
       resolved_at AS resolved_at,
       tombstone AS tombstone,
       title AS title,
       is_private AS is_private,
       position AS position,
       block_reasons_set AS block_reasons_set
  FROM goal_overlays;

CREATE TABLE carry_goals AS
SELECT (SELECT new_id FROM uuid_map WHERE kind = 'goal' AND old_id = id) AS id,
       title AS title,
       parent_type AS parent_type,
       CASE parent_type
                WHEN 'aspect' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'project' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'domain' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'tag' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'goal' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'task' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'commitment' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'expectation' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'info' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'info' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_root' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_goal' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_task' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_commitment' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_expectation' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'person' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'person' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'event' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'event' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'thread' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'thread' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                ELSE CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END END AS parent_id,
       status AS status,
       position AS position,
       time_scope_start_id AS time_scope_start_id,
       time_scope_end_id AS time_scope_end_id,
       time_scope_duration_n AS time_scope_duration_n,
       time_scope_duration_kind AS time_scope_duration_kind,
       on_scope_exit AS on_scope_exit,
       is_private AS is_private,
       achieved_at AS achieved_at
  FROM goals;

CREATE TABLE carry_infos AS
SELECT (SELECT new_id FROM uuid_map WHERE kind = 'info' AND old_id = id) AS id,
       body AS body,
       parent_type AS parent_type,
       CASE parent_type
                WHEN 'aspect' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'project' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'domain' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'tag' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'goal' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'task' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'commitment' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'expectation' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'info' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'info' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_root' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_goal' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_task' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_commitment' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_expectation' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'person' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'person' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'event' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'event' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'thread' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'thread' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                ELSE CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END END AS parent_id,
       position AS position,
       created_at AS created_at,
       updated_at AS updated_at,
       details AS details,
       is_private AS is_private
  FROM infos;

CREATE TABLE carry_mcp_roots AS
SELECT (SELECT new_id FROM uuid_map WHERE kind = 'mcp_root' AND old_id = id) AS id,
       node_kind AS node_kind,
       CASE node_kind
                WHEN 'aspect' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = node_id), CASE WHEN node_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', node_id) END)
                WHEN 'project' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = node_id), CASE WHEN node_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', node_id) END)
                WHEN 'domain' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = node_id), CASE WHEN node_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', node_id) END)
                WHEN 'tag' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = node_id), CASE WHEN node_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', node_id) END)
                WHEN 'goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'goal' AND old_id = node_id), CASE WHEN node_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', node_id) END)
                WHEN 'task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'task' AND old_id = node_id), CASE WHEN node_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', node_id) END)
                WHEN 'commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'commitment' AND old_id = node_id), CASE WHEN node_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', node_id) END)
                WHEN 'expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'expectation' AND old_id = node_id), CASE WHEN node_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', node_id) END)
                WHEN 'info' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'info' AND old_id = node_id), CASE WHEN node_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', node_id) END)
                WHEN 'flow' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = node_id), CASE WHEN node_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', node_id) END)
                WHEN 'flow_root' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = node_id), CASE WHEN node_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', node_id) END)
                WHEN 'flow_goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_goal' AND old_id = node_id), CASE WHEN node_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', node_id) END)
                WHEN 'flow_task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_task' AND old_id = node_id), CASE WHEN node_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', node_id) END)
                WHEN 'flow_commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_commitment' AND old_id = node_id), CASE WHEN node_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', node_id) END)
                WHEN 'flow_expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_expectation' AND old_id = node_id), CASE WHEN node_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', node_id) END)
                WHEN 'person' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'person' AND old_id = node_id), CASE WHEN node_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', node_id) END)
                WHEN 'event' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'event' AND old_id = node_id), CASE WHEN node_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', node_id) END)
                WHEN 'thread' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'thread' AND old_id = node_id), CASE WHEN node_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', node_id) END)
                ELSE CASE WHEN node_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', node_id) END END AS node_id
  FROM mcp_roots;

CREATE TABLE carry_occurrence_async_templates AS
SELECT coalesce((SELECT new_key FROM key_map WHERE old_key = node_key), node_key) AS node_key,
       coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = flow_id), CASE WHEN flow_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', flow_id) END) AS flow_id,
       title AS title,
       time_scope_n AS time_scope_n,
       time_scope_kind AS time_scope_kind,
       check_every_n AS check_every_n,
       check_every_kind AS check_every_kind
  FROM occurrence_async_templates;

CREATE TABLE carry_occurrence_spawned_waits AS
SELECT coalesce((SELECT new_key FROM key_map WHERE old_key = node_key), node_key) AS node_key,
       coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = flow_id), CASE WHEN flow_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', flow_id) END) AS flow_id,
       status AS status,
       archival AS archival,
       released_at AS released_at
  FROM occurrence_spawned_waits;

CREATE TABLE carry_people AS
SELECT (SELECT new_id FROM uuid_map WHERE kind = 'person' AND old_id = id) AS id,
       name AS name,
       aliases AS aliases,
       linked_note AS linked_note
  FROM people;

CREATE TABLE carry_retired_beads_ids AS
SELECT table_name AS table_name,
       CASE table_name
                WHEN 'domains' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = row_id), CASE WHEN row_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', row_id) END)
                WHEN 'goals' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'goal' AND old_id = row_id), CASE WHEN row_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', row_id) END)
                WHEN 'tasks' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'task' AND old_id = row_id), CASE WHEN row_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', row_id) END)
                WHEN 'commitments' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'commitment' AND old_id = row_id), CASE WHEN row_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', row_id) END)
                WHEN 'expectations' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'expectation' AND old_id = row_id), CASE WHEN row_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', row_id) END)
                WHEN 'infos' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'info' AND old_id = row_id), CASE WHEN row_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', row_id) END)
                WHEN 'flows' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = row_id), CASE WHEN row_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', row_id) END)
                WHEN 'flow_goals' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_goal' AND old_id = row_id), CASE WHEN row_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', row_id) END)
                WHEN 'flow_tasks' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_task' AND old_id = row_id), CASE WHEN row_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', row_id) END)
                WHEN 'flow_commitments' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_commitment' AND old_id = row_id), CASE WHEN row_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', row_id) END)
                WHEN 'flow_expectations' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_expectation' AND old_id = row_id), CASE WHEN row_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', row_id) END)
                WHEN 'people' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'person' AND old_id = row_id), CASE WHEN row_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', row_id) END)
                WHEN 'events' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'event' AND old_id = row_id), CASE WHEN row_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', row_id) END)
                WHEN 'threads' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'thread' AND old_id = row_id), CASE WHEN row_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', row_id) END)
                ELSE CASE WHEN row_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', row_id) END END AS row_id,
       beads_id AS beads_id
  FROM retired_beads_ids;

CREATE TABLE carry_spawned_waits AS
SELECT coalesce((SELECT new_id FROM uuid_map WHERE kind = 'task' AND old_id = task_id), CASE WHEN task_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', task_id) END) AS task_id,
       status AS status,
       archival AS archival,
       last_check_at AS last_check_at,
       released_at AS released_at
  FROM spawned_waits;

CREATE TABLE carry_tags_on_async_templates AS
SELECT coalesce((SELECT new_id FROM uuid_map WHERE kind = 'task' AND old_id = task_id), CASE WHEN task_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', task_id) END) AS task_id,
       coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = tag_id), CASE WHEN tag_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', tag_id) END) AS tag_id
  FROM tags_on_async_templates;

CREATE TABLE carry_tags_on_commitments AS
SELECT coalesce((SELECT new_id FROM uuid_map WHERE kind = 'commitment' AND old_id = commitment_id), CASE WHEN commitment_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', commitment_id) END) AS commitment_id,
       coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = tag_id), CASE WHEN tag_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', tag_id) END) AS tag_id
  FROM tags_on_commitments;

CREATE TABLE carry_tags_on_expectations AS
SELECT coalesce((SELECT new_id FROM uuid_map WHERE kind = 'expectation' AND old_id = expectation_id), CASE WHEN expectation_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', expectation_id) END) AS expectation_id,
       coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = tag_id), CASE WHEN tag_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', tag_id) END) AS tag_id
  FROM tags_on_expectations;

CREATE TABLE carry_tags_on_flow_async_templates AS
SELECT coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = flow_id), CASE WHEN flow_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', flow_id) END) AS flow_id,
       coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = tag_id), CASE WHEN tag_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', tag_id) END) AS tag_id
  FROM tags_on_flow_async_templates;

CREATE TABLE carry_tags_on_flow_task_async_templates AS
SELECT coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_task' AND old_id = flow_task_id), CASE WHEN flow_task_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', flow_task_id) END) AS flow_task_id,
       coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = tag_id), CASE WHEN tag_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', tag_id) END) AS tag_id
  FROM tags_on_flow_task_async_templates;

CREATE TABLE carry_tags_on_goals AS
SELECT coalesce((SELECT new_id FROM uuid_map WHERE kind = 'goal' AND old_id = goal_id), CASE WHEN goal_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', goal_id) END) AS goal_id,
       coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = tag_id), CASE WHEN tag_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', tag_id) END) AS tag_id
  FROM tags_on_goals;

CREATE TABLE carry_tags_on_occurrence_async_templates AS
SELECT coalesce((SELECT new_key FROM key_map WHERE old_key = node_key), node_key) AS node_key,
       coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = tag_id), CASE WHEN tag_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', tag_id) END) AS tag_id
  FROM tags_on_occurrence_async_templates;

CREATE TABLE carry_tags_on_tasks AS
SELECT coalesce((SELECT new_id FROM uuid_map WHERE kind = 'task' AND old_id = task_id), CASE WHEN task_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', task_id) END) AS task_id,
       coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = tag_id), CASE WHEN tag_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', tag_id) END) AS tag_id
  FROM tags_on_tasks;

CREATE TABLE carry_task_agentic_briefs AS
SELECT coalesce((SELECT new_id FROM uuid_map WHERE kind = 'task' AND old_id = task_id), CASE WHEN task_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', task_id) END) AS task_id,
       priority AS priority,
       spec AS spec,
       design AS design,
       acceptance AS acceptance,
       notes AS notes
  FROM task_agentic_briefs;

CREATE TABLE carry_task_async_templates AS
SELECT coalesce((SELECT new_id FROM uuid_map WHERE kind = 'task' AND old_id = task_id), CASE WHEN task_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', task_id) END) AS task_id,
       title AS title,
       time_scope_n AS time_scope_n,
       time_scope_kind AS time_scope_kind,
       check_every_n AS check_every_n,
       check_every_kind AS check_every_kind
  FROM task_async_templates;

CREATE TABLE carry_task_dependencies AS
SELECT coalesce((SELECT new_id FROM uuid_map WHERE kind = 'task' AND old_id = task_id), CASE WHEN task_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', task_id) END) AS task_id,
       dependency_type AS dependency_type,
       CASE dependency_type
                WHEN 'aspect' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = dependency_id), CASE WHEN dependency_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', dependency_id) END)
                WHEN 'project' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = dependency_id), CASE WHEN dependency_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', dependency_id) END)
                WHEN 'domain' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = dependency_id), CASE WHEN dependency_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', dependency_id) END)
                WHEN 'tag' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = dependency_id), CASE WHEN dependency_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', dependency_id) END)
                WHEN 'goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'goal' AND old_id = dependency_id), CASE WHEN dependency_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', dependency_id) END)
                WHEN 'task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'task' AND old_id = dependency_id), CASE WHEN dependency_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', dependency_id) END)
                WHEN 'commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'commitment' AND old_id = dependency_id), CASE WHEN dependency_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', dependency_id) END)
                WHEN 'expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'expectation' AND old_id = dependency_id), CASE WHEN dependency_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', dependency_id) END)
                WHEN 'info' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'info' AND old_id = dependency_id), CASE WHEN dependency_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', dependency_id) END)
                WHEN 'flow' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = dependency_id), CASE WHEN dependency_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', dependency_id) END)
                WHEN 'flow_root' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = dependency_id), CASE WHEN dependency_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', dependency_id) END)
                WHEN 'flow_goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_goal' AND old_id = dependency_id), CASE WHEN dependency_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', dependency_id) END)
                WHEN 'flow_task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_task' AND old_id = dependency_id), CASE WHEN dependency_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', dependency_id) END)
                WHEN 'flow_commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_commitment' AND old_id = dependency_id), CASE WHEN dependency_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', dependency_id) END)
                WHEN 'flow_expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_expectation' AND old_id = dependency_id), CASE WHEN dependency_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', dependency_id) END)
                WHEN 'person' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'person' AND old_id = dependency_id), CASE WHEN dependency_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', dependency_id) END)
                WHEN 'event' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'event' AND old_id = dependency_id), CASE WHEN dependency_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', dependency_id) END)
                WHEN 'thread' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'thread' AND old_id = dependency_id), CASE WHEN dependency_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', dependency_id) END)
                ELSE CASE WHEN dependency_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', dependency_id) END END AS dependency_id
  FROM task_dependencies;

CREATE TABLE carry_task_knowledge_base_links AS
SELECT coalesce((SELECT new_id FROM uuid_map WHERE kind = 'task' AND old_id = task_id), CASE WHEN task_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', task_id) END) AS task_id,
       entity_type AS entity_type,
       CASE entity_type
                WHEN 'aspect' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = entity_id), CASE WHEN entity_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', entity_id) END)
                WHEN 'project' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = entity_id), CASE WHEN entity_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', entity_id) END)
                WHEN 'domain' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = entity_id), CASE WHEN entity_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', entity_id) END)
                WHEN 'tag' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = entity_id), CASE WHEN entity_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', entity_id) END)
                WHEN 'goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'goal' AND old_id = entity_id), CASE WHEN entity_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', entity_id) END)
                WHEN 'task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'task' AND old_id = entity_id), CASE WHEN entity_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', entity_id) END)
                WHEN 'commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'commitment' AND old_id = entity_id), CASE WHEN entity_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', entity_id) END)
                WHEN 'expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'expectation' AND old_id = entity_id), CASE WHEN entity_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', entity_id) END)
                WHEN 'info' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'info' AND old_id = entity_id), CASE WHEN entity_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', entity_id) END)
                WHEN 'flow' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = entity_id), CASE WHEN entity_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', entity_id) END)
                WHEN 'flow_root' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = entity_id), CASE WHEN entity_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', entity_id) END)
                WHEN 'flow_goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_goal' AND old_id = entity_id), CASE WHEN entity_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', entity_id) END)
                WHEN 'flow_task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_task' AND old_id = entity_id), CASE WHEN entity_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', entity_id) END)
                WHEN 'flow_commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_commitment' AND old_id = entity_id), CASE WHEN entity_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', entity_id) END)
                WHEN 'flow_expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_expectation' AND old_id = entity_id), CASE WHEN entity_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', entity_id) END)
                WHEN 'person' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'person' AND old_id = entity_id), CASE WHEN entity_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', entity_id) END)
                WHEN 'event' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'event' AND old_id = entity_id), CASE WHEN entity_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', entity_id) END)
                WHEN 'thread' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'thread' AND old_id = entity_id), CASE WHEN entity_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', entity_id) END)
                ELSE CASE WHEN entity_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', entity_id) END END AS entity_id
  FROM task_knowledge_base_links;

CREATE TABLE carry_task_overlays AS
SELECT (SELECT new_id FROM uuid_map WHERE kind = 'task_overlay' AND old_id = id) AS id,
       origin AS origin,
       coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = flow_id), CASE WHEN flow_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', flow_id) END) AS flow_id,
       item_type AS item_type,
       CASE item_type
                WHEN 'aspect' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'project' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'domain' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'tag' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'goal' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'task' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'commitment' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'expectation' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'info' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'info' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'flow' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'flow_root' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'flow_goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_goal' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'flow_task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_task' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'flow_commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_commitment' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'flow_expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_expectation' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'person' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'person' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'event' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'event' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'thread' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'thread' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                ELSE CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END END AS item_id,
       iteration_scope AS iteration_scope,
       CASE WHEN cycle_id = 0 THEN '00000000-0000-0000-0000-000000000000' ELSE coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_item_cycle' AND old_id = cycle_id), CASE WHEN cycle_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', cycle_id) END) END AS cycle_id,
       coalesce((SELECT new_key FROM key_map WHERE old_key = wait_key), wait_key) AS wait_key,
       due_at AS due_at,
       status AS status,
       resolved_at AS resolved_at,
       tombstone AS tombstone,
       title AS title,
       plan_start_id AS plan_start_id,
       plan_end_id AS plan_end_id,
       plan_set AS plan_set,
       delegate_kind AS delegate_kind,
       coalesce((SELECT new_id FROM uuid_map WHERE kind = 'person' AND old_id = delegate_id), CASE WHEN delegate_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', delegate_id) END) AS delegate_id,
       delegate_set AS delegate_set,
       agentic AS agentic,
       agentic_set AS agentic_set,
       asynchronous AS asynchronous,
       archival AS archival,
       is_private AS is_private,
       position AS position,
       block_reasons_set AS block_reasons_set,
       brief_priority AS brief_priority,
       brief_priority_set AS brief_priority_set,
       brief_spec AS brief_spec,
       brief_design AS brief_design,
       brief_acceptance AS brief_acceptance,
       brief_notes AS brief_notes,
       due_scope_start_id AS due_scope_start_id,
       due_scope_end_id AS due_scope_end_id,
       compound AS compound,
       async_template_set AS async_template_set
  FROM task_overlays;

CREATE TABLE carry_tasks AS
SELECT (SELECT new_id FROM uuid_map WHERE kind = 'task' AND old_id = id) AS id,
       title AS title,
       parent_type AS parent_type,
       CASE parent_type
                WHEN 'aspect' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'project' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'domain' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'tag' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'goal' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'task' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'commitment' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'expectation' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'info' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'info' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_root' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_goal' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_task' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_commitment' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'flow_expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_expectation' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'person' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'person' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'event' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'event' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                WHEN 'thread' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'thread' AND old_id = parent_id), CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END)
                ELSE CASE WHEN parent_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', parent_id) END END AS parent_id,
       status AS status,
       delegate_kind AS delegate_kind,
       coalesce((SELECT new_id FROM uuid_map WHERE kind = 'person' AND old_id = delegate_id), CASE WHEN delegate_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', delegate_id) END) AS delegate_id,
       position AS position,
       time_scope_start_id AS time_scope_start_id,
       time_scope_end_id AS time_scope_end_id,
       time_scope_duration_n AS time_scope_duration_n,
       time_scope_duration_kind AS time_scope_duration_kind,
       plan_start_id AS plan_start_id,
       plan_end_id AS plan_end_id,
       on_scope_exit AS on_scope_exit,
       is_private AS is_private,
       archival AS archival,
       agentic AS agentic,
       asynchronous AS asynchronous,
       done_at AS done_at,
       due_scope_start_id AS due_scope_start_id,
       due_scope_end_id AS due_scope_end_id,
       compound AS compound
  FROM tasks;

CREATE TABLE carry_template_agentic_briefs AS
SELECT (SELECT new_id FROM uuid_map WHERE kind = 'template_agentic_brief' AND old_id = id) AS id,
       item_type AS item_type,
       CASE item_type
                WHEN 'aspect' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'project' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'domain' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'tag' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'goal' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'task' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'commitment' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'expectation' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'info' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'info' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'flow' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'flow_root' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'flow_goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_goal' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'flow_task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_task' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'flow_commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_commitment' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'flow_expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_expectation' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'person' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'person' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'event' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'event' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'thread' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'thread' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                ELSE CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END END AS item_id,
       priority AS priority,
       spec AS spec,
       design AS design,
       acceptance AS acceptance,
       notes AS notes
  FROM template_agentic_briefs;

CREATE TABLE carry_template_block_reasons AS
SELECT (SELECT new_id FROM uuid_map WHERE kind = 'template_block_reason' AND old_id = id) AS id,
       item_type AS item_type,
       CASE item_type
                WHEN 'aspect' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'project' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'domain' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'tag' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'goal' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'task' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'commitment' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'expectation' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'info' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'info' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'flow' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'flow_root' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'flow_goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_goal' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'flow_task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_task' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'flow_commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_commitment' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'flow_expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_expectation' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'person' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'person' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'event' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'event' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'thread' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'thread' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                ELSE CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END END AS item_id,
       reason AS reason,
       position AS position
  FROM template_block_reasons;

CREATE TABLE carry_template_tags AS
SELECT (SELECT new_id FROM uuid_map WHERE kind = 'template_tag' AND old_id = id) AS id,
       item_type AS item_type,
       CASE item_type
                WHEN 'aspect' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'project' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'domain' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'tag' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'goal' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'task' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'commitment' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'expectation' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'info' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'info' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'flow' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'flow_root' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'flow_goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_goal' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'flow_task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_task' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'flow_commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_commitment' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'flow_expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_expectation' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'person' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'person' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'event' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'event' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                WHEN 'thread' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'thread' AND old_id = item_id), CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END)
                ELSE CASE WHEN item_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', item_id) END END AS item_id,
       coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = tag_id), CASE WHEN tag_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', tag_id) END) AS tag_id
  FROM template_tags;

CREATE TABLE carry_threads AS
SELECT (SELECT new_id FROM uuid_map WHERE kind = 'thread' AND old_id = id) AS id,
       title AS title,
       linked_note AS linked_note
  FROM threads;

CREATE TABLE carry_wait_checks AS
SELECT (SELECT new_id FROM uuid_map WHERE kind = 'wait_check' AND old_id = id) AS id,
       wait_kind AS wait_kind,
       CASE wait_kind
                WHEN 'aspect' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = wait_id), CASE WHEN wait_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', wait_id) END)
                WHEN 'project' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = wait_id), CASE WHEN wait_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', wait_id) END)
                WHEN 'domain' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = wait_id), CASE WHEN wait_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', wait_id) END)
                WHEN 'tag' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'domain' AND old_id = wait_id), CASE WHEN wait_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', wait_id) END)
                WHEN 'goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'goal' AND old_id = wait_id), CASE WHEN wait_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', wait_id) END)
                WHEN 'task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'task' AND old_id = wait_id), CASE WHEN wait_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', wait_id) END)
                WHEN 'commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'commitment' AND old_id = wait_id), CASE WHEN wait_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', wait_id) END)
                WHEN 'expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'expectation' AND old_id = wait_id), CASE WHEN wait_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', wait_id) END)
                WHEN 'info' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'info' AND old_id = wait_id), CASE WHEN wait_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', wait_id) END)
                WHEN 'flow' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = wait_id), CASE WHEN wait_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', wait_id) END)
                WHEN 'flow_root' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow' AND old_id = wait_id), CASE WHEN wait_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', wait_id) END)
                WHEN 'flow_goal' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_goal' AND old_id = wait_id), CASE WHEN wait_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', wait_id) END)
                WHEN 'flow_task' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_task' AND old_id = wait_id), CASE WHEN wait_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', wait_id) END)
                WHEN 'flow_commitment' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_commitment' AND old_id = wait_id), CASE WHEN wait_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', wait_id) END)
                WHEN 'flow_expectation' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'flow_expectation' AND old_id = wait_id), CASE WHEN wait_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', wait_id) END)
                WHEN 'person' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'person' AND old_id = wait_id), CASE WHEN wait_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', wait_id) END)
                WHEN 'event' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'event' AND old_id = wait_id), CASE WHEN wait_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', wait_id) END)
                WHEN 'thread' THEN coalesce((SELECT new_id FROM uuid_map WHERE kind = 'thread' AND old_id = wait_id), CASE WHEN wait_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', wait_id) END)
                ELSE CASE WHEN wait_id IS NULL THEN NULL ELSE '00000000-0000-4000-8000-' || printf('%012x', wait_id) END END AS wait_id,
       coalesce((SELECT new_key FROM key_map WHERE old_key = wait_key), wait_key) AS wait_key,
       due_at AS due_at,
       resolved_at AS resolved_at
  FROM wait_checks;

DROP TABLE tags_on_flow_task_async_templates;
DROP TABLE tags_on_occurrence_async_templates;
DROP TABLE tags_on_flow_async_templates;
DROP TABLE tags_on_async_templates;
DROP TABLE flow_task_async_templates;
DROP TABLE flow_instance_nodes;
DROP TABLE task_overlays;
DROP TABLE task_knowledge_base_links;
DROP TABLE task_dependencies;
DROP TABLE task_async_templates;
DROP TABLE task_agentic_briefs;
DROP TABLE tags_on_tasks;
DROP TABLE spawned_waits;
DROP TABLE occurrence_spawned_waits;
DROP TABLE occurrence_async_templates;
DROP TABLE goal_overlays;
DROP TABLE flow_tasks;
DROP TABLE flow_recurrences;
DROP TABLE flow_item_cycles;
DROP TABLE flow_instances;
DROP TABLE flow_goals;
DROP TABLE flow_expectations;
DROP TABLE flow_dependencies;
DROP TABLE flow_commitments;
DROP TABLE flow_async_templates;
DROP TABLE expectation_overlays;
DROP TABLE derived_tags;
DROP TABLE derived_dependencies;
DROP TABLE derived_children;
DROP TABLE derived_block_reasons;
DROP TABLE commitment_overlays;
DROP TABLE template_tags;
DROP TABLE tasks;
DROP TABLE tags_on_goals;
DROP TABLE tags_on_expectations;
DROP TABLE tags_on_commitments;
DROP TABLE goal_knowledge_base_links;
DROP TABLE flows;
DROP TABLE wait_checks;
DROP TABLE threads;
DROP TABLE template_block_reasons;
DROP TABLE template_agentic_briefs;
DROP TABLE retired_beads_ids;
DROP TABLE people;
DROP TABLE mcp_roots;
DROP TABLE infos;
DROP TABLE goals;
DROP TABLE expectations;
DROP TABLE events;
DROP TABLE domains;
DROP TABLE commitments;
DROP TABLE block_reasons;
DROP TABLE agents;

CREATE TABLE agents (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    -- What Settings -> Agents shows. Unique, so a name points at one agent.
    name         TEXT NOT NULL UNIQUE,
    -- The label of the account the agent works under; usage is kept per account.
    account      TEXT NOT NULL,
    -- The client's own session id, as the agent last attached with it.
    session_uuid TEXT NOT NULL,
    -- The agent token's digest: what lets a session attach again after a restart.
    token_sha256 TEXT NOT NULL UNIQUE,
    -- The Claim's root, keyed as `mcp_roots` keys a node; both NULL when the agent holds none.
    claim_kind   TEXT,
    claim_id     TEXT,
    -- A paused Claim leaves the subtree free for another agent to claim; the agent keeps its token.
    claim_paused INTEGER NOT NULL DEFAULT 0 CHECK (claim_paused IN (0, 1)),
    -- When the Claim was made: the older of two overlapping Claims keeps its place.
    claimed_at   TEXT,
    -- A manual lock: the agent's claimed Agentic Tasks read blocked while it is on.
    locked       INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1)),
    created_at   TEXT NOT NULL,
    last_seen_at TEXT, parent_id INTEGER,
    CHECK ((claim_kind IS NULL) = (claim_id IS NULL) AND (claim_kind IS NULL) = (claimed_at IS NULL))
);
INSERT INTO agents (id, name, account, session_uuid, token_sha256, claim_kind, claim_id, claim_paused, claimed_at, locked, created_at, last_seen_at, parent_id)
SELECT id, name, account, session_uuid, token_sha256, claim_kind, claim_id, claim_paused, claimed_at, locked, created_at, last_seen_at, parent_id FROM carry_agents;
CREATE UNIQUE INDEX agents_child_per_client ON agents (parent_id, session_uuid)
    WHERE parent_id IS NOT NULL;

CREATE TABLE block_reasons (
    id          TEXT PRIMARY KEY NOT NULL,
    owner_type  TEXT NOT NULL CHECK (owner_type IN ('task', 'goal')),
    owner_id    TEXT NOT NULL,
    reason      TEXT NOT NULL,
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO block_reasons (id, owner_type, owner_id, reason, position, created_at)
SELECT id, owner_type, owner_id, reason, position, created_at FROM carry_block_reasons;
CREATE INDEX idx_block_reasons_owner ON block_reasons (owner_type, owner_id);

CREATE TABLE "commitments" (
    id                       TEXT PRIMARY KEY NOT NULL,
    title                    TEXT NOT NULL,
    parent_type              TEXT NOT NULL
                                 CHECK (parent_type IN ('domain', 'goal', 'task', 'commitment')),
    parent_id                TEXT NOT NULL,
    verdict                  TEXT NOT NULL DEFAULT 'unresolved'
                                 CHECK (verdict IN ('unresolved', 'kept', 'broken')),
    time_scope_start_id      TEXT,
    time_scope_end_id        TEXT,
    time_scope_duration_n    INTEGER,
    time_scope_duration_kind TEXT,
    verdict_window_n         INTEGER,
    verdict_window_kind      TEXT,
    position                 INTEGER NOT NULL DEFAULT 0,
    is_private               BOOLEAN NOT NULL DEFAULT 0,
    verdict_at TEXT, archival TEXT NOT NULL DEFAULT 'live'
    CHECK (archival IN ('live', 'archived')),
    CHECK (time_scope_start_id IS NULL OR json_valid(time_scope_start_id)),
    CHECK (time_scope_end_id IS NULL OR json_valid(time_scope_end_id)),
    CHECK ((verdict_window_n IS NULL) = (verdict_window_kind IS NULL))
);
INSERT INTO commitments (id, title, parent_type, parent_id, verdict, time_scope_start_id, time_scope_end_id, time_scope_duration_n, time_scope_duration_kind, verdict_window_n, verdict_window_kind, position, is_private, verdict_at, archival)
SELECT id, title, parent_type, parent_id, verdict, time_scope_start_id, time_scope_end_id, time_scope_duration_n, time_scope_duration_kind, verdict_window_n, verdict_window_kind, position, is_private, verdict_at, archival FROM carry_commitments;
CREATE INDEX idx_commitments_parent ON commitments (parent_type, parent_id);

CREATE TABLE domains (
    id                       TEXT PRIMARY KEY NOT NULL,
    title                    TEXT NOT NULL,
    description              TEXT,
    subtype                  TEXT NOT NULL CHECK (subtype IN ('aspect', 'project', 'domain', 'tag')),
    parent_id                TEXT REFERENCES domains(id),
    color                    TEXT,
    status                   TEXT CHECK (status IN ('active', 'achieved', 'frozen', 'archived')),
    knowledge_base_directory TEXT
, position INTEGER NOT NULL DEFAULT 0, is_private BOOLEAN NOT NULL DEFAULT 0);
INSERT INTO domains (id, title, description, subtype, parent_id, color, status, knowledge_base_directory, position, is_private)
SELECT id, title, description, subtype, parent_id, color, status, knowledge_base_directory, position, is_private FROM carry_domains;

CREATE TABLE "events" (
    id                       TEXT PRIMARY KEY NOT NULL,
    title                    TEXT NOT NULL,
    scope_id                 TEXT,
    event_time               TEXT,
    linked_note              TEXT,
    CHECK (scope_id IS NULL OR json_valid(scope_id))
);
INSERT INTO events (id, title, scope_id, event_time, linked_note)
SELECT id, title, scope_id, event_time, linked_note FROM carry_events;

CREATE TABLE "expectations" (
    id                       TEXT PRIMARY KEY NOT NULL,
    title                    TEXT NOT NULL,
    parent_type              TEXT NOT NULL
                                 CHECK (parent_type IN ('domain', 'goal', 'task', 'commitment')),
    parent_id                TEXT NOT NULL,
    status                   TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'released')),
    archival                 TEXT NOT NULL DEFAULT 'live' CHECK (archival IN ('live', 'archived')),
    position                 INTEGER NOT NULL DEFAULT 0,
    is_private               BOOLEAN NOT NULL DEFAULT 0,
    time_scope_start_id      TEXT,
    time_scope_end_id        TEXT,
    time_scope_duration_n    INTEGER,
    time_scope_duration_kind TEXT,
    check_every_n            INTEGER,
    check_every_kind         TEXT,
    check_starting           TEXT,
    last_check_at            TEXT, agentic INTEGER NOT NULL DEFAULT 0 CHECK (agentic IN (0, 1)), agentic_note TEXT, agentic_question INTEGER NOT NULL DEFAULT 1
    CHECK (agentic_question IN (0, 1)), agentic_answer TEXT, released_at TEXT, agentic_review TEXT CHECK (agentic_review IS NULL OR json_valid(agentic_review)), agentic_verdict TEXT CHECK (agentic_verdict IS NULL OR agentic_verdict IN ('approved', 'changes_requested')),
    CHECK (time_scope_start_id IS NULL OR json_valid(time_scope_start_id)),
    CHECK (time_scope_end_id IS NULL OR json_valid(time_scope_end_id)),
    CHECK ((check_every_n IS NULL) = (check_every_kind IS NULL))
);
INSERT INTO expectations (id, title, parent_type, parent_id, status, archival, position, is_private, time_scope_start_id, time_scope_end_id, time_scope_duration_n, time_scope_duration_kind, check_every_n, check_every_kind, check_starting, last_check_at, agentic, agentic_note, agentic_question, agentic_answer, released_at, agentic_review, agentic_verdict)
SELECT id, title, parent_type, parent_id, status, archival, position, is_private, time_scope_start_id, time_scope_end_id, time_scope_duration_n, time_scope_duration_kind, check_every_n, check_every_kind, check_starting, last_check_at, agentic, agentic_note, agentic_question, agentic_answer, released_at, agentic_review, agentic_verdict FROM carry_expectations;
CREATE INDEX idx_expectations_parent ON expectations (parent_type, parent_id);

CREATE TABLE "goals" (
    id                       TEXT PRIMARY KEY NOT NULL,
    title                    TEXT NOT NULL,
    parent_type              TEXT NOT NULL CHECK (parent_type IN ('domain', 'goal')),
    parent_id                TEXT NOT NULL,
    status                   TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'achieved', 'frozen', 'archived')),
    position                 INTEGER NOT NULL DEFAULT 0,
    time_scope_start_id      TEXT,
    time_scope_end_id        TEXT,
    time_scope_duration_n    INTEGER,
    time_scope_duration_kind TEXT,
    on_scope_exit            TEXT CHECK (on_scope_exit IS NULL OR on_scope_exit IN ('archive', 'keep')),
    is_private               BOOLEAN NOT NULL DEFAULT 0,
    achieved_at TEXT,
    CHECK (time_scope_start_id IS NULL OR json_valid(time_scope_start_id)),
    CHECK (time_scope_end_id IS NULL OR json_valid(time_scope_end_id))
);
INSERT INTO goals (id, title, parent_type, parent_id, status, position, time_scope_start_id, time_scope_end_id, time_scope_duration_n, time_scope_duration_kind, on_scope_exit, is_private, achieved_at)
SELECT id, title, parent_type, parent_id, status, position, time_scope_start_id, time_scope_end_id, time_scope_duration_n, time_scope_duration_kind, on_scope_exit, is_private, achieved_at FROM carry_goals;

CREATE TABLE "infos" (
    id          TEXT PRIMARY KEY NOT NULL,
    body        TEXT NOT NULL,
    parent_type TEXT NOT NULL
                    CHECK (parent_type IN ('domain', 'goal', 'task', 'commitment', 'expectation', 'info')),
    parent_id   TEXT NOT NULL,
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    details     TEXT,
    is_private  BOOLEAN NOT NULL DEFAULT 0
);
INSERT INTO infos (id, body, parent_type, parent_id, position, created_at, updated_at, details, is_private)
SELECT id, body, parent_type, parent_id, position, created_at, updated_at, details, is_private FROM carry_infos;

CREATE TABLE mcp_roots (
    id        TEXT PRIMARY KEY NOT NULL,
    node_kind TEXT NOT NULL CHECK (node_kind IN
                  ('domain', 'goal', 'task', 'commitment', 'expectation', 'info',
                   'flow', 'flow_goal', 'flow_task')),
    node_id   TEXT NOT NULL,
    UNIQUE (node_kind, node_id)
);
INSERT INTO mcp_roots (id, node_kind, node_id)
SELECT id, node_kind, node_id FROM carry_mcp_roots;

CREATE TABLE people (
    id          TEXT PRIMARY KEY NOT NULL,
    name        TEXT NOT NULL UNIQUE,
    aliases     TEXT NOT NULL DEFAULT '[]',
    linked_note TEXT
);
INSERT INTO people (id, name, aliases, linked_note)
SELECT id, name, aliases, linked_note FROM carry_people;

CREATE TABLE retired_beads_ids (
    table_name TEXT    NOT NULL,
    row_id     TEXT NOT NULL,
    beads_id   TEXT    NOT NULL,
    PRIMARY KEY (table_name, row_id)
);
INSERT INTO retired_beads_ids (table_name, row_id, beads_id)
SELECT table_name, row_id, beads_id FROM carry_retired_beads_ids;

CREATE TABLE template_agentic_briefs (
    id         TEXT PRIMARY KEY NOT NULL,
    item_type  TEXT NOT NULL CHECK (item_type IN ('flow', 'flow_task')),
    item_id    TEXT NOT NULL,
    priority   INTEGER CHECK (priority IS NULL OR priority BETWEEN 0 AND 3),
    spec       TEXT NOT NULL DEFAULT '',
    design     TEXT NOT NULL DEFAULT '',
    acceptance TEXT NOT NULL DEFAULT '',
    notes      TEXT NOT NULL DEFAULT '',
    UNIQUE (item_type, item_id)
);
INSERT INTO template_agentic_briefs (id, item_type, item_id, priority, spec, design, acceptance, notes)
SELECT id, item_type, item_id, priority, spec, design, acceptance, notes FROM carry_template_agentic_briefs;

CREATE TABLE template_block_reasons (
    id        TEXT PRIMARY KEY NOT NULL,
    item_type TEXT NOT NULL CHECK (item_type IN ('flow', 'flow_goal', 'flow_task')),
    item_id   TEXT NOT NULL,
    reason    TEXT NOT NULL,
    position  INTEGER NOT NULL DEFAULT 0
);
INSERT INTO template_block_reasons (id, item_type, item_id, reason, position)
SELECT id, item_type, item_id, reason, position FROM carry_template_block_reasons;
CREATE INDEX idx_template_block_reasons_item ON template_block_reasons (item_type, item_id);

CREATE TABLE threads (
    id          TEXT PRIMARY KEY NOT NULL,
    title       TEXT NOT NULL,
    linked_note TEXT
);
INSERT INTO threads (id, title, linked_note)
SELECT id, title, linked_note FROM carry_threads;

CREATE TABLE wait_checks (
    id          TEXT PRIMARY KEY NOT NULL,
    wait_kind   TEXT NOT NULL CHECK (wait_kind IN ('stored', 'spawned', 'occurrence')),
    wait_id     TEXT,
    wait_key    TEXT,
    due_at      TEXT NOT NULL,
    resolved_at TEXT NOT NULL,
    CHECK ((wait_kind = 'occurrence') = (wait_key IS NOT NULL)),
    CHECK ((wait_id IS NULL) = (wait_key IS NOT NULL))
);
INSERT INTO wait_checks (id, wait_kind, wait_id, wait_key, due_at, resolved_at)
SELECT id, wait_kind, wait_id, wait_key, due_at, resolved_at FROM carry_wait_checks;
CREATE UNIQUE INDEX idx_wait_checks_check ON wait_checks (wait_kind, coalesce(wait_id, wait_key), due_at);

CREATE TABLE "flows" (
    id                     TEXT PRIMARY KEY NOT NULL,
    title                  TEXT NOT NULL,
    instance_type          TEXT NOT NULL CHECK (instance_type IN ('goal', 'task', 'commitment')),
    parent_type            TEXT NOT NULL CHECK (parent_type IN ('domain', 'goal')),
    parent_id              TEXT NOT NULL,
    target_type            TEXT CHECK (target_type IS NULL OR target_type IN ('domain', 'goal', 'task')),
    target_id              TEXT,
    flow_duration_n        INTEGER,
    flow_duration_kind     TEXT,
    position               INTEGER NOT NULL DEFAULT 0,
    flow_window_part       TEXT
                               CHECK (flow_window_part IS NULL OR flow_window_part IN
                                   ('morning', 'noon', 'afternoon', 'evening', 'night', 'premorning')),
    flow_window_time_start TEXT,
    flow_window_time_end   TEXT,
    root_plan_kind         TEXT,
    root_plan_start        INTEGER,
    root_plan_end          INTEGER,
    is_private             BOOLEAN NOT NULL DEFAULT 0
, verdict_window_n INTEGER, verdict_window_kind TEXT, delegate_kind TEXT CHECK (delegate_kind IN ('person', 'agent')), delegate_id TEXT REFERENCES people(id), agentic INTEGER CHECK (agentic IN (0, 1)), asynchronous INTEGER NOT NULL DEFAULT 0 CHECK (asynchronous IN (0, 1)), archival TEXT NOT NULL DEFAULT 'live' CHECK (archival IN ('live', 'backlog')), compound INTEGER NOT NULL DEFAULT 0 CHECK (compound IN (0, 1)));
INSERT INTO flows (id, title, instance_type, parent_type, parent_id, target_type, target_id, flow_duration_n, flow_duration_kind, position, flow_window_part, flow_window_time_start, flow_window_time_end, root_plan_kind, root_plan_start, root_plan_end, is_private, verdict_window_n, verdict_window_kind, delegate_kind, delegate_id, agentic, asynchronous, archival, compound)
SELECT id, title, instance_type, parent_type, parent_id, target_type, target_id, flow_duration_n, flow_duration_kind, position, flow_window_part, flow_window_time_start, flow_window_time_end, root_plan_kind, root_plan_start, root_plan_end, is_private, verdict_window_n, verdict_window_kind, delegate_kind, delegate_id, agentic, asynchronous, archival, compound FROM carry_flows;

CREATE TABLE goal_knowledge_base_links (
    goal_id     TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('person', 'event', 'thread', 'scope')),
    entity_id   TEXT NOT NULL,
    PRIMARY KEY (goal_id, entity_type, entity_id)
);
INSERT INTO goal_knowledge_base_links (goal_id, entity_type, entity_id)
SELECT goal_id, entity_type, entity_id FROM carry_goal_knowledge_base_links;

CREATE TABLE tags_on_commitments (
    commitment_id TEXT NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
    tag_id        TEXT NOT NULL REFERENCES domains(id),
    PRIMARY KEY (commitment_id, tag_id)
);
INSERT INTO tags_on_commitments (commitment_id, tag_id)
SELECT commitment_id, tag_id FROM carry_tags_on_commitments;

CREATE TABLE tags_on_expectations (
    expectation_id TEXT NOT NULL REFERENCES expectations(id) ON DELETE CASCADE,
    tag_id         TEXT NOT NULL REFERENCES domains(id),
    PRIMARY KEY (expectation_id, tag_id)
);
INSERT INTO tags_on_expectations (expectation_id, tag_id)
SELECT expectation_id, tag_id FROM carry_tags_on_expectations;

CREATE TABLE tags_on_goals (
    goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    tag_id  TEXT NOT NULL REFERENCES domains(id),
    PRIMARY KEY (goal_id, tag_id)
);
INSERT INTO tags_on_goals (goal_id, tag_id)
SELECT goal_id, tag_id FROM carry_tags_on_goals;

CREATE TABLE "tasks" (
    id                       TEXT PRIMARY KEY NOT NULL,
    title                    TEXT NOT NULL,
    parent_type              TEXT NOT NULL
                                 CHECK (parent_type IN ('domain', 'goal', 'task', 'commitment')),
    parent_id                TEXT NOT NULL,
    status                   TEXT NOT NULL DEFAULT 'todo'
                                 CHECK (status IN ('todo', 'in_progress', 'started', 'done', 'agentic_todo', 'on_agent', 'doing', 'agentic_done')),
    delegate_kind            TEXT CHECK (delegate_kind IN ('person')),
    delegate_id              TEXT REFERENCES people(id),
    position                 INTEGER NOT NULL DEFAULT 0,
    time_scope_start_id      TEXT,
    time_scope_end_id        TEXT,
    time_scope_duration_n    INTEGER,
    time_scope_duration_kind TEXT,
    plan_start_id            TEXT,
    plan_end_id              TEXT,
    on_scope_exit            TEXT CHECK (on_scope_exit IS NULL OR on_scope_exit IN ('archive', 'keep')),
    is_private               BOOLEAN NOT NULL DEFAULT 0,
    archival                 TEXT NOT NULL DEFAULT 'live' CHECK (archival IN ('live', 'backlog', 'archived')),
    agentic                  INTEGER NULL CHECK (agentic IN (0, 1)),
    asynchronous             INTEGER NOT NULL DEFAULT 0 CHECK (asynchronous IN (0, 1)),
    done_at                  TEXT,
    due_scope_start_id       TEXT CHECK (due_scope_start_id IS NULL OR json_valid(due_scope_start_id)),
    due_scope_end_id         TEXT CHECK (due_scope_end_id IS NULL OR json_valid(due_scope_end_id)),
    compound                 INTEGER NOT NULL DEFAULT 0 CHECK (compound IN (0, 1)),
    CHECK (time_scope_start_id IS NULL OR json_valid(time_scope_start_id)),
    CHECK (time_scope_end_id IS NULL OR json_valid(time_scope_end_id)),
    CHECK (plan_start_id IS NULL OR json_valid(plan_start_id)),
    CHECK (plan_end_id IS NULL OR json_valid(plan_end_id)),
    CHECK (
        (delegate_kind IS NULL     AND delegate_id IS NULL)
     OR (delegate_kind = 'person'  AND delegate_id IS NOT NULL)
    )
);
INSERT INTO tasks (id, title, parent_type, parent_id, status, delegate_kind, delegate_id, position, time_scope_start_id, time_scope_end_id, time_scope_duration_n, time_scope_duration_kind, plan_start_id, plan_end_id, on_scope_exit, is_private, archival, agentic, asynchronous, done_at, due_scope_start_id, due_scope_end_id, compound)
SELECT id, title, parent_type, parent_id, status, delegate_kind, delegate_id, position, time_scope_start_id, time_scope_end_id, time_scope_duration_n, time_scope_duration_kind, plan_start_id, plan_end_id, on_scope_exit, is_private, archival, agentic, asynchronous, done_at, due_scope_start_id, due_scope_end_id, compound FROM carry_tasks;

CREATE TABLE "template_tags" (
    id        TEXT PRIMARY KEY NOT NULL,
    item_type TEXT NOT NULL
                  CHECK (item_type IN ('flow', 'flow_goal', 'flow_task', 'flow_commitment', 'flow_expectation')),
    item_id   TEXT NOT NULL,
    tag_id    TEXT NOT NULL REFERENCES domains(id),
    UNIQUE (item_type, item_id, tag_id)
);
INSERT INTO template_tags (id, item_type, item_id, tag_id)
SELECT id, item_type, item_id, tag_id FROM carry_template_tags;

CREATE TABLE "commitment_overlays" (
    id                TEXT PRIMARY KEY NOT NULL,
    flow_id           TEXT NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    -- A commitment Habit's iteration root, and each occurrence of a Commitment item.
    item_type         TEXT NOT NULL CHECK (item_type IN ('flow_root', 'flow_commitment')),
    item_id           TEXT NOT NULL,
    iteration_scope   TEXT NOT NULL,
    cycle_id          TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
    node_key          TEXT GENERATED ALWAYS AS (
                          item_type || ':' || item_id || ':' || iteration_scope || ':' || cycle_id) VIRTUAL,
    verdict           TEXT CHECK (verdict IN ('kept', 'broken')),
    resolved_at       INTEGER,
    tombstone         TEXT CHECK (tombstone IN ('archived', 'missed')),
    title             TEXT,
    is_private        INTEGER CHECK (is_private IN (0, 1)),
    position          INTEGER,
    UNIQUE (item_type, item_id, iteration_scope, cycle_id),
    CHECK (iteration_scope IS NULL OR json_valid(iteration_scope))
);
INSERT INTO commitment_overlays (id, flow_id, item_type, item_id, iteration_scope, cycle_id, verdict, resolved_at, tombstone, title, is_private, position)
SELECT id, flow_id, item_type, item_id, iteration_scope, cycle_id, verdict, resolved_at, tombstone, title, is_private, position FROM carry_commitment_overlays;
CREATE UNIQUE INDEX idx_commitment_overlays_key ON commitment_overlays (node_key);
CREATE INDEX idx_commitment_overlays_flow ON commitment_overlays (flow_id, iteration_scope);

CREATE TABLE derived_block_reasons (
    id         TEXT PRIMARY KEY NOT NULL,
    flow_id    TEXT REFERENCES flows(id) ON DELETE CASCADE,
    node_kind  TEXT NOT NULL CHECK (node_kind IN ('task', 'goal')),
    node_key   TEXT NOT NULL,
    reason     TEXT NOT NULL,
    position   INTEGER NOT NULL DEFAULT 0
);
INSERT INTO derived_block_reasons (id, flow_id, node_kind, node_key, reason, position)
SELECT id, flow_id, node_kind, node_key, reason, position FROM carry_derived_block_reasons;
CREATE INDEX idx_derived_block_reasons_node ON derived_block_reasons (node_key);

CREATE TABLE "derived_children" (
    id                  TEXT PRIMARY KEY NOT NULL,
    flow_id             TEXT REFERENCES flows(id) ON DELETE CASCADE,
    parent_kind         TEXT NOT NULL CHECK (parent_kind IN ('task', 'goal', 'commitment', 'expectation')),
    parent_key          TEXT NOT NULL,
    -- The occurrence's window, its two boundary scopes resolved at attach time: reading the
    -- child's ancestry must not have to resolve a Flow Window, which mints scope rows.
    window_start_scope_id TEXT,
    window_end_scope_id TEXT,
    child_type          TEXT NOT NULL CHECK (child_type IN ('task', 'goal', 'commitment', 'info', 'expectation')),
    child_id            TEXT NOT NULL,
    UNIQUE (child_type, child_id),
    CHECK (window_start_scope_id IS NULL OR json_valid(window_start_scope_id)),
    CHECK (window_end_scope_id IS NULL OR json_valid(window_end_scope_id))
);
INSERT INTO derived_children (id, flow_id, parent_kind, parent_key, window_start_scope_id, window_end_scope_id, child_type, child_id)
SELECT id, flow_id, parent_kind, parent_key, window_start_scope_id, window_end_scope_id, child_type, child_id FROM carry_derived_children;
CREATE INDEX idx_derived_children_parent ON derived_children (parent_key);
CREATE INDEX idx_derived_children_flow ON derived_children (flow_id);

CREATE TABLE derived_dependencies (
    id             TEXT PRIMARY KEY NOT NULL,
    flow_id        TEXT REFERENCES flows(id) ON DELETE CASCADE,
    dependent_id   TEXT REFERENCES tasks(id) ON DELETE CASCADE,
    dependent_key  TEXT,
    target_type    TEXT NOT NULL CHECK (target_type IN ('task', 'goal', 'expectation')),
    target_id      TEXT,
    target_key     TEXT,
    added          INTEGER NOT NULL DEFAULT 1 CHECK (added IN (0, 1)),
    dependent_node TEXT GENERATED ALWAYS AS (coalesce(dependent_key, 'task:' || dependent_id)) VIRTUAL,
    target_node    TEXT GENERATED ALWAYS AS (coalesce(target_key, target_type || ':' || target_id)) VIRTUAL,
    CHECK ((dependent_id IS NULL) <> (dependent_key IS NULL)),
    CHECK ((target_id IS NULL) <> (target_key IS NULL)),
    CHECK (dependent_key IS NOT NULL OR target_key IS NOT NULL),
    CHECK (added = 1 OR dependent_key IS NOT NULL)
);
INSERT INTO derived_dependencies (id, flow_id, dependent_id, dependent_key, target_type, target_id, target_key, added)
SELECT id, flow_id, dependent_id, dependent_key, target_type, target_id, target_key, added FROM carry_derived_dependencies;
CREATE UNIQUE INDEX idx_derived_dependencies_edge ON derived_dependencies (dependent_node, target_node);
CREATE INDEX idx_derived_dependencies_flow ON derived_dependencies (flow_id);

CREATE TABLE derived_tags (
    id        TEXT PRIMARY KEY NOT NULL,
    flow_id   TEXT REFERENCES flows(id) ON DELETE CASCADE,
    node_kind TEXT NOT NULL CHECK (node_kind IN ('task', 'goal', 'commitment', 'expectation')),
    node_key  TEXT NOT NULL,
    tag_id    TEXT NOT NULL REFERENCES domains(id),
    added     INTEGER NOT NULL CHECK (added IN (0, 1)),
    UNIQUE (node_key, tag_id)
);
INSERT INTO derived_tags (id, flow_id, node_kind, node_key, tag_id, added)
SELECT id, flow_id, node_kind, node_key, tag_id, added FROM carry_derived_tags;
CREATE INDEX idx_derived_tags_flow ON derived_tags (flow_id);

CREATE TABLE expectation_overlays (
    node_key                 TEXT PRIMARY KEY,
    flow_id                  TEXT REFERENCES flows(id) ON DELETE CASCADE,
    occurrence_key           TEXT,
    title                    TEXT,
    time_scope_start_id      TEXT,
    time_scope_end_id        TEXT,
    time_scope_duration_n    INTEGER,
    time_scope_duration_kind TEXT,
    time_scope_set           INTEGER NOT NULL DEFAULT 0 CHECK (time_scope_set IN (0, 1)),
    check_every_n            INTEGER,
    check_every_kind         TEXT,
    check_every_set          INTEGER NOT NULL DEFAULT 0 CHECK (check_every_set IN (0, 1)),
    check_starting           TEXT,
    is_private               INTEGER CHECK (is_private IN (0, 1)),
    archival                 TEXT CHECK (archival IN ('live', 'archived')),
    agentic                  INTEGER CHECK (agentic IN (0, 1)),
    agentic_note             TEXT,
    agentic_note_set         INTEGER NOT NULL DEFAULT 0 CHECK (agentic_note_set IN (0, 1)),
    agentic_question         INTEGER CHECK (agentic_question IN (0, 1)),
    agentic_answer           TEXT,
    agentic_answer_set       INTEGER NOT NULL DEFAULT 0 CHECK (agentic_answer_set IN (0, 1)), status TEXT CHECK (status IS NULL OR status IN ('pending', 'released')), released_at TEXT,
    CHECK (time_scope_start_id IS NULL OR json_valid(time_scope_start_id)),
    CHECK (time_scope_end_id IS NULL OR json_valid(time_scope_end_id)),
    CHECK ((check_every_n IS NULL) = (check_every_kind IS NULL))
);
INSERT INTO expectation_overlays (node_key, flow_id, occurrence_key, title, time_scope_start_id, time_scope_end_id, time_scope_duration_n, time_scope_duration_kind, time_scope_set, check_every_n, check_every_kind, check_every_set, check_starting, is_private, archival, agentic, agentic_note, agentic_note_set, agentic_question, agentic_answer, agentic_answer_set, status, released_at)
SELECT node_key, flow_id, occurrence_key, title, time_scope_start_id, time_scope_end_id, time_scope_duration_n, time_scope_duration_kind, time_scope_set, check_every_n, check_every_kind, check_every_set, check_starting, is_private, archival, agentic, agentic_note, agentic_note_set, agentic_question, agentic_answer, agentic_answer_set, status, released_at FROM carry_expectation_overlays;
CREATE INDEX idx_expectation_overlays_flow ON expectation_overlays (flow_id);

CREATE TABLE flow_async_templates (
    flow_id          TEXT PRIMARY KEY NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    title            TEXT NOT NULL,
    time_scope_n     INTEGER,
    time_scope_kind  TEXT,
    check_every_n    INTEGER,
    check_every_kind TEXT,
    CHECK ((time_scope_n IS NULL) = (time_scope_kind IS NULL)),
    CHECK ((check_every_n IS NULL) = (check_every_kind IS NULL))
);
INSERT INTO flow_async_templates (flow_id, title, time_scope_n, time_scope_kind, check_every_n, check_every_kind)
SELECT flow_id, title, time_scope_n, time_scope_kind, check_every_n, check_every_kind FROM carry_flow_async_templates;

CREATE TABLE flow_commitments (
    id                  TEXT PRIMARY KEY NOT NULL,
    flow_id             TEXT NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    title               TEXT NOT NULL,
    parent_type         TEXT NOT NULL
                            CHECK (parent_type IN ('flow', 'flow_goal', 'flow_task', 'flow_commitment')),
    parent_id           TEXT NOT NULL,
    position            INTEGER NOT NULL DEFAULT 0,
    is_private          BOOLEAN NOT NULL DEFAULT 0,
    verdict_window_n    INTEGER,
    verdict_window_kind TEXT,
    CHECK ((verdict_window_n IS NULL) = (verdict_window_kind IS NULL))
);
INSERT INTO flow_commitments (id, flow_id, title, parent_type, parent_id, position, is_private, verdict_window_n, verdict_window_kind)
SELECT id, flow_id, title, parent_type, parent_id, position, is_private, verdict_window_n, verdict_window_kind FROM carry_flow_commitments;

CREATE TABLE "flow_dependencies" (
    id              TEXT PRIMARY KEY NOT NULL,
    flow_id         TEXT NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    dependent_type  TEXT NOT NULL CHECK (dependent_type IN ('flow_goal', 'flow_task')),
    dependent_id    TEXT NOT NULL,
    depends_on_type TEXT NOT NULL
                        CHECK (depends_on_type IN ('flow_goal', 'flow_task', 'flow_expectation')),
    depends_on_id   TEXT NOT NULL,
    UNIQUE (dependent_type, dependent_id, depends_on_type, depends_on_id)
);
INSERT INTO flow_dependencies (id, flow_id, dependent_type, dependent_id, depends_on_type, depends_on_id)
SELECT id, flow_id, dependent_type, dependent_id, depends_on_type, depends_on_id FROM carry_flow_dependencies;

CREATE TABLE flow_expectations (
    id                TEXT PRIMARY KEY NOT NULL,
    flow_id           TEXT NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    title             TEXT NOT NULL,
    parent_type       TEXT NOT NULL
                          CHECK (parent_type IN ('flow', 'flow_goal', 'flow_task', 'flow_commitment')),
    parent_id         TEXT NOT NULL,
    position          INTEGER NOT NULL DEFAULT 0,
    is_private        BOOLEAN NOT NULL DEFAULT 0,
    check_every_n     INTEGER,
    check_every_kind  TEXT,
    first_check_kind  TEXT,
    first_check_index INTEGER,
    CHECK ((check_every_n IS NULL) = (check_every_kind IS NULL)),
    CHECK ((first_check_kind IS NULL) = (first_check_index IS NULL)),
    CHECK (first_check_index IS NULL OR first_check_index >= 1)
);
INSERT INTO flow_expectations (id, flow_id, title, parent_type, parent_id, position, is_private, check_every_n, check_every_kind, first_check_kind, first_check_index)
SELECT id, flow_id, title, parent_type, parent_id, position, is_private, check_every_n, check_every_kind, first_check_kind, first_check_index FROM carry_flow_expectations;

CREATE TABLE flow_goals (
    id          TEXT PRIMARY KEY NOT NULL,
    flow_id     TEXT NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    parent_type TEXT NOT NULL CHECK (parent_type IN ('flow', 'flow_goal')),
    parent_id   TEXT NOT NULL,
    position    INTEGER NOT NULL DEFAULT 0,
    is_private  BOOLEAN NOT NULL DEFAULT 0
);
INSERT INTO flow_goals (id, flow_id, title, parent_type, parent_id, position, is_private)
SELECT id, flow_id, title, parent_type, parent_id, position, is_private FROM carry_flow_goals;

CREATE TABLE flow_instances (
    id         TEXT PRIMARY KEY NOT NULL,
    flow_id    TEXT REFERENCES flows(id) ON DELETE SET NULL,
    root_type  TEXT NOT NULL CHECK (root_type IN ('goal', 'task', 'commitment')),
    root_id    TEXT NOT NULL,
    started_at INTEGER NOT NULL
);
INSERT INTO flow_instances (id, flow_id, root_type, root_id, started_at)
SELECT id, flow_id, root_type, root_id, started_at FROM carry_flow_instances;

CREATE TABLE "flow_item_cycles" (
    id          TEXT PRIMARY KEY NOT NULL,
    flow_id     TEXT NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    item_type   TEXT NOT NULL
                    CHECK (item_type IN ('flow_goal', 'flow_task', 'flow_commitment', 'flow_expectation')),
    item_id     TEXT NOT NULL,
    scope_kind  TEXT,
    scope_index INTEGER,
    plan_kind   TEXT,
    plan_start  INTEGER,
    plan_end    INTEGER,
    position    INTEGER NOT NULL DEFAULT 0
);
INSERT INTO flow_item_cycles (id, flow_id, item_type, item_id, scope_kind, scope_index, plan_kind, plan_start, plan_end, position)
SELECT id, flow_id, item_type, item_id, scope_kind, scope_index, plan_kind, plan_start, plan_end, position FROM carry_flow_item_cycles;
CREATE INDEX idx_flow_item_cycles_item ON flow_item_cycles (item_type, item_id);

CREATE TABLE "flow_recurrences" (
    flow_id                  TEXT PRIMARY KEY NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    start_scope_id           TEXT NOT NULL,
    gap_n                    INTEGER,
    gap_kind                 TEXT CHECK (gap_kind IN ('day', 'week', 'month', 'season')),
    end_scope_id             TEXT,
    clock                    TEXT NOT NULL CHECK (clock IN ('window', 'interval')),
    miss_policy              TEXT CHECK (miss_policy IN ('archive', 'overdue', 'owed')), cooldown_n INTEGER
    CHECK (cooldown_n IS NULL OR cooldown_n >= 1), cooldown_kind TEXT
    CHECK ((cooldown_kind IS NULL) = (cooldown_n IS NULL)
           AND (cooldown_kind IS NULL OR (cooldown_kind IN ('part', 'day', 'week', 'month')
                                          AND clock = 'window'))),
    CHECK (start_scope_id IS NULL OR json_valid(start_scope_id)),
    CHECK (end_scope_id IS NULL OR json_valid(end_scope_id)),
    CHECK ((gap_n IS NULL) = (gap_kind IS NULL)),
    CHECK ((clock = 'window') = (miss_policy IS NOT NULL))
);
INSERT INTO flow_recurrences (flow_id, start_scope_id, gap_n, gap_kind, end_scope_id, clock, miss_policy, cooldown_n, cooldown_kind)
SELECT flow_id, start_scope_id, gap_n, gap_kind, end_scope_id, clock, miss_policy, cooldown_n, cooldown_kind FROM carry_flow_recurrences;

CREATE TABLE "flow_tasks" (
    id            TEXT PRIMARY KEY NOT NULL,
    flow_id       TEXT NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    parent_type   TEXT NOT NULL
                      CHECK (parent_type IN ('flow', 'flow_goal', 'flow_task', 'flow_commitment')),
    parent_id     TEXT NOT NULL,
    position      INTEGER NOT NULL DEFAULT 0,
    is_private    BOOLEAN NOT NULL DEFAULT 0,
    delegate_kind TEXT CHECK (delegate_kind IN ('person', 'agent')),
    delegate_id   TEXT REFERENCES people(id),
    agentic       INTEGER CHECK (agentic IN (0, 1)),
    asynchronous  INTEGER NOT NULL DEFAULT 0 CHECK (asynchronous IN (0, 1)),
    archival      TEXT NOT NULL DEFAULT 'live' CHECK (archival IN ('live', 'backlog')),
    compound      INTEGER NOT NULL DEFAULT 0 CHECK (compound IN (0, 1))
);
INSERT INTO flow_tasks (id, flow_id, title, parent_type, parent_id, position, is_private, delegate_kind, delegate_id, agentic, asynchronous, archival, compound)
SELECT id, flow_id, title, parent_type, parent_id, position, is_private, delegate_kind, delegate_id, agentic, asynchronous, archival, compound FROM carry_flow_tasks;

CREATE TABLE goal_overlays (
    id                TEXT PRIMARY KEY NOT NULL,
    flow_id           TEXT NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    item_type         TEXT NOT NULL CHECK (item_type IN ('flow_goal', 'flow_root')),
    item_id           TEXT NOT NULL,
    iteration_scope   TEXT NOT NULL,
    cycle_id          TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
    node_key          TEXT GENERATED ALWAYS AS (
                          item_type || ':' || item_id || ':' || iteration_scope || ':' || cycle_id) VIRTUAL,
    status            TEXT CHECK (status IN ('active', 'achieved', 'frozen', 'archived')),
    resolved_at       INTEGER,
    tombstone         TEXT CHECK (tombstone IN ('archived', 'missed')),
    title             TEXT,
    is_private        INTEGER CHECK (is_private IN (0, 1)),
    position          INTEGER,
    block_reasons_set INTEGER NOT NULL DEFAULT 0 CHECK (block_reasons_set IN (0, 1)),
    UNIQUE (item_type, item_id, iteration_scope, cycle_id),
    CHECK (iteration_scope IS NULL OR json_valid(iteration_scope))
);
INSERT INTO goal_overlays (id, flow_id, item_type, item_id, iteration_scope, cycle_id, status, resolved_at, tombstone, title, is_private, position, block_reasons_set)
SELECT id, flow_id, item_type, item_id, iteration_scope, cycle_id, status, resolved_at, tombstone, title, is_private, position, block_reasons_set FROM carry_goal_overlays;
CREATE UNIQUE INDEX idx_goal_overlays_key ON goal_overlays (node_key);
CREATE INDEX idx_goal_overlays_flow ON goal_overlays (flow_id, iteration_scope);

CREATE TABLE occurrence_async_templates (
    node_key         TEXT PRIMARY KEY,
    flow_id          TEXT NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    title            TEXT NOT NULL,
    time_scope_n     INTEGER,
    time_scope_kind  TEXT,
    check_every_n    INTEGER,
    check_every_kind TEXT,
    CHECK ((time_scope_n IS NULL) = (time_scope_kind IS NULL)),
    CHECK ((check_every_n IS NULL) = (check_every_kind IS NULL))
);
INSERT INTO occurrence_async_templates (node_key, flow_id, title, time_scope_n, time_scope_kind, check_every_n, check_every_kind)
SELECT node_key, flow_id, title, time_scope_n, time_scope_kind, check_every_n, check_every_kind FROM carry_occurrence_async_templates;

CREATE TABLE occurrence_spawned_waits (
    node_key TEXT PRIMARY KEY,
    flow_id  TEXT NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    status   TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'released')),
    archival TEXT NOT NULL DEFAULT 'live' CHECK (archival IN ('live', 'archived'))
, released_at TEXT);
INSERT INTO occurrence_spawned_waits (node_key, flow_id, status, archival, released_at)
SELECT node_key, flow_id, status, archival, released_at FROM carry_occurrence_spawned_waits;

CREATE TABLE spawned_waits (
    task_id       TEXT PRIMARY KEY NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'released')),
    archival      TEXT NOT NULL DEFAULT 'live' CHECK (archival IN ('live', 'archived')),
    last_check_at TEXT
, released_at TEXT);
INSERT INTO spawned_waits (task_id, status, archival, last_check_at, released_at)
SELECT task_id, status, archival, last_check_at, released_at FROM carry_spawned_waits;

CREATE TABLE tags_on_tasks (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    tag_id  TEXT NOT NULL REFERENCES domains(id),
    PRIMARY KEY (task_id, tag_id)
);
INSERT INTO tags_on_tasks (task_id, tag_id)
SELECT task_id, tag_id FROM carry_tags_on_tasks;

CREATE TABLE task_agentic_briefs (
    task_id    TEXT PRIMARY KEY NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    priority   INTEGER CHECK (priority IS NULL OR priority BETWEEN 0 AND 3),
    spec       TEXT NOT NULL DEFAULT '',
    design     TEXT NOT NULL DEFAULT '',
    acceptance TEXT NOT NULL DEFAULT '',
    notes      TEXT NOT NULL DEFAULT ''
);
INSERT INTO task_agentic_briefs (task_id, priority, spec, design, acceptance, notes)
SELECT task_id, priority, spec, design, acceptance, notes FROM carry_task_agentic_briefs;

CREATE TABLE task_async_templates (
    task_id          TEXT PRIMARY KEY NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    title            TEXT NOT NULL,
    time_scope_n     INTEGER,
    time_scope_kind  TEXT,
    check_every_n    INTEGER,
    check_every_kind TEXT,
    CHECK ((time_scope_n IS NULL) = (time_scope_kind IS NULL)),
    CHECK ((check_every_n IS NULL) = (check_every_kind IS NULL))
);
INSERT INTO task_async_templates (task_id, title, time_scope_n, time_scope_kind, check_every_n, check_every_kind)
SELECT task_id, title, time_scope_n, time_scope_kind, check_every_n, check_every_kind FROM carry_task_async_templates;

CREATE TABLE task_dependencies (
    task_id         TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    dependency_type TEXT NOT NULL CHECK (dependency_type IN ('task', 'goal', 'expectation')),
    dependency_id   TEXT NOT NULL,
    PRIMARY KEY (task_id, dependency_type, dependency_id)
);
INSERT INTO task_dependencies (task_id, dependency_type, dependency_id)
SELECT task_id, dependency_type, dependency_id FROM carry_task_dependencies;

CREATE TABLE task_knowledge_base_links (
    task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('person', 'event', 'thread', 'scope')),
    entity_id   TEXT NOT NULL,
    PRIMARY KEY (task_id, entity_type, entity_id)
);
INSERT INTO task_knowledge_base_links (task_id, entity_type, entity_id)
SELECT task_id, entity_type, entity_id FROM carry_task_knowledge_base_links;

CREATE TABLE "task_overlays" (
    id                TEXT PRIMARY KEY NOT NULL,
    -- Which derivation the row belongs to: a Habit occurrence, or a wait's check task.
    origin            TEXT NOT NULL DEFAULT 'habit' CHECK (origin IN ('habit', 'check')),
    -- Habit occurrence key.
    flow_id           TEXT REFERENCES flows(id) ON DELETE CASCADE,
    item_type         TEXT CHECK (item_type IN ('flow_task', 'flow_root')),
    item_id           TEXT,
    iteration_scope   TEXT,
    cycle_id          TEXT,
    -- Check task key: the wait's own node key, and the instant the check fell due.
    wait_key          TEXT,
    due_at            TEXT,
    node_key          TEXT GENERATED ALWAYS AS (
                          CASE origin
                              WHEN 'habit' THEN item_type || ':' || item_id || ':' || iteration_scope || ':' || cycle_id
                              ELSE 'check:' || wait_key || '@' || due_at
                          END) VIRTUAL,
    -- Per-occurrence state, in the occurrence's own model: NULL is To Do in either.
    status            TEXT CHECK (status IN ('todo', 'in_progress', 'started', 'done', 'agentic_todo', 'on_agent', 'doing', 'agentic_done')),
    resolved_at       INTEGER,
    tombstone         TEXT CHECK (tombstone IN ('archived', 'missed')),
    -- Inherited columns: NULL inherits the template's value.
    title             TEXT,
    plan_start_id     TEXT,
    plan_end_id       TEXT,
    plan_set          INTEGER NOT NULL DEFAULT 0 CHECK (plan_set IN (0, 1)),
    delegate_kind     TEXT CHECK (delegate_kind IN ('person')),
    delegate_id       TEXT REFERENCES people(id),
    delegate_set      INTEGER NOT NULL DEFAULT 0 CHECK (delegate_set IN (0, 1)),
    agentic           INTEGER CHECK (agentic IN (0, 1)),
    agentic_set       INTEGER NOT NULL DEFAULT 0 CHECK (agentic_set IN (0, 1)),
    asynchronous      INTEGER CHECK (asynchronous IN (0, 1)),
    archival          TEXT CHECK (archival IN ('live', 'backlog')),
    is_private        INTEGER CHECK (is_private IN (0, 1)),
    position          INTEGER,
    -- Set when the occurrence's block reasons are its own list (in derived_block_reasons), even an
    -- empty one; clear when it reads its template's.
    block_reasons_set INTEGER NOT NULL DEFAULT 0 CHECK (block_reasons_set IN (0, 1)), brief_priority INTEGER
    CHECK (brief_priority IS NULL OR brief_priority BETWEEN 0 AND 3), brief_priority_set INTEGER NOT NULL DEFAULT 0
    CHECK (brief_priority_set IN (0, 1)), brief_spec TEXT, brief_design TEXT, brief_acceptance TEXT, brief_notes TEXT,
    -- An occurrence's own explicit due (migration 0087).
    due_scope_start_id TEXT CHECK (due_scope_start_id IS NULL OR json_valid(due_scope_start_id)),
    due_scope_end_id   TEXT CHECK (due_scope_end_id IS NULL OR json_valid(due_scope_end_id)), compound INTEGER CHECK (compound IS NULL OR compound IN (0, 1)), async_template_set INTEGER NOT NULL DEFAULT 0
    CHECK (async_template_set IN (0, 1)),
    CHECK ((origin = 'habit') = (flow_id IS NOT NULL AND item_type IS NOT NULL AND item_id IS NOT NULL
                                 AND iteration_scope IS NOT NULL AND cycle_id IS NOT NULL)),
    CHECK ((origin = 'check') = (wait_key IS NOT NULL AND due_at IS NOT NULL)),
    CHECK (plan_set = 1 OR (plan_start_id IS NULL AND plan_end_id IS NULL)),
    CHECK ((plan_start_id IS NULL) = (plan_end_id IS NULL)),
    CHECK (
        (delegate_kind IS NULL     AND delegate_id IS NULL)
     OR (delegate_kind = 'person'  AND delegate_id IS NOT NULL)
    ),
    CHECK (iteration_scope IS NULL OR json_valid(iteration_scope)),
    CHECK (plan_start_id IS NULL OR json_valid(plan_start_id)),
    CHECK (plan_end_id IS NULL OR json_valid(plan_end_id))
);
INSERT INTO task_overlays (id, origin, flow_id, item_type, item_id, iteration_scope, cycle_id, wait_key, due_at, status, resolved_at, tombstone, title, plan_start_id, plan_end_id, plan_set, delegate_kind, delegate_id, delegate_set, agentic, agentic_set, asynchronous, archival, is_private, position, block_reasons_set, brief_priority, brief_priority_set, brief_spec, brief_design, brief_acceptance, brief_notes, due_scope_start_id, due_scope_end_id, compound, async_template_set)
SELECT id, origin, flow_id, item_type, item_id, iteration_scope, cycle_id, wait_key, due_at, status, resolved_at, tombstone, title, plan_start_id, plan_end_id, plan_set, delegate_kind, delegate_id, delegate_set, agentic, agentic_set, asynchronous, archival, is_private, position, block_reasons_set, brief_priority, brief_priority_set, brief_spec, brief_design, brief_acceptance, brief_notes, due_scope_start_id, due_scope_end_id, compound, async_template_set FROM carry_task_overlays;
CREATE UNIQUE INDEX idx_task_overlays_key ON task_overlays (node_key);
CREATE INDEX idx_task_overlays_item ON task_overlays (item_type, item_id);
CREATE INDEX idx_task_overlays_flow ON task_overlays (flow_id, iteration_scope);

CREATE TABLE "flow_instance_nodes" (
    id                   TEXT PRIMARY KEY NOT NULL,
    flow_instance_id     TEXT NOT NULL REFERENCES flow_instances(id) ON DELETE CASCADE,
    node_type            TEXT NOT NULL
                             CHECK (node_type IN ('goal', 'task', 'commitment', 'expectation')),
    node_id              TEXT NOT NULL,
    source_item_type     TEXT NOT NULL
                             CHECK (source_item_type IN
                                 ('flow', 'flow_goal', 'flow_task', 'flow_commitment', 'flow_expectation')),
    source_item_id       TEXT NOT NULL,
    original_parent_type TEXT NOT NULL
                             CHECK (original_parent_type IN ('domain', 'goal', 'task', 'commitment')),
    original_parent_id   TEXT NOT NULL
);
INSERT INTO flow_instance_nodes (id, flow_instance_id, node_type, node_id, source_item_type, source_item_id, original_parent_type, original_parent_id)
SELECT id, flow_instance_id, node_type, node_id, source_item_type, source_item_id, original_parent_type, original_parent_id FROM carry_flow_instance_nodes;
CREATE INDEX idx_flow_instance_nodes_instance ON flow_instance_nodes (flow_instance_id);
CREATE INDEX idx_flow_instance_nodes_node ON flow_instance_nodes (node_type, node_id);

CREATE TABLE flow_task_async_templates (
    flow_task_id     TEXT PRIMARY KEY NOT NULL REFERENCES flow_tasks(id) ON DELETE CASCADE,
    title            TEXT NOT NULL,
    time_scope_n     INTEGER,
    time_scope_kind  TEXT,
    check_every_n    INTEGER,
    check_every_kind TEXT,
    CHECK ((time_scope_n IS NULL) = (time_scope_kind IS NULL)),
    CHECK ((check_every_n IS NULL) = (check_every_kind IS NULL))
);
INSERT INTO flow_task_async_templates (flow_task_id, title, time_scope_n, time_scope_kind, check_every_n, check_every_kind)
SELECT flow_task_id, title, time_scope_n, time_scope_kind, check_every_n, check_every_kind FROM carry_flow_task_async_templates;

CREATE TABLE tags_on_async_templates (
    task_id TEXT NOT NULL REFERENCES task_async_templates(task_id) ON DELETE CASCADE,
    tag_id  TEXT NOT NULL REFERENCES domains(id),
    PRIMARY KEY (task_id, tag_id)
);
INSERT INTO tags_on_async_templates (task_id, tag_id)
SELECT task_id, tag_id FROM carry_tags_on_async_templates;

CREATE TABLE tags_on_flow_async_templates (
    flow_id TEXT NOT NULL REFERENCES flow_async_templates(flow_id) ON DELETE CASCADE,
    tag_id  TEXT NOT NULL REFERENCES domains(id),
    PRIMARY KEY (flow_id, tag_id)
);
INSERT INTO tags_on_flow_async_templates (flow_id, tag_id)
SELECT flow_id, tag_id FROM carry_tags_on_flow_async_templates;

CREATE TABLE tags_on_occurrence_async_templates (
    node_key TEXT NOT NULL REFERENCES occurrence_async_templates(node_key) ON DELETE CASCADE,
    tag_id   TEXT NOT NULL REFERENCES domains(id),
    PRIMARY KEY (node_key, tag_id)
);
INSERT INTO tags_on_occurrence_async_templates (node_key, tag_id)
SELECT node_key, tag_id FROM carry_tags_on_occurrence_async_templates;

CREATE TABLE tags_on_flow_task_async_templates (
    flow_task_id TEXT NOT NULL
                     REFERENCES flow_task_async_templates(flow_task_id) ON DELETE CASCADE,
    tag_id       TEXT NOT NULL REFERENCES domains(id),
    PRIMARY KEY (flow_task_id, tag_id)
);
INSERT INTO tags_on_flow_task_async_templates (flow_task_id, tag_id)
SELECT flow_task_id, tag_id FROM carry_tags_on_flow_task_async_templates;

DROP TABLE carry_agents;
DROP TABLE carry_block_reasons;
DROP TABLE carry_commitment_overlays;
DROP TABLE carry_commitments;
DROP TABLE carry_derived_block_reasons;
DROP TABLE carry_derived_children;
DROP TABLE carry_derived_dependencies;
DROP TABLE carry_derived_tags;
DROP TABLE carry_domains;
DROP TABLE carry_events;
DROP TABLE carry_expectation_overlays;
DROP TABLE carry_expectations;
DROP TABLE carry_flow_async_templates;
DROP TABLE carry_flow_commitments;
DROP TABLE carry_flow_dependencies;
DROP TABLE carry_flow_expectations;
DROP TABLE carry_flow_goals;
DROP TABLE carry_flow_instance_nodes;
DROP TABLE carry_flow_instances;
DROP TABLE carry_flow_item_cycles;
DROP TABLE carry_flow_recurrences;
DROP TABLE carry_flow_task_async_templates;
DROP TABLE carry_flow_tasks;
DROP TABLE carry_flows;
DROP TABLE carry_goal_knowledge_base_links;
DROP TABLE carry_goal_overlays;
DROP TABLE carry_goals;
DROP TABLE carry_infos;
DROP TABLE carry_mcp_roots;
DROP TABLE carry_occurrence_async_templates;
DROP TABLE carry_occurrence_spawned_waits;
DROP TABLE carry_people;
DROP TABLE carry_retired_beads_ids;
DROP TABLE carry_spawned_waits;
DROP TABLE carry_tags_on_async_templates;
DROP TABLE carry_tags_on_commitments;
DROP TABLE carry_tags_on_expectations;
DROP TABLE carry_tags_on_flow_async_templates;
DROP TABLE carry_tags_on_flow_task_async_templates;
DROP TABLE carry_tags_on_goals;
DROP TABLE carry_tags_on_occurrence_async_templates;
DROP TABLE carry_tags_on_tasks;
DROP TABLE carry_task_agentic_briefs;
DROP TABLE carry_task_async_templates;
DROP TABLE carry_task_dependencies;
DROP TABLE carry_task_knowledge_base_links;
DROP TABLE carry_task_overlays;
DROP TABLE carry_tasks;
DROP TABLE carry_template_agentic_briefs;
DROP TABLE carry_template_block_reasons;
DROP TABLE carry_template_tags;
DROP TABLE carry_threads;
DROP TABLE carry_wait_checks;
DROP TABLE uuid_map;
DROP TABLE key_map;
