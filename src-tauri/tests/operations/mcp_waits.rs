//! Listing waits cheaply, and how the snapshot's `expectations` section reads under a filter.

use crate::helpers;
use helpers::StoredId;

use arlesh_lib::access::model::NodeTable;
use arlesh_lib::commands::{
    access as access_commands, domains as domain_commands, tasks as task_commands,
};
use arlesh_lib::domains::model::{CreateDomainRequest, DomainSubtype};
use arlesh_lib::filters::model::{BoardFilter, Pill, Preset, TagMode};
use arlesh_lib::mcp::{params, ArleshMcp};
use arlesh_lib::tasks::model::CreateTaskRequest;
use rmcp::handler::server::wrapper::Parameters;
use tauri::Manager;

/// Two Projects opened to the MCP, each with an Agentic Task. The first Task holds a released
/// question, then a pending question and a pending wait on something else; the second holds one
/// pending question.
struct Fixture {
    pool: sqlx::SqlitePool,
    mcp: ArleshMcp,
    first_project: i64,
    first_task: i64,
    second_project: i64,
}

async fn project(app: &tauri::App<tauri::test::MockRuntime>, title: &str) -> i64 {
    domain_commands::create_domain(
        app.state(),
        CreateDomainRequest {
            title: title.into(),
            description: None,
            subtype: DomainSubtype::Project,
            parent_id: Some(1),
            status: None,
            knowledge_base_directory: None,
        },
    )
    .await
    .expect("create project")
    .id
}

async fn task_in(app: &tauri::App<tauri::test::MockRuntime>, project: i64, title: &str) -> i64 {
    task_commands::create_task(
        app.state(),
        CreateTaskRequest {
            title: title.into(),
            parent_type: "project".into(),
            parent_id: project.into(),
            ..Default::default()
        },
    )
    .await
    .expect("create task")
    .id
    .sid()
}

async fn wait(mcp: &ArleshMcp, task: i64, title: &str, question: bool) -> serde_json::Value {
    let answer = mcp
        .waits(Parameters(params::WaitsOperation::Raise {
            task_id: task.into(),
            title: title.into(),
            note: Some(format!("the long note of {title}")),
            question,
            verbose: None,
        }))
        .await
        .expect("the waits tool returned no result");
    assert_ne!(
        answer.is_error,
        Some(true),
        "{:?}",
        answer.structured_content
    );
    answer.structured_content.expect("structured")
}

async fn fixture() -> Fixture {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let first_project = project(&app, "First").await;
    let second_project = project(&app, "Second").await;
    for root in [first_project, second_project] {
        access_commands::add_mcp_root(app.state(), NodeTable::Domain, root)
            .await
            .expect("add MCP root");
    }
    let first_task = task_in(&app, first_project, "First work").await;
    let second_task = task_in(&app, second_project, "Second work").await;
    helpers::make_agentic(&pool, first_task).await;
    helpers::make_agentic(&pool, second_task).await;
    let mcp = ArleshMcp::new(helpers::session_factory(&pool));
    let old = wait(&mcp, first_task, "Old question", true).await;
    let released = mcp
        .waits(Parameters(params::WaitsOperation::Release {
            id: old["id"].as_i64().expect("id").into(),
            answer: Some("done".into()),
            verdict: None,
            verbose: None,
        }))
        .await
        .expect("the waits tool returned no result");
    assert_ne!(
        released.is_error,
        Some(true),
        "{:?}",
        released.structured_content
    );
    wait(&mcp, first_task, "Pending question", true).await;
    wait(&mcp, first_task, "CI on the PR", false).await;
    wait(&mcp, second_task, "Other question", true).await;
    Fixture {
        pool,
        mcp,
        first_project,
        first_task,
        second_project,
    }
}

