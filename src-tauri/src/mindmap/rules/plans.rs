//! Every node's effective Plan on a finished board, and every plan rule the board breaks: the
//! board's half of Plan inheritance ([`crate::tasks::rules::plan_inheritance`]).
//!
//! Pure: a function of the board's rows and lifecycles. Keyed as the app keys a node (`task-12`,
//! `expectation-3`, `domain-4`).

use std::collections::{HashMap, HashSet};

use chrono::NaiveDateTime;
use serde::Serialize;

use crate::{
    nodes::{id::NodeId, origin::Origin},
    tasks::{
        lifecycle::{derive_timing, ItemLifecycle},
        model::{Commitment, Expectation, Goal, Task, TimeScope},
        rules::plan_inheritance::{
            clamps_for, effective_time_scope, habit_conflicts, read_plans, HabitConflict,
            HabitSpan, PlanConflict, PlanLink, PlanReading,
        },
    },
};

use super::facts::content_parent;

/// A Habit as a node of the containment chain: its span and the node its roots hang under.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HabitEdge {
    /// The Habit's Flow id.
    pub flow_id: i64,
    /// Its title.
    pub title: String,
    /// The key of the node its iteration roots hang under — its target.
    pub host: String,
    /// How far it reaches.
    pub span: HabitSpan,
}

/// A rule the board breaks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(untagged)]
pub enum BoardConflict {
    /// A Task's.
    Plan(PlanConflict),
    /// A Habit's, against its target.
    Habit(HabitConflict),
}

/// One rule broken on the board, by the node that breaks it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConflictEntry {
    /// The node, keyed as the board keys it — a Habit as `flow-{id}`.
    pub key: String,
    /// Its title, to name it by.
    pub title: String,
    /// What it breaks.
    pub conflict: BoardConflict,
}

/// Every node's Plan reading on a board, and every rule it breaks.
#[derive(Debug, Clone, Default)]
pub struct PlanAudit {
    /// What each node passes a Plan through.
    pub links: HashMap<String, PlanLink<String>>,
    /// What each node reads.
    pub readings: HashMap<String, PlanReading<String>>,
    /// Every rule broken, Tasks first in board order, then Habits.
    pub conflicts: Vec<ConflictEntry>,
    /// Each Task's id and title, by key.
    pub tasks: HashMap<String, (NodeId, String)>,
}

impl PlanAudit {
    /// The rules broken, as `(key, conflict)` pairs.
    pub fn broken(&self) -> HashSet<(String, BoardConflict)> {
        self.conflicts
            .iter()
            .map(|entry| (entry.key.clone(), entry.conflict))
            .collect()
    }
}

/// The rows a board's Plans are read over.
pub struct PlanRows<'a> {
    /// Every Domain, Project, Aspect and Tag, as `(id, parent id)`.
    pub domains: Vec<(i64, Option<i64>)>,
    /// Every Goal.
    pub goals: &'a [Goal],
    /// Every Task.
    pub tasks: &'a [Task],
    /// Every Commitment.
    pub commitments: &'a [Commitment],
    /// Every wait.
    pub expectations: &'a [Expectation],
    /// Every lifecycle, read for the Overdue flag.
    pub lifecycles: &'a [ItemLifecycle],
    /// Every Habit as a node.
    pub habits: &'a [HabitEdge],
}

fn pass_through(parent: String, time_scope: Option<TimeScope>, clips: bool) -> PlanLink<String> {
    PlanLink {
        parent: Some(parent),
        plan: None,
        time_scope,
        clips,
        is_task: false,
    }
}

/// What each node passes a Plan through.
fn links(rows: &PlanRows<'_>) -> HashMap<String, PlanLink<String>> {
    let overdue: HashSet<&NodeId> = rows
        .lifecycles
        .iter()
        .filter(|entry| entry.node_type == "task" && entry.overdue)
        .map(|entry| &entry.node_id)
        .collect();
    let mut links = HashMap::new();
    for (id, parent) in &rows.domains {
        let link = PlanLink {
            parent: parent.map(|parent| format!("domain-{parent}")),
            plan: None,
            time_scope: None,
            clips: false,
            is_task: false,
        };
        links.insert(format!("domain-{id}"), link);
    }
    for goal in rows.goals {
        let parent = content_parent(&goal.parent_type, &goal.parent_id);
        links.insert(
            format!("goal-{}", goal.id),
            pass_through(parent, goal.time_scope.clone(), true),
        );
    }
    for commitment in rows.commitments {
        let parent = content_parent(&commitment.parent_type, &commitment.parent_id);
        links.insert(
            format!("commitment-{}", commitment.id),
            pass_through(parent, commitment.time_scope.clone(), true),
        );
    }
    for wait in rows.expectations {
        let parent = content_parent(&wait.parent_type, &wait.parent_id);
        // A wait's window is its own, and its check tasks inherit fully: it passes the Plan above
        // it down unclipped.
        links.insert(
            format!("expectation-{}", wait.id),
            pass_through(parent, wait.time_scope.clone(), false),
        );
    }
    for task in rows.tasks {
        let check = matches!(task.origin, Origin::Check(_));
        let link = PlanLink {
            parent: Some(content_parent(&task.parent_type, &task.parent_id)),
            plan: task.plan.clone(),
            time_scope: task.time_scope.clone(),
            // A check task's window is the day it fell due, and an Overdue Task's Plan may leave
            // its window: neither clips what it inherits.
            clips: !check && !overdue.contains(&task.id),
            is_task: true,
        };
        links.insert(format!("task-{}", task.id), link);
    }
    links
}

