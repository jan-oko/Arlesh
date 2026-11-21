//! The Backend port's operations, each listed once with what a Replica does with it. The two
//! users of the list ([`super::forward`] and the test rig's server stand-in) are macros called
//! with it, so a method cannot be forgotten by one and not the other.
//!
//! Kinds: `read` is answered by the local board; `option_read` is `read` for a method that
//! answers an `Option`; `write` is predicted locally and sent; `create` is `write` for a method
//! whose request carries the new row's id, minted here; `remote` waits until the Replica is
//! settled and is answered by the server; `remote_read` is a read the server alone can answer;
//! `local` is a Gesture boundary, which the Replica has no use for; `undo` is undo or redo;
//! `refused` is not offered in Client mode.

/// Calls `$callback` with every port, in the list below.
macro_rules! with_ports {
    ($callback:ident) => {
        $callback! {
            AccessPort in access {
                uses {
                    use arlesh_core::nodes::id::RowId;
                    use arlesh_core::{
                        access::model::{EffectiveAccess, NodeTable},
                        error::WireError,
                    };
                    use arlesh_core::access::model::McpAccessCatalogue;
                }
                methods {
                read mcp_access_catalogue() -> Result<McpAccessCatalogue, WireError>;
                read list_mcp_access() -> Result<Vec<EffectiveAccess>, WireError>;
                write add_mcp_root(node_kind: NodeTable, node_id: RowId) -> Result<(), WireError>;
                write remove_mcp_root(node_kind: NodeTable, node_id: RowId) -> Result<(), WireError>;
                }
            }
            AgentsPort in agents {
                uses {
                    use arlesh_core::{
                        agents::model::{AgentAction, AgentsOverview, IssuedPin},
                        error::WireError,
                    };
                }
                methods {
                remote_read list_agents() -> Result<AgentsOverview, WireError>;
                remote issue_agent_pin() -> Result<IssuedPin, WireError>;
                write apply_agent_action(id: i64, action: AgentAction) -> Result<(), WireError>;
                write set_agent_account_locked(label: String, locked: bool) -> Result<(), WireError>;
                }
            }
            BlockReasonsPort in block_reasons {
                uses {
                    use arlesh_core::{block_reasons::model::BlockReason, error::WireError};
                }
                methods {
                read list_all_block_reasons() -> Result<Vec<BlockReason>, WireError>;
                write set_block_reasons(owner_type: String, owner_id: arlesh_core::nodes::id::NodeId, reasons: Vec<String>) -> Result<(), WireError>;
                }
            }
            CommitmentsPort in commitments {
                uses {
                    use arlesh_core::nodes::id::RowId;
                    use arlesh_core::{
                        error::WireError,
                        nodes::id::NodeId,
                        tasks::model::{Commitment, CreateCommitmentRequest, UpdateCommitmentRequest},
                    };
                }
                methods {
                create create_commitment(request: CreateCommitmentRequest) -> Result<Commitment, WireError>;
                read get_commitment(id: RowId) -> Result<Commitment, WireError>;
                read list_commitments(now: chrono::NaiveDateTime) -> Result<Vec<Commitment>, WireError>;
                write update_commitment(id: NodeId, request: UpdateCommitmentRequest) -> Result<Commitment, WireError>;
                write delete_commitment(id: NodeId) -> Result<(), WireError>;
                write add_tag_to_commitment(commitment_id: NodeId, tag_id: RowId) -> Result<(), WireError>;
                write remove_tag_from_commitment(commitment_id: NodeId, tag_id: RowId) -> Result<(), WireError>;
                }
            }
            DomainsPort in domains {
                uses {
                    use arlesh_core::nodes::id::RowId;
                    use arlesh_core::{
                        domains::model::{CreateDomainRequest, Domain, DomainSubtype, UpdateDomainRequest},
                        duplicate::DuplicatedSubtree,
                        error::WireError,
                    };
                }
                methods {
                create create_domain(request: CreateDomainRequest) -> Result<Domain, WireError>;
                read get_domain(id: RowId) -> Result<Domain, WireError>;
                read list_domains(subtype: Option<DomainSubtype>) -> Result<Vec<Domain>, WireError>;
                write update_domain(id: RowId, request: UpdateDomainRequest) -> Result<Domain, WireError>;
                write delete_domain(id: RowId) -> Result<(), WireError>;
                write duplicate_domain(id: RowId, target_id: RowId, position: i64) -> Result<DuplicatedSubtree<Domain>, WireError>;
                }
            }
            WaitsPort in expectations {
                uses {
                    use arlesh_core::nodes::id::RowId;
                    use arlesh_core::{
                        error::WireError,
                        nodes::id::NodeId,
                        tasks::answer_drafts::{AnswerDraft, DraftRequest, SendOutcome, SendRequest},
                        tasks::model::{
                            CreateExpectationRequest, Expectation, SpawnedWait, UpdateExpectationRequest,
                            UpdateSpawnedWaitRequest,
                        },
                    };
                }
                methods {
                create create_expectation(request: CreateExpectationRequest) -> Result<Expectation, WireError>;
                read list_expectations(now: chrono::NaiveDateTime) -> Result<Vec<Expectation>, WireError>;
                write update_expectation(id: NodeId, request: UpdateExpectationRequest) -> Result<Expectation, WireError>;
                write complete_expectation_check(id: RowId) -> Result<Expectation, WireError>;
                write update_spawned_wait(task_id: RowId, request: UpdateSpawnedWaitRequest) -> Result<SpawnedWait, WireError>;
                write complete_spawned_wait_check(task_id: RowId) -> Result<(), WireError>;
                write add_tag_to_expectation(expectation_id: arlesh_core::nodes::id::NodeId, tag_id: RowId) -> Result<(), WireError>;
                write remove_tag_from_expectation(expectation_id: arlesh_core::nodes::id::NodeId, tag_id: RowId) -> Result<(), WireError>;
                write delete_expectation(id: NodeId) -> Result<(), WireError>;
                write reopen_expectation_check(id: RowId, due_at: chrono::NaiveDateTime) -> Result<Expectation, WireError>;
                write reopen_spawned_wait_check(task_id: RowId, due_at: chrono::NaiveDateTime) -> Result<(), WireError>;
                write save_answer_draft(wait_id: NodeId, request: DraftRequest) -> Result<AnswerDraft, WireError>;
                write clear_answer_draft(wait_id: NodeId) -> Result<(), WireError>;
                write send_answer_drafts(request: SendRequest) -> Result<SendOutcome, WireError>;
                }
            }
            FlowsPort in flows {
                uses {
                    use arlesh_core::nodes::id::RowId;
                    use arlesh_core::{
                        error::WireError,
                        flows::{
                            self,
                            model::{
                                CreateFlowItemRequest, CreateFlowRequest, Flow, FlowCommitment, FlowCycleInput,
                                FlowDependency, FlowExpectation, FlowGoal, FlowItemCycle, FlowItemType, FlowOrigin,
                                FlowRecurrence, FlowTask, MaterializedFlow, SetRecurrenceRequest, StartFlowRequest,
                                TargetRef, UpdateFlowItemRequest, UpdateFlowRequest,
                            },
                        },
                    };
                }
                methods {
                create create_flow(request: CreateFlowRequest) -> Result<Flow, WireError>;
                read get_flow(id: RowId) -> Result<Flow, WireError>;
                read list_flows() -> Result<Vec<Flow>, WireError>;
                write update_flow(id: RowId, request: UpdateFlowRequest) -> Result<Flow, WireError>;
                write delete_flow(id: RowId) -> Result<(), WireError>;
                create create_flow_goal(request: CreateFlowItemRequest) -> Result<FlowGoal, WireError>;
                create create_flow_task(request: CreateFlowItemRequest) -> Result<FlowTask, WireError>;
                create create_flow_commitment(request: CreateFlowItemRequest) -> Result<FlowCommitment, WireError>;
                create create_flow_expectation(request: CreateFlowItemRequest) -> Result<FlowExpectation, WireError>;
                write update_flow_commitment(id: RowId, request: UpdateFlowItemRequest) -> Result<FlowCommitment, WireError>;
                write update_flow_expectation(id: RowId, request: UpdateFlowItemRequest) -> Result<FlowExpectation, WireError>;
                read list_flow_goals(flow_id: RowId) -> Result<Vec<FlowGoal>, WireError>;
                read list_flow_tasks(flow_id: RowId) -> Result<Vec<FlowTask>, WireError>;
                read list_all_flow_goals() -> Result<Vec<FlowGoal>, WireError>;
                read list_all_flow_tasks() -> Result<Vec<FlowTask>, WireError>;
                write update_flow_goal(id: RowId, request: UpdateFlowItemRequest) -> Result<FlowGoal, WireError>;
                write update_flow_task(id: RowId, request: UpdateFlowItemRequest) -> Result<FlowTask, WireError>;
                write start_flow(flow_id: RowId, request: StartFlowRequest) -> Result<MaterializedFlow, WireError>;
                read scope_valid_flow_targets(duration_n: Option<i64>, duration_kind: Option<String>, anchor_date: Option<chrono::NaiveDate>, candidates: Vec<TargetRef>) -> Result<Vec<TargetRef>, WireError>;
                write set_flow_recurrence(flow_id: RowId, request: SetRecurrenceRequest) -> Result<FlowRecurrence, WireError>;
                read get_flow_recurrence(flow_id: RowId) -> Result<Option<FlowRecurrence>, WireError>;
                write delete_flow_recurrence(flow_id: RowId) -> Result<(), WireError>;
                read flow_origins(nodes: Vec<TargetRef>) -> Result<Vec<FlowOrigin>, WireError>;
                read list_flow_instance_nodes() -> Result<Vec<TargetRef>, WireError>;
                write delete_flow_item(item_type: FlowItemType, id: RowId) -> Result<(), WireError>;
                write set_flow_item_cycles(flow_id: RowId, item_type: FlowItemType, item_id: RowId, cycles: Vec<FlowCycleInput>, reconcile: Option<flows::cycles::Reconcile>, now: Option<chrono::NaiveDateTime>) -> Result<Option<flows::cycles::ForkedTemplate>, WireError>;
                read list_all_flow_cycles() -> Result<Vec<FlowItemCycle>, WireError>;
                write add_flow_dependency(flow_id: RowId, dependent_type: FlowItemType, dependent_id: RowId, depends_on_type: FlowItemType, depends_on_id: RowId) -> Result<(), WireError>;
                write remove_flow_dependency(dependent_type: FlowItemType, dependent_id: RowId, depends_on_type: FlowItemType, depends_on_id: RowId) -> Result<(), WireError>;
                read list_all_flow_dependencies() -> Result<Vec<FlowDependency>, WireError>;
                read habit_completion_count(flow_id: RowId) -> Result<i64, WireError>;
                write clear_habit_modifications(flow_id: RowId) -> Result<(), WireError>;
                write fork_flow(flow_id: RowId, now: chrono::NaiveDateTime) -> Result<Flow, WireError>;
                write duplicate_flow(flow_id: RowId, parent_type: String, parent_id: RowId, position: i64) -> Result<Flow, WireError>;
                write duplicate_flow_item(item_type: FlowItemType, item_id: RowId, parent_type: String, parent_id: RowId, position: i64) -> Result<RowId, WireError>;
                write convert_to_flow(node_type: String, node_id: RowId, keep_dependencies: bool, map_scopes: bool) -> Result<Flow, WireError>;
                }
            }
            GesturesPort in gestures {
                uses {
                    use arlesh_core::tasks::gestures::StatusStepOutcome;
                    use arlesh_core::{
                        error::WireError,
                        nodes::id::NodeId,
                        tasks::{
                            model::{Commitment, Task},
                            rules::gestures::{StatusStep, VerdictPress},
                        },
                    };
                }
                methods {
                write step_task_status(id: NodeId, step: StatusStep, confirmed: Option<bool>) -> Result<StatusStepOutcome, WireError>;
                write toggle_task_agentic(id: NodeId) -> Result<Task, WireError>;
                write press_commitment_verdict(id: NodeId, press: VerdictPress) -> Result<Commitment, WireError>;
                }
            }
            InfosPort in infos {
                uses {
                    use arlesh_core::nodes::id::RowId;
                    use arlesh_core::{
                        duplicate::DuplicatedSubtree,
                        error::WireError,
                        infos::model::{CreateInfoRequest, Info, UpdateInfoRequest},
                    };
                }
                methods {
                create create_info(request: CreateInfoRequest) -> Result<Info, WireError>;
                read list_infos() -> Result<Vec<Info>, WireError>;
                write update_info(id: RowId, request: UpdateInfoRequest) -> Result<Info, WireError>;
                write delete_info(id: RowId) -> Result<(), WireError>;
                write duplicate_info(id: RowId, target_type: String, target_id: RowId, position: i64) -> Result<DuplicatedSubtree<Info>, WireError>;
                }
            }
            KnowledgeBasePort in knowledge_base {
                uses {
                    use arlesh_core::nodes::id::RowId;
                    use arlesh_core::{
                        error::WireError,
                        knowledge_base::model::{
                            CreateEventRequest, CreatePersonRequest, CreateThreadRequest, Event, Person, Thread,
                            UpdatePersonRequest,
                        },
                    };
                }
                methods {
                refused create_person(request: CreatePersonRequest) -> Result<Person, WireError>;
                refused get_person(id: RowId) -> Result<Person, WireError>;
                refused list_people() -> Result<Vec<Person>, WireError>;
                refused update_person(id: RowId, request: UpdatePersonRequest) -> Result<Person, WireError>;
                refused delete_person(id: RowId) -> Result<(), WireError>;
                refused create_event(request: CreateEventRequest) -> Result<Event, WireError>;
                refused list_events() -> Result<Vec<Event>, WireError>;
                refused create_thread(request: CreateThreadRequest) -> Result<Thread, WireError>;
                refused list_threads() -> Result<Vec<Thread>, WireError>;
                }
            }
            BoardPort in mindmap {
                uses {
                    use crate::revision::{BoardHead, BoardLoad, BoardRevision, CurrentBoard};
                    use arlesh_core::error::WireError;
                }
                methods {
                read load_mindmap(now: chrono::NaiveDateTime) -> Result<BoardLoad, WireError>;
                read current_board() -> Result<CurrentBoard, WireError>;
                option_read board_fence() -> Option<BoardRevision>;
                option_read board_head() -> Option<BoardHead>;
                }
            }
            NodeGesturesPort in node_gestures {
                uses {
                    use arlesh_core::{
                        error::WireError,
                        nodes::gestures::{steps::StepEntry, GestureName, GestureNode},
                    };
                }
                methods {
                write delete_nodes(nodes: Vec<GestureNode>) -> Result<(), WireError>;
                write run_gesture(name: GestureName, steps: Vec<StepEntry>) -> Result<Vec<serde_json::Value>, WireError>;
                }
            }
            TasksPort in tasks {
                uses {
                    use arlesh_core::nodes::id::RowId;
                    use arlesh_core::{
                        duplicate::DuplicatedSubtree,
                        error::WireError,
                        nodes::id::NodeId,
                        tasks::{
                            lifecycle::ItemLifecycle,
                            model::{
                                CreateGoalRequest, CreateTaskRequest, Dependency, DescendantPlans, Goal, Task,
                                TaskDependencyEdge, TaskWithBlockers, TimeScope, UpdateGoalRequest, UpdateTaskRequest,
                            },
                            ReparentConflicts, ViolatingDescendant,
                        },
                    };
                }
                methods {
                create create_task(request: CreateTaskRequest) -> Result<Task, WireError>;
                read get_task(id: RowId) -> Result<TaskWithBlockers, WireError>;
                read list_tasks(now: chrono::NaiveDateTime) -> Result<Vec<Task>, WireError>;
                write update_task(id: NodeId, request: UpdateTaskRequest, confirmed: Option<bool>) -> Result<Task, WireError>;
                write update_task_settling_plans(id: NodeId, request: UpdateTaskRequest, confirmed: Option<bool>, descendant_plans: DescendantPlans) -> Result<Task, WireError>;
                read dependency_candidates(id: NodeId) -> Result<Vec<Dependency>, WireError>;
                read plan_containment_conflicts(id: NodeId, plan: Option<TimeScope>) -> Result<Vec<arlesh_core::mindmap::rules::plans::PlanClampTarget>, WireError>;
                read scope_containment_conflicts(node_type: String, node_id: RowId, time_scope: TimeScope) -> Result<Vec<ViolatingDescendant>, WireError>;
                read reparent_scope_conflicts(node_type: String, node_id: RowId, new_parent_type: String, new_parent_id: RowId) -> Result<ReparentConflicts, WireError>;
                write delete_task(id: NodeId) -> Result<(), WireError>;
                write duplicate_task(id: RowId, target_type: String, target_id: RowId, position: i64) -> Result<DuplicatedSubtree<Task>, WireError>;
                write add_task_dependency(task_id: NodeId, dependency: Dependency) -> Result<(), WireError>;
                write remove_task_dependency(task_id: NodeId, dependency: Dependency) -> Result<(), WireError>;
                read list_task_dependencies(task_id: NodeId) -> Result<Vec<Dependency>, WireError>;
                read task_done_at(id: NodeId) -> Result<Option<chrono::NaiveDateTime>, WireError>;
                write set_task_done_at(id: NodeId, at: chrono::NaiveDateTime) -> Result<(), WireError>;
                read list_all_task_dependencies() -> Result<Vec<TaskDependencyEdge>, WireError>;
                create create_goal(request: CreateGoalRequest) -> Result<Goal, WireError>;
                read get_goal(id: RowId) -> Result<Goal, WireError>;
                read list_goals(now: chrono::NaiveDateTime) -> Result<Vec<Goal>, WireError>;
                write update_goal(id: NodeId, request: UpdateGoalRequest, confirmed: Option<bool>) -> Result<Goal, WireError>;
                write delete_goal(id: NodeId) -> Result<(), WireError>;
                write duplicate_goal(id: RowId, target_type: String, target_id: RowId, position: i64) -> Result<DuplicatedSubtree<Goal>, WireError>;
                write add_tag_to_task(task_id: NodeId, tag_id: RowId) -> Result<(), WireError>;
                write remove_tag_from_task(task_id: NodeId, tag_id: RowId) -> Result<(), WireError>;
                write add_tag_to_goal(goal_id: NodeId, tag_id: RowId) -> Result<(), WireError>;
                write remove_tag_from_goal(goal_id: NodeId, tag_id: RowId) -> Result<(), WireError>;
                read derive_scope_lifecycles(now: chrono::NaiveDateTime) -> Result<Vec<ItemLifecycle>, WireError>;
                }
            }
            UndoPort in undo {
                uses {
                    use arlesh_core::{
                        error::WireError,
                        undo::{
                            model::{GestureId, GestureSummary, UndoStatus},
                            GestureAbort, GestureClose,
                        },
                    };
                }
                methods {
                local open_gesture() -> Result<GestureId, WireError>;
                local close_gesture() -> Result<GestureClose, WireError>;
                local abort_gesture() -> Result<GestureAbort, WireError>;
                undo undo() -> Result<Option<GestureSummary>, WireError>;
                undo redo() -> Result<Option<GestureSummary>, WireError>;
                remote_read undo_status() -> Result<UndoStatus, WireError>;
                }
            }
        }
    };
}

pub(super) use with_ports;
