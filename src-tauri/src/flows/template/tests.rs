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
