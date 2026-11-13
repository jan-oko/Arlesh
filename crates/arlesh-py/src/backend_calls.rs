//! The operation table over the Backend port: every call Python can make, as one method of
//! [`Backend`].
//!
//! [`crate::request::Request`] is the tagged form the Python half already sends; this module reads
//! it and calls the matching port method, so an `HttpBackend` answers the same operations the
//! SQLite core does. It adds no rule of its own: each arm is one port call, and the answer is the
//! serde form the port returns.

use arlesh_backend::Backend;
use arlesh_core::{
    error::{WireError, WireErrorKind},
    tasks::model::DescendantPlans,
};
use chrono::{Local, NaiveDateTime};
use serde::Serialize;
use serde_json::Value;

use crate::request::Request;

/// The device's wall clock, which a call that derives the board at an instant defaults to.
fn now() -> NaiveDateTime {
    Local::now().naive_local()
}

/// `value` as JSON.
fn json(value: impl Serialize) -> Result<Value, WireError> {
    serde_json::to_value(value).map_err(|error| WireError::internal(error.to_string()))
}

/// The board last read, with the stamp it carried; set by [`run`] for the host to keep.
pub(crate) struct Answer {
    /// The operation's result.
    pub(crate) value: Value,
    /// The revision stamp of a board load, when the operation was one.
    pub(crate) revision: Option<arlesh_backend::revision::BoardRevision>,
}

/// Runs `request` against `backend`.
pub(crate) async fn run(backend: &dyn Backend, request: Request) -> Result<Answer, WireError> {
    if let Request::Board {
        now: at,
        without_nulls,
    } = request
    {
        let load = backend.load_mindmap(at.unwrap_or_else(now)).await?;
        let revision = load.revision.clone();
        let board = json(load.into_load())?;
        return Ok(Answer {
            value: if without_nulls {
                crate::request::without_nulls(board)
            } else {
                board
            },
            revision,
        });
    }
    Ok(Answer {
        value: dispatch(backend, request).await?,
        revision: None,
    })
}

