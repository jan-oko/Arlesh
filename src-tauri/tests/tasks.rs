mod helpers;

// Aliased rather than imported by name: several command functions share a name with a test below
// (`delete_task`, `delete_goal`), and the alias keeps the call sites saying which one they mean.
// The free functions `delete_task`/`delete_goal` collide the same way, so those two are reached
// through their full path (`arlesh_lib::tasks::delete_task`/`delete_goal`) at the call site
// instead of being imported bare.
use arlesh_lib::commands::tasks as task_commands;
use arlesh_lib::{
    database::session::SessionFactory,
    domains::model::{CreateDomainRequest, DomainSubtype, ProjectStatus},
    scopes::model::ScopeKind,
    tasks::{
        add_task_dependency, conflicts_for_new_time_scope, create_goal, create_task,
        derive_all_scope_lifecycles, get_task_with_blockers,
        lifecycle::{Archival, Resolution, Timing},
        model::{
            CreateGoalRequest, CreateTaskRequest, Dependency, DurationSpec, GoalStatus, OnScopeExit,
            TaskStatus, TimeScope, UpdateGoalRequest, UpdateTaskRequest,
        },
        reparent_conflicts, update_goal, update_task,
    },
};
use chrono::NaiveDate;
use tauri::Manager;

async fn make_project(pool: &sqlx::SqlitePool) -> i64 {
    let aspect_id: i64 =
        sqlx::query_scalar("SELECT id FROM domains WHERE title = 'Growth' AND subtype = 'aspect'")
            .fetch_one(pool)
            .await
            .unwrap();
    helpers::session_factory(pool).connect().await.unwrap().domains().create(CreateDomainRequest {
            title: "Test Project".into(),
            description: None,
            subtype: DomainSubtype::Project,
            parent_id: Some(aspect_id),
            status: Some(ProjectStatus::Active),
            knowledge_base_directory: None,
        })
        .await
        .unwrap()
        .id
}

async fn make_tag(pool: &sqlx::SqlitePool) -> i64 {
    let aspect_id: i64 =
        sqlx::query_scalar("SELECT id FROM domains WHERE title = 'Growth' AND subtype = 'aspect'")
            .fetch_one(pool)
            .await
            .unwrap();
    helpers::session_factory(pool).connect().await.unwrap().domains().create(CreateDomainRequest {
            title: "test-tag".into(),
            description: None,
            subtype: DomainSubtype::Tag,
            parent_id: Some(aspect_id),
            status: None,
            knowledge_base_directory: None,
        })
        .await
        .unwrap()
        .id
}

