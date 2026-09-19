use super::*;

#[test]
fn instance_type_as_str_covers_all_variants() {
    assert_eq!(InstanceType::Goal.as_str(), "goal");
    assert_eq!(InstanceType::Task.as_str(), "task");
    assert_eq!(InstanceType::Commitment.as_str(), "commitment");
}

#[test]
fn instance_type_from_db_roundtrips_every_variant() {
    for instance_type in [InstanceType::Goal, InstanceType::Task, InstanceType::Commitment] {
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
