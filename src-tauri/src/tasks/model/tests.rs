use super::*;

#[test]
fn task_status_as_str_covers_all_variants() {
    assert_eq!(TaskStatus::Todo.as_str(), "todo");
    assert_eq!(TaskStatus::InProgress.as_str(), "in_progress");
    assert_eq!(TaskStatus::Done.as_str(), "done");
}

#[test]
fn task_status_from_db_roundtrips_every_variant() {
    for status in [TaskStatus::Todo, TaskStatus::InProgress, TaskStatus::Done] {
        assert_eq!(TaskStatus::from_db(status.as_str()), Some(status));
    }
}

#[test]
fn task_status_from_db_rejects_unrecognized_values() {
    assert_eq!(TaskStatus::from_db("bogus"), None);
}

#[test]
fn task_archival_as_str_covers_all_variants() {
    assert_eq!(TaskArchival::Live.as_str(), "live");
    assert_eq!(TaskArchival::Backlog.as_str(), "backlog");
}

#[test]
fn task_archival_from_db_roundtrips_every_variant() {
    for archival in [TaskArchival::Live, TaskArchival::Backlog] {
        assert_eq!(TaskArchival::from_db(archival.as_str()), Some(archival));
    }
}

#[test]
fn task_archival_from_db_rejects_the_goal_side_vocabulary() {
    // Frozen and Archived belong to Goals and Projects. A Task row spelling either is corrupt,
    // and reading it as anything at all would quietly bless a state that cannot exist.
    assert_eq!(TaskArchival::from_db("frozen"), None);
    assert_eq!(TaskArchival::from_db("archived"), None);
    assert_eq!(TaskArchival::from_db("bogus"), None);
}

#[test]
fn a_task_defaults_to_live() {
    assert_eq!(TaskArchival::default(), TaskArchival::Live);
}

#[test]
fn only_a_live_task_may_carry_a_plan() {
    assert!(TaskArchival::Live.allows_plan());
    assert!(!TaskArchival::Backlog.allows_plan());
}

#[test]
fn goal_status_as_str_covers_all_variants() {
    assert_eq!(GoalStatus::Active.as_str(), "active");
    assert_eq!(GoalStatus::Achieved.as_str(), "achieved");
    assert_eq!(GoalStatus::Frozen.as_str(), "frozen");
    assert_eq!(GoalStatus::Archived.as_str(), "archived");
}

#[test]
fn goal_status_from_db_roundtrips_every_variant() {
    for status in [
        GoalStatus::Active,
        GoalStatus::Achieved,
        GoalStatus::Frozen,
        GoalStatus::Archived,
    ] {
        assert_eq!(GoalStatus::from_db(status.as_str()), Some(status));
    }
}

#[test]
fn goal_status_from_db_rejects_unrecognized_values() {
    assert_eq!(GoalStatus::from_db("bogus"), None);
}

#[test]
fn task_id_roundtrip() {
    let id = TaskId::from(7_i64);
    assert_eq!(i64::from(id), 7);
}

#[test]
fn goal_id_roundtrip() {
    let id = GoalId::from(13_i64);
    assert_eq!(i64::from(id), 13);
}
