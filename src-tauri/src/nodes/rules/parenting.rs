//! Which kinds may hold which: the one parenting table every writer asks, and the one the
//! frontend's drop targets are pinned to.
//!
//! Mirrors `isValidDropTarget` in `src/utils/node-meta.ts`, which the Mindmap asks per pointer
//! move; `conformance/parenting.json` writes the whole kind × kind matrix down, and both sides
//! replay it.

use crate::filters::model::NodeKind;

/// The kind a stored `parent_type` spells, or `None` for a spelling no node kind has.
pub fn kind_of(parent_type: &str) -> Option<NodeKind> {
    Some(match parent_type {
        "aspect" => NodeKind::Aspect,
        "project" => NodeKind::Project,
        "domain" => NodeKind::Domain,
        "tag" => NodeKind::Tag,
        "goal" => NodeKind::Goal,
        "task" => NodeKind::Task,
        "commitment" => NodeKind::Commitment,
        "expectation" => NodeKind::Expectation,
        "info" => NodeKind::Info,
        "flow" => NodeKind::Flow,
        "flow_goal" => NodeKind::FlowGoal,
        "flow_task" => NodeKind::FlowTask,
        _ => return None,
    })
}

/// Whether a node of kind `child` may hang under one of kind `parent`.
///
/// - An **Aspect** never moves: it is the top of the board.
/// - A **folded run** of Habit history is a drawing, neither a thing to move nor a place to put one.
/// - **Flows** live in their own world: a Flow hangs under an Aspect, a Domain, a Project or a Goal;
///   a Goal item under its Flow or another Goal item; a Task item under its Flow or any item. No
///   real node hangs under a Flow, nor a Flow item under a real node.
/// - A **Tag**, an **Info** and a wait (**Expectation**) hold notes about them and nothing else.
/// - An **Info** hangs on any real node.
/// - A **Commitment** hangs anywhere a Task can, and inside another Commitment; it holds Tasks,
///   Commitments and waits.
/// - A wait hangs anywhere a Task can.
/// - A **Project** hangs under an Aspect or a Project; a **Domain** and a **Tag** under an Aspect,
///   a Domain or a Project.
/// - A **Goal** hangs under an Aspect, a Domain, a Project or a Goal.
/// - A **Task** hangs under an Aspect, a Domain, a Project, a Goal or a Task.
///
/// Every pair is named rather than defaulted to, so a kind added later is refused everywhere until
/// someone teaches this rule about it.
pub fn may_parent(child: NodeKind, parent: NodeKind) -> bool {
    use NodeKind::{
        Aspect, Commitment, Domain, Expectation, Flow, FlowGoal, FlowTask, Goal, HabitGroup, Info,
        Project, Tag, Task,
    };
    let container = matches!(parent, Aspect | Domain | Project);
    match child {
        Aspect | HabitGroup => false,
        Flow => container || parent == Goal,
        FlowGoal => matches!(parent, Flow | FlowGoal),
        FlowTask => matches!(parent, Flow | FlowGoal | FlowTask),
        Info => !matches!(parent, Flow | FlowGoal | FlowTask | HabitGroup),
        Commitment | Expectation | Task => {
            container || matches!(parent, Goal | Commitment) || parent == Task
        }
        Project => matches!(parent, Aspect | Project),
        Domain | Tag => container,
        Goal => container || parent == Goal,
    }
}

#[cfg(test)]
mod tests;
