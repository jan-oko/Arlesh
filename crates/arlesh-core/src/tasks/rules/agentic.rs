//! The Agentic rules a write is held to: which status a Task holds once its kind is known
//! ([`settle_status`]), how a Task left without a counterpart status is named ([`stranded`]), and
//! that an Agentic Task cannot start without a Spec ([`require_spec`]) — and what a node *reads
//! as* for Agentic, climbing the tree the app draws ([`AgenticClimb`], over loaded rows through an
//! [`AgenticIndex`]).
//!
//! Pure. The database climb that drives [`AgenticClimb`] a row at a time lives in
//! [`crate::tasks::agentic`], which re-exports the write rules (ADR 0010).

use std::collections::{HashMap, HashSet};

use crate::flows::model::{
    ChildAttachment, Flow, FlowCommitment, FlowExpectation, FlowGoal, FlowTask,
};
use crate::nodes::key::{OccurrenceKey, TemplateItem, TemplateKind, NO_CYCLE};
use crate::nodes::overlay::TaskOverlay;
use crate::scopes::key::ScopeKey;
use crate::tasks::error::TaskError;
use crate::tasks::model::{AgenticBrief, AgenticStatus, Commitment, Goal, Status, Task};

/// The status a Task holds after a write, in the model its kind holds then.
///
/// `before` is what the row held, `requested` what the write names, `agentic` the kind after the
/// write. A value already in that model stands — except Review, which is derived and never set. A
/// requested value of the other model is refused when the kind does not change: an ordinary
/// Started on an Agentic Task, say, or On Agent on an ordinary one. When the kind **does** change —
/// a flag change, or a move under another ancestor — the value is **converted** explicitly
/// ([`Status::converted`]), and refused, naming the Task, when it has no counterpart there.
pub(crate) fn settle_status(
    title: &str,
    before: Status,
    requested: Option<Status>,
    agentic: bool,
) -> Result<Status, TaskError> {
    if requested == Some(Status::Agentic(AgenticStatus::Review)) {
        return Err(TaskError::ReviewIsDerived);
    }
    let value = requested.unwrap_or(before);
    if value.is_agentic() == agentic {
        return Ok(value);
    }
    let kind_changes = before.is_agentic() != agentic;
    if requested.is_some() && !kind_changes {
        return Err(match agentic {
            true => TaskError::NotAgenticStatus(value.as_str().to_string()),
            false => TaskError::NotOrdinaryStatus(value.as_str().to_string()),
        });
    }
    value
        .converted(agentic)
        .ok_or_else(|| TaskError::KindConversion(stranded(title, value)))
}

/// How a Task left without a counterpart is named in a refusal.
pub(crate) fn stranded(title: &str, status: Status) -> String {
    format!("“{title}” ({})", status.as_str().replace('_', " "))
}

/// Refuses to start something that reads as Agentic, `agentic` already resolved, while `brief` has
/// no Spec.
pub(crate) fn require_spec(agentic: bool, brief: &Option<AgenticBrief>) -> Result<(), TaskError> {
    if agentic && !brief.as_ref().is_some_and(AgenticBrief::has_spec) {
        return Err(TaskError::AgenticSpecMissing);
    }
    Ok(())
}

/// Where an Agentic climb is: a stored row, or a Habit occurrence by its template item.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(in crate::tasks) enum Cursor {
    /// A stored row, by its kind and id.
    Stored(String, i64),
    /// A Habit occurrence.
    Template {
        /// Its template item.
        item: TemplateItem,
        /// Its iteration.
        iteration: ScopeKey,
        /// Its cycle pair.
        cycle: i64,
        /// Whether to skip this row's own value and start at its parent — for an occurrence being
        /// set back to Inherit in the very write being checked.
        skip_own: bool,
    },
}

/// What a template row hangs under: another template row, or — for an iteration's root — the
/// Habit's host.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(in crate::tasks) enum TemplateParent {
    /// Another template row.
    Item(TemplateItem),
    /// The Habit's host, spelled as a child row's parent type.
    Host(String, i64),
}

/// The cursor a Habit occurrence's own climb starts at.
pub(in crate::tasks) fn occurrence_cursor(key: &OccurrenceKey, skip_own: bool) -> Cursor {
    Cursor::Template {
        item: key.item,
        iteration: key.iteration,
        cycle: key.cycle,
        skip_own,
    }
}

