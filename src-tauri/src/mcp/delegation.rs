//! What a delegated Task's wait is called on the MCP: `"{delegate} finish: {task title}"`.
//!
//! The derived row's title is its Task's (`nodes::waits`), and the app draws the label round it in
//! the user's language. The MCP speaks English, so it says the same thing here, over the board it
//! serves — the snapshot's `expectations` and `arlesh_waits.get` alike. A wait given a title of
//! its own is left as it is, as the app leaves it.

use std::collections::HashMap;

use crate::{
    knowledge_base::model::Person,
    mindmap::model::MindmapLoad,
    nodes::{id::NodeId, origin::Origin},
    tasks::model::Delegate,
};

/// What the Agent is called in a delegation wait's label.
const AGENT: &str = "Agent";

/// A delegation wait's label: who finishes it, then the Task's title.
pub(super) fn finish_title(delegate: &str, task_title: &str) -> String {
    format!("{delegate} finish: {task_title}")
}

/// Labels every delegation wait in `load` whose title is still its Task's.
pub(super) fn label_waits(load: &mut MindmapLoad, people: &[Person]) {
    let names: HashMap<i64, &str> = people
        .iter()
        .map(|person| (person.id, person.name.as_str()))
        .collect();
    let holders: HashMap<&NodeId, (&str, &str)> = load
        .tasks
        .iter()
        .filter_map(|task| {
            let holder = match task.delegate_to? {
                Delegate::Agent => AGENT,
                Delegate::Person { id } => names.get(&id).copied()?,
            };
            Some((&task.id, (holder, task.title.as_str())))
        })
        .collect();
    let labels: Vec<Option<String>> = load
        .expectations
        .iter()
        .map(|wait| {
            if !matches!(wait.origin, Origin::DelegationWait(_)) {
                return None;
            }
            let (holder, title) = holders.get(&wait.parent_id)?;
            (*title == wait.title).then(|| finish_title(holder, title))
        })
        .collect();
    for (wait, label) in load.expectations.iter_mut().zip(labels) {
        if let Some(label) = label {
            wait.title = label;
        }
    }
}

#[cfg(test)]
mod tests;
