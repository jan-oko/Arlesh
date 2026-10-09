//! The parenting table, replayed from the shared conformance corpus.
//!
//! `conformance/parenting.json` writes the whole kind × kind matrix down. This asks
//! [`arlesh_lib::nodes::rules::parenting::may_parent`] of every pair;
//! `src/utils/parenting-conformance.test.ts` asks the frontend's `isValidDropTarget`. Neither side
//! generates the file.

use std::collections::BTreeMap;

use arlesh_lib::{filters::model::NodeKind, nodes::rules::parenting::may_parent};
use serde::Deserialize;

const CORPUS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../conformance/parenting.json"
));

#[derive(Debug, Deserialize)]
struct Corpus {
    kinds: Vec<NodeKind>,
    parents: BTreeMap<String, Vec<NodeKind>>,
}

/// A kind as the corpus spells it.
fn spelled(kind: NodeKind) -> String {
    serde_json::to_value(kind)
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_default()
}

#[test]
fn every_pair_agrees_with_the_shared_corpus() {
    let corpus: Corpus = serde_json::from_str(CORPUS).expect("the corpus parses");
    assert_eq!(
        corpus.parents.len(),
        corpus.kinds.len(),
        "every kind names its parents, even when it has none"
    );
    for &child in &corpus.kinds {
        let allowed = corpus
            .parents
            .get(&spelled(child))
            .unwrap_or_else(|| panic!("{child:?} names no parents"));
        for &parent in &corpus.kinds {
            assert_eq!(
                may_parent(child, parent),
                allowed.contains(&parent),
                "{child:?} under {parent:?}"
            );
        }
    }
}

/// The writers ask the same table: a Goal under a Task is refused by name, as a bad request, before
/// the table's own constraint is reached.
#[tokio::test]
async fn a_writer_refuses_a_kind_the_table_does_not_allow_there() {
    use arlesh_lib::{
        commands::tasks as task_commands,
        tasks::model::{CreateGoalRequest, CreateTaskRequest},
    };
    use tauri::Manager;

    let pool = crate::helpers::test_pool().await;
    let app = crate::helpers::command_host(&pool);
    let task = task_commands::create_task(
        app.state(),
        CreateTaskRequest {
            title: "Write".into(),
            parent_type: "domain".into(),
            parent_id: 1.into(),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let refused = task_commands::create_goal(
        app.state(),
        CreateGoalRequest {
            title: "Ship".into(),
            parent_type: "task".into(),
            parent_id: task.id,
            ..Default::default()
        },
    )
    .await
    .unwrap_err();
    let wire = serde_json::to_value(&refused).unwrap();
    assert_eq!(wire["kind"], "invalid_request");
    assert_eq!(wire["message"], "a goal cannot hang under a task");
}

/// A reference names every domains-table row `domain` (Task 13c), so the kind of such a parent is
/// read from its row's subtype, not from how the request spelled it: a Goal asked for under a Tag
/// spelled `domain` is refused as under a Tag, and one under a Project spelled `aspect` is written
/// — and stored as `domain`.
#[tokio::test]
async fn a_domains_table_parent_is_the_kind_its_subtype_says_however_it_is_spelled() {
    use arlesh_lib::{commands::tasks as task_commands, tasks::model::CreateGoalRequest};
    use tauri::Manager;

    let pool = crate::helpers::test_pool().await;
    let app = crate::helpers::command_host(&pool);
    sqlx::query(
        "INSERT INTO domains (id, title, subtype, parent_id) VALUES
             (100, 'Label', 'tag', NULL), (101, 'Engines', 'project', 1)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let refused = task_commands::create_goal(
        app.state(),
        CreateGoalRequest {
            title: "Ship".into(),
            parent_type: "domain".into(),
            parent_id: 100.into(),
            ..Default::default()
        },
    )
    .await
    .unwrap_err();
    let wire = serde_json::to_value(&refused).unwrap();
    assert_eq!(wire["message"], "a goal cannot hang under a tag");

    let goal = task_commands::create_goal(
        app.state(),
        CreateGoalRequest {
            title: "Ship".into(),
            parent_type: "aspect".into(),
            parent_id: 101.into(),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(goal.parent_type, "domain");
}