/// Every node's Plan reading on the board, and every rule it breaks.
pub fn audit(rows: &PlanRows<'_>) -> PlanAudit {
    let links = links(rows);
    let readings = read_plans(&links);
    let mut conflicts = Vec::new();
    for task in rows.tasks {
        let key = format!("task-{}", task.id);
        if let Some(conflict) = readings.get(&key).and_then(|reading| reading.conflict) {
            conflicts.push(ConflictEntry {
                key,
                title: task.title.clone(),
                conflict: BoardConflict::Plan(conflict),
            });
        }
    }
    for habit in rows.habits {
        let scope = effective_time_scope(&links, &habit.host).map(TimeScope::window);
        let plan = readings
            .get(&habit.host)
            .and_then(|reading| reading.effective.plan())
            .map(TimeScope::window);
        for conflict in habit_conflicts(habit.span, scope, plan) {
            conflicts.push(ConflictEntry {
                key: format!("flow-{}", habit.flow_id),
                title: habit.title.clone(),
                conflict: BoardConflict::Habit(conflict),
            });
        }
    }
    let tasks = rows
        .tasks
        .iter()
        .map(|task| {
            (
                format!("task-{}", task.id),
                (task.id.clone(), task.title.clone()),
            )
        })
        .collect();
    PlanAudit {
        links,
        readings,
        conflicts,
        tasks,
    }
}

/// Stamps every Task's lifecycle with where its **effective** Plan stands at `now` — the Plan's
/// position Start reads, its own or the one it inherits. A Task reading no Plan has none.
pub fn stamp_plan_timing(lifecycles: &mut [ItemLifecycle], audit: &PlanAudit, now: NaiveDateTime) {
    for entry in lifecycles
        .iter_mut()
        .filter(|entry| entry.node_type == "task")
    {
        let key = format!("task-{}", entry.node_id);
        entry.plan_timing = audit
            .readings
            .get(&key)
            .and_then(|reading| reading.effective.plan())
            .map(|plan| derive_timing(Some(plan.window()), now));
    }
}

/// A Task a new Plan above it would leave outside, and what clamping would give it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PlanClampTarget {
    /// The Task.
    pub id: NodeId,
    /// Its title, to name it by.
    pub title: String,
    /// The Plan clamping gives it, or `None` when nothing above would admit it.
    pub clamp_to: Option<TimeScope>,
}

/// The Tasks below `task` whose own Plan would leave the Plan they inherit were `task` given
/// `plan`, nearest first — what the clamp-or-cancel prompt names before the write.
pub fn clamp_targets(
    audit: &PlanAudit,
    task: &NodeId,
    plan: Option<&TimeScope>,
) -> Vec<PlanClampTarget> {
    clamps_for(&audit.links, &format!("task-{task}"), plan)
        .into_iter()
        .filter_map(|clamp| {
            let (id, title) = audit.tasks.get(&clamp.key)?;
            Some(PlanClampTarget {
                id: id.clone(),
                title: title.clone(),
                clamp_to: clamp.clamp_to,
            })
        })
        .collect()
}

/// What a refusal says about `entries`: each rule broken, naming the nodes that break it.
pub fn refusal_message(entries: &[&ConflictEntry]) -> String {
    let named = |conflict: BoardConflict| {
        entries
            .iter()
            .filter(|entry| entry.conflict == conflict)
            .map(|entry| format!("“{}”", entry.title))
            .collect::<Vec<_>>()
    };
    let rules = [
        (
            BoardConflict::Plan(PlanConflict::ParentPlan),
            "plan is not within the plan it inherits",
        ),
        (
            BoardConflict::Plan(PlanConflict::Empty),
            "this would leave no plan inside the time scope of",
        ),
        (
            BoardConflict::Habit(HabitConflict::TimeScope),
            "a habit would reach outside its target's time scope",
        ),
        (
            BoardConflict::Habit(HabitConflict::Plan),
            "a habit's plan would reach outside its target's plan",
        ),
    ];
    rules
        .into_iter()
        .filter_map(|(conflict, says)| {
            let names = named(conflict);
            (!names.is_empty()).then(|| format!("{says}: {}", names.join(", ")))
        })
        .collect::<Vec<_>>()
        .join("; ")
}

#[cfg(test)]
mod tests;