async fn dispatch(backend: &dyn Backend, request: Request) -> Result<Value, WireError> {
    match request {
        Request::Board { .. } => Err(WireError::internal("the board is loaded by `run`")),
        Request::GetTask { id } => json(backend.get_task(id).await?),
        Request::GetGoal { id } => json(backend.get_goal(id).await?),
        Request::GetCommitment { id } => json(backend.get_commitment(id).await?),
        Request::GetDomain { id } => json(backend.get_domain(id).await?),
        Request::GetInfo { id } => {
            let infos = backend.list_infos().await?;
            match infos.into_iter().find(|info| info.id == id) {
                Some(info) => json(info),
                None => Err(WireError::new(
                    WireErrorKind::NotFound,
                    format!("no info {id}"),
                    None,
                )),
            }
        }
        Request::GetFlow { id } => json(backend.get_flow(id).await?),
        Request::TaskDependencies { id } => json(backend.list_task_dependencies(id).await?),
        Request::TaskDoneAt { id } => json(backend.task_done_at(id).await?),

        Request::CreateTask { request } => json(backend.create_task(request).await?),
        Request::UpdateTask {
            id,
            request,
            confirmed,
            descendant_plans,
        } => json(match descendant_plans {
            Some(plans) => settle(backend, id, request, confirmed, plans).await?,
            None => backend.update_task(id, request, Some(confirmed)).await?,
        }),
        Request::PlanContainmentConflicts { id, plan } => {
            json(backend.plan_containment_conflicts(id, plan).await?)
        }
        Request::DeleteTask { id } => json(backend.delete_task(id).await?),
        Request::StepTaskStatus {
            id,
            step,
            confirmed,
        } => json(backend.step_task_status(id, step, Some(confirmed)).await?),
        Request::ToggleTaskAgentic { id } => json(backend.toggle_task_agentic(id).await?),
        Request::AddTaskDependency {
            task_id,
            dependency,
        } => json(backend.add_task_dependency(task_id, dependency).await?),
        Request::RemoveTaskDependency {
            task_id,
            dependency,
        } => json(backend.remove_task_dependency(task_id, dependency).await?),
        Request::SetTaskDoneAt { id, at } => json(backend.set_task_done_at(id, at).await?),
        Request::DuplicateTask {
            id,
            target_type,
            target_id,
            position,
        } => json(
            backend
                .duplicate_task(id, target_type, target_id, position)
                .await?,
        ),

        Request::CreateGoal { request } => json(backend.create_goal(request).await?),
        Request::UpdateGoal {
            id,
            request,
            confirmed,
        } => json(backend.update_goal(id, request, Some(confirmed)).await?),
        Request::DeleteGoal { id } => json(backend.delete_goal(id).await?),
        Request::DuplicateGoal {
            id,
            target_type,
            target_id,
            position,
        } => json(
            backend
                .duplicate_goal(id, target_type, target_id, position)
                .await?,
        ),

        Request::CreateCommitment { request } => json(backend.create_commitment(request).await?),
        Request::UpdateCommitment { id, request } => {
            json(backend.update_commitment(id, request).await?)
        }
        Request::DeleteCommitment { id } => json(backend.delete_commitment(id).await?),
        Request::PressCommitmentVerdict { id, press } => {
            json(backend.press_commitment_verdict(id, press).await?)
        }

        Request::CreateWait { request } => json(backend.create_expectation(request).await?),
        Request::UpdateWait { id, request } => json(backend.update_expectation(id, request).await?),
        Request::DeleteWait { id } => json(backend.delete_expectation(id).await?),
        Request::CompleteWaitCheck { id } => json(backend.complete_expectation_check(id).await?),
        Request::ReopenWaitCheck { id, due_at } => {
            json(backend.reopen_expectation_check(id, due_at).await?)
        }
        Request::UpdateSpawnedWait { task_id, request } => {
            json(backend.update_spawned_wait(task_id, request).await?)
        }
        Request::CompleteSpawnedWaitCheck { task_id } => {
            json(backend.complete_spawned_wait_check(task_id).await?)
        }
        Request::ReopenSpawnedWaitCheck { task_id, due_at } => {
            json(backend.reopen_spawned_wait_check(task_id, due_at).await?)
        }

        Request::SetTag {
            kind,
            id,
            tag_id,
            present,
        } => set_tag(backend, &kind, id, tag_id, present).await,
        Request::SetBlockReasons {
            owner_type,
            owner_id,
            reasons,
        } => json(
            backend
                .set_block_reasons(owner_type, owner_id, reasons)
                .await?,
        ),

        Request::CreateInfo { request } => json(backend.create_info(request).await?),
        Request::UpdateInfo { id, request } => json(backend.update_info(id, request).await?),
        Request::DeleteInfo { id } => json(backend.delete_info(id).await?),
        Request::DuplicateInfo {
            id,
            target_type,
            target_id,
            position,
        } => json(
            backend
                .duplicate_info(id, target_type, target_id, position)
                .await?,
        ),

        Request::ListDomains { subtype } => json(backend.list_domains(subtype).await?),
        Request::CreateDomain { request } => json(backend.create_domain(request).await?),
        Request::UpdateDomain { id, request } => json(backend.update_domain(id, request).await?),
        Request::DeleteDomain { id } => json(backend.delete_domain(id).await?),
        Request::DuplicateDomain {
            id,
            target_id,
            position,
        } => json(backend.duplicate_domain(id, target_id, position).await?),

        Request::CreateFlow { request } => json(backend.create_flow(request).await?),
        Request::UpdateFlow { id, request } => json(backend.update_flow(id, request).await?),
        Request::DeleteFlow { id } => json(backend.delete_flow(id).await?),
        Request::CreateFlowGoal { request } => json(backend.create_flow_goal(request).await?),
        Request::CreateFlowTask { request } => json(backend.create_flow_task(request).await?),
        Request::CreateFlowCommitment { request } => {
            json(backend.create_flow_commitment(request).await?)
        }
        Request::CreateFlowWait { request } => {
            json(backend.create_flow_expectation(request).await?)
        }
        Request::UpdateFlowCommitment { id, request } => {
            json(backend.update_flow_commitment(id, request).await?)
        }
        Request::UpdateFlowWait { id, request } => {
            json(backend.update_flow_expectation(id, request).await?)
        }
        Request::UpdateFlowGoal { id, request } => {
            json(backend.update_flow_goal(id, request).await?)
        }
        Request::UpdateFlowTask { id, request } => {
            json(backend.update_flow_task(id, request).await?)
        }
        Request::DeleteFlowItem { item_type, id } => {
            json(backend.delete_flow_item(item_type, id).await?)
        }
        Request::SetFlowItemCycles {
            flow_id,
            item_type,
            item_id,
            cycles,
            reconcile,
            now: at,
        } => json(
            backend
                .set_flow_item_cycles(flow_id, item_type, item_id, cycles, reconcile, at)
                .await?,
        ),
        Request::AddFlowDependency {
            flow_id,
            dependent_type,
            dependent_id,
            depends_on_type,
            depends_on_id,
        } => json(
            backend
                .add_flow_dependency(
                    flow_id,
                    dependent_type,
                    dependent_id,
                    depends_on_type,
                    depends_on_id,
                )
                .await?,
        ),
        Request::RemoveFlowDependency {
            dependent_type,
            dependent_id,
            depends_on_type,
            depends_on_id,
        } => json(
            backend
                .remove_flow_dependency(
                    dependent_type,
                    dependent_id,
                    depends_on_type,
                    depends_on_id,
                )
                .await?,
        ),
        Request::StartFlow { flow_id, request } => {
            json(backend.start_flow(flow_id, request).await?)
        }
        Request::SetFlowRecurrence { flow_id, request } => {
            json(backend.set_flow_recurrence(flow_id, request).await?)
        }
        Request::DeleteFlowRecurrence { flow_id } => {
            json(backend.delete_flow_recurrence(flow_id).await?)
        }
        Request::ClearHabitModifications { flow_id } => {
            json(backend.clear_habit_modifications(flow_id).await?)
        }
        Request::ForkFlow { flow_id, now: at } => {
            json(backend.fork_flow(flow_id, at.unwrap_or_else(now)).await?)
        }
        Request::DuplicateFlow {
            flow_id,
            parent_type,
            parent_id,
            position,
        } => json(
            backend
                .duplicate_flow(flow_id, parent_type, parent_id, position)
                .await?,
        ),
        Request::DuplicateFlowItem {
            item_type,
            item_id,
            parent_type,
            parent_id,
            position,
        } => json(
            backend
                .duplicate_flow_item(item_type, item_id, parent_type, parent_id, position)
                .await?,
        ),
        Request::ConvertToFlow {
            node_type,
            node_id,
            keep_dependencies,
            map_scopes,
        } => json(
            backend
                .convert_to_flow(node_type, node_id, keep_dependencies, map_scopes)
                .await?,
        ),

        Request::ListTasks { now: at } => json(backend.list_tasks(at.unwrap_or_else(now)).await?),
        Request::ListGoals { now: at } => json(backend.list_goals(at.unwrap_or_else(now)).await?),
        Request::ListCommitments { now: at } => {
            json(backend.list_commitments(at.unwrap_or_else(now)).await?)
        }
        Request::ListWaits { now: at } => {
            json(backend.list_expectations(at.unwrap_or_else(now)).await?)
        }
        Request::ScopeLifecycles { now: at } => json(
            backend
                .derive_scope_lifecycles(at.unwrap_or_else(now))
                .await?,
        ),
        Request::ListAllTaskDependencies { .. } => {
            json(backend.list_all_task_dependencies().await?)
        }
        Request::DependencyCandidates { id, .. } => json(backend.dependency_candidates(id).await?),
        Request::ScopeContainmentConflicts {
            node_type,
            node_id,
            time_scope,
        } => json(
            backend
                .scope_containment_conflicts(node_type, node_id, time_scope)
                .await?,
        ),
        Request::ReparentConflicts {
            node_type,
            node_id,
            new_parent_type,
            new_parent_id,
        } => json(
            backend
                .reparent_scope_conflicts(node_type, node_id, new_parent_type, new_parent_id)
                .await?,
        ),
        Request::ListInfos => json(backend.list_infos().await?),
        Request::ListFlows => json(backend.list_flows().await?),
        Request::ListFlowGoals { flow_id } => json(backend.list_flow_goals(flow_id).await?),
        Request::ListFlowTasks { flow_id } => json(backend.list_flow_tasks(flow_id).await?),
        Request::ListAllFlowGoals => json(backend.list_all_flow_goals().await?),
        Request::ListAllFlowTasks => json(backend.list_all_flow_tasks().await?),
        Request::ListAllFlowCycles => json(backend.list_all_flow_cycles().await?),
        Request::ListAllFlowDependencies => json(backend.list_all_flow_dependencies().await?),
        Request::GetFlowRecurrence { flow_id } => json(backend.get_flow_recurrence(flow_id).await?),
        Request::HabitCompletionCount { flow_id } => {
            json(backend.habit_completion_count(flow_id).await?)
        }
        Request::FlowOrigins { nodes } => json(backend.flow_origins(nodes).await?),
        Request::ListFlowInstanceNodes => json(backend.list_flow_instance_nodes().await?),
        Request::ScopeValidFlowTargets {
            duration_n,
            duration_kind,
            anchor_date,
            candidates,
        } => json(
            backend
                .scope_valid_flow_targets(duration_n, duration_kind, anchor_date, candidates)
                .await?,
        ),
        Request::ListAllBlockReasons => json(backend.list_all_block_reasons().await?),
        Request::McpAccessCatalogue => json(backend.mcp_access_catalogue().await?),
        Request::ListMcpAccess => json(backend.list_mcp_access().await?),
        Request::AddMcpRoot { node_kind, node_id } => {
            json(backend.add_mcp_root(node_kind, node_id).await?)
        }
        Request::RemoveMcpRoot { node_kind, node_id } => {
            json(backend.remove_mcp_root(node_kind, node_id).await?)
        }
        Request::ListAgents => json(backend.list_agents().await?),
        Request::IssueAgentPin => json(backend.issue_agent_pin().await?),
        Request::ApplyAgentAction { id, action } => {
            json(backend.apply_agent_action(id, action).await?)
        }
        Request::SetAgentAccountLocked { label, locked } => {
            json(backend.set_agent_account_locked(label, locked).await?)
        }
        Request::DeleteNodes { nodes } => json(backend.delete_nodes(nodes).await?),
        Request::RunGesture { name, steps } => json(backend.run_gesture(name, steps).await?),
        Request::Undo => json(backend.undo().await?),
        Request::Redo => json(backend.redo().await?),
        Request::UndoStatus => json(backend.undo_status().await?),
    }
}

