//! Pure flow rendering: the *shape* of a materialised flow, decided without a database.
//!
//! [`start`](super::start) used to decide and write in one pass, so the only way to ask "what
//! subtree does this template produce?" was to produce it. This module answers that question as a
//! value: given the flow, its template rows and a [`ScopeTable`] of already-resolved scopes,
//! [`render`] returns a [`RenderedPlan`] — a flat list of [`PlannedNode`]s in creation order plus
//! the dependency [`PlannedEdge`]s between them, both in **placeholder** terms ([`NodeRef`], an
//! index into the node list). Nothing here knows a real goal or task id; the writer supplies those
//! as it goes.
//!
//! The split follows [`habits`](super::habits): the impure half precomputes what the decision needs
//! (there, the iteration windows; here, the scope table), and the pure half decides.
//!
//! [`render`] is **total** — it returns no `Result`. Every fallible step of the old loop was a
//! `create_*` or a scope resolution, and all of those now live on one side or the other of it.
//!
//! One walk, [`visit_order`], underpins both halves: the gather resolves pairs in the order it
//! yields them, and the renderer allocates nodes in that same order. That is what keeps the split
//! from reordering anything — goal rows and task rows are written in exactly the sequence the
//! single-pass version wrote them.

use std::collections::HashMap;

use super::model::{Flow, FlowDependency, FlowItemCycle, FlowItemType, InstanceType};
use crate::tasks::model::TimeScope;

/// A node's placeholder identity: its index in [`RenderedPlan::nodes`].
///
/// Nodes are listed in creation order and a parent always precedes its children, so the writer can
/// walk the list once and have every parent's real id already in hand.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) struct NodeRef(pub usize);

/// The template row a planned node materialises, for `flow_instance_nodes` bookkeeping.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PlannedSource {
    /// The flow root itself; recorded against `("flow", flow_id)`.
    Root,
    /// One flow item, by table and id.
    Item(FlowItemType, i64),
}

/// One goal or task the flow will materialise.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PlannedNode {
    /// The node this one hangs under; `None` for the root, whose parent is the start target.
    pub parent: Option<NodeRef>,
    /// Whether this materialises as a goal or a task.
    pub kind: InstanceType,
    /// Title to create it with.
    pub title: String,
    /// Resolved relevance window, if the item is scoped.
    pub time_scope: Option<TimeScope>,
    /// Resolved Cycle Plan. Only tasks carry a plan; it is ignored for goals, as it always was.
    pub plan: Option<TimeScope>,
    /// Whether the node inherits privacy from the flow or the flow item.
    pub is_private: bool,
    /// Which template row this came from.
    pub source: PlannedSource,
}

/// One materialised dependency: `dependent` waits on `blocker`.
///
/// Both ends are placeholders. The writer picks `Dependency::Goal` or `Dependency::Task` from the
/// blocker's *written* kind — putting the enum here would drag real ids into a pure type.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct PlannedEdge {
    /// The waiting node. Always a task (see [`render`]'s fan-in rule).
    pub dependent: NodeRef,
    /// The blocking node, which may be a goal or a task.
    pub blocker: NodeRef,
}

/// A whole flow materialisation, decided but not written.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct RenderedPlan {
    /// Every node to create, in creation order; index 0 is the root.
    pub nodes: Vec<PlannedNode>,
    /// Every dependency edge to add, after all nodes exist.
    pub edges: Vec<PlannedEdge>,
}

/// One flow item as the renderer reads it — the goal and task tables flattened into one shape.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TemplateItem {
    /// Which flow-item table the row came from.
    pub kind: FlowItemType,
    /// Row id within that table.
    pub id: i64,
    /// Display title.
    pub title: String,
    /// In-flow parent type (`flow`, `flow_goal` or `flow_task`).
    pub parent_type: String,
    /// In-flow parent id.
    pub parent_id: i64,
    /// Sort position among its siblings.
    pub position: i64,
    /// Whether the materialised node should be private.
    pub is_private: bool,
}

/// A flow's template, already filtered to that one flow.
///
/// `items` must be **all goals in position order, then all tasks in position order** — the order
/// the walk falls back to when two siblings share a position, and therefore part of the creation
/// order of real rows.
#[derive(Debug, Clone, Default)]
pub(crate) struct FlowTemplate {
    /// Goals then tasks, each block in position order.
    pub items: Vec<TemplateItem>,
    /// Every cycle pair belonging to the flow.
    pub cycles: Vec<FlowItemCycle>,
    /// Every intra-flow dependency belonging to the flow.
    pub dependencies: Vec<FlowDependency>,
}

