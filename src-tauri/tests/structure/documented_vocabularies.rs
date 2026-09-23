//! Pins the enumerable claims the design documents make against the code and the migrations.
//!
//! These are the claims that drifted: the spec named the Aspects Red / Purple / Green / Blue /
//! Gray / Steel from migration 3 — which renamed them — onwards, and the glossary gave Project
//! status a vocabulary the `domains.status` CHECK never accepted. Prose cannot be tested; a list
//! of values can. The frontend constants are pinned by `src/utils/documented-vocabularies.test.ts`.
//!
//! Each vocabulary is listed through an exhaustive `match`, so a variant added to an enum fails to
//! compile here until the documents are looked at.

use crate::helpers;

use arlesh_lib::{
    domains::model::ProjectStatus,
    tasks::model::{GoalStatus, TaskStatus, Verdict},
};

const CONTEXT: &str = include_str!("../../../CONTEXT.md");
const RESOURCES: &str = include_str!("../../../docs/spec/resources.md");

/// The backticked values on the glossary line that opens with `**{label}:**`, in order.
fn documented_values(label: &str) -> Vec<String> {
    let prefix = format!("**{label}:**");
    let line = CONTEXT
        .lines()
        .find(|line| line.starts_with(&prefix))
        .unwrap_or_else(|| panic!("CONTEXT.md has no {label:?} line"));
    line.split('`')
        .skip(1)
        .step_by(2)
        .map(str::to_owned)
        .collect()
}

fn task_statuses() -> Vec<&'static str> {
    [TaskStatus::Todo, TaskStatus::InProgress, TaskStatus::Done]
        .iter()
        .map(|status| match status {
            TaskStatus::Todo | TaskStatus::InProgress | TaskStatus::Done => status.as_str(),
        })
        .collect()
}

fn goal_statuses() -> Vec<&'static str> {
    [
        GoalStatus::Active,
        GoalStatus::Achieved,
        GoalStatus::Frozen,
        GoalStatus::Archived,
    ]
    .iter()
    .map(|status| match status {
        GoalStatus::Active | GoalStatus::Achieved | GoalStatus::Frozen | GoalStatus::Archived => {
            status.as_str()
        }
    })
    .collect()
}

fn project_statuses() -> Vec<&'static str> {
    [
        ProjectStatus::Active,
        ProjectStatus::Achieved,
        ProjectStatus::Frozen,
        ProjectStatus::Archived,
    ]
    .iter()
    .map(|status| match status {
        ProjectStatus::Active
        | ProjectStatus::Achieved
        | ProjectStatus::Frozen
        | ProjectStatus::Archived => status.as_str(),
    })
    .collect()
}

fn verdicts() -> Vec<&'static str> {
    [Verdict::Unresolved, Verdict::Kept, Verdict::Broken]
        .iter()
        .map(|verdict| match verdict {
            Verdict::Unresolved | Verdict::Kept | Verdict::Broken => verdict.as_str(),
        })
        .collect()
}

#[test]
fn context_lists_the_task_statuses_the_enum_has() {
    assert_eq!(documented_values("Task status"), task_statuses());
}

#[test]
fn context_lists_the_goal_statuses_the_enum_has() {
    assert_eq!(documented_values("Goal status"), goal_statuses());
}

#[test]
fn context_lists_the_project_statuses_the_enum_has() {
    assert_eq!(documented_values("Project status"), project_statuses());
}

#[test]
fn context_lists_the_verdicts_the_enum_has() {
    assert_eq!(documented_values("Commitment verdict"), verdicts());
}

/// The six Aspects as the migrations seed them, in seeding order.
async fn seeded_aspect_titles() -> Vec<String> {
    let pool = helpers::test_pool().await;
    sqlx::query_scalar("SELECT title FROM domains WHERE subtype = 'aspect' ORDER BY id")
        .fetch_all(&pool)
        .await
        .expect("aspects should be readable")
}

/// The first column of the Aspects table in `resources.md`, header excluded.
fn resources_aspect_names() -> Vec<String> {
    RESOURCES
        .lines()
        .skip_while(|line| !line.starts_with("| Name"))
        .skip(2)
        .take_while(|line| line.starts_with('|'))
        .filter_map(|line| line.split('|').nth(1))
        .map(|cell| cell.trim().to_owned())
        .collect()
}

/// The parenthesised list in CONTEXT.md's **Aspect** entry.
fn context_aspect_names() -> Vec<String> {
    let entry = CONTEXT
        .lines()
        .find(|line| line.starts_with("**Aspect**"))
        .expect("CONTEXT.md has an Aspect entry");
    let list = entry
        .split_once('(')
        .and_then(|(_, rest)| rest.split_once(')'))
        .map(|(inside, _)| inside)
        .expect("the Aspect entry names the six in parentheses");
    list.split(',').map(|name| name.trim().to_owned()).collect()
}

#[tokio::test]
async fn resources_names_the_aspects_the_migrations_seed() {
    assert_eq!(resources_aspect_names(), seeded_aspect_titles().await);
}

#[tokio::test]
async fn context_names_the_aspects_the_migrations_seed() {
    assert_eq!(context_aspect_names(), seeded_aspect_titles().await);
}