#[tokio::test]
async fn create_task_and_goal() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(&mut db, CreateTaskRequest {
            title: "Write tests".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    assert_eq!(task.title, "Write tests");
    assert_eq!(task.status, "todo");
    assert!(task.tag_ids.is_empty());

    let goal = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_goal(&mut db, CreateGoalRequest {
            title: "Ship Phase 1".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    assert_eq!(goal.status, "active");
    assert!(goal.tag_ids.is_empty());
}

#[tokio::test]
async fn undone_dependency_blocks_task() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let dependency = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(&mut db, CreateTaskRequest {
            title: "Dependency".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(&mut db, CreateTaskRequest {
            title: "Blocked Task".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = add_task_dependency(&mut db, task.id.into(), Dependency::Task { id: dependency.id }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    let with_blockers = {
        let mut db = helpers::session_factory(&pool).connect().await.unwrap();
        get_task_with_blockers(&mut db, task.id.into()).await
    }.unwrap();
    assert_eq!(with_blockers.block_reasons.len(), 1);
    assert!(with_blockers.block_reasons[0].contains("Dependency"));
}

#[tokio::test]
async fn done_dependency_unblocks_task() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let dependency = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(&mut db, CreateTaskRequest {
            title: "Dep".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(&mut db, CreateTaskRequest {
            title: "Task".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = add_task_dependency(&mut db, task.id.into(), Dependency::Task { id: dependency.id }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = update_task(&mut db,
            dependency.id.into(),
            UpdateTaskRequest {
                status: Some(arlesh_lib::tasks::model::TaskStatus::Done),
                ..Default::default()
            },
        ).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    let with_blockers = {
        let mut db = helpers::session_factory(&pool).connect().await.unwrap();
        get_task_with_blockers(&mut db, task.id.into()).await
    }.unwrap();
    assert!(with_blockers.block_reasons.is_empty(), "should be unblocked");
}

#[tokio::test]
async fn circular_dependency_rejected() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let task_a = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(&mut db, CreateTaskRequest {
            title: "A".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    let task_b = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(&mut db, CreateTaskRequest {
            title: "B".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = add_task_dependency(&mut db, task_a.id.into(), Dependency::Task { id: task_b.id }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    let err = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = add_task_dependency(&mut db, task_b.id.into(), Dependency::Task { id: task_a.id }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap_err();

    assert!(
        matches!(err, arlesh_lib::tasks::error::TaskError::CircularDependency),
        "expected CircularDependency, got {:?}",
        err
    );
}

#[tokio::test]
async fn goal_dependency_blocks_task_until_achieved() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let goal = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_goal(&mut db, CreateGoalRequest {
            title: "The Goal".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(&mut db, CreateTaskRequest {
            title: "Task".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = add_task_dependency(&mut db, task.id.into(), Dependency::Goal { id: goal.id }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    let blocked = {
        let mut db = helpers::session_factory(&pool).connect().await.unwrap();
        get_task_with_blockers(&mut db, task.id.into()).await
    }.unwrap();
    assert_eq!(blocked.block_reasons.len(), 1);

    {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = update_goal(&mut db,
            goal.id.into(),
            UpdateGoalRequest {
                status: Some(GoalStatus::Achieved),
                ..Default::default()
            },
        ).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    let unblocked = {
        let mut db = helpers::session_factory(&pool).connect().await.unwrap();
        get_task_with_blockers(&mut db, task.id.into()).await
    }.unwrap();
    assert!(unblocked.block_reasons.is_empty());
}

#[tokio::test]
async fn reparent_task_to_different_project() {
    let pool = helpers::test_pool().await;
    let project_a_id = make_project(&pool).await;
    let aspect_id: i64 =
        sqlx::query_scalar("SELECT id FROM domains WHERE title = 'Growth' AND subtype = 'aspect'")
            .fetch_one(&pool)
            .await
            .unwrap();
    let project_b_id = helpers::session_factory(&pool).connect().await.unwrap().domains().create(CreateDomainRequest {
            title: "Project B".into(),
            description: None,
            subtype: DomainSubtype::Project,
            parent_id: Some(aspect_id),
            status: Some(ProjectStatus::Active),
            knowledge_base_directory: None,
        })
        .await
        .unwrap()
        .id;

    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(&mut db, CreateTaskRequest {
            title: "Movable Task".into(),
            parent_type: "project".into(),
            parent_id: project_a_id,
            status: None,
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    assert_eq!(task.parent_id, project_a_id);

    let moved = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = update_task(&mut db,
            task.id.into(),
            UpdateTaskRequest {
                parent_type: Some("project".into()),
                parent_id: Some(project_b_id),
                ..Default::default()
            },
        ).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    assert_eq!(moved.parent_id, project_b_id);
}

#[tokio::test]
async fn add_and_remove_tag_on_task() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let tag_id = make_tag(&pool).await;

    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(&mut db, CreateTaskRequest {
            title: "Tagged Task".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    assert!(task.tag_ids.is_empty());

    helpers::session_factory(&pool).connect().await.unwrap().tasks().add_tag(task.id.into(), tag_id).await.unwrap();
    let tagged = helpers::session_factory(&pool).connect().await.unwrap().tasks().get(task.id.into()).await.unwrap();
    assert_eq!(tagged.tag_ids, vec![tag_id]);

    helpers::session_factory(&pool).connect().await.unwrap().tasks().remove_tag(task.id.into(), tag_id).await.unwrap();
    let untagged = helpers::session_factory(&pool).connect().await.unwrap().tasks().get(task.id.into()).await.unwrap();
    assert!(untagged.tag_ids.is_empty());
}

#[tokio::test]
async fn list_tasks_includes_tag_ids() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let tag_id = make_tag(&pool).await;

    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(&mut db, CreateTaskRequest {
            title: "Task With Tag".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    helpers::session_factory(&pool).connect().await.unwrap().tasks().add_tag(task.id.into(), tag_id).await.unwrap();

    let all_tasks = helpers::session_factory(&pool).connect().await.unwrap().tasks().list().await.unwrap();
    let found = all_tasks.iter().find(|t| t.id == task.id).unwrap();
    assert_eq!(found.tag_ids, vec![tag_id]);
}

#[tokio::test]
async fn update_task_title() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(&mut db, CreateTaskRequest {
            title: "Old Title".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    let updated = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = update_task(&mut db,
            task.id.into(),
            UpdateTaskRequest { title: Some("New Title".into()), ..Default::default() },
        ).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    assert_eq!(updated.title, "New Title");
}

#[tokio::test]
async fn delete_task() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(&mut db, CreateTaskRequest {
            title: "Doomed Task".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = arlesh_lib::tasks::delete_task(&mut db, task.id.into()).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }.unwrap();

    let err = helpers::session_factory(&pool).connect().await.unwrap().tasks().get(task.id.into()).await.unwrap_err();
    assert!(
        matches!(err, arlesh_lib::tasks::error::TaskError::TaskNotFound(_)),
        "expected TaskNotFound, got {:?}",
        err
    );
}

#[tokio::test]
async fn remove_dependency() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let dep = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(&mut db, CreateTaskRequest {
            title: "Dep".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(&mut db, CreateTaskRequest {
            title: "Task".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = add_task_dependency(&mut db, task.id.into(), Dependency::Task { id: dep.id }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();
    helpers::session_factory(&pool).connect().await.unwrap().tasks().remove_dependency(task.id.into(), Dependency::Task { id: dep.id })
        .await
        .unwrap();

    let deps = helpers::session_factory(&pool).connect().await.unwrap().tasks().list_dependencies(task.id.into()).await.unwrap();
    assert!(deps.is_empty());
}

#[tokio::test]
async fn update_goal_title() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let goal = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_goal(&mut db, CreateGoalRequest {
            title: "Old Goal".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    let updated = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = update_goal(&mut db,
            goal.id.into(),
            UpdateGoalRequest { title: Some("New Goal".into()), ..Default::default() },
        ).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    assert_eq!(updated.title, "New Goal");
}

#[tokio::test]
async fn delete_goal() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let goal = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_goal(&mut db, CreateGoalRequest {
            title: "Doomed Goal".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = arlesh_lib::tasks::delete_goal(&mut db, goal.id.into()).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }.unwrap();

    let err = helpers::session_factory(&pool).connect().await.unwrap().goals().get(goal.id.into()).await.unwrap_err();
    assert!(
        matches!(err, arlesh_lib::tasks::error::TaskError::GoalNotFound(_)),
        "expected GoalNotFound, got {:?}",
        err
    );
}

#[tokio::test]
async fn add_and_remove_tag_on_goal() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let tag_id = make_tag(&pool).await;

    let goal = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_goal(&mut db, CreateGoalRequest {
            title: "Tagged Goal".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    assert!(goal.tag_ids.is_empty());

    helpers::session_factory(&pool).connect().await.unwrap().goals().add_tag(goal.id.into(), tag_id).await.unwrap();
    let tagged = helpers::session_factory(&pool).connect().await.unwrap().goals().get(goal.id.into()).await.unwrap();
    assert_eq!(tagged.tag_ids, vec![tag_id]);

    helpers::session_factory(&pool).connect().await.unwrap().goals().remove_tag(goal.id.into(), tag_id).await.unwrap();
    let untagged = helpers::session_factory(&pool).connect().await.unwrap().goals().get(goal.id.into()).await.unwrap();
    assert!(untagged.tag_ids.is_empty());
}

#[tokio::test]
async fn list_goals_includes_tag_ids() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let tag_id = make_tag(&pool).await;

    let goal = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_goal(&mut db, CreateGoalRequest {
            title: "Goal With Tag".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    helpers::session_factory(&pool).connect().await.unwrap().goals().add_tag(goal.id.into(), tag_id).await.unwrap();

    let all_goals = helpers::session_factory(&pool).connect().await.unwrap().goals().list().await.unwrap();
    let found = all_goals.iter().find(|g| g.id == goal.id).unwrap();
    assert_eq!(found.tag_ids, vec![tag_id]);
}

#[tokio::test]
async fn reparent_goal_to_different_project() {
    let pool = helpers::test_pool().await;
    let project_a_id = make_project(&pool).await;
    let aspect_id: i64 =
        sqlx::query_scalar("SELECT id FROM domains WHERE title = 'Growth' AND subtype = 'aspect'")
            .fetch_one(&pool)
            .await
            .unwrap();
    let project_b_id = helpers::session_factory(&pool).connect().await.unwrap().domains().create(CreateDomainRequest {
            title: "Project B".into(),
            description: None,
            subtype: DomainSubtype::Project,
            parent_id: Some(aspect_id),
            status: Some(ProjectStatus::Active),
            knowledge_base_directory: None,
        })
        .await
        .unwrap()
        .id;

    let goal = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_goal(&mut db, CreateGoalRequest {
            title: "Movable Goal".into(),
            parent_type: "project".into(),
            parent_id: project_a_id,
            status: None,
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    assert_eq!(goal.parent_id, project_a_id);

    let moved = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = update_goal(&mut db,
            goal.id.into(),
            UpdateGoalRequest {
                parent_type: Some("project".into()),
                parent_id: Some(project_b_id),
                ..Default::default()
            },
        ).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    assert_eq!(moved.parent_id, project_b_id);
}

#[tokio::test]
async fn update_task_status_to_in_progress() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(&mut db, CreateTaskRequest {
            title: "In Progress Task".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    assert_eq!(task.status, "todo");

    let updated = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = update_task(&mut db,
            task.id.into(),
            UpdateTaskRequest { status: Some(TaskStatus::InProgress), ..Default::default() },
        ).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    assert_eq!(updated.status, "in_progress");
}

#[tokio::test]
async fn update_task_blocked_reason() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(&mut db, CreateTaskRequest {
            title: "Blockable Task".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = db.block_reasons().set("task", task.id, &["Waiting on design".into(), "Needs review".into()]).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();
    assert_eq!(
        helpers::session_factory(&pool).connect().await.unwrap().block_reasons().list_for("task", task.id).await.unwrap(),
        vec!["Waiting on design".to_string(), "Needs review".to_string()],
    );

    // Setting an empty list clears them; blank reasons are dropped.
    {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = db.block_reasons().set("task", task.id, &[String::new(), "   ".into()]).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }.unwrap();
    assert!(helpers::session_factory(&pool).connect().await.unwrap().block_reasons().list_for("task", task.id).await.unwrap().is_empty());
}

#[tokio::test]
async fn explicit_block_reason_surfaces_in_get_with_blockers() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(&mut db, CreateTaskRequest {
            title: "Blocked Task".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = db.block_reasons().set("task", task.id, &["Explicit reason".into()]).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    let with_blockers = {
        let mut db = helpers::session_factory(&pool).connect().await.unwrap();
        get_task_with_blockers(&mut db, task.id.into()).await
    }.unwrap();
    assert!(with_blockers.block_reasons.iter().any(|r| r.contains("Explicit reason")));
}

#[tokio::test]
async fn update_task_scope() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let scope = helpers::session_factory(&pool).connect().await.unwrap().scopes().get_or_create(ScopeKind::Day, chrono::NaiveDate::from_ymd_opt(2026, 7, 1).unwrap())
        .await
        .unwrap();

    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(&mut db, CreateTaskRequest {
            title: "Scoped Task".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    assert!(task.time_scope.is_none());

    let updated = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = update_task(&mut db,
            task.id.into(),
            UpdateTaskRequest {
                time_scope: Some(Some(TimeScope {
                    start_id: scope.id,
                    end_id: scope.id,
                    duration: None,
                })),
                ..Default::default()
            },
        ).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    let time_scope = updated.time_scope.expect("time scope set");
    assert_eq!(time_scope.start_id, scope.id);
    assert_eq!(time_scope.end_id, scope.id);
}

#[tokio::test]
async fn task_time_scope_duration_params_round_trip() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let scope = helpers::session_factory(&pool).connect().await.unwrap().scopes().get_or_create(ScopeKind::Week, chrono::NaiveDate::from_ymd_opt(2026, 7, 1).unwrap())
        .await
        .unwrap();

    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(&mut db, CreateTaskRequest {
            title: "Duration Task".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(TimeScope {
                start_id: scope.id,
                end_id: scope.id,
                duration: Some(DurationSpec { n: 3, kind: "week".into() }),
            }),
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    // The snapshotted window persists alongside the remembered duration parameters.
    let duration = task.time_scope.and_then(|ts| ts.duration).expect("duration kept");
    assert_eq!(duration.n, 3);
    assert_eq!(duration.kind, "week");
}

#[tokio::test]
async fn task_plan_is_independent_of_time_scope() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let week = helpers::session_factory(&pool).connect().await.unwrap().scopes().get_or_create(ScopeKind::Week, chrono::NaiveDate::from_ymd_opt(2026, 7, 1).unwrap())
        .await
        .unwrap();
    let day = helpers::session_factory(&pool).connect().await.unwrap().scopes().get_or_create(ScopeKind::Day, chrono::NaiveDate::from_ymd_opt(2026, 7, 1).unwrap())
        .await
        .unwrap();

    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(&mut db, CreateTaskRequest {
            title: "Planned Task".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(TimeScope { start_id: week.id, end_id: week.id, duration: None }),
            plan: Some(single(day.id)),
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    assert_eq!(task.time_scope.expect("time scope").start_id, week.id);
    assert_eq!(task.plan.map(|p| (p.start_id, p.end_id)), Some((day.id, day.id)));

    // Clearing the Plan leaves the Time Scope intact.
    let cleared = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = update_task(&mut db,
            task.id.into(),
            UpdateTaskRequest { plan: Some(None), ..Default::default() },
        ).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();
    assert!(cleared.plan.is_none());
    assert!(cleared.time_scope.is_some(), "clearing Plan must not clear Time Scope");
}

#[tokio::test]
async fn plan_within_time_scope_is_accepted() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    // 2026-07-01 (Wed) sits inside its own Sun–Sat week.
    let week = helpers::session_factory(&pool).connect().await.unwrap().scopes().get_or_create(ScopeKind::Week, chrono::NaiveDate::from_ymd_opt(2026, 7, 1).unwrap())
        .await
        .unwrap();
    let day = helpers::session_factory(&pool).connect().await.unwrap().scopes().get_or_create(ScopeKind::Day, chrono::NaiveDate::from_ymd_opt(2026, 7, 1).unwrap())
        .await
        .unwrap();

    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(&mut db, CreateTaskRequest {
            title: "Planned".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(TimeScope { start_id: week.id, end_id: week.id, duration: None }),
            plan: Some(single(day.id)),
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();
    assert_eq!(task.plan.map(|p| (p.start_id, p.end_id)), Some((day.id, day.id)));
}

#[tokio::test]
async fn plan_outside_time_scope_is_rejected() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let week = helpers::session_factory(&pool).connect().await.unwrap().scopes().get_or_create(ScopeKind::Week, chrono::NaiveDate::from_ymd_opt(2026, 7, 1).unwrap())
        .await
        .unwrap();
    // A day three weeks later is not contained in the time-scope week.
    let far_day = helpers::session_factory(&pool).connect().await.unwrap().scopes().get_or_create(ScopeKind::Day, chrono::NaiveDate::from_ymd_opt(2026, 7, 20).unwrap())
        .await
        .unwrap();

    let result = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(&mut db, CreateTaskRequest {
            title: "Bad plan".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(TimeScope { start_id: week.id, end_id: week.id, duration: None }),
            plan: Some(single(far_day.id)),
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    };

    assert!(
        matches!(result, Err(arlesh_lib::tasks::error::TaskError::ScopeContainment(_))),
        "plan outside the time scope should be rejected, got {result:?}",
    );
}

// --- Cross-tree containment (child within ancestor, cascade detection, reparent) ---

fn single(scope_id: i64) -> TimeScope {
    TimeScope { start_id: scope_id, end_id: scope_id, duration: None }
}

async fn july_scopes(
    pool: &sqlx::SqlitePool,
) -> (i64, i64, i64) {
    let july = helpers::session_factory(pool).connect().await.unwrap().scopes().get_or_create(ScopeKind::Month, chrono::NaiveDate::from_ymd_opt(2026, 7, 15).unwrap())
        .await
        .unwrap();
    let week_in_july = helpers::session_factory(pool).connect().await.unwrap().scopes().get_or_create(ScopeKind::Week, chrono::NaiveDate::from_ymd_opt(2026, 7, 15).unwrap())
        .await
        .unwrap();
    let week_in_august = helpers::session_factory(pool).connect().await.unwrap().scopes().get_or_create(ScopeKind::Week, chrono::NaiveDate::from_ymd_opt(2026, 8, 15).unwrap())
        .await
        .unwrap();
    (july.id, week_in_july.id, week_in_august.id)
}

#[tokio::test]
async fn child_time_scope_within_ancestor_is_accepted() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let (july, week_in_july, _) = july_scopes(&pool).await;

    let goal = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_goal(&mut db, CreateGoalRequest {
            title: "July Goal".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(single(july)),
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(&mut db, CreateTaskRequest {
            title: "Week Task".into(),
            parent_type: "goal".into(),
            parent_id: goal.id,
            time_scope: Some(single(week_in_july)),
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    };
    assert!(task.is_ok(), "a week inside the goal's month should be accepted: {task:?}");
}

#[tokio::test]
async fn child_time_scope_outside_ancestor_is_rejected() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let (july, _, week_in_august) = july_scopes(&pool).await;

    let goal = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_goal(&mut db, CreateGoalRequest {
            title: "July Goal".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(single(july)),
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    let result = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(&mut db, CreateTaskRequest {
            title: "August Task".into(),
            parent_type: "goal".into(),
            parent_id: goal.id,
            time_scope: Some(single(week_in_august)),
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    };
    assert!(matches!(
        result,
        Err(arlesh_lib::tasks::error::TaskError::ScopeContainment(_))
    ));
}

#[tokio::test]
async fn narrowing_a_scope_reports_violating_descendants() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let (july, week_in_july, _) = july_scopes(&pool).await;

    // Goal scoped to July, with a task child also scoped to all of July.
    let goal = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_goal(&mut db, CreateGoalRequest {
            title: "July Goal".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(single(july)),
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();
    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(&mut db, CreateTaskRequest {
            title: "Whole July Task".into(),
            parent_type: "goal".into(),
            parent_id: goal.id,
            time_scope: Some(single(july)),
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    // Narrowing the goal to a single week would orphan the month-scoped task.
    let conflicts = {
        let mut db = helpers::session_factory(&pool).connect().await.unwrap();
        conflicts_for_new_time_scope(&mut db, "goal", goal.id, &single(week_in_july)).await
    }
        .unwrap();
    assert_eq!(conflicts.len(), 1);
    assert_eq!(conflicts[0].node_type, "task");
    assert_eq!(conflicts[0].node_id, task.id);
}

#[tokio::test]
async fn reparenting_under_a_tighter_ancestor_is_rejected() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let (july, week_in_july, week_in_august) = july_scopes(&pool).await;

    let july_goal = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_goal(&mut db, CreateGoalRequest {
            title: "July Goal".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(single(july)),
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();
    let august_goal = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_goal(&mut db, CreateGoalRequest {
            title: "August Goal".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(single(week_in_august)),
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();
    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(&mut db, CreateTaskRequest {
            title: "Week Task".into(),
            parent_type: "goal".into(),
            parent_id: july_goal.id,
            time_scope: Some(single(week_in_july)),
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    // Moving the July-week task under the August goal must be rejected.
    let result = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = update_task(&mut db,
            task.id.into(),
            UpdateTaskRequest {
                parent_type: Some("goal".into()),
                parent_id: Some(august_goal.id),
                ..Default::default()
            },
        ).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    };
    assert!(matches!(
        result,
        Err(arlesh_lib::tasks::error::TaskError::ScopeContainment(_))
    ));
}

#[tokio::test]
async fn reparent_conflicts_flags_a_node_that_would_leave_its_new_ancestor() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let (july, _week_in_july, week_in_august) = july_scopes(&pool).await;

    let july_goal = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_goal(&mut db, CreateGoalRequest {
            title: "July".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(single(july)),
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();
    // A task scoped to August, currently under the (unscoped) project.
    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(&mut db, CreateTaskRequest {
            title: "August task".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(single(week_in_august)),
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    let result = {
        let mut db = helpers::session_factory(&pool).connect().await.unwrap();
        reparent_conflicts(&mut db, "task", task.id, "goal", july_goal.id).await
    }
        .unwrap();

    assert!(result.ancestor_time_scope.is_some());
    assert_eq!(result.conflicts.len(), 1);
    assert_eq!(result.conflicts[0].node_type, "task");
    assert_eq!(result.conflicts[0].node_id, task.id);
}

#[tokio::test]
async fn reparent_conflicts_empty_when_node_fits_the_new_ancestor() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let (july, week_in_july, _) = july_scopes(&pool).await;

    let july_goal = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_goal(&mut db, CreateGoalRequest {
            title: "July".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(single(july)),
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();
    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(&mut db, CreateTaskRequest {
            title: "Fits".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(single(week_in_july)),
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    let result = {
        let mut db = helpers::session_factory(&pool).connect().await.unwrap();
        reparent_conflicts(&mut db, "task", task.id, "goal", july_goal.id).await
    }
        .unwrap();
    assert!(result.conflicts.is_empty());
}

#[tokio::test]
async fn reparent_conflicts_none_under_an_unscoped_parent() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let (_, _, week_in_august) = july_scopes(&pool).await;

    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(&mut db, CreateTaskRequest {
            title: "Scoped".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(single(week_in_august)),
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    let result = {
        let mut db = helpers::session_factory(&pool).connect().await.unwrap();
        reparent_conflicts(&mut db, "task", task.id, "project", project_id).await
    }
        .unwrap();
    assert!(result.ancestor_time_scope.is_none());
    assert!(result.conflicts.is_empty());
}

#[tokio::test]
async fn update_rejects_plan_outside_time_scope() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let week = helpers::session_factory(&pool).connect().await.unwrap().scopes().get_or_create(ScopeKind::Week, chrono::NaiveDate::from_ymd_opt(2026, 7, 1).unwrap())
        .await
        .unwrap();
    let far_day = helpers::session_factory(&pool).connect().await.unwrap().scopes().get_or_create(ScopeKind::Day, chrono::NaiveDate::from_ymd_opt(2026, 7, 20).unwrap())
        .await
        .unwrap();

    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(&mut db, CreateTaskRequest {
            title: "Scoped".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(TimeScope { start_id: week.id, end_id: week.id, duration: None }),
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    let result = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = update_task(&mut db,
            task.id.into(),
            UpdateTaskRequest { plan: Some(Some(single(far_day.id))), ..Default::default() },
        ).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    };
    assert!(matches!(
        result,
        Err(arlesh_lib::tasks::error::TaskError::ScopeContainment(_))
    ));
}

#[tokio::test]
async fn update_goal_blocked_reason() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let goal = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_goal(&mut db, CreateGoalRequest {
            title: "Blockable Goal".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = db.block_reasons().set("goal", goal.id, &["Waiting on funding".into()]).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }.unwrap();
    assert_eq!(helpers::session_factory(&pool).connect().await.unwrap().block_reasons().list_for("goal", goal.id).await.unwrap(), vec!["Waiting on funding".to_string()]);

    {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = db.block_reasons().set("goal", goal.id, &[]).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }.unwrap();
    assert!(helpers::session_factory(&pool).connect().await.unwrap().block_reasons().list_for("goal", goal.id).await.unwrap().is_empty());
}

#[tokio::test]
async fn update_goal_scope() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let scope = helpers::session_factory(&pool).connect().await.unwrap().scopes().get_or_create(ScopeKind::Month, chrono::NaiveDate::from_ymd_opt(2026, 7, 1).unwrap())
        .await
        .unwrap();

    let goal = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_goal(&mut db, CreateGoalRequest {
            title: "Scoped Goal".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    let updated = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = update_goal(&mut db,
            goal.id.into(),
            UpdateGoalRequest {
                time_scope: Some(Some(TimeScope {
                    start_id: scope.id,
                    end_id: scope.id,
                    duration: None,
                })),
                ..Default::default()
            },
        ).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    let time_scope = updated.time_scope.expect("time scope set");
    assert_eq!(time_scope.start_id, scope.id);
    assert_eq!(time_scope.end_id, scope.id);
}

#[tokio::test]
async fn goal_frozen_and_archived_statuses() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let goal = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_goal(&mut db, CreateGoalRequest {
            title: "Status Goal".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    let frozen = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = update_goal(&mut db,
            goal.id.into(),
            UpdateGoalRequest { status: Some(GoalStatus::Frozen), ..Default::default() },
        ).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();
    assert_eq!(frozen.status, "frozen");

    let archived = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = update_goal(&mut db,
            goal.id.into(),
            UpdateGoalRequest { status: Some(GoalStatus::Archived), ..Default::default() },
        ).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();
    assert_eq!(archived.status, "archived");
}

#[tokio::test]
async fn goal_is_achieved() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let goal = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_goal(&mut db, CreateGoalRequest {
            title: "Achievement Goal".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    assert!(!helpers::session_factory(&pool).connect().await.unwrap().goals().is_achieved(goal.id.into()).await.unwrap());

    {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = update_goal(&mut db,
            goal.id.into(),
            UpdateGoalRequest { status: Some(GoalStatus::Achieved), ..Default::default() },
        ).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    assert!(helpers::session_factory(&pool).connect().await.unwrap().goals().is_achieved(goal.id.into()).await.unwrap());
}

// --- On-exit behavior + derived scope lifecycle (Feature A / S2) ---

async fn day_scope(pool: &sqlx::SqlitePool, y: i32, m: u32, d: u32) -> i64 {
    helpers::session_factory(pool).connect().await.unwrap().scopes().get_or_create(ScopeKind::Day, NaiveDate::from_ymd_opt(y, m, d).unwrap())
        .await
        .unwrap()
        .id
}

/// Derives every item's lifecycle over a pooled session, the way the `derive_scope_lifecycles`
/// command does. The session is dropped before returning: the test pool has one connection, and
/// the callers below go on to read it.
async fn lifecycles(
    pool: &sqlx::SqlitePool,
    now: chrono::NaiveDateTime,
) -> Vec<arlesh_lib::tasks::lifecycle::ItemLifecycle> {
    let mut db = SessionFactory::new(pool.clone()).connect().await.unwrap();
    derive_all_scope_lifecycles(&mut db, now).await.unwrap()
}

fn task_state(states: &[arlesh_lib::tasks::lifecycle::ItemLifecycle], id: i64) -> arlesh_lib::tasks::lifecycle::ItemLifecycle {
    states
        .iter()
        .find(|s| s.node_type == "task" && s.node_id == id)
        .unwrap()
        .clone()
}

#[tokio::test]
async fn scoped_item_defaults_to_keep_and_unscoped_forces_null() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let scope = day_scope(&pool, 2026, 1, 5).await;

    // Scoped without an explicit on-exit → defaults to Keep.
    let scoped = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(&mut db, CreateTaskRequest {
            title: "Scoped".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(TimeScope { start_id: scope, end_id: scope, duration: None }),
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();
    assert_eq!(scoped.on_scope_exit, Some(OnScopeExit::Keep));

    // Unscoped but an on-exit was provided → dropped (invariant: on-exit present iff scoped).
    let unscoped = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(&mut db, CreateTaskRequest {
            title: "Unscoped".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            on_scope_exit: Some(OnScopeExit::Archive),
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();
    assert_eq!(unscoped.on_scope_exit, None);
}

#[tokio::test]
async fn archive_on_exit_persists_and_clearing_scope_clears_it() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let scope = day_scope(&pool, 2026, 1, 5).await;

    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(&mut db, CreateTaskRequest {
            title: "Archive me".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(TimeScope { start_id: scope, end_id: scope, duration: None }),
            on_scope_exit: Some(OnScopeExit::Archive),
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();
    assert_eq!(task.on_scope_exit, Some(OnScopeExit::Archive));

    let cleared = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = update_task(&mut db,
            task.id.into(),
            UpdateTaskRequest { time_scope: Some(None), ..Default::default() },
        ).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();
    assert_eq!(cleared.time_scope, None);
    assert_eq!(cleared.on_scope_exit, None);
}

#[tokio::test]
async fn derives_overdue_missed_and_archives_a_completed_item() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let past = day_scope(&pool, 2026, 1, 5).await;
    let scope = || Some(TimeScope { start_id: past, end_id: past, duration: None });

    let keep = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(&mut db, CreateTaskRequest {
            title: "Keep".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: scope(),
            on_scope_exit: Some(OnScopeExit::Keep),
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();
    let archive = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(&mut db, CreateTaskRequest {
            title: "Archive".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: scope(),
            on_scope_exit: Some(OnScopeExit::Archive),
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();
    let done = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(&mut db, CreateTaskRequest {
            title: "Done".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: Some(TaskStatus::Done),
            time_scope: scope(),
            on_scope_exit: Some(OnScopeExit::Archive),
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    // Well past the 2026-01-05 window.
    let now = NaiveDate::from_ymd_opt(2026, 2, 1).unwrap().and_hms_opt(12, 0, 0).unwrap();
    let states = lifecycles(&pool, now).await;

    let keep_state = task_state(&states, keep.id);
    assert_eq!(keep_state.timing, Timing::Lapsed);
    assert_eq!(keep_state.resolution, Some(Resolution::Overdue));
    assert_eq!(keep_state.archival, Archival::Live); // Overdue never forces archival

    let archive_state = task_state(&states, archive.id);
    assert_eq!(archive_state.timing, Timing::Lapsed);
    assert_eq!(archive_state.resolution, Some(Resolution::Missed));
    assert_eq!(archive_state.archival, Archival::Archived);

    // A Done task is no longer exempt from Timing — once its window passes, it's Lapsed +
    // Completed, and now also archives (the behavior this whole model was introduced to fix).
    let done_state = task_state(&states, done.id);
    assert_eq!(done_state.timing, Timing::Lapsed);
    assert_eq!(done_state.resolution, Some(Resolution::Completed));
    assert_eq!(done_state.archival, Archival::Archived);
}

#[tokio::test]
async fn inherited_scope_and_on_exit_govern_children() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let past = day_scope(&pool, 2026, 1, 5).await;

    let parent = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(&mut db, CreateTaskRequest {
            title: "Parent".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(TimeScope { start_id: past, end_id: past, duration: None }),
            on_scope_exit: Some(OnScopeExit::Archive),
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();
    // Child carries no scope of its own — it inherits the parent's window and on-exit.
    let child = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(&mut db, CreateTaskRequest {
            title: "Child".into(),
            parent_type: "task".into(),
            parent_id: parent.id,
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();
    assert_eq!(child.time_scope, None);
    assert_eq!(child.on_scope_exit, None); // nothing stored on the child

    let now = NaiveDate::from_ymd_opt(2026, 2, 1).unwrap().and_hms_opt(12, 0, 0).unwrap();
    let states = lifecycles(&pool, now).await;
    // Inherits Archive → Lapsed + Missed, even though the child itself is unscoped.
    let child_state = task_state(&states, child.id);
    assert_eq!(child_state.timing, Timing::Lapsed);
    assert_eq!(child_state.resolution, Some(Resolution::Missed));
}

fn goal_state(states: &[arlesh_lib::tasks::lifecycle::ItemLifecycle], id: i64) -> arlesh_lib::tasks::lifecycle::ItemLifecycle {
    states
        .iter()
        .find(|s| s.node_type == "goal" && s.node_id == id)
        .unwrap()
        .clone()
}

#[tokio::test]
async fn derives_goal_overdue_missed_and_archives_an_achieved_goal() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let past = day_scope(&pool, 2026, 1, 5).await;
    let scope = || Some(TimeScope { start_id: past, end_id: past, duration: None });

    let keep = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_goal(&mut db, CreateGoalRequest {
            title: "Keep".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: scope(),
            on_scope_exit: Some(OnScopeExit::Keep),
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();
    let archive = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_goal(&mut db, CreateGoalRequest {
            title: "Archive".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: scope(),
            on_scope_exit: Some(OnScopeExit::Archive),
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();
    let achieved = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_goal(&mut db, CreateGoalRequest {
            title: "Achieved".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: Some(GoalStatus::Achieved),
            time_scope: scope(),
            on_scope_exit: Some(OnScopeExit::Archive),
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    let now = NaiveDate::from_ymd_opt(2026, 2, 1).unwrap().and_hms_opt(12, 0, 0).unwrap();
    let states = lifecycles(&pool, now).await;

    let keep_state = goal_state(&states, keep.id);
    assert_eq!(keep_state.timing, Timing::Lapsed);
    assert_eq!(keep_state.resolution, Some(Resolution::Overdue));
    assert_eq!(keep_state.archival, Archival::Live);

    let archive_state = goal_state(&states, archive.id);
    assert_eq!(archive_state.timing, Timing::Lapsed);
    assert_eq!(archive_state.resolution, Some(Resolution::Missed));
    assert_eq!(archive_state.archival, Archival::Archived);

    // An Achieved goal is no longer exempt from Timing — once its window passes, it's Lapsed +
    // Completed, and now also archives (Achieved itself stays untouched as its own stored status).
    let achieved_state = goal_state(&states, achieved.id);
    assert_eq!(achieved_state.timing, Timing::Lapsed);
    assert_eq!(achieved_state.resolution, Some(Resolution::Completed));
    assert_eq!(achieved_state.archival, Archival::Archived);
}

#[tokio::test]
async fn derivation_tolerates_an_orphaned_item_whose_parent_was_deleted() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let parent = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_goal(&mut db, CreateGoalRequest {
            title: "Parent".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();
    let child = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(&mut db, CreateTaskRequest {
            title: "Child".into(),
            parent_type: "goal".into(),
            parent_id: parent.id,
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();
    // Orphan the child directly (a raw delete that skips the cascade), simulating stale data.
    sqlx::query("DELETE FROM goals WHERE id = ?").bind(parent.id).execute(&pool).await.unwrap();

    // Deriving every item's lifecycle must NOT crash on the dangling ancestor (the render bug);
    // the orphan is simply unconstrained → Active.
    let now = NaiveDate::from_ymd_opt(2026, 2, 1).unwrap().and_hms_opt(12, 0, 0).unwrap();
    let states = lifecycles(&pool, now).await;
    assert_eq!(task_state(&states, child.id).timing, Timing::Active);
}

#[tokio::test]
async fn deleting_a_goal_cascades_its_subtree() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let parent = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_goal(&mut db, CreateGoalRequest { title: "Parent".into(), parent_type: "project".into(), parent_id: project_id, ..Default::default() }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();
    let sub_goal = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_goal(&mut db, CreateGoalRequest { title: "Sub".into(), parent_type: "goal".into(), parent_id: parent.id, ..Default::default() }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();
    let sub_task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(&mut db, CreateTaskRequest { title: "Step".into(), parent_type: "goal".into(), parent_id: sub_goal.id, ..Default::default() }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();

    {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = arlesh_lib::tasks::delete_goal(&mut db, parent.id.into()).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }.unwrap();

    // The whole subtree is gone — nothing is orphaned.
    assert!(helpers::session_factory(&pool).connect().await.unwrap().goals().get(sub_goal.id.into()).await.is_err());
    assert!(helpers::session_factory(&pool).connect().await.unwrap().tasks().get(sub_task.id.into()).await.is_err());
}

// --- Command-level tests for the transactional commands (Task 2.2 Step 3) ---
//
// Every `tasks` command that opens a transactional session gets one of these. They call the real
// command function — `tauri::State` has no public constructor, so `helpers::command_host` stands
// up a mock app to lend one — and assert what is on disk afterwards, never merely that the call
// returned `Ok`. A command whose `db.commit()` line is deleted still compiles and still returns
// `Ok`; the rollback is visible only in the rows, which is what these read.
//
// The pool has a single connection (see `helpers::test_pool`), so every raw read below happens
// after the command's session has been committed and dropped.

/// A second project, so a reparent has somewhere to go.
async fn make_second_project(pool: &sqlx::SqlitePool) -> i64 {
    let aspect_id: i64 =
        sqlx::query_scalar("SELECT id FROM domains WHERE title = 'Growth' AND subtype = 'aspect'")
            .fetch_one(pool)
            .await
            .unwrap();
    helpers::session_factory(pool).connect().await.unwrap().domains().create(CreateDomainRequest {
            title: "Second Project".into(),
            description: None,
            subtype: DomainSubtype::Project,
            parent_id: Some(aspect_id),
            status: Some(ProjectStatus::Active),
            knowledge_base_directory: None,
        })
        .await
        .unwrap()
        .id
}

/// The row's title and sort position, read straight from the database.
async fn title_and_position(pool: &sqlx::SqlitePool, table: &str, id: i64) -> (String, i64) {
    sqlx::query_as(&format!("SELECT title, position FROM {table} WHERE id = ?"))
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

/// The row's title and parent id, read straight from the database.
async fn title_and_parent(pool: &sqlx::SqlitePool, table: &str, id: i64) -> (String, i64) {
    sqlx::query_as(&format!("SELECT title, parent_id FROM {table} WHERE id = ?"))
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

/// Counts the rows of `table` whose `column` equals `value`, straight from the database.
///
/// Takes the column rather than a whole predicate on purpose: a helper that binds one value into
/// caller-supplied SQL silently binds NULL for every extra `?`, so `id = ? OR parent_id = ?` reads
/// as `id = 1 OR parent_id = NULL` and the second half quietly never matches. One placeholder,
/// one bind, no way to get that wrong.
async fn count_where(pool: &sqlx::SqlitePool, table: &str, column: &str, value: i64) -> i64 {
    sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table} WHERE {column} = ?"))
        .bind(value)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn the_create_task_command_commits_the_insert_and_the_position_update_together() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let app = helpers::command_host(&pool);

    let created = task_commands::create_task(
        app.state(),
        CreateTaskRequest {
            title: "Committed Task".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let (title, position) = title_and_position(&pool, "tasks", created.id).await;
    assert_eq!(title, "Committed Task", "the command must commit the insert, not roll it back");
    assert!(
        position > 1_600_000_000_000,
        "the position update must land with the insert, got {position}"
    );
}

#[tokio::test]
async fn the_update_task_command_commits_the_reparent_and_the_field_update_together() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let other_project_id = make_second_project(&pool).await;
    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(&mut db, CreateTaskRequest {
            title: "Before".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();
    let app = helpers::command_host(&pool);

    task_commands::update_task(
        app.state(),
        task.id,
        UpdateTaskRequest {
            title: Some("After".into()),
            parent_type: Some("project".into()),
            parent_id: Some(other_project_id),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    // Two separate UPDATE statements: the parent move and the field write. Both or neither.
    let (title, parent_id) = title_and_parent(&pool, "tasks", task.id).await;
    assert_eq!(title, "After", "the command must commit the field update");
    assert_eq!(parent_id, other_project_id, "the command must commit the reparent");
}

#[tokio::test]
async fn the_delete_task_command_commits_the_whole_subtree() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let root = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(&mut db, CreateTaskRequest {
            title: "Root".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();
    let child = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(&mut db, CreateTaskRequest {
            title: "Child".into(),
            parent_type: "task".into(),
            parent_id: root.id,
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();
    sqlx::query("INSERT INTO infos (body, parent_type, parent_id, position) VALUES (?, 'task', ?, 0)")
        .bind("A note on the child")
        .bind(child.id)
        .execute(&pool)
        .await
        .unwrap();
    {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = db.block_reasons().set("task", root.id, &["waiting".to_string()]).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();
    let app = helpers::command_host(&pool);

    task_commands::delete_task(app.state(), root.id).await.unwrap();

    assert_eq!(
        count_where(&pool, "tasks", "id", root.id).await,
        0,
        "the command must commit the root's deletion"
    );
    assert_eq!(
        count_where(&pool, "tasks", "id", child.id).await,
        0,
        "the descendant task must go with the root"
    );
    assert_eq!(
        count_where(&pool, "infos", "parent_id", child.id).await,
        0,
        "the descendant's infos must go with it"
    );
    assert_eq!(
        count_where(&pool, "block_reasons", "owner_id", root.id).await,
        0,
        "the block reasons must go with the task"
    );
}

#[tokio::test]
async fn the_create_goal_command_commits_the_insert_and_the_position_update_together() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let app = helpers::command_host(&pool);

    let created = task_commands::create_goal(
        app.state(),
        CreateGoalRequest {
            title: "Committed Goal".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let (title, position) = title_and_position(&pool, "goals", created.id).await;
    assert_eq!(title, "Committed Goal", "the command must commit the insert, not roll it back");
    assert!(
        position > 1_600_000_000_000,
        "the position update must land with the insert, got {position}"
    );
}

#[tokio::test]
async fn the_update_goal_command_commits_the_reparent_and_the_field_update_together() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let other_project_id = make_second_project(&pool).await;
    let goal = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_goal(&mut db, CreateGoalRequest {
            title: "Before".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();
    let app = helpers::command_host(&pool);

    task_commands::update_goal(
        app.state(),
        goal.id,
        UpdateGoalRequest {
            title: Some("After".into()),
            parent_type: Some("project".into()),
            parent_id: Some(other_project_id),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let (title, parent_id) = title_and_parent(&pool, "goals", goal.id).await;
    assert_eq!(title, "After", "the command must commit the field update");
    assert_eq!(parent_id, other_project_id, "the command must commit the reparent");
}

#[tokio::test]
async fn the_delete_goal_command_commits_the_whole_subtree() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let root = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_goal(&mut db, CreateGoalRequest {
            title: "Root".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();
    let child = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(&mut db, CreateTaskRequest {
            title: "Step".into(),
            parent_type: "goal".into(),
            parent_id: root.id,
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();
    let app = helpers::command_host(&pool);

    task_commands::delete_goal(app.state(), root.id).await.unwrap();

    assert_eq!(
        count_where(&pool, "goals", "id", root.id).await,
        0,
        "the command must commit the goal's deletion"
    );
    assert_eq!(
        count_where(&pool, "tasks", "id", child.id).await,
        0,
        "the descendant task must go with it"
    );
}

#[tokio::test]
async fn the_add_task_dependency_command_commits_the_edge_it_checked() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let blocker = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(&mut db, CreateTaskRequest {
            title: "Blocker".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();
    let blocked = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(&mut db, CreateTaskRequest {
            title: "Blocked".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            ..Default::default()
        }).await;
        if __r.is_ok() { db.commit().await.unwrap(); }
        __r
    }
        .unwrap();
    let app = helpers::command_host(&pool);

    task_commands::add_task_dependency(
        app.state(),
        blocked.id,
        Dependency::Task { id: blocker.id },
    )
    .await
    .unwrap();

    // One INSERT, but a transactional command: the cycle check in front of it is a read the write
    // depends on. The edge must still be on disk once the session closes.
    let edge: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM task_dependencies
         WHERE task_id = ? AND dependency_type = 'task' AND dependency_id = ?",
    )
    .bind(blocked.id)
    .bind(blocker.id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(edge, 1, "the command must commit the dependency edge it validated");

    // And the check itself still rejects the reverse edge, inside the transaction.
    let cycle = task_commands::add_task_dependency(
        app.state(),
        blocker.id,
        Dependency::Task { id: blocked.id },
    )
    .await;
    assert!(cycle.is_err(), "the cycle check must still reject the reverse edge");
    assert_eq!(
        count_where(&pool, "task_dependencies", "task_id", blocker.id).await,
        0,
        "a rejected dependency must leave nothing behind"
    );
}