impl FlowTemplate {
    /// The cycle pairs a materialisation will consume, **in the order it consumes them**.
    ///
    /// This is what the gather step resolves, so the selection matters: an item whose in-flow
    /// parent chain does not lead back to `"flow"` is never walked, so the single-pass version
    /// never resolved its pairs. Handing the gather every pair the flow owns would turn a
    /// malformed orphan from harmless into a hard error.
    pub fn planned_cycles(&self, flow_id: i64) -> Vec<FlowItemCycle> {
        let by_id: HashMap<i64, &FlowItemCycle> =
            self.cycles.iter().map(|cycle| (cycle.id, cycle)).collect();
        visit_order(self, flow_id)
            .iter()
            .flat_map(|visit| visit.pairs.iter())
            .filter_map(|pair| pair.and_then(|id| by_id.get(&id)).copied().cloned())
            .collect()
    }
}

/// A cycle pair resolved against the calendar: its Cycle Scope and its Cycle Plan.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct ResolvedPair {
    /// The Cycle Scope, as a single-scope window.
    pub time_scope: Option<TimeScope>,
    /// The Cycle Plan within that scope.
    pub plan: Option<TimeScope>,
}

/// Every scope the flow needs, resolved up front so that rendering can be pure.
///
/// Built by [`resolve_scopes`](super::resolve_scopes), which is pure: a scope is derived from its
/// value key.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct ScopeTable {
    /// The Flow Window, when the flow is scoped.
    pub window: Option<TimeScope>,
    /// The root's Cycle Plan under that window.
    pub root_plan: Option<TimeScope>,
    /// Resolved pairs, keyed by [`FlowItemCycle::id`]. A pair with no entry inherits the root.
    pub pairs: HashMap<i64, ResolvedPair>,
}

/// One template item the walk reaches, in the order it reaches it.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Visit {
    /// Index into [`FlowTemplate::items`].
    item: usize,
    /// Index into the visit list of the item this one hangs under; `None` directly under the root.
    parent: Option<usize>,
    /// The item's cycle pair ids in position order, or a single `None` when it has none — an
    /// unpaired item still materialises exactly once, unscoped.
    pairs: Vec<Option<i64>>,
}

/// Walks the flow's in-flow parent links from the root, yielding each reachable item once, in the
/// order a materialisation visits it.
///
/// Three ordering rules decide the order real rows are created in, and all three are deliberately
/// as the single-pass version had them:
///
/// * The pending work is a **stack**: popped from the back, so all of one parent's children are
///   visited before any descent into them, but sibling *subtrees* are descended in reverse order
///   (the last child pushed is the first one popped).
/// * Sibling sorting is by `position`, stably, so ties fall back to goals-before-tasks.
/// * That `position` is each sibling's own — read straight off the `TemplateItem` being sorted, not
///   looked up by id. It used to be looked up by id alone, ignoring the item's kind; since
///   `flow_goals` and `flow_tasks` have independent autoincrements, a flow holding both could sort
///   a task by an unrelated goal's position. Fixed.
///
/// A parent always precedes its children, so callers may resolve a parent's placeholder before
/// they need it.
fn visit_order(template: &FlowTemplate, flow_id: i64) -> Vec<Visit> {
    let mut visits: Vec<Visit> = Vec::new();
    let mut stack: Vec<(String, i64, Option<usize>)> = vec![("flow".to_string(), flow_id, None)];

    while let Some((parent_type, parent_id, parent_visit)) = stack.pop() {
        let mut children: Vec<(usize, &TemplateItem)> = template
            .items
            .iter()
            .enumerate()
            .filter(|(_, item)| item.parent_type == parent_type && item.parent_id == parent_id)
            .collect();
        children.sort_by_key(|(_, child)| child.position);

        for (index, child) in children {
            let mut pairs: Vec<&FlowItemCycle> = template
                .cycles
                .iter()
                .filter(|cycle| cycle.item_type == child.kind.as_str() && cycle.item_id == child.id)
                .collect();
            pairs.sort_by_key(|cycle| cycle.position);
            let pairs: Vec<Option<i64>> = if pairs.is_empty() {
                vec![None]
            } else {
                pairs.iter().map(|cycle| Some(cycle.id)).collect()
            };

            stack.push((
                child.kind.as_str().to_string(),
                child.id,
                Some(visits.len()),
            ));
            visits.push(Visit {
                item: index,
                parent: parent_visit,
                pairs,
            });
        }
    }

    visits
}

