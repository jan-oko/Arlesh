//! The relative cycle grid a Flow item's Cycle Scope is picked on.
//!
//! A flow item's Cycle Scope is the Nth subscope of the Flow's window, and its Cycle Plan a range of
//! sub-subscopes within it. The window is unanchored while the template is edited, so the grid
//! counts **nominal** subdivisions — three months to a season, four weeks to a month, seven days to
//! a week, six parts to a day — and the backend resolves the flat index to real dates only when the
//! Flow starts. Mirrors `src/utils/flow-cycle.ts`; `conformance/flow-cycles.json` holds the two
//! together.

use crate::scopes::model::ScopeKind;

/// The kinds a cycle grid steps through, coarsest first.
pub const SCOPE_ORDER: [ScopeKind; 5] = [
    ScopeKind::Season,
    ScopeKind::Month,
    ScopeKind::Week,
    ScopeKind::Day,
    ScopeKind::PartOfDay,
];

/// How many of `SCOPE_ORDER[i + 1]` one `SCOPE_ORDER[i]` nominally holds.
const SUBDIVISIONS: [i64; 4] = [3, 4, 7, 6];

fn index_of(kind: ScopeKind) -> Option<usize> {
    SCOPE_ORDER.iter().position(|candidate| *candidate == kind)
}

/// How many `child` units one `parent` unit nominally holds: 1 for the same kind, 0 when `child` is
/// coarser or either is not on the grid.
pub fn subdivisions_between(parent: ScopeKind, child: ScopeKind) -> i64 {
    match (index_of(parent), index_of(child)) {
        (Some(parent), Some(child)) if child >= parent => SUBDIVISIONS
            .get(parent..child)
            .map_or(0, |steps| steps.iter().product()),
        _ => 0,
    }
}

/// One level of the cycle navigator: `count` sibling slots of `kind`.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize, schemars::JsonSchema,
)]
pub struct CycleLevel {
    /// The level's kind.
    pub kind: ScopeKind,
    /// How many slots it offers.
    pub count: i64,
}

/// The navigator's levels from the Flow's own period down to `target`: the Flow's kind, repeated
/// `flow_n` times, then each kind down to and including `target`. Empty unless `target` is finer.
pub fn cycle_levels(flow_n: i64, flow_kind: ScopeKind, target: ScopeKind) -> Vec<CycleLevel> {
    let (Some(flow), Some(target)) = (index_of(flow_kind), index_of(target)) else {
        return Vec::new();
    };
    if target <= flow {
        return Vec::new();
    }
    let below = (flow..target).filter_map(|index| {
        Some(CycleLevel {
            kind: *SCOPE_ORDER.get(index + 1)?,
            count: *SUBDIVISIONS.get(index)?,
        })
    });
    std::iter::once(CycleLevel {
        kind: flow_kind,
        count: flow_n,
    })
    .chain(below)
    .collect()
}

/// The flat 1-based scope index a 1-based per-level `path` (coarsest first) names.
pub fn path_to_index(levels: &[CycleLevel], path: &[i64]) -> i64 {
    levels
        .iter()
        .zip(path)
        .fold(0, |flat, (level, step)| flat * level.count + (step - 1))
        + 1
}

#[cfg(test)]
mod tests;
