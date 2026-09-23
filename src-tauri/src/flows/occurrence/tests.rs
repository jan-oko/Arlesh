use super::*;

fn task(id: i64) -> FlowItemRef {
    FlowItemRef {
        item_type: "flow_task".into(),
        item_id: id,
    }
}

fn goal(id: i64) -> FlowItemRef {
    FlowItemRef {
        item_type: "flow_goal".into(),
        item_id: id,
    }
}

fn template_edge(dependent: &FlowItemRef, blocker: &FlowItemRef) -> FlowDependency {
    FlowDependency {
        id: 0,
        flow_id: 1,
        dependent_type: dependent.item_type.clone(),
        dependent_id: dependent.item_id,
        depends_on_type: blocker.item_type.clone(),
        depends_on_id: blocker.item_id,
    }
}

fn divergence(
    scope: i64,
    dependent: &FlowItemRef,
    blocker: &FlowItemRef,
    added: bool,
) -> DependencyDivergence {
    DependencyDivergence {
        iteration_scope_id: scope,
        dependent_type: dependent.item_type.clone(),
        dependent_id: dependent.item_id,
        depends_on_type: blocker.item_type.clone(),
        depends_on_id: blocker.item_id,
        added,
    }
}

#[test]
fn a_typed_title_is_stored_trimmed() {
    assert_eq!(
        stored_text(Some("  Run at dawn ".into()), Some("Run")),
        Some("Run at dawn".to_string())
    );
}

#[test]
fn typing_the_templates_own_title_back_clears_the_divergence() {
    assert_eq!(stored_text(Some("Run ".into()), Some("Run")), None);
}

#[test]
fn an_empty_text_or_none_clears_the_divergence() {
    assert_eq!(stored_text(Some("   ".into()), None), None);
    assert_eq!(stored_text(None, Some("Run")), None);
}

#[test]
fn an_iteration_with_no_divergences_waits_on_exactly_the_template() {
    let template = [template_edge(&task(2), &task(1))];
    assert_eq!(
        effective_dependencies(&template, &[], 100, &task(2)),
        vec![task(1)]
    );
}

#[test]
fn an_iteration_can_add_an_edge_and_remove_a_template_one() {
    let template = [template_edge(&task(2), &task(1))];
    let divergences = [
        divergence(100, &task(2), &task(1), false),
        divergence(100, &task(2), &goal(5), true),
    ];
    assert_eq!(
        effective_dependencies(&template, &divergences, 100, &task(2)),
        vec![goal(5)]
    );
}

#[test]
fn another_iterations_divergences_leave_this_one_on_the_template() {
    let template = [template_edge(&task(2), &task(1))];
    let divergences = [divergence(200, &task(2), &task(1), false)];
    assert_eq!(
        effective_dependencies(&template, &divergences, 100, &task(2)),
        vec![task(1)]
    );
}

#[test]
fn wanting_the_templates_set_needs_no_divergence_rows() {
    assert!(divergence_rows(&[task(1)], &[task(1)]).is_empty());
}

#[test]
fn divergence_rows_remove_what_is_left_out_and_add_what_is_new() {
    let rows = divergence_rows(&[task(1), task(3)], &[task(3), goal(5)]);
    assert_eq!(rows.len(), 2);
    assert!(rows.contains(&(task(1), false)));
    assert!(rows.contains(&(goal(5), true)));
}

#[test]
fn a_chain_is_not_circular_and_a_loop_is() {
    let chain = [(task(3), task(2)), (task(2), task(1))];
    assert!(!is_circular(&chain));
    let looped = [(task(3), task(2)), (task(2), task(1)), (task(1), task(3))];
    assert!(is_circular(&looped));
}

#[test]
fn a_diamond_is_not_circular() {
    let diamond = [
        (task(4), task(2)),
        (task(4), task(3)),
        (task(2), task(1)),
        (task(3), task(1)),
    ];
    assert!(!is_circular(&diamond));
}

fn stored(id: i64, scope_index: i64, plan_start: Option<i64>) -> FlowItemCycle {
    FlowItemCycle {
        id,
        flow_id: 1,
        item_type: "flow_task".into(),
        item_id: 2,
        scope_kind: Some("day".into()),
        scope_index: Some(scope_index),
        plan_kind: plan_start.map(|_| "part_of_day".into()),
        plan_start,
        plan_end: plan_start,
        position: 0,
    }
}

fn asked(scope_index: i64, plan_start: Option<i64>) -> FlowCycleInput {
    FlowCycleInput {
        scope_kind: Some("day".into()),
        scope_index: Some(scope_index),
        plan_kind: plan_start.map(|_| "part_of_day".into()),
        plan_start,
        plan_end: plan_start,
    }
}

