//! What a board load reads, gathered in one place: every stored row, every list the payload
//! carries, and what each Habit's rows are drawn from.
//!
//! A gather and nothing else; [`super::rules::derive_board`] derives the board from it (ADR 0010).

use std::collections::HashMap;

use crate::{
    block_reasons::model::BlockReason,
    database::session::{Db, Transactional},
    domains::model::Domain,
    error::AppError,
    flows::{
        error::FlowError,
        model::{Flow, FlowDependency, FlowGoal, FlowItemCycle, FlowTask, TargetRef},
        occurrences::HabitSource,
    },
    nodes::{board::StoredBoard, relations::DerivedEdge},
    tasks::model::TaskDependencyEdge,
};

/// Everything a board load is derived from.
pub struct BoardSources {
    /// Every Domain, Project, Aspect and Tag.
    pub domains: Vec<Domain>,
    /// The stored rows and what their rules need beside them.
    pub stored: StoredBoard,
    /// Every Flow.
    pub flows: Vec<Flow>,
    /// Every Flow's goal items.
    pub flow_goals: Vec<FlowGoal>,
    /// Every Flow's task items.
    pub flow_tasks: Vec<FlowTask>,
    /// Every flow item's cycle pairs.
    pub flow_cycles: Vec<FlowItemCycle>,
    /// Every Flow's template edges.
    pub flow_dependencies: Vec<FlowDependency>,
    /// Every stored block reason.
    pub block_reasons: Vec<BlockReason>,
    /// Every stored dependency edge.
    pub task_dependencies: Vec<TaskDependencyEdge>,
    /// Every node a started Flow materialised.
    pub flow_instance_nodes: Vec<TargetRef>,
    /// What each Habit's rows are drawn from, by Flow id — or why it could not be read.
    pub habits: HashMap<i64, Result<HabitSource, FlowError>>,
    /// Every dependency edge recorded against a derived node.
    pub derived_edges: Vec<DerivedEdge>,
}

impl BoardSources {
    /// Reads everything a board load is derived from, in one transaction so that every read sees
    /// one consistent board. A Habit whose sources cannot be read is recorded as failed rather than
    /// failing the read.
    pub async fn read(db: &mut Db<Transactional>) -> Result<Self, AppError> {
        let domains = db.domains().list(None).await?;
        let stored = StoredBoard::read(db).await?;
        let flows = db.flows().list().await?;
        let mut habits = HashMap::new();
        for flow in flows.iter().filter(|flow| flow.is_habit) {
            habits.insert(flow.id, HabitSource::read(db, flow).await);
        }
        Ok(Self {
            domains,
            stored,
            flow_goals: db.flows().list_all_goals().await?,
            flow_tasks: db.flows().list_all_tasks().await?,
            flow_cycles: db.flows().list_all_cycles().await?,
            flow_dependencies: db.flows().list_all_dependencies().await?,
            block_reasons: db.block_reasons().list_all().await?,
            task_dependencies: db.tasks().list_all_dependencies().await?,
            flow_instance_nodes: db.flows().list_instance_node_refs().await?,
            derived_edges: db.relations().dependencies().await?,
            flows,
            habits,
        })
    }
}
