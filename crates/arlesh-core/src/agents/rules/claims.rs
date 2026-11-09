//! Claims: one active Claim may cover any node, and a Claim must lie inside the user's roots.
//!
//! Two Claims **overlap** when one's root is the other's root or an ancestor of it, so a subtree
//! and anything inside it cannot be held by two agents at once. Overlap is judged against the
//! board's shape *now*: a node moved under another agent's Claim makes the two overlap even though
//! neither agent did anything, and the older Claim then keeps its place ([`shadowed`]).

use std::collections::{HashMap, HashSet};

use crate::access::model::{NodeKey, StoredNode};
use crate::agents::model::{AgentId, AgentStanding, ClaimStatus};

#[cfg(test)]
mod tests;

/// Where every stored node hangs: child to parent.
#[derive(Debug, Clone, Default)]
pub struct Lineage {
    parents: HashMap<NodeKey, NodeKey>,
}

impl Lineage {
    /// The shape of the board `nodes` describe.
    pub fn of(nodes: &[StoredNode]) -> Self {
        let parents = nodes
            .iter()
            .filter_map(|node| node.parent.map(|parent| (node.key, parent)))
            .collect();
        Self { parents }
    }

    /// `node` and every node above it, nearest first. A cycle, which the schema cannot express,
    /// ends where it closes.
    fn up_from(&self, node: NodeKey) -> Vec<NodeKey> {
        let mut seen = HashSet::new();
        let mut chain = Vec::new();
        let mut cursor = Some(node);
        while let Some(key) = cursor {
            if !seen.insert(key) {
                break;
            }
            chain.push(key);
            cursor = self.parents.get(&key).copied();
        }
        chain
    }

    /// Whether the subtrees rooted at `a` and `b` share a node.
    pub fn overlaps(&self, a: NodeKey, b: NodeKey) -> bool {
        self.up_from(a).contains(&b) || self.up_from(b).contains(&a)
    }
}

/// An active Claim, as the rules see it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Held {
    /// Who holds it.
    pub agent: AgentId,
    /// The subtree's root.
    pub root: NodeKey,
    /// When it was made (ISO 8601, so text order is time order).
    pub claimed_at: String,
}

/// Why a Claim may not be made or resumed.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum Refusal {
    /// The node is not inside the user's MCP roots (or is private, or is not a node at all).
    #[error("the node is not inside the MCP roots, so it cannot be claimed")]
    OutsideRoots,
    /// Another agent holds an active Claim that overlaps.
    #[error("another agent holds an active Claim that overlaps it")]
    Overlaps {
        /// The holder.
        holder: AgentId,
    },
}

/// Whether `agent` may hold an active Claim on `candidate`: it must be readable through the user's
/// roots (`readable`), and no *other* agent's active Claim in `held` may overlap it.
pub fn check(
    lineage: &Lineage,
    candidate: NodeKey,
    readable: bool,
    held: &[Held],
    agent: AgentId,
) -> Result<(), Refusal> {
    if !readable {
        return Err(Refusal::OutsideRoots);
    }
    let conflict = held
        .iter()
        .filter(|other| other.agent != agent)
        .find(|other| lineage.overlaps(candidate, other.root));
    match conflict {
        Some(other) => Err(Refusal::Overlaps {
            holder: other.agent,
        }),
        None => Ok(()),
    }
}

/// The agents whose active Claim overlaps an **older** active Claim, so is set aside until the
/// overlap goes. Claims made at the same instant are told apart by agent id.
pub fn shadowed(lineage: &Lineage, held: &[Held]) -> HashSet<AgentId> {
    let order = |claim: &Held| (claim.claimed_at.clone(), claim.agent);
    held.iter()
        .filter(|claim| {
            held.iter().any(|other| {
                other.agent != claim.agent
                    && order(other) < order(claim)
                    && lineage.overlaps(claim.root, other.root)
            })
        })
        .map(|claim| claim.agent)
        .collect()
}

/// Where a Claim stands, given whether its agent holds one at all (`claim`: its status and root),
/// whether the root is still readable through the user's roots, and whether an older active Claim
/// shadows it.
pub fn standing(
    claim: Option<(ClaimStatus, NodeKey)>,
    root_readable: bool,
    is_shadowed: bool,
) -> AgentStanding {
    match claim {
        None => AgentStanding::Unclaimed,
        Some(_) if !root_readable => AgentStanding::Unreachable,
        Some((ClaimStatus::Paused, _)) => AgentStanding::Paused,
        Some((ClaimStatus::Active, _)) if is_shadowed => AgentStanding::Shadowed,
        Some((ClaimStatus::Active, _)) => AgentStanding::Active,
    }
}
