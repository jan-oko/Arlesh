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
fn clock_enums_roundtrip_every_variant() {
    for clock in [ClockKind::Window, ClockKind::Interval] {
        assert_eq!(ClockKind::from_db(clock.as_str()), Some(clock));
    }
    for policy in [MissPolicy::Archive, MissPolicy::Overdue, MissPolicy::Owed] {
        assert_eq!(MissPolicy::from_db(policy.as_str()), Some(policy));
    }
    assert_eq!(ClockKind::Window.as_str(), "window");
    assert_eq!(ClockKind::Interval.as_str(), "interval");
    assert_eq!(MissPolicy::Archive.as_str(), "archive");
    assert_eq!(MissPolicy::Overdue.as_str(), "overdue");
    assert_eq!(MissPolicy::Owed.as_str(), "owed");
    // The retired Consumption vocabulary is not a clock.
    assert_eq!(ClockKind::from_db("destructive"), None);
    assert_eq!(MissPolicy::from_db("blocking"), None);
}