/// The titles of the snapshot's `expectations`, in the order it sends them.
async fn expectation_titles(mcp: &ArleshMcp, filter: Option<BoardFilter>) -> Vec<String> {
    let answer = mcp
        .snapshot(Parameters(params::SnapshotOperation::Load {
            now: None,
            sections: Some(vec![arlesh_lib::mcp::paging::Section::Expectations]),
            cursor: None,
            filter,
            agentic: None,
        }))
        .await
        .expect("the snapshot tool returned no result");
    answer.structured_content.expect("structured")["expectations"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|row| row["title"].as_str().unwrap_or("").to_string())
        .collect()
}

fn waits_filter(under: Option<String>) -> BoardFilter {
    let mut filter = BoardFilter::preset(Preset::All);
    filter.expectations = true;
    if let Some(under) = under {
        filter.pills.antecedent.push(Pill {
            value: under,
            mode: TagMode::Any,
        });
    }
    filter
}

/// As designed, not a bug: without a pill the snapshot narrows as the Mindmap does, which ignores
/// the List View's Expectations option, so every wait still comes back.
#[tokio::test]
async fn the_expectations_option_alone_does_not_narrow_the_snapshot() {
    let fixture = fixture().await;
    let everything = expectation_titles(&fixture.mcp, None).await;
    let option = expectation_titles(&fixture.mcp, Some(waits_filter(None))).await;
    assert_eq!(option, everything);
    assert_eq!(option.len(), 4, "the released wait is still there");
}

/// As designed, not a bug: under a pill the read is the List View's, which draws no agentic wait,
/// and a Task is not a row under the option, so no agentic wait travels with one.
#[tokio::test]
async fn the_expectations_option_with_an_under_pill_finds_no_agentic_wait() {
    let fixture = fixture().await;
    let project = project_full_id(&fixture.mcp, fixture.first_project).await;
    let pill = format!("domain-{}", fixture.first_project);
    let found = expectation_titles(&fixture.mcp, Some(waits_filter(Some(pill)))).await;
    assert!(found.is_empty(), "{found:?}");
    let listed = list(&fixture.mcp, listing(None, Some(project), None)).await;
    assert_eq!(titles(&listed), ["Pending question", "CI on the PR"]);
}

async fn list(mcp: &ArleshMcp, operation: params::WaitsOperation) -> serde_json::Value {
    let answer = mcp
        .waits(Parameters(operation))
        .await
        .expect("the waits tool returned no result");
    assert_ne!(
        answer.is_error,
        Some(true),
        "{:?}",
        answer.structured_content
    );
    answer.structured_content.expect("structured")
}

fn listing(
    status: Option<params::WaitStatusParam>,
    under: Option<String>,
    question: Option<bool>,
) -> params::WaitsOperation {
    params::WaitsOperation::List {
        status,
        under: under.map(Into::into),
        question,
        cursor: None,
    }
}

fn titles(listed: &serde_json::Value) -> Vec<String> {
    listed["waits"]
        .as_array()
        .expect("waits")
        .iter()
        .map(|row| row["title"].as_str().unwrap_or("").to_string())
        .collect()
}

#[tokio::test]
async fn list_answers_the_pending_waits_by_default_with_cheap_rows() {
    let fixture = fixture().await;
    let listed = list(&fixture.mcp, listing(None, None, None)).await;
    assert_eq!(
        titles(&listed),
        ["Pending question", "CI on the PR", "Other question"]
    );
    assert!(listed["next_cursor"].is_null());
    let row = &listed["waits"][0];
    assert_eq!(row["status"], "pending");
    assert_eq!(row["question"], true);
    assert_eq!(row["task"]["title"], "First work");
    assert_eq!(row["task"]["id"], fixture.first_task);
    for field in ["id", "short_id", "full_id"] {
        assert!(row[field].is_string() || row[field].is_number(), "{field}");
        assert!(row["task"][field].is_string() || row["task"][field].is_number());
    }
    assert!(row.get("agentic_note").is_none(), "the note is get's");
    assert!(row.get("answer").is_none(), "the answer is get's");
}

