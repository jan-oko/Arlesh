//! Which nodes a Flow may target: where its Goal and Task instances may hang.
//!
//! A Flow's instances hang under its Target Node, so a target is a stored node that can hold a
//! Goal or a Task instance — an Aspect, a Domain, a Project, a Goal or a Task. A Tag holds only
//! notes, and a Commitment or a wait is not somewhere a Flow's work is started. Whether a scoped
//! Flow's window also fits the target's is the containment check [`crate::flows::valid_targets`]
//! makes on top of this.

/// Whether a stored node of `node_type` can hold a Flow's instances.
pub fn holds_instances(node_type: &str) -> bool {
    matches!(node_type, "aspect" | "domain" | "project" | "goal" | "task")
}

#[cfg(test)]
mod tests;
