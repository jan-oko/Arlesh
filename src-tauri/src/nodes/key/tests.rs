use super::*;

fn key(item_type: TemplateKind, item_id: i64, date: &str, cycle: i64) -> OccurrenceKey {
    OccurrenceKey {
        item: TemplateItem { item_type, item_id },
        iteration: NaiveDate::parse_from_str(date, "%Y-%m-%d").unwrap(),
        cycle,
    }
}

#[test]
fn an_occurrence_key_spells_its_tuple() {
    let occurrence = key(TemplateKind::FlowTask, 12, "2026-09-20", 3);
    assert_eq!(occurrence.node_key(), "flow_task:12:2026-09-20:3");
    assert_eq!(
        key(TemplateKind::FlowRoot, 4, "2026-01-02", NO_CYCLE).node_key(),
        "flow_root:4:2026-01-02:0"
    );
}

#[test]
fn a_canonical_key_parses_back() {
    for occurrence in [
        key(TemplateKind::FlowTask, 12, "2026-09-20", 3),
        key(TemplateKind::FlowGoal, 1, "2025-12-31", 0),
        key(TemplateKind::FlowRoot, 99, "2026-02-28", 0),
    ] {
        assert_eq!(
            OccurrenceKey::parse(&occurrence.node_key()),
            Some(occurrence)
        );
        assert_eq!(
            DerivedKey::parse(&occurrence.node_key()),
            Some(DerivedKey::Occurrence(occurrence))
        );
    }
}

#[test]
fn a_malformed_key_does_not_parse() {
    for malformed in [
        "",
        "task:12",
        "flow_task:12:2026-09-20",
        "flow_task:x:2026-09-20:0",
        "flow_task:12:2026-13-40:0",
        "flow_task:12:2026-09-20:0:extra",
        "flow_step:12:2026-09-20:0",
    ] {
        assert_eq!(OccurrenceKey::parse(malformed), None, "{malformed}");
    }
}

#[test]
fn the_id_is_the_hash_of_the_canonical_key() {
    let occurrence = key(TemplateKind::FlowTask, 12, "2026-09-20", 3);
    let derived = DerivedKey::from(occurrence);
    assert_eq!(derived.id(), occurrence.id());
    assert_eq!(
        derived.id().as_str(),
        "99692f37-c4ba-58ab-b68f-27b019c9b93a"
    );
    assert_eq!(derived.node_id(), NodeId::Derived(occurrence.id()));
    assert_eq!(derived.occurrence(), Some(&occurrence));
}

#[test]
fn template_kinds_round_trip_their_column() {
    for kind in [
        TemplateKind::FlowRoot,
        TemplateKind::FlowGoal,
        TemplateKind::FlowTask,
    ] {
        assert_eq!(TemplateKind::from_db(kind.as_str()), Some(kind));
        assert_eq!(kind.to_string(), kind.as_str());
    }
    assert_eq!(TemplateKind::from_db("flow"), None);
}