#[tokio::test]
async fn list_filters_by_status_and_kind() {
    use params::WaitStatusParam::{All, Released};
    let fixture = fixture().await;
    let released = list(&fixture.mcp, listing(Some(Released), None, None)).await;
    assert_eq!(titles(&released), ["Old question"]);
    let all = list(&fixture.mcp, listing(Some(All), None, None)).await;
    assert_eq!(all["waits"].as_array().expect("waits").len(), 4);
    let questions = list(&fixture.mcp, listing(None, None, Some(true))).await;
    assert_eq!(titles(&questions), ["Pending question", "Other question"]);
    let others = list(&fixture.mcp, listing(None, None, Some(false))).await;
    assert_eq!(titles(&others), ["CI on the PR"]);
}

/// The full id the snapshot gives the Project `id`: a row id alone could name a Task as well.
async fn project_full_id(mcp: &ArleshMcp, id: i64) -> String {
    let answer = mcp
        .snapshot(Parameters(params::SnapshotOperation::Load {
            now: None,
            sections: Some(vec![arlesh_lib::mcp::paging::Section::Domains]),
            cursor: None,
            filter: None,
            agentic: None,
        }))
        .await
        .expect("the snapshot tool returned no result");
    answer.structured_content.expect("structured")["domains"]
        .as_array()
        .and_then(|rows| rows.iter().find(|row| row["id"] == id))
        .and_then(|row| row["full_id"].as_str())
        .map(str::to_string)
        .expect("the project is on the board")
}

#[tokio::test]
async fn list_under_a_project_or_a_task_keeps_only_waits_beneath_it() {
    let fixture = fixture().await;
    let first = project_full_id(&fixture.mcp, fixture.first_project).await;
    let under_first = list(&fixture.mcp, listing(None, Some(first), None)).await;
    assert_eq!(titles(&under_first), ["Pending question", "CI on the PR"]);
    let second = project_full_id(&fixture.mcp, fixture.second_project).await;
    let under_second = list(&fixture.mcp, listing(None, Some(second), None)).await;
    assert_eq!(titles(&under_second), ["Other question"]);
    let task = under_first["waits"][0]["task"]["full_id"]
        .as_str()
        .expect("the Task's full id")
        .to_string();
    let under_task = list(&fixture.mcp, listing(None, Some(task), None)).await;
    assert_eq!(titles(&under_task), ["Pending question", "CI on the PR"]);
}

#[tokio::test]
async fn list_is_cut_to_the_mcp_roots_and_refuses_an_unseen_under() {
    let fixture = fixture().await;
    let outside = sqlx::query_scalar::<_, i64>("SELECT MAX(id) + 1000 FROM domains")
        .fetch_one(&fixture.pool)
        .await
        .expect("an id nobody has");
    let answer = fixture
        .mcp
        .waits(Parameters(listing(None, Some(outside.to_string()), None)))
        .await
        .expect("the waits tool returned no result");
    assert_eq!(answer.is_error, Some(true));
}

#[tokio::test]
async fn the_snapshot_sends_pending_waits_before_released_ones() {
    let fixture = fixture().await;
    let all = expectation_titles(&fixture.mcp, None).await;
    assert_eq!(
        all,
        [
            "Pending question",
            "CI on the PR",
            "Other question",
            "Old question"
        ]
    );
}

#[tokio::test]
async fn a_write_answers_briefly_unless_asked_for_the_whole_row() {
    let fixture = fixture().await;
    let raised = wait(&fixture.mcp, fixture.first_task, "Brief one", true).await;
    for field in [
        "id",
        "short_id",
        "full_id",
        "title",
        "status",
        "question",
        "task_id",
        "task_short_id",
    ] {
        assert!(!raised[field].is_null(), "{field}");
    }
    assert!(raised.get("agentic_note").is_none());
    let verbose = fixture
        .mcp
        .waits(Parameters(params::WaitsOperation::Raise {
            task_id: fixture.first_task.into(),
            title: "Whole one".into(),
            note: Some("kept".into()),
            question: true,
            verbose: Some(true),
        }))
        .await
        .expect("the waits tool returned no result");
    assert_eq!(
        verbose.structured_content.expect("structured")["agentic_note"],
        "kept"
    );
}
