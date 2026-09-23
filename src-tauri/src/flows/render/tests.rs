use super::*;
use crate::scopes::key::test_key;

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
        verdict_window_n: None,
        verdict_window_kind: None,
        is_habit: false,
        position: 0,
        is_private: false,
    }
}

fn item(
    kind: FlowItemType,
    id: i64,
    title: &str,
    parent: (&str, i64),
    position: i64,
) -> TemplateItem {
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

fn dependency(
    id: i64,
    dependent: (FlowItemType, i64),
    blocker: (FlowItemType, i64),
) -> FlowDependency {
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
    Some(TimeScope::single(test_key(id)))
}

/// A scope table resolving each listed cycle id to its own single-scope window.
fn table(cycle_ids: &[i64]) -> ScopeTable {
    ScopeTable {
        pairs: cycle_ids
            .iter()
            .map(|id| {
                (
                    *id,
                    ResolvedPair {
                        time_scope: scope(*id * 100),
                        plan: None,
                    },
                )
            })
            .collect(),
        ..Default::default()
    }
}

fn titles(plan: &RenderedPlan) -> Vec<&str> {
    plan.nodes.iter().map(|node| node.title.as_str()).collect()
}

#[test]
fn an_empty_flow_renders_just_its_root() {
    let plan = render(
        &flow(),
        "Run",
        &FlowTemplate::default(),
        &ScopeTable::default(),
    );
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
    let scopes = ScopeTable {
        window: scope(1),
        root_plan: scope(2),
        ..Default::default()
    };

    let plan = render(&flow, "Private Run", &FlowTemplate::default(), &scopes);

    assert_eq!(plan.nodes[0].kind, InstanceType::Goal);
    assert!(plan.nodes[0].is_private);
    assert_eq!(plan.nodes[0].time_scope, scope(1));
    assert_eq!(plan.nodes[0].plan, scope(2));
}

#[test]
fn an_item_with_no_cycle_pairs_yields_one_unscoped_instance() {
    let template = FlowTemplate {
        items: vec![item(
            FlowItemType::FlowTask,
            1,
            "Once",
            ("flow", FLOW_ID),
            0,
        )],
        ..Default::default()
    };

    let plan = render(&flow(), "Run", &template, &ScopeTable::default());

    assert_eq!(titles(&plan), ["Run", "Once"]);
    assert_eq!(plan.nodes[1].time_scope, None);
    assert_eq!(plan.nodes[1].plan, None);
    assert_eq!(plan.nodes[1].parent, Some(NodeRef(0)));
    assert_eq!(
        plan.nodes[1].source,
        PlannedSource::Item(FlowItemType::FlowTask, 1)
    );
}

#[test]
fn three_cycle_pairs_spawn_three_instances_in_position_order() {
    let template = FlowTemplate {
        items: vec![item(
            FlowItemType::FlowTask,
            1,
            "Repeat",
            ("flow", FLOW_ID),
            0,
        )],
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
    let windows: Vec<_> = plan.nodes[1..]
        .iter()
        .map(|node| node.time_scope.clone())
        .collect();
    assert_eq!(windows, [scope(1000), scope(2000), scope(3000)]);
    assert!(plan.nodes[1..]
        .iter()
        .all(|node| node.parent == Some(NodeRef(0))));
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
fn siblings_sort_by_their_own_position_even_when_a_goal_and_a_task_share_an_id() {
    // `flow_goals` and `flow_tasks` have independent rowid sequences, so a goal and a task can
    // legitimately share an id. The goal (id 1, position 100) is listed first, as
    // `FlowTemplate::items` requires; the task with the *same* id (position 0) must still sort
    // by its own position, not the goal's.
    let template = FlowTemplate {
        items: vec![
            item(
                FlowItemType::FlowGoal,
                1,
                "GoalHigh",
                ("flow", FLOW_ID),
                100,
            ),
            item(FlowItemType::FlowTask, 1, "TaskLow", ("flow", FLOW_ID), 0),
            item(FlowItemType::FlowTask, 2, "TaskMid", ("flow", FLOW_ID), 50),
        ],
        ..Default::default()
    };

    let plan = render(&flow(), "Run", &template, &ScopeTable::default());

    assert_eq!(titles(&plan), ["Run", "TaskLow", "TaskMid", "GoalHigh"]);
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

    assert_eq!(
        titles(&render(&flow(), "Run", &template, &table(&[10]))),
        ["Run", "Reachable"]
    );
    // And the gather is told not to resolve that orphan's scopes, exactly as the single-pass
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

    let kept: Vec<i64> = template
        .planned_cycles(FLOW_ID)
        .iter()
        .map(|cycle| cycle.id)
        .collect();
    assert_eq!(kept, [10, 20]);
}

// ---- The fan-in remapping ----------------------------------------------------------------

/// Instance titles for each edge, so assertions read as the flow, not as indices.
fn edge_pairs(plan: &RenderedPlan) -> Vec<(usize, usize)> {
    plan.edges
        .iter()
        .map(|edge| (edge.dependent.0, edge.blocker.0))
        .collect()
}

#[test]
fn one_dependent_over_two_blockers_fans_in_to_two_edges() {
    let template = FlowTemplate {
        items: vec![
            item(FlowItemType::FlowTask, 1, "Blocker", ("flow", FLOW_ID), 10),
            item(
                FlowItemType::FlowTask,
                2,
                "Dependent",
                ("flow", FLOW_ID),
                20,
            ),
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
            item(
                FlowItemType::FlowTask,
                2,
                "Dependent",
                ("flow", FLOW_ID),
                20,
            ),
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
    assert_eq!(
        edge_pairs(&plan),
        [(3, 1), (3, 2), (4, 1), (4, 2), (5, 1), (5, 2)]
    );
}

#[test]
fn a_goal_dependent_yields_no_edges_at_all() {
    let template = FlowTemplate {
        items: vec![
            item(
                FlowItemType::FlowGoal,
                1,
                "Waiting Goal",
                ("flow", FLOW_ID),
                10,
            ),
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
            item(
                FlowItemType::FlowGoal,
                1,
                "Blocking Goal",
                ("flow", FLOW_ID),
                10,
            ),
            item(
                FlowItemType::FlowTask,
                11,
                "Waiting Task",
                ("flow", FLOW_ID),
                20,
            ),
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
    assert_eq!(
        plan.nodes[1].kind,
        InstanceType::Goal,
        "the writer must pick Dependency::Goal"
    );
}

#[test]
fn both_sides_of_the_asymmetry_at_once() {
    // A goal dependent and a goal blocker in the same flow: exactly one edge survives, and it
    // is the one whose *blocker* is the goal. Swapping which side is filtered keeps the edge
    // count at one while changing which edge it is — hence the explicit pair assertion.
    let template = FlowTemplate {
        items: vec![
            item(
                FlowItemType::FlowGoal,
                1,
                "Goal Dependent",
                ("flow", FLOW_ID),
                10,
            ),
            item(
                FlowItemType::FlowGoal,
                2,
                "Goal Blocker",
                ("flow", FLOW_ID),
                20,
            ),
            item(
                FlowItemType::FlowTask,
                11,
                "Task Dependent",
                ("flow", FLOW_ID),
                30,
            ),
            item(
                FlowItemType::FlowTask,
                12,
                "Task Blocker",
                ("flow", FLOW_ID),
                40,
            ),
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
        [
            "Run",
            "Goal Dependent",
            "Goal Blocker",
            "Task Dependent",
            "Task Blocker"
        ]
    );
    assert_eq!(edge_pairs(&plan), [(3, 2)]);
}

#[test]
fn a_dependency_naming_an_item_with_no_instances_yields_nothing() {
    let template = FlowTemplate {
        items: vec![item(
            FlowItemType::FlowTask,
            1,
            "Alone",
            ("flow", FLOW_ID),
            0,
        )],
        cycles: vec![],
        dependencies: vec![
            // The blocker does not exist in the template at all.
            dependency(
                1,
                (FlowItemType::FlowTask, 1),
                (FlowItemType::FlowTask, 404),
            ),
            // Neither does the dependent.
            dependency(
                2,
                (FlowItemType::FlowTask, 404),
                (FlowItemType::FlowTask, 1),
            ),
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
