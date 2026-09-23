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

#[test]
fn a_delegate_is_a_kind_and_an_id_on_the_wire() {
    let person = serde_json::to_value(Delegate::Person { id: 3 }).expect("serialises");
    assert_eq!(person, serde_json::json!({"kind": "person", "id": 3}));
    let agent = serde_json::to_value(Delegate::Agent).expect("serialises");
    assert_eq!(agent, serde_json::json!({"kind": "agent"}));

    let read: Delegate = serde_json::from_str(r#"{"kind":"agent"}"#).expect("parses");
    assert_eq!(read, Delegate::Agent);
    let read: Delegate = serde_json::from_str(r#"{"kind":"person","id":7}"#).expect("parses");
    assert_eq!(read, Delegate::Person { id: 7 });
}

#[test]
fn a_person_delegate_without_an_id_is_refused_on_the_wire() {
    assert!(serde_json::from_str::<Delegate>(r#"{"kind":"person"}"#).is_err());
    assert!(serde_json::from_str::<Delegate>(r#"{"kind":"robot"}"#).is_err());
}

#[test]
fn every_delegate_round_trips_through_its_columns() {
    for delegate in [
        None,
        Some(Delegate::Person { id: 4 }),
        Some(Delegate::Agent),
    ] {
        let (kind, id) = Delegate::columns(delegate);
        assert_eq!(Delegate::from_columns(kind, id), delegate);
    }
}

#[test]
fn the_agent_stores_no_id_and_a_person_stores_theirs() {
    assert_eq!(
        Delegate::columns(Some(Delegate::Agent)),
        (Some("agent"), None)
    );
    assert_eq!(
        Delegate::columns(Some(Delegate::Person { id: 9 })),
        (Some("person"), Some(9))
    );
    assert_eq!(Delegate::columns(None), (None, None));
}

#[test]
fn a_column_pair_the_schema_would_refuse_reads_as_no_delegate() {
    assert_eq!(Delegate::from_columns(Some("person"), None), None);
    assert_eq!(Delegate::from_columns(Some("robot"), Some(1)), None);
    assert_eq!(Delegate::from_columns(None, Some(1)), None);
}

#[test]
fn a_delegate_describes_itself_for_a_prompt() {
    assert_eq!(Delegate::Person { id: 12 }.describe(), "person 12");
    assert_eq!(Delegate::Agent.describe(), "agent");
}