/// An update that says what becomes of the Plans below.
async fn settle(
    backend: &dyn Backend,
    id: arlesh_core::nodes::id::NodeId,
    request: arlesh_core::tasks::model::UpdateTaskRequest,
    confirmed: bool,
    plans: DescendantPlans,
) -> Result<arlesh_core::tasks::model::Task, WireError> {
    backend
        .update_task_settling_plans(id, request, Some(confirmed), plans)
        .await
}

/// Adds or removes a tag on a Task, Goal, Commitment or wait.
async fn set_tag(
    backend: &dyn Backend,
    kind: &str,
    id: arlesh_core::nodes::id::NodeId,
    tag_id: i64,
    present: bool,
) -> Result<Value, WireError> {
    match (kind, present) {
        ("task", true) => json(backend.add_tag_to_task(id, tag_id).await?),
        ("task", false) => json(backend.remove_tag_from_task(id, tag_id).await?),
        ("goal", true) => json(backend.add_tag_to_goal(id, tag_id).await?),
        ("goal", false) => json(backend.remove_tag_from_goal(id, tag_id).await?),
        ("commitment", true) => json(backend.add_tag_to_commitment(id, tag_id).await?),
        ("commitment", false) => json(backend.remove_tag_from_commitment(id, tag_id).await?),
        ("expectation", true) => json(backend.add_tag_to_expectation(id, tag_id).await?),
        ("expectation", false) => json(backend.remove_tag_from_expectation(id, tag_id).await?),
        _ => Err(WireError::invalid_request(format!("cannot tag a {kind}"))),
    }
}
