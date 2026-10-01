use super::*;

#[test]
fn task_status_as_str_covers_all_variants() {
    assert_eq!(TaskStatus::Todo.as_str(), "todo");
    assert_eq!(TaskStatus::InProgress.as_str(), "in_progress");
    assert_eq!(TaskStatus::Started.as_str(), "started");
    assert_eq!(TaskStatus::Done.as_str(), "done");
}

#[test]
fn task_status_from_db_roundtrips_every_variant() {
    for status in [
        TaskStatus::Todo,
        TaskStatus::InProgress,
        TaskStatus::Started,
        TaskStatus::Done,
    ] {
        assert_eq!(TaskStatus::from_db(status.as_str()), Some(status));
    }
}

#[test]
fn only_in_progress_and_started_are_begun() {
    assert!(TaskStatus::InProgress.is_begun());
    assert!(TaskStatus::Started.is_begun());
    assert!(!TaskStatus::Todo.is_begun());
    assert!(!TaskStatus::Done.is_begun());
}

#[test]
fn agentic_status_stores_spellings_disjoint_from_the_ordinary_model() {
    for status in [
        AgenticStatus::Todo,
        AgenticStatus::OnAgent,
        AgenticStatus::Doing,
        AgenticStatus::Done,
    ] {
        let spelling = status.as_db().expect("stored");
        assert_eq!(AgenticStatus::from_db(spelling), Some(status));
        assert_eq!(TaskStatus::from_db(spelling), None, "{spelling} must not read as ordinary");
    }
    for ordinary in ["todo", "in_progress", "started", "done"] {
        assert_eq!(AgenticStatus::from_db(ordinary), None, "{ordinary} must not read as agentic");
    }
}

#[test]
fn review_is_derived_and_never_stored() {
    assert_eq!(AgenticStatus::Review.as_db(), None);
    assert_eq!(AgenticStatus::from_db("review"), None);
    assert_eq!(AgenticStatus::Review.stored(), AgenticStatus::OnAgent);
    assert_eq!(AgenticStatus::Review.as_str(), "review");
    assert!(AgenticStatus::Review.is_begun());
    assert!(AgenticStatus::OnAgent.is_begun());
    assert!(AgenticStatus::Doing.is_begun());
    assert!(!AgenticStatus::Todo.is_begun());
    assert!(!AgenticStatus::Done.is_begun());
}

#[test]
fn status_decodes_each_stored_spelling_into_exactly_one_model() {
    assert_eq!(Status::from_db("todo"), Some(Status::Ordinary(TaskStatus::Todo)));
    assert_eq!(
        Status::from_db("agentic_todo"),
        Some(Status::Agentic(AgenticStatus::Todo))
    );
    assert_eq!(
        Status::from_db("doing"),
        Some(Status::Agentic(AgenticStatus::Doing))
    );
    assert_eq!(
        Status::from_db("in_progress"),
        Some(Status::Ordinary(TaskStatus::InProgress))
    );
    assert_eq!(Status::from_db("review"), None);
    assert_eq!(Status::from_db("bogus"), None);
    assert_eq!(Status::Agentic(AgenticStatus::Review).as_db(), None);
}

#[test]
fn status_serialises_tagged_by_its_model() {
    let doing = serde_json::to_value(Status::Agentic(AgenticStatus::Doing)).expect("json");
    assert_eq!(doing, serde_json::json!({"kind": "agentic", "status": "doing"}));
    let started = serde_json::to_value(Status::Ordinary(TaskStatus::Started)).expect("json");
    assert_eq!(started, serde_json::json!({"kind": "ordinary", "status": "started"}));
    let back: Status = serde_json::from_value(doing).expect("parses");
    assert_eq!(back, Status::Agentic(AgenticStatus::Doing));
}

#[test]
fn conversion_maps_the_shared_states_and_refuses_the_rest() {
    let ordinary = |status| Status::Ordinary(status);
    let agentic = |status| Status::Agentic(status);
    assert_eq!(ordinary(TaskStatus::Todo).converted(true), Some(agentic(AgenticStatus::Todo)));
    assert_eq!(
        ordinary(TaskStatus::InProgress).converted(true),
        Some(agentic(AgenticStatus::Doing))
    );
    assert_eq!(ordinary(TaskStatus::Done).converted(true), Some(agentic(AgenticStatus::Done)));
    assert_eq!(ordinary(TaskStatus::Started).converted(true), None);
    assert_eq!(agentic(AgenticStatus::Doing).converted(false), Some(ordinary(TaskStatus::InProgress)));
    assert_eq!(agentic(AgenticStatus::OnAgent).converted(false), None);
    assert_eq!(agentic(AgenticStatus::Review).converted(false), None);
    // Staying in its own model is the identity, Started and On Agent included.
    assert_eq!(ordinary(TaskStatus::Started).converted(false), Some(ordinary(TaskStatus::Started)));
    assert_eq!(agentic(AgenticStatus::OnAgent).converted(true), Some(agentic(AgenticStatus::OnAgent)));
}

#[test]
fn readings_round_trip_through_each_model() {
    assert_eq!(Status::Agentic(AgenticStatus::OnAgent).reading(), TaskStatus::Started);
    assert_eq!(Status::Agentic(AgenticStatus::Doing).reading(), TaskStatus::InProgress);
    assert_eq!(
        Status::from_reading(TaskStatus::Started, true),
        Status::Agentic(AgenticStatus::OnAgent)
    );
    assert_eq!(
        Status::from_reading(TaskStatus::Started, false),
        Status::Ordinary(TaskStatus::Started)
    );
    assert!(Status::Agentic(AgenticStatus::Done).is_done());
    assert!(Status::todo(true).is_todo());
    assert!(!Status::todo(false).is_agentic());
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
