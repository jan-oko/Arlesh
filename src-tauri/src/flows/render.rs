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
//! (there, the iteration windows; here, the scope table, which must be minted inside the caller's
//! transaction because `offset_scope` writes), and the pure half decides.
//!
//! [`render`] is **total** — it returns no `Result`. Every fallible step of the old loop was a
//! `create_*` or a scope resolution, and all of those now live on one side or the other of it.
//!
//! One walk, [`visit_order`], underpins both halves: the gather resolves pairs in the order it
//! yields them, and the renderer allocates nodes in that same order. That is what keeps the split
//! from reordering anything — scope rows, goal rows and task rows are all minted in exactly the
//! sequence the single-pass version minted them.

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
    /// This is what the gather step resolves, and resolving a pair mints scope rows, so both the
    /// selection and the order matter:
    ///
    /// * *Selection* — an item whose in-flow parent chain does not lead back to `"flow"` is never
    ///   walked, so the single-pass version never resolved its pairs. Handing the gather every
    ///   pair the flow owns would mint scope rows that materialisation never minted, and would
    ///   turn a malformed orphan from harmless into a hard error.
    /// * *Order* — scope rows are numbered as they are minted, so resolving pairs in, say, table
    ///   order rather than walk order would renumber the calendar.
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
/// Built by [`resolve_scopes`](super::resolve_scopes) inside the caller's transaction — resolving a
/// scope *mints* it, so the gather is a write and cannot be hoisted out.
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
/// * The "queue" is a **stack**, so all of one parent's children are visited before any descent,
///   but sibling *subtrees* are descended in reverse order. The old comment called this
///   breadth-first; it never was.
/// * Sibling sorting is by `position`, stably, so ties fall back to goals-before-tasks.
/// * The position looked up for that sort is found **by item id alone, ignoring the item's kind**.
///   `flow_goals` and `flow_tasks` have independent autoincrements, so in a flow holding both, a
///   task can be sorted by an unrelated goal's position. This is a real defect, preserved verbatim
///   and knowingly: correcting it here would reorder materialised siblings, which is a behaviour
///   change, and would destroy the evidence that this split is not one. It is fixed separately.
///
/// A parent always precedes its children, so callers may resolve a parent's placeholder before
/// they need it.
fn visit_order(template: &FlowTemplate, flow_id: i64) -> Vec<Visit> {
    let mut visits: Vec<Visit> = Vec::new();
    let mut queue: Vec<(String, i64, Option<usize>)> = vec![("flow".to_string(), flow_id, None)];

    while let Some((parent_type, parent_id, parent_visit)) = queue.pop() {
        let mut children: Vec<(usize, &TemplateItem)> = template
            .items
            .iter()
            .enumerate()
            .filter(|(_, item)| item.parent_type == parent_type && item.parent_id == parent_id)
            .collect();
        children.sort_by_key(|(_, child)| {
            // By id alone, kind ignored — see the doc comment. Preserved, not endorsed.
            template
                .items
                .iter()
                .find(|item| item.id == child.id)
                .map(|item| item.position)
                .unwrap_or(0)
        });

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

            queue.push((child.kind.as_str().to_string(), child.id, Some(visits.len())));
            visits.push(Visit { item: index, parent: parent_visit, pairs });
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
    let root_kind = if flow.instance_type == "goal" {
        InstanceType::Goal
    } else {
        InstanceType::Task
    };
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
                edges.push(PlannedEdge { dependent: *dependent, blocker: *blocker });
            }
        }
    }

    RenderedPlan { nodes, edges }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FLOW_ID: i64 = 7;

    /// A task-instance flow, public, with no window and no root plan unless a test adds one.
    fn flow() -> Flow {
        Flow {
            id: FLOW_ID,
            title: "Flow".to_string(),
            instance_type: "task".to_string(),
            parent_type: "aspect".to_string(),
            parent_id: 1,
            target_type: None,
            target_id: None,
            flow_duration_n: None,
            flow_duration_kind: None,
            flow_window_part: None,
            flow_window_time_start: None,
            flow_window_time_end: None,
            root_plan_kind: None,
            root_plan_start: None,
            root_plan_end: None,
            is_habit: false,
            position: 0,
            is_private: false,
        }
    }

    fn item(kind: FlowItemType, id: i64, title: &str, parent: (&str, i64), position: i64) -> TemplateItem {
        TemplateItem {
            kind,
            id,
            title: title.to_string(),
            parent_type: parent.0.to_string(),
            parent_id: parent.1,
            position,
            is_private: false,
        }
    }

    fn cycle(id: i64, item: (FlowItemType, i64), position: i64) -> FlowItemCycle {
        FlowItemCycle {
            id,
            flow_id: FLOW_ID,
            item_type: item.0.as_str().to_string(),
            item_id: item.1,
            scope_kind: Some("day".to_string()),
            scope_index: Some(position + 1),
            plan_kind: None,
            plan_start: None,
            plan_end: None,
            position,
        }
    }

    fn dependency(id: i64, dependent: (FlowItemType, i64), blocker: (FlowItemType, i64)) -> FlowDependency {
        FlowDependency {
            id,
            flow_id: FLOW_ID,
            dependent_type: dependent.0.as_str().to_string(),
            dependent_id: dependent.1,
            depends_on_type: blocker.0.as_str().to_string(),
            depends_on_id: blocker.1,
        }
    }

    fn scope(id: i64) -> Option<TimeScope> {
        Some(TimeScope { start_id: id, end_id: id, duration: None })
    }

    /// A scope table resolving each listed cycle id to its own single-scope window.
    fn table(cycle_ids: &[i64]) -> ScopeTable {
        ScopeTable {
            pairs: cycle_ids
                .iter()
                .map(|id| (*id, ResolvedPair { time_scope: scope(*id * 100), plan: None }))
                .collect(),
            ..Default::default()
        }
    }

    fn titles(plan: &RenderedPlan) -> Vec<&str> {
        plan.nodes.iter().map(|node| node.title.as_str()).collect()
    }

    #[test]
    fn an_empty_flow_renders_just_its_root() {
        let plan = render(&flow(), "Run", &FlowTemplate::default(), &ScopeTable::default());
        assert_eq!(titles(&plan), ["Run"]);
        assert_eq!(plan.nodes[0].parent, None);
        assert_eq!(plan.nodes[0].kind, InstanceType::Task);
        assert_eq!(plan.nodes[0].source, PlannedSource::Root);
        assert!(plan.edges.is_empty());
    }

    #[test]
    fn the_root_takes_the_flows_kind_privacy_window_and_plan() {
        let mut flow = flow();
        flow.instance_type = "goal".to_string();
        flow.is_private = true;
        let scopes = ScopeTable { window: scope(1), root_plan: scope(2), ..Default::default() };

        let plan = render(&flow, "Private Run", &FlowTemplate::default(), &scopes);

        assert_eq!(plan.nodes[0].kind, InstanceType::Goal);
        assert!(plan.nodes[0].is_private);
        assert_eq!(plan.nodes[0].time_scope, scope(1));
        assert_eq!(plan.nodes[0].plan, scope(2));
    }

    #[test]
    fn an_item_with_no_cycle_pairs_yields_one_unscoped_instance() {
        let template = FlowTemplate {
            items: vec![item(FlowItemType::FlowTask, 1, "Once", ("flow", FLOW_ID), 0)],
            ..Default::default()
        };

        let plan = render(&flow(), "Run", &template, &ScopeTable::default());

        assert_eq!(titles(&plan), ["Run", "Once"]);
        assert_eq!(plan.nodes[1].time_scope, None);
        assert_eq!(plan.nodes[1].plan, None);
        assert_eq!(plan.nodes[1].parent, Some(NodeRef(0)));
        assert_eq!(plan.nodes[1].source, PlannedSource::Item(FlowItemType::FlowTask, 1));
    }

    #[test]
    fn three_cycle_pairs_spawn_three_instances_in_position_order() {
        let template = FlowTemplate {
            items: vec![item(FlowItemType::FlowTask, 1, "Repeat", ("flow", FLOW_ID), 0)],
            // Deliberately out of position order, to prove the renderer sorts them.
            cycles: vec![
                cycle(30, (FlowItemType::FlowTask, 1), 2),
                cycle(10, (FlowItemType::FlowTask, 1), 0),
                cycle(20, (FlowItemType::FlowTask, 1), 1),
            ],
            ..Default::default()
        };

        let plan = render(&flow(), "Run", &template, &table(&[10, 20, 30]));

        assert_eq!(titles(&plan), ["Run", "Repeat", "Repeat", "Repeat"]);
        let windows: Vec<_> = plan.nodes[1..].iter().map(|node| node.time_scope.clone()).collect();
        assert_eq!(windows, [scope(1000), scope(2000), scope(3000)]);
        assert!(plan.nodes[1..].iter().all(|node| node.parent == Some(NodeRef(0))));
    }

    #[test]
    fn children_nest_under_the_first_instance_of_a_multi_pair_parent() {
        let template = FlowTemplate {
            items: vec![
                item(FlowItemType::FlowTask, 1, "Parent", ("flow", FLOW_ID), 0),
                item(FlowItemType::FlowTask, 2, "Child", ("flow_task", 1), 0),
            ],
            cycles: vec![
                cycle(10, (FlowItemType::FlowTask, 1), 0),
                cycle(20, (FlowItemType::FlowTask, 1), 1),
            ],
            ..Default::default()
        };

        let plan = render(&flow(), "Run", &template, &table(&[10, 20]));

        assert_eq!(titles(&plan), ["Run", "Parent", "Parent", "Child"]);
        // NodeRef(1) is the FIRST Parent instance, not the second and not the root.
        assert_eq!(plan.nodes[3].parent, Some(NodeRef(1)));
    }

    #[test]
    fn siblings_of_one_kind_are_ordered_by_position() {
        let template = FlowTemplate {
            items: vec![
                item(FlowItemType::FlowTask, 1, "Third", ("flow", FLOW_ID), 30),
                item(FlowItemType::FlowTask, 2, "First", ("flow", FLOW_ID), 10),
                item(FlowItemType::FlowTask, 3, "Second", ("flow", FLOW_ID), 20),
            ],
            ..Default::default()
        };

        let plan = render(&flow(), "Run", &template, &ScopeTable::default());

        assert_eq!(titles(&plan), ["Run", "First", "Second", "Third"]);
    }

    #[test]
    fn all_of_a_parents_children_precede_any_descent_and_subtrees_descend_in_reverse() {
        // The "queue" is a stack, so `B`'s subtree is descended before `A`'s. This is the historic
        // order and it decides real row ids; it is pinned here so a "fix" to a real queue is loud.
        let template = FlowTemplate {
            items: vec![
                item(FlowItemType::FlowTask, 1, "A", ("flow", FLOW_ID), 10),
                item(FlowItemType::FlowTask, 2, "B", ("flow", FLOW_ID), 20),
                item(FlowItemType::FlowTask, 3, "A-child", ("flow_task", 1), 0),
                item(FlowItemType::FlowTask, 4, "B-child", ("flow_task", 2), 0),
            ],
            ..Default::default()
        };

        let plan = render(&flow(), "Run", &template, &ScopeTable::default());

        assert_eq!(titles(&plan), ["Run", "A", "B", "B-child", "A-child"]);
    }

    #[test]
    fn an_orphaned_item_is_never_reached() {
        let template = FlowTemplate {
            items: vec![
                item(FlowItemType::FlowTask, 1, "Reachable", ("flow", FLOW_ID), 0),
                item(FlowItemType::FlowTask, 2, "Orphan", ("flow_task", 999), 0),
            ],
            cycles: vec![cycle(10, (FlowItemType::FlowTask, 2), 0)],
            ..Default::default()
        };

        assert_eq!(titles(&render(&flow(), "Run", &template, &table(&[10]))), ["Run", "Reachable"]);
        // And the gather is told not to mint that orphan's scopes, exactly as the single-pass
        // version never reached them.
        assert!(template.planned_cycles(FLOW_ID).is_empty());
    }

    #[test]
    fn planned_cycles_keeps_pairs_of_items_reached_through_a_parent_chain() {
        let template = FlowTemplate {
            items: vec![
                item(FlowItemType::FlowGoal, 1, "Top", ("flow", FLOW_ID), 0),
                item(FlowItemType::FlowTask, 11, "Deep", ("flow_goal", 1), 0),
            ],
            cycles: vec![
                cycle(10, (FlowItemType::FlowGoal, 1), 0),
                cycle(20, (FlowItemType::FlowTask, 11), 0),
            ],
            ..Default::default()
        };

        let kept: Vec<i64> =
            template.planned_cycles(FLOW_ID).iter().map(|cycle| cycle.id).collect();
        assert_eq!(kept, [10, 20]);
    }

    // ---- The fan-in remapping ----------------------------------------------------------------

    /// Instance titles for each edge, so assertions read as the flow, not as indices.
    fn edge_pairs(plan: &RenderedPlan) -> Vec<(usize, usize)> {
        plan.edges.iter().map(|edge| (edge.dependent.0, edge.blocker.0)).collect()
    }

    #[test]
    fn one_dependent_over_two_blockers_fans_in_to_two_edges() {
        let template = FlowTemplate {
            items: vec![
                item(FlowItemType::FlowTask, 1, "Blocker", ("flow", FLOW_ID), 10),
                item(FlowItemType::FlowTask, 2, "Dependent", ("flow", FLOW_ID), 20),
            ],
            cycles: vec![
                cycle(10, (FlowItemType::FlowTask, 1), 0),
                cycle(20, (FlowItemType::FlowTask, 1), 1),
            ],
            dependencies: vec![dependency(
                1,
                (FlowItemType::FlowTask, 2),
                (FlowItemType::FlowTask, 1),
            )],
        };

        let plan = render(&flow(), "Run", &template, &table(&[10, 20]));

        assert_eq!(titles(&plan), ["Run", "Blocker", "Blocker", "Dependent"]);
        assert_eq!(edge_pairs(&plan), [(3, 1), (3, 2)]);
    }

    #[test]
    fn three_dependents_over_two_blockers_is_a_cross_product_not_a_zip() {
        let template = FlowTemplate {
            items: vec![
                item(FlowItemType::FlowTask, 1, "Blocker", ("flow", FLOW_ID), 10),
                item(FlowItemType::FlowTask, 2, "Dependent", ("flow", FLOW_ID), 20),
            ],
            cycles: vec![
                cycle(10, (FlowItemType::FlowTask, 1), 0),
                cycle(20, (FlowItemType::FlowTask, 1), 1),
                cycle(30, (FlowItemType::FlowTask, 2), 0),
                cycle(40, (FlowItemType::FlowTask, 2), 1),
                cycle(50, (FlowItemType::FlowTask, 2), 2),
            ],
            dependencies: vec![dependency(
                1,
                (FlowItemType::FlowTask, 2),
                (FlowItemType::FlowTask, 1),
            )],
        };

        let plan = render(&flow(), "Run", &template, &table(&[10, 20, 30, 40, 50]));

        // Nodes: 0 root, 1-2 Blocker, 3-5 Dependent.
        assert_eq!(plan.edges.len(), 6, "3 x 2 is a cross product");
        assert_eq!(edge_pairs(&plan), [(3, 1), (3, 2), (4, 1), (4, 2), (5, 1), (5, 2)]);
    }

    #[test]
    fn a_goal_dependent_yields_no_edges_at_all() {
        let template = FlowTemplate {
            items: vec![
                item(FlowItemType::FlowGoal, 1, "Waiting Goal", ("flow", FLOW_ID), 10),
                item(FlowItemType::FlowTask, 11, "Blocker", ("flow", FLOW_ID), 20),
            ],
            cycles: vec![],
            dependencies: vec![dependency(
                1,
                (FlowItemType::FlowGoal, 1),
                (FlowItemType::FlowTask, 11),
            )],
        };

        let plan = render(&flow(), "Run", &template, &ScopeTable::default());

        assert_eq!(titles(&plan), ["Run", "Waiting Goal", "Blocker"]);
        assert!(plan.edges.is_empty(), "only tasks may be dependents");
    }

    #[test]
    fn a_goal_blocker_is_kept_because_only_dependents_are_filtered() {
        // The asymmetry: the `"task"` filter is applied to the dependent side ONLY. A port that
        // filtered blockers too, or instead, would produce zero edges here.
        let template = FlowTemplate {
            items: vec![
                item(FlowItemType::FlowGoal, 1, "Blocking Goal", ("flow", FLOW_ID), 10),
                item(FlowItemType::FlowTask, 11, "Waiting Task", ("flow", FLOW_ID), 20),
            ],
            cycles: vec![],
            dependencies: vec![dependency(
                1,
                (FlowItemType::FlowTask, 11),
                (FlowItemType::FlowGoal, 1),
            )],
        };

        let plan = render(&flow(), "Run", &template, &ScopeTable::default());

        assert_eq!(titles(&plan), ["Run", "Blocking Goal", "Waiting Task"]);
        assert_eq!(edge_pairs(&plan), [(2, 1)]);
        assert_eq!(plan.nodes[1].kind, InstanceType::Goal, "the writer must pick Dependency::Goal");
    }

    #[test]
    fn both_sides_of_the_asymmetry_at_once() {
        // A goal dependent and a goal blocker in the same flow: exactly one edge survives, and it
        // is the one whose *blocker* is the goal. Swapping which side is filtered keeps the edge
        // count at one while changing which edge it is — hence the explicit pair assertion.
        let template = FlowTemplate {
            items: vec![
                item(FlowItemType::FlowGoal, 1, "Goal Dependent", ("flow", FLOW_ID), 10),
                item(FlowItemType::FlowGoal, 2, "Goal Blocker", ("flow", FLOW_ID), 20),
                item(FlowItemType::FlowTask, 11, "Task Dependent", ("flow", FLOW_ID), 30),
                item(FlowItemType::FlowTask, 12, "Task Blocker", ("flow", FLOW_ID), 40),
            ],
            cycles: vec![],
            dependencies: vec![
                // goal waits on task — dropped.
                dependency(1, (FlowItemType::FlowGoal, 1), (FlowItemType::FlowTask, 12)),
                // task waits on goal — kept.
                dependency(2, (FlowItemType::FlowTask, 11), (FlowItemType::FlowGoal, 2)),
            ],
        };

        let plan = render(&flow(), "Run", &template, &ScopeTable::default());

        assert_eq!(
            titles(&plan),
            ["Run", "Goal Dependent", "Goal Blocker", "Task Dependent", "Task Blocker"]
        );
        assert_eq!(edge_pairs(&plan), [(3, 2)]);
    }

    #[test]
    fn a_dependency_naming_an_item_with_no_instances_yields_nothing() {
        let template = FlowTemplate {
            items: vec![item(FlowItemType::FlowTask, 1, "Alone", ("flow", FLOW_ID), 0)],
            cycles: vec![],
            dependencies: vec![
                // The blocker does not exist in the template at all.
                dependency(1, (FlowItemType::FlowTask, 1), (FlowItemType::FlowTask, 404)),
                // Neither does the dependent.
                dependency(2, (FlowItemType::FlowTask, 404), (FlowItemType::FlowTask, 1)),
                // The item exists but is orphaned, so it has no instances.
                dependency(3, (FlowItemType::FlowTask, 1), (FlowItemType::FlowGoal, 9)),
            ],
        };

        let plan = render(&flow(), "Run", &template, &ScopeTable::default());

        assert_eq!(titles(&plan), ["Run", "Alone"]);
        assert!(plan.edges.is_empty());
    }

    #[test]
    fn dependencies_are_remapped_in_template_order() {
        let template = FlowTemplate {
            items: vec![
                item(FlowItemType::FlowTask, 1, "A", ("flow", FLOW_ID), 10),
                item(FlowItemType::FlowTask, 2, "B", ("flow", FLOW_ID), 20),
                item(FlowItemType::FlowTask, 3, "C", ("flow", FLOW_ID), 30),
            ],
            cycles: vec![],
            dependencies: vec![
                dependency(1, (FlowItemType::FlowTask, 3), (FlowItemType::FlowTask, 1)),
                dependency(2, (FlowItemType::FlowTask, 2), (FlowItemType::FlowTask, 1)),
            ],
        };

        let plan = render(&flow(), "Run", &template, &ScopeTable::default());

        assert_eq!(edge_pairs(&plan), [(3, 1), (2, 1)]);
    }
}