#[test]
fn asking_for_the_same_pairs_keeps_every_id_and_orphans_nothing() {
    let existing = [stored(10, 1, None), stored(11, 3, Some(2))];
    let wanted = [asked(1, None), asked(3, Some(2))];
    let diff = diff_cycles(&existing, &wanted);
    assert_eq!(
        diff.kept,
        vec![
            KeptPair {
                id: 10,
                position: 0
            },
            KeptPair {
                id: 11,
                position: 1
            }
        ]
    );
    assert!(diff.added.is_empty() && diff.removed.is_empty());
    assert!(orphaned_cycle_ids(&existing, &wanted, &diff).is_empty());
}

#[test]
fn a_plan_only_change_keeps_the_pair() {
    let existing = [stored(10, 1, Some(1))];
    let diff = diff_cycles(&existing, &[asked(1, Some(4))]);
    assert_eq!(
        diff.kept,
        vec![KeptPair {
            id: 10,
            position: 0
        }]
    );
    assert!(diff.removed.is_empty());
}

#[test]
fn a_moved_cycle_scope_is_a_new_pair_and_orphans_the_old_one() {
    let existing = [stored(10, 1, None)];
    let wanted = [asked(2, None)];
    let diff = diff_cycles(&existing, &wanted);
    assert_eq!(diff.added, vec![0]);
    assert_eq!(diff.removed, vec![10]);
    assert_eq!(orphaned_cycle_ids(&existing, &wanted, &diff), vec![10]);
}

#[test]
fn reordered_pairs_keep_their_ids_at_their_new_positions() {
    let existing = [stored(10, 1, None), stored(11, 3, None)];
    let diff = diff_cycles(&existing, &[asked(3, None), asked(1, None)]);
    assert_eq!(
        diff.kept,
        vec![
            KeptPair {
                id: 11,
                position: 0
            },
            KeptPair {
                id: 10,
                position: 1
            }
        ]
    );
}

#[test]
fn giving_an_unpaired_item_its_first_pair_orphans_the_no_pair_occurrence() {
    let wanted = [asked(1, None)];
    let diff = diff_cycles(&[], &wanted);
    assert_eq!(orphaned_cycle_ids(&[], &wanted, &diff), vec![NO_CYCLE]);
}

#[test]
fn taking_every_pair_away_orphans_each_of_them() {
    let existing = [stored(10, 1, None), stored(11, 3, None)];
    let diff = diff_cycles(&existing, &[]);
    assert_eq!(orphaned_cycle_ids(&existing, &[], &diff), vec![10, 11]);
}

fn key(item_type: &str, item_id: i64, cycle_id: i64) -> (String, i64, i64) {
    (item_type.to_string(), item_id, cycle_id)
}

/// A root, an item 1 with a pair 7 (first) and 8, and item 2 nested under item 1.
fn iteration_keys() -> Vec<(String, i64, i64)> {
    vec![
        key("flow_root", 99, NO_CYCLE),
        key("flow_task", 1, 7),
        key("flow_task", 1, 8),
        key("flow_task", 2, NO_CYCLE),
    ]
}

fn hierarchy() -> (
    HashMap<(String, i64), (String, i64)>,
    HashMap<(String, i64), i64>,
) {
    let parents = HashMap::from([(("flow_task".to_string(), 2), ("flow_task".to_string(), 1))]);
    let first = HashMap::from([(("flow_task".to_string(), 1), 7)]);
    (parents, first)
}

#[test]
fn nothing_archived_sets_nothing_aside() {
    let (parents, first) = hierarchy();
    assert!(set_aside(&iteration_keys(), &HashSet::new(), &parents, &first).is_empty());
}

#[test]
fn an_archived_root_sets_the_whole_iteration_aside() {
    let (parents, first) = hierarchy();
    let archived = HashSet::from([key("flow_root", 99, NO_CYCLE)]);
    assert_eq!(
        set_aside(&iteration_keys(), &archived, &parents, &first).len(),
        4
    );
}

#[test]
fn an_archived_first_occurrence_takes_the_items_nested_under_it() {
    let (parents, first) = hierarchy();
    let archived = HashSet::from([key("flow_task", 1, 7)]);
    let aside = set_aside(&iteration_keys(), &archived, &parents, &first);
    assert!(aside.contains(&key("flow_task", 1, 7)));
    assert!(aside.contains(&key("flow_task", 2, NO_CYCLE)));
    assert!(
        !aside.contains(&key("flow_task", 1, 8)),
        "the evening occurrence is its own"
    );
}

#[test]
fn an_archived_later_occurrence_holds_no_children_and_takes_only_itself() {
    let (parents, first) = hierarchy();
    let archived = HashSet::from([key("flow_task", 1, 8)]);
    let aside = set_aside(&iteration_keys(), &archived, &parents, &first);
    assert_eq!(aside, HashSet::from([key("flow_task", 1, 8)]));
}