/// What one stored row says to an Agentic climb.
pub(in crate::tasks) enum StoredRead {
    /// The row: its own flag (only a Task has one), its parent, and the occurrence it hangs on
    /// when it is an added child of one.
    Found {
        /// Its own Agentic flag.
        flag: Option<bool>,
        /// Its parent reference.
        parent: (String, i64),
        /// The occurrence it hangs on.
        holding: Option<OccurrenceKey>,
    },
    /// No such row.
    Missing,
}

/// What a climb needs read next.
pub(in crate::tasks) enum AgenticStep {
    /// The stored row `(kind, id)`.
    Stored(String, i64),
    /// The occurrence `key`'s own value (unless `skip_own`) and its template item's parent.
    Template {
        /// The occurrence.
        key: OccurrenceKey,
        /// Whether its own value is skipped.
        skip_own: bool,
    },
    /// The climb is over: what the node reads as.
    Done(bool),
}

/// One Agentic climb, as the reads it needs — the rule of what a node reads as for Agentic, kept
/// once. [`crate::tasks::agentic`] drives it from the database, a link at a time; an
/// [`AgenticIndex`] drives it from rows already loaded.
///
/// Inherits *through* the kinds that carry no flag — a Goal, a Commitment, a goal item — and stops
/// at anything else (a Project, a Domain, an Aspect: no Task ever sits above one), at a missing
/// row, and at a cycle, all of which read as not Agentic. A row hung on a Habit occurrence has the
/// occurrence for its parent, not the host its columns name; an occurrence reads its own value —
/// its overlay's, else its template's — then its template's parent within the same iteration,
/// and from the root the Habit's host.
pub(in crate::tasks) struct AgenticClimb {
    cursor: Cursor,
    seen_stored: HashSet<(String, i64)>,
    seen_template: HashSet<TemplateItem>,
}

impl AgenticClimb {
    /// A climb starting at `start`.
    pub(in crate::tasks) fn new(start: Cursor) -> Self {
        Self {
            cursor: start,
            seen_stored: HashSet::new(),
            seen_template: HashSet::new(),
        }
    }

    /// The next read, or the answer when the climb is over.
    pub(in crate::tasks) fn step(&mut self) -> AgenticStep {
        match &self.cursor {
            Cursor::Stored(kind, id) => {
                if !self.seen_stored.insert((kind.clone(), *id)) {
                    return AgenticStep::Done(false);
                }
                if !matches!(kind.as_str(), "task" | "goal" | "commitment") {
                    return AgenticStep::Done(false);
                }
                AgenticStep::Stored(kind.clone(), *id)
            }
            Cursor::Template {
                item,
                iteration,
                cycle,
                skip_own,
            } => {
                if !self.seen_template.insert(*item) {
                    return AgenticStep::Done(false);
                }
                AgenticStep::Template {
                    key: OccurrenceKey {
                        item: *item,
                        iteration: *iteration,
                        cycle: *cycle,
                    },
                    skip_own: *skip_own,
                }
            }
        }
    }

    /// Takes in what the stored row [`Self::step`] asked for says, and returns the answer when
    /// that ends the climb.
    pub(in crate::tasks) fn stored(&mut self, read: StoredRead) -> Option<bool> {
        match read {
            StoredRead::Missing => Some(false),
            StoredRead::Found {
                flag: Some(flag), ..
            } => Some(flag),
            StoredRead::Found {
                flag: None,
                parent,
                holding,
            } => {
                // A row hung on an occurrence climbs into the occurrence, as the app draws it.
                self.cursor = match holding {
                    Some(key) => occurrence_cursor(&key, false),
                    None => Cursor::Stored(parent.0, parent.1),
                };
                None
            }
        }
    }

    /// Takes in the occurrence's own value (read only when the step did not skip it) and its
    /// template item's parent, and returns the answer when that ends the climb.
    pub(in crate::tasks) fn template(
        &mut self,
        key: &OccurrenceKey,
        own: Option<bool>,
        parent: Option<TemplateParent>,
    ) -> Option<bool> {
        if let Some(flag) = own {
            return Some(flag);
        }
        self.cursor = match parent {
            None => return Some(false),
            Some(TemplateParent::Item(parent)) => Cursor::Template {
                item: parent,
                iteration: key.iteration,
                // An iteration's root is drawn by no cycle pair.
                cycle: if parent.item_type == TemplateKind::FlowRoot {
                    NO_CYCLE
                } else {
                    key.cycle
                },
                skip_own: false,
            },
            Some(TemplateParent::Host(kind, id)) => Cursor::Stored(kind, id),
        };
        None
    }
}