/// Renders a flow template into the concrete subtree it materialises.
///
/// The walk ([`visit_order`]) starts at the root and descends the in-flow parent links. An item
/// with `n` cycle pairs yields `n` nodes (one with no pairs still yields exactly one, unscoped);
/// **its children nest under the first of them**. Dependencies then fan in: every instance of the
/// dependent waits on every instance of the blocker.
///
/// Only tasks may be dependents — a goal instance on the waiting side contributes no edges at all.
/// Blockers are **not** filtered: a goal blocker is legitimate and yields a goal-typed dependency.
pub(crate) fn render(
    flow: &Flow,
    root_title: &str,
    template: &FlowTemplate,
    scopes: &ScopeTable,
) -> RenderedPlan {
    let root_kind = InstanceType::from_db(&flow.instance_type);
    let mut nodes = vec![PlannedNode {
        parent: None,
        kind: root_kind,
        title: root_title.to_string(),
        time_scope: scopes.window.clone(),
        plan: scopes.root_plan.clone(),
        is_private: flow.is_private,
        source: PlannedSource::Root,
    }];

    // Template item -> the nodes it became, in pair order, with the kind the fan-in filters on.
    let mut instances: HashMap<(String, i64), Vec<(InstanceType, NodeRef)>> = HashMap::new();
    // Per visit, the node its children nest under: the FIRST instance of that item.
    let mut first_instance: Vec<NodeRef> = Vec::new();

    for visit in visit_order(template, flow.id) {
        // Both fallbacks below are unreachable: `visit.item` indexes the list the walk read,
        // and a parent visit always precedes its children. They keep `render` total anyway, and
        // keep `first_instance` aligned with the visit list either way.
        let Some(item) = template.items.get(visit.item) else {
            first_instance.push(NodeRef(0));
            continue;
        };
        let parent_ref = visit.parent.map_or(NodeRef(0), |parent| {
            first_instance.get(parent).copied().unwrap_or(NodeRef(0))
        });

        let kind = match item.kind {
            FlowItemType::FlowGoal => InstanceType::Goal,
            FlowItemType::FlowTask => InstanceType::Task,
        };
        let mut refs: Vec<(InstanceType, NodeRef)> = Vec::with_capacity(visit.pairs.len());
        for pair in &visit.pairs {
            let resolved = pair
                .and_then(|id| scopes.pairs.get(&id))
                .cloned()
                .unwrap_or_default();
            refs.push((kind, NodeRef(nodes.len())));
            nodes.push(PlannedNode {
                parent: Some(parent_ref),
                kind,
                title: item.title.clone(),
                time_scope: resolved.time_scope,
                plan: resolved.plan,
                is_private: item.is_private,
                source: PlannedSource::Item(item.kind, item.id),
            });
        }

        // Children of this item nest under its first instance. `pairs` is never empty, so there
        // always is one.
        first_instance.push(refs.first().map(|(_, node)| *node).unwrap_or(NodeRef(0)));
        instances.insert((item.kind.as_str().to_string(), item.id), refs);
    }

    let mut edges = Vec::new();
    for dependency in &template.dependencies {
        let dependents = instances
            .get(&(dependency.dependent_type.clone(), dependency.dependent_id))
            .cloned()
            .unwrap_or_default();
        let blockers = instances
            .get(&(dependency.depends_on_type.clone(), dependency.depends_on_id))
            .cloned()
            .unwrap_or_default();
        for (dependent_kind, dependent) in &dependents {
            // Only tasks can be dependents in the real model. Blockers are NOT filtered.
            if *dependent_kind != InstanceType::Task {
                continue;
            }
            for (_, blocker) in &blockers {
                edges.push(PlannedEdge {
                    dependent: *dependent,
                    blocker: *blocker,
                });
            }
        }
    }

    RenderedPlan { nodes, edges }
}

#[cfg(test)]
mod tests;
