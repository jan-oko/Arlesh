use super::*;

#[test]
fn instance_type_as_str_covers_all_variants() {
    assert_eq!(InstanceType::Goal.as_str(), "goal");
    assert_eq!(InstanceType::Task.as_str(), "task");
    assert_eq!(InstanceType::Commitment.as_str(), "commitment");
}

#[test]
fn instance_type_from_db_roundtrips_every_variant() {
    for instance_type in [
        InstanceType::Goal,
        InstanceType::Task,
        InstanceType::Commitment,
    ] {
        assert_eq!(InstanceType::from_db(instance_type.as_str()), instance_type);
    }
}

#[test]
fn an_unrecognised_instance_type_reads_as_a_task() {
    // The CHECK constraint is what keeps this from arising; a row that got past it still
    // renders as something rather than taking the flow off the canvas.
    assert_eq!(InstanceType::from_db("bogus"), InstanceType::Task);
}

#[test]
fn flow_id_roundtrip() {
    assert_eq!(i64::from(FlowId::from(9_i64)), 9);
}

#[test]
fn consumption_enums_cover_all_variants() {
    assert_eq!(ConsumptionKind::Destructive.as_str(), "destructive");
    assert_eq!(ConsumptionKind::Accumulating.as_str(), "accumulating");
    assert_eq!(BlockingMode::Overlapping.as_str(), "overlapping");
    assert_eq!(BlockingMode::Blocking.as_str(), "blocking");
    assert_eq!(CatchupPolicy::AllPending.as_str(), "all_pending");
    assert_eq!(CatchupPolicy::Next.as_str(), "next");
    assert_eq!(CatchupPolicy::Latest.as_str(), "latest");
}

fn window(start_id: i64, end_id: i64) -> TimeScope {
    TimeScope {
        start_id,
        end_id,
        duration: None,
    }
}

#[test]
fn an_occurrence_with_no_override_follows_its_cycle_plan() {
    let cycle_plan = Some(window(10, 10));
    let row = PlanOverride::from_columns(false, None, None);
    assert_eq!(row.effective_plan(cycle_plan.clone()), cycle_plan);
    assert!(!row.is_override());
}

#[test]
fn an_occurrence_with_no_override_and_no_cycle_plan_is_unplanned() {
    assert_eq!(
        PlanOverride::from_columns(false, None, None).effective_plan(None),
        None
    );
}

#[test]
fn an_overridden_window_replaces_the_cycle_plan() {
    let row = PlanOverride::from_columns(true, Some(20), Some(22));
    assert_eq!(
        row.effective_plan(Some(window(10, 10))),
        Some(window(20, 22))
    );
    assert!(row.is_override());
}

#[test]
fn an_overridden_window_plans_an_occurrence_the_template_left_unplanned() {
    let row = PlanOverride::from_columns(true, Some(20), Some(20));
    assert_eq!(row.effective_plan(None), Some(window(20, 20)));
}

#[test]
fn deliberately_unplanned_removes_the_cycle_plan_and_is_still_an_override() {
    let row = PlanOverride::from_columns(true, None, None);
    assert_eq!(row, PlanOverride::Unplanned);
    assert_eq!(row.effective_plan(Some(window(10, 10))), None);
    assert!(
        row.is_override(),
        "unplanned is a choice, not the absence of one"
    );
}

#[test]
fn a_half_written_window_reads_as_unplanned_rather_than_inheriting() {
    assert_eq!(
        PlanOverride::from_columns(true, Some(20), None),
        PlanOverride::Unplanned
    );
    assert_eq!(
        PlanOverride::from_columns(true, None, Some(20)),
        PlanOverride::Unplanned
    );
}

#[test]
fn stale_scope_columns_on_an_unflagged_row_are_ignored() {
    assert_eq!(
        PlanOverride::from_columns(false, Some(20), Some(20)),
        PlanOverride::Inherit
    );
}

#[test]
fn a_plan_override_reads_off_the_wire_in_all_three_states() {
    let inherit: PlanOverride = serde_json::from_str(r#"{"kind":"inherit"}"#).unwrap();
    let unplanned: PlanOverride = serde_json::from_str(r#"{"kind":"unplanned"}"#).unwrap();
    let planned: PlanOverride =
        serde_json::from_str(r#"{"kind":"planned","plan":{"start_id":3,"end_id":4}}"#).unwrap();
    assert_eq!(inherit, PlanOverride::Inherit);
    assert_eq!(unplanned, PlanOverride::Unplanned);
    assert_eq!(planned, PlanOverride::Planned { plan: window(3, 4) });
}
