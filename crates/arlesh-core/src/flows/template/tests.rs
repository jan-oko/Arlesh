use super::*;
use crate::nodes::id::tid;
use crate::tasks::model::TaskAgentic;

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
        tag_ids: Some(vec![tid(1)]),
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
}

#[test]
fn compound_and_a_wait_template_are_a_task_templates_alone() {
    for update in [
        TemplateUpdate {
            compound: Some(true),
            ..TemplateUpdate::default()
        },
        TemplateUpdate {
            async_template: Some(None),
            ..TemplateUpdate::default()
        },
    ] {
        assert!(
            update.touches_task_columns(),
            "a goal template is refused them"
        );
    }
}

#[test]
fn a_task_template_keeps_its_wait_template_where_its_table_says() {
    assert_eq!(
        TemplateTable::Flow
            .wait_template()
            .map(|(table, _, key)| (table, key)),
        Some(("flow_async_templates", "flow_id"))
    );
    assert_eq!(
        TemplateTable::FlowTask
            .wait_template()
            .map(|(table, _, key)| (table, key)),
        Some(("flow_task_async_templates", "flow_task_id"))
    );
    assert_eq!(TemplateTable::FlowGoal.wait_template(), None);
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

mod narrowed_reads {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn seeded_pool() -> crate::database::DatabasePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("open");
        crate::database::run_migrations(&pool)
            .await
            .expect("migrations");
        sqlx::query("PRAGMA foreign_keys = OFF")
            .execute(&pool)
            .await
            .expect("pragma");
        for n in 1..=4 {
            sqlx::query(
                "INSERT INTO flow_tasks (id, flow_id, title, parent_type, parent_id, asynchronous)
                 VALUES (?, ?, 't', 'flow', ?, ?)",
            )
            .bind(tid(n))
            .bind(tid(90))
            .bind(tid(90))
            .bind(i64::from(n == 2))
            .execute(&pool)
            .await
            .expect("item");
        }
        for (item, tag) in [(1, 7), (1, 3), (2, 5), (3, 8), (4, 1)] {
            sqlx::query(
                "INSERT INTO template_tags (item_type, item_id, tag_id) VALUES ('flow_task', ?, ?)",
            )
            .bind(tid(item))
            .bind(tid(tag))
            .execute(&pool)
            .await
            .expect("tag");
        }
        for (item, reason, position) in [(1, "b", 1), (1, "a", 0), (3, "c", 0)] {
            sqlx::query(
                "INSERT INTO template_block_reasons (item_type, item_id, reason, position)
                 VALUES ('flow_task', ?, ?, ?)",
            )
            .bind(tid(item))
            .bind(reason)
            .bind(position)
            .execute(&pool)
            .await
            .expect("reason");
        }
        sqlx::query(
            "INSERT INTO template_agentic_briefs (item_type, item_id, priority, spec)
             VALUES ('flow_task', ?, 1, 'spec')",
        )
        .bind(tid(3))
        .execute(&pool)
        .await
        .expect("brief");
        sqlx::query(
            "INSERT INTO flow_task_async_templates
                (flow_task_id, title, time_scope_n, time_scope_kind, check_every_n, check_every_kind)
             VALUES (?, 'wait', 1, 'day', 1, 'hour')",
        )
        .bind(tid(2))
        .execute(&pool)
        .await
        .expect("wait template");
        sqlx::query(
            "INSERT INTO tags_on_flow_task_async_templates (flow_task_id, tag_id) VALUES (?, ?)",
        )
        .bind(tid(2))
        .bind(tid(6))
        .execute(&pool)
        .await
        .expect("wait tag");
        pool
    }

    #[tokio::test]
    async fn the_rows_asked_for_read_as_they_do_in_the_whole_table() {
        let pool = seeded_pool().await;
        let mut connection = pool.acquire().await.expect("connection");
        let mut templates = TemplateOperator::new(&mut connection);

        let everything = templates.all(TemplateTable::FlowTask).await.expect("all");
        assert_eq!(everything.len(), 4);
        let some = templates
            .of(TemplateTable::FlowTask, &[tid(1), tid(2), tid(3)])
            .await
            .expect("of");

        assert_eq!(some.len(), 3);
        for id in [tid(1), tid(2), tid(3)] {
            assert_eq!(some.get(&id), everything.get(&id));
        }
        assert!(!some.contains_key(&tid(4)));
        let first = some.get(&tid(1)).expect("item 1");
        assert_eq!(first.tag_ids, vec![tid(3), tid(7)]);
        assert_eq!(first.block_reasons, vec!["a", "b"]);
        assert!(some.get(&tid(2)).expect("item 2").async_template.is_some());
        assert!(some.get(&tid(3)).expect("item 3").agentic_brief.is_some());
    }

    #[tokio::test]
    async fn no_rows_asked_for_reads_nothing() {
        let pool = seeded_pool().await;
        let mut connection = pool.acquire().await.expect("connection");
        let mut templates = TemplateOperator::new(&mut connection);
        assert!(templates
            .of(TemplateTable::FlowTask, &[])
            .await
            .expect("of")
            .is_empty());
    }

    #[tokio::test]
    async fn one_row_reads_as_it_does_in_the_whole_table() {
        let pool = seeded_pool().await;
        let mut connection = pool.acquire().await.expect("connection");
        let mut templates = TemplateOperator::new(&mut connection);
        let everything = templates.all(TemplateTable::FlowTask).await.expect("all");
        let one = templates
            .one(TemplateTable::FlowTask, tid(2))
            .await
            .expect("one");
        assert_eq!(Some(&one), everything.get(&tid(2)));
    }
}
