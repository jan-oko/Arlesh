//! The stored board, read once: every stored row a board-wide derivation reads, with what its
//! rules need beside the rows — each node's ancestry, every wait's sources, every completion
//! instant.
//!
//! This is a gather and nothing else. The derivations that read it — a Habit's compound readings
//! today, the board load as it moves over — are pure functions of what it holds (ADR 0010).

use std::collections::HashMap;

use chrono::NaiveDateTime;

use crate::{
    database::session::{Db, SessionMode},
    error::AppError,
    flows::model::{ChildAttachment, HabitInstanceChild},
    infos::model::Info,
    nodes::{id::NodeId, waits::WaitData},
    tasks::{
        model::{Commitment, Expectation, Goal, Task},
        rules::ancestry::AncestryIndex,
    },
};

/// Every stored row a board-wide derivation reads, and what its rules need beside them.
pub struct StoredBoard {
    /// The stored Tasks.
    pub tasks: Vec<Task>,
    /// The stored Goals.
    pub goals: Vec<Goal>,
    /// The stored Commitments.
    pub commitments: Vec<Commitment>,
    /// The stored Expectations.
    pub expectations: Vec<Expectation>,
    /// The stored Infos.
    pub infos: Vec<Info>,
    /// Every stored node hung on a Habit occurrence.
    pub children: Vec<HabitInstanceChild>,
    /// Every added child's attachment, as `(child_type, child_id, attachment)`.
    pub attachments: Vec<(String, i64, ChildAttachment)>,
    /// Every stored scoped row's ancestry link, and every added child's occurrence.
    pub ancestry: AncestryIndex,
    /// What every wait is drawn from.
    pub waits: WaitData,
    /// When each finished stored item was finished.
    pub instants: HashMap<NodeId, NaiveDateTime>,
}

impl StoredBoard {
    /// Reads the stored board.
    pub async fn read<M: SessionMode>(db: &mut Db<M>) -> Result<Self, AppError> {
        let tasks = db.tasks().list().await?;
        let goals = db.goals().list().await?;
        let commitments = db.commitments().list().await?;
        let attachments = db.flows().child_attachments().await?;
        let ancestry = AncestryIndex::of(&tasks, &goals, &commitments, attachments.clone());
        Ok(Self {
            expectations: db.expectations().list().await?,
            infos: db.infos().list().await?,
            children: db.flows().list_all_instance_children().await?,
            waits: WaitData::read(db).await?,
            instants: db.tasks().completion_instants().await?,
            tasks,
            goals,
            commitments,
            attachments,
            ancestry,
        })
    }
}
