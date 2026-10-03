//! The dependency rules: how a "Blocked by …" reason names what it is blocked by
//! ([`dependency_name`]).
//!
//! Pure. Which dependencies are unmet is read in [`crate::tasks`] (ADR 0010).

use std::collections::HashMap;

use crate::nodes::id::NodeId;

/// How a "Blocked by …" reason names the node it is blocked by: its **short id** from `names` —
/// keyed as the board keys a node, `task-12` — or, for a node `names` does not hold, its id.
pub fn dependency_name(names: &HashMap<String, String>, kind: &str, id: &NodeId) -> String {
    names
        .get(&format!("{kind}-{id}"))
        .cloned()
        .unwrap_or_else(|| id.to_string())
}
