//! What to tell a child agent when the MCP refuses it a node (ADR 0019).
//!
//! The access layer words every refusal the same, whether the node is outside the user's MCP
//! roots, outside the caller's Claim, or does not exist, so that a refusal cannot be used to probe
//! for what is there. A child agent has two causes the generic words hide: its Claim is paused
//! (read-only), and the node lies outside its sub-Claim but inside its parent's Claim, where it
//! may claim it. These pure functions read a generic refusal and word the better one; the caller
//! decides which cause applies, and only says the second when the node is inside the parent's
//! Claim, so nothing is revealed that the parent could not already see.

/// The node a generic access refusal names.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NamedNode<'message> {
    /// The kind the message spells (`task`), when it spells one.
    pub node_type: Option<&'message str>,
    /// The id as the request wrote it.
    pub id: &'message str,
}

const NO_NODE: &str = "no node inside the MCP roots has the id ";
const NO_WAIT: &str = "no wait inside the MCP roots has the id ";
const IN_ROOTS: &str = " inside the MCP roots";

/// The node a generic access refusal names, or `None` when `message` is not one.
pub fn named_node(message: &str) -> Option<NamedNode<'_>> {
    for prefix in [NO_NODE, NO_WAIT] {
        if let Some(id) = message.strip_prefix(prefix) {
            return Some(NamedNode {
                node_type: None,
                id: id.trim(),
            });
        }
    }
    let mut words = message.split_whitespace();
    let node_type = words.next()?;
    let id = words.next()?;
    let rest = message.get(message.find(" is not ")?..)?;
    (rest.contains(IN_ROOTS) || rest.starts_with(" is not inside the MCP roots")).then_some(
        NamedNode {
            node_type: Some(node_type),
            id,
        },
    )
}

/// Whether `message` is the generic refusal of a **write**.
pub fn is_write_refusal(message: &str) -> bool {
    message.contains(IN_ROOTS) && message.contains("so it cannot be written")
}

/// `message` with the reason a paused child cannot write: its Claim is read-only until resumed.
pub fn paused(message: &str) -> String {
    format!(
        "{message}. Your Claim is paused, so it is read-only: your parent agent or the user \
         resumes it"
    )
}

/// The refusal for a node outside the child's sub-Claim that lies inside its parent's Claim.
pub fn outside_claim(node: &NamedNode<'_>) -> String {
    let subject = match node.node_type {
        Some(node_type) => format!("{node_type} {}", node.id),
        None => format!("node {}", node.id),
    };
    format!(
        "{subject} is outside your Claim. It lies inside your parent agent's Claim, so you can \
         claim it with arlesh_agents.claim, which replaces your current Claim"
    )
}

#[cfg(test)]
mod tests;
