use super::*;

#[test]
fn a_template_table_names_its_relation_rows_and_its_own_table() {
    assert_eq!(TemplateTable::Flow.as_str(), "flow");
    assert_eq!(TemplateTable::FlowGoal.as_str(), "flow_goal");
    assert_eq!(TemplateTable::FlowTask.as_str(), "flow_task");
    assert_eq!(TemplateTable::Flow.table(), "flows");
    assert_eq!(TemplateTable::FlowGoal.table(), "flow_goals");
    assert_eq!(TemplateTable::FlowTask.table(), "flow_tasks");
}

#[test]
fn only_the_task_columns_count_as_task_only() {
    assert!(!TemplateUpdate::default().touches_task_columns());
    let relations = TemplateUpdate {
        tag_ids: Some(vec![1]),
        block_reasons: Some(vec!["x".into()]),
        ..TemplateUpdate::default()
    };
    assert!(
        !relations.touches_task_columns(),
        "every template has tags and block reasons"
    );
    for update in [
        TemplateUpdate {
            delegate_to: Some(None),
            ..TemplateUpdate::default()
        },
        TemplateUpdate {
            agentic: Some(TaskAgentic::Yes),
            ..TemplateUpdate::default()
        },
        TemplateUpdate {
            asynchronous: Some(true),
            ..TemplateUpdate::default()
        },
        TemplateUpdate {
            archival: Some(TaskArchival::Backlog),
            ..TemplateUpdate::default()
        },
    ] {
        assert!(update.touches_task_columns());
    }
}

#[test]
fn a_template_update_reads_null_as_clearing_the_delegate() {
    let cleared: TemplateUpdate = serde_json::from_str(r#"{"delegate_to": null}"#).unwrap();
    assert_eq!(cleared.delegate_to, Some(None));
    let untouched: TemplateUpdate = serde_json::from_str("{}").unwrap();
    assert_eq!(untouched.delegate_to, None);
}

#[test]
fn template_fields_default_to_what_a_template_said_before_it_had_them() {
    let fields = TemplateFields::default();
    assert_eq!(fields.delegate_to, None);
    assert_eq!(fields.agentic, None);
    assert!(!fields.asynchronous);
    assert_eq!(fields.archival, TaskArchival::Live);
    let wire = serde_json::to_value(&fields).unwrap();
    assert!(
        wire.get("beads_id").is_none(),
        "no issue is sent as no field"
    );
}

#[test]
fn compound_and_a_wait_template_are_a_flow_task_items_alone() {
    let compound = TemplateUpdate {
        compound: Some(true),
        ..TemplateUpdate::default()
    };
    let template = TemplateUpdate {
        async_template: Some(None),
        ..TemplateUpdate::default()
    };
    for update in [compound, template] {
        assert!(update.touches_flow_task_columns());
        assert!(
            update.touches_task_columns(),
            "a goal template is refused them too"
        );
    }
    assert!(!TemplateUpdate {
        asynchronous: Some(true),
        ..TemplateUpdate::default()
    }
    .touches_flow_task_columns());
}

#[test]
fn a_template_update_reads_null_as_removing_the_wait_template() {
    let removed: TemplateUpdate = serde_json::from_str(r#"{"async_template": null}"#).unwrap();
    assert_eq!(removed.async_template, Some(None));
    let untouched: TemplateUpdate = serde_json::from_str("{}").unwrap();
    assert_eq!(untouched.async_template, None);
    assert_eq!(untouched.compound, None);
}

#[test]
fn a_durations_columns_round_trip() {
    let spec = DurationSpec {
        n: 3,
        kind: "week".into(),
    };
    let (n, kind) = duration_columns(Some(&spec));
    assert_eq!(duration(n, kind.map(str::to_string)), Some(spec));
    assert_eq!(duration_columns(None), (None, None));
    assert_eq!(duration(Some(1), None), None);
}