/// The host an iteration's root renders under: the Target Node, else the Flow's parent — spelled
/// as a child row's parent type.
pub(in crate::tasks) fn flow_host(flow: &Flow) -> (String, i64) {
    let (kind, id) = match (&flow.target_type, flow.target_id) {
        (Some(kind), Some(id)) => (kind.clone(), id),
        _ => (flow.parent_type.clone(), flow.parent_id),
    };
    let kind = match kind.as_str() {
        "goal" | "task" => kind,
        _ => "project".to_string(),
    };
    (kind, id)
}

/// The template kind a flow item's `parent_type` names, or `None` for anything else.
pub(in crate::tasks) fn template_kind_of(parent_type: &str) -> Option<TemplateKind> {
    match parent_type {
        "flow" => Some(TemplateKind::FlowRoot),
        "flow_task" => Some(TemplateKind::FlowTask),
        "flow_goal" => Some(TemplateKind::FlowGoal),
        "flow_commitment" => Some(TemplateKind::FlowCommitment),
        "flow_expectation" => Some(TemplateKind::FlowExpectation),
        _ => None,
    }
}

/// Every row an Agentic climb reads, loaded once for a whole board.
#[derive(Debug, Default)]
pub struct AgenticIndex {
    tasks: HashMap<i64, (Option<bool>, String, i64)>,
    goals: HashMap<i64, (String, i64)>,
    commitments: HashMap<i64, (String, i64)>,
    holding: HashMap<(String, i64), String>,
    overlays: HashMap<String, (Option<bool>, bool)>,
    flows: HashMap<i64, Flow>,
    flow_tasks: HashMap<i64, FlowTask>,
    flow_goals: HashMap<i64, FlowGoal>,
    /// Where each Commitment and wait item hangs — what a Task item under a Commitment item climbs
    /// through. Neither carries an Agentic flag of its own.
    item_parents: HashMap<TemplateItem, (String, i64)>,
}

/// The rows an [`AgenticIndex`] is built from.
pub struct AgenticRows<'rows> {
    /// The stored Tasks.
    pub tasks: &'rows [Task],
    /// The stored Goals.
    pub goals: &'rows [Goal],
    /// The stored Commitments.
    pub commitments: &'rows [Commitment],
    /// Every added child's attachment, as `(child_type, child_id, attachment)`.
    pub attachments: &'rows [(String, i64, ChildAttachment)],
    /// Every Task overlay, by node key.
    pub overlays: &'rows HashMap<String, TaskOverlay>,
    /// Every Flow.
    pub flows: &'rows [Flow],
    /// Every Flow's task items.
    pub flow_tasks: &'rows [FlowTask],
    /// Every Flow's goal items.
    pub flow_goals: &'rows [FlowGoal],
    /// Every Flow's Commitment items.
    pub flow_commitments: &'rows [FlowCommitment],
    /// Every Flow's wait items.
    pub flow_expectations: &'rows [FlowExpectation],
}

impl AgenticIndex {
    /// The index of `rows`.
    pub fn of(rows: AgenticRows<'_>) -> Self {
        let parent_of = |parent_type: &str, parent_id: &crate::nodes::id::NodeId| {
            Some((parent_type.to_string(), parent_id.stored()?))
        };
        Self {
            tasks: rows
                .tasks
                .iter()
                .filter_map(|task| {
                    let (kind, id) = parent_of(&task.parent_type, &task.parent_id)?;
                    Some((task.id.stored()?, (task.agentic, kind, id)))
                })
                .collect(),
            goals: rows
                .goals
                .iter()
                .filter_map(|goal| {
                    Some((
                        goal.id.stored()?,
                        parent_of(&goal.parent_type, &goal.parent_id)?,
                    ))
                })
                .collect(),
            commitments: rows
                .commitments
                .iter()
                .filter_map(|commitment| {
                    Some((
                        commitment.id.stored()?,
                        parent_of(&commitment.parent_type, &commitment.parent_id)?,
                    ))
                })
                .collect(),
            holding: rows
                .attachments
                .iter()
                .map(|(kind, id, attachment)| ((kind.clone(), *id), attachment.parent_key.clone()))
                .collect(),
            overlays: rows
                .overlays
                .iter()
                .map(|(key, overlay)| (key.clone(), (overlay.agentic, overlay.agentic_set)))
                .collect(),
            flows: rows
                .flows
                .iter()
                .map(|flow| (flow.id, flow.clone()))
                .collect(),
            flow_tasks: rows
                .flow_tasks
                .iter()
                .map(|task| (task.id, task.clone()))
                .collect(),
            flow_goals: rows
                .flow_goals
                .iter()
                .map(|goal| (goal.id, goal.clone()))
                .collect(),
            item_parents: rows
                .flow_commitments
                .iter()
                .map(|item| {
                    (
                        TemplateKind::FlowCommitment,
                        item.id,
                        &item.parent_type,
                        item.parent_id,
                    )
                })
                .chain(rows.flow_expectations.iter().map(|item| {
                    (
                        TemplateKind::FlowExpectation,
                        item.id,
                        &item.parent_type,
                        item.parent_id,
                    )
                }))
                .map(|(item_type, item_id, parent_type, parent_id)| {
                    (
                        TemplateItem { item_type, item_id },
                        (parent_type.clone(), parent_id),
                    )
                })
                .collect(),
        }
    }

