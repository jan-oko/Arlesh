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