    /// What the stored node `(node_type, node_id)` reads as for Agentic.
    pub fn reads_agentic(&self, node_type: &str, node_id: i64) -> bool {
        self.climb(Cursor::Stored(node_type.to_string(), node_id))
    }

    fn climb(&self, start: Cursor) -> bool {
        let mut climb = AgenticClimb::new(start);
        loop {
            let answer = match climb.step() {
                AgenticStep::Done(answer) => return answer,
                AgenticStep::Stored(kind, id) => climb.stored(self.stored(&kind, id)),
                AgenticStep::Template { key, skip_own } => {
                    let own = if skip_own { None } else { self.own(&key) };
                    let parent = self.template_parent(key.item);
                    climb.template(&key, own, parent)
                }
            };
            if let Some(answer) = answer {
                return answer;
            }
        }
    }

    fn stored(&self, kind: &str, id: i64) -> StoredRead {
        let found = match kind {
            "task" => self
                .tasks
                .get(&id)
                .map(|(flag, kind, parent)| (*flag, (kind.clone(), *parent))),
            "goal" => self.goals.get(&id).map(|parent| (None, parent.clone())),
            "commitment" => self
                .commitments
                .get(&id)
                .map(|parent| (None, parent.clone())),
            _ => None,
        };
        let Some((flag, parent)) = found else {
            return StoredRead::Missing;
        };
        let holding = self
            .holding
            .get(&(kind.to_string(), id))
            .and_then(|key| OccurrenceKey::parse(key));
        StoredRead::Found {
            flag,
            parent,
            holding,
        }
    }

    fn own(&self, key: &OccurrenceKey) -> Option<bool> {
        if let Some((agentic, true)) = self.overlays.get(&key.node_key()) {
            return *agentic;
        }
        match key.item.item_type {
            TemplateKind::FlowTask => self
                .flow_tasks
                .get(&key.item.item_id)
                .and_then(|task| task.template.agentic),
            TemplateKind::FlowRoot => self
                .flows
                .get(&key.item.item_id)
                .filter(|flow| flow.instance_type == "task")
                .and_then(|flow| flow.template.agentic),
            TemplateKind::FlowGoal
            | TemplateKind::FlowCommitment
            | TemplateKind::FlowExpectation => None,
        }
    }

    fn template_parent(&self, item: TemplateItem) -> Option<TemplateParent> {
        let (parent_type, parent_id) = match item.item_type {
            TemplateKind::FlowRoot => {
                let (kind, id) = flow_host(self.flows.get(&item.item_id)?);
                return Some(TemplateParent::Host(kind, id));
            }
            TemplateKind::FlowTask => {
                let task = self.flow_tasks.get(&item.item_id)?;
                (task.parent_type.as_str(), task.parent_id)
            }
            TemplateKind::FlowGoal => {
                let goal = self.flow_goals.get(&item.item_id)?;
                (goal.parent_type.as_str(), goal.parent_id)
            }
            TemplateKind::FlowCommitment | TemplateKind::FlowExpectation => {
                let (parent_type, parent_id) = self.item_parents.get(&item)?;
                (parent_type.as_str(), *parent_id)
            }
        };
        let item_type = template_kind_of(parent_type)?;
        Some(TemplateParent::Item(TemplateItem {
            item_type,
            item_id: parent_id,
        }))
    }
}
