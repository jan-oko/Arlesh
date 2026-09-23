use crate::helpers;

// Aliased rather than imported by name: several command functions share a name with a test below
// (`delete_task`, `delete_goal`), and the alias keeps the call sites saying which one they mean.
// The free functions `delete_task`/`delete_goal` collide the same way, so those two are reached
// through their full path (`arlesh_lib::tasks::delete_task`/`delete_goal`) at the call site
// instead of being imported bare.
use arlesh_lib::commands::tasks as task_commands;
use arlesh_lib::{
    database::session::SessionFactory,
    domains::model::{CreateDomainRequest, DomainSubtype, ProjectStatus},
    scopes::{key::ScopeKey, model::ScopeKind},
    tasks::{
        add_task_dependency, conflicts_for_new_time_scope, create_goal, create_task,
        derive_all_scope_lifecycles, get_task_with_blockers,
        lifecycle::{Archival, Resolution, Timing},
        model::{
            CreateGoalRequest, CreateTaskRequest, Dependency, DurationSpec, GoalStatus,
            OnScopeExit, TaskAgentic, TaskArchival, TaskStatus, TimeScope, UpdateGoalRequest,
            UpdateTaskRequest,
        },
        reparent_conflicts, update_goal, update_task,
    },
};
use chrono::NaiveDate;
use helpers::StoredId;
use tauri::Manager;

async fn make_project(pool: &sqlx::SqlitePool) -> i64 {
    let aspect_id: i64 =
        sqlx::query_scalar("SELECT id FROM domains WHERE title = 'Growth' AND subtype = 'aspect'")
            .fetch_one(pool)
            .await
            .unwrap();
    helpers::session_factory(pool)
        .connect()
        .await
        .unwrap()
        .domains()
        .create(CreateDomainRequest {
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
    helpers::session_factory(pool)
        .connect()
        .await
        .unwrap()
        .domains()
        .create(CreateDomainRequest {
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
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Write tests".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                status: None,
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    assert_eq!(task.title, "Write tests");
    assert_eq!(task.status, "todo");
    assert!(task.tag_ids.is_empty());

    let goal = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_goal(
            &mut db,
            CreateGoalRequest {
                title: "Ship Phase 1".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                status: None,
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
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
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Dependency".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                status: None,
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Blocked Task".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                status: None,
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = add_task_dependency(
            &mut db,
            task.id.sid().into(),
            Dependency::Task {
                id: dependency.id.sid(),
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    let with_blockers = {
        let mut db = helpers::session_factory(&pool).connect().await.unwrap();
        get_task_with_blockers(&mut db, task.id.sid().into()).await
    }
    .unwrap();
    assert_eq!(with_blockers.block_reasons.len(), 1);
    assert!(with_blockers.block_reasons[0].contains("Dependency"));
}

#[tokio::test]
async fn done_dependency_unblocks_task() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let dependency = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Dep".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                status: None,
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Task".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                status: None,
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = add_task_dependency(
            &mut db,
            task.id.sid().into(),
            Dependency::Task {
                id: dependency.id.sid(),
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = update_task(
            &mut db,
            dependency.id.sid().into(),
            UpdateTaskRequest {
                status: Some(arlesh_lib::tasks::model::TaskStatus::Done),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    let with_blockers = {
        let mut db = helpers::session_factory(&pool).connect().await.unwrap();
        get_task_with_blockers(&mut db, task.id.sid().into()).await
    }
    .unwrap();
    assert!(
        with_blockers.block_reasons.is_empty(),
        "should be unblocked"
    );
}

#[tokio::test]
async fn circular_dependency_rejected() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let task_a = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "A".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                status: None,
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    let task_b = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "B".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                status: None,
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = add_task_dependency(
            &mut db,
            task_a.id.sid().into(),
            Dependency::Task {
                id: task_b.id.sid(),
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    let err = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = add_task_dependency(
            &mut db,
            task_b.id.sid().into(),
            Dependency::Task {
                id: task_a.id.sid(),
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
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
        let __r = create_goal(
            &mut db,
            CreateGoalRequest {
                title: "The Goal".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                status: None,
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Task".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                status: None,
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = add_task_dependency(
            &mut db,
            task.id.sid().into(),
            Dependency::Goal { id: goal.id.sid() },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    let blocked = {
        let mut db = helpers::session_factory(&pool).connect().await.unwrap();
        get_task_with_blockers(&mut db, task.id.sid().into()).await
    }
    .unwrap();
    assert_eq!(blocked.block_reasons.len(), 1);

    {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = update_goal(
            &mut db,
            goal.id.sid().into(),
            UpdateGoalRequest {
                status: Some(GoalStatus::Achieved),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    let unblocked = {
        let mut db = helpers::session_factory(&pool).connect().await.unwrap();
        get_task_with_blockers(&mut db, task.id.sid().into()).await
    }
    .unwrap();
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
    let project_b_id = helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .domains()
        .create(CreateDomainRequest {
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
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Movable Task".into(),
                parent_type: "project".into(),
                parent_id: project_a_id,
                status: None,
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    assert_eq!(task.parent_id, project_a_id);

    let moved = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = update_task(
            &mut db,
            task.id.sid().into(),
            UpdateTaskRequest {
                parent_type: Some("project".into()),
                parent_id: Some(project_b_id),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
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
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Tagged Task".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                status: None,
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    assert!(task.tag_ids.is_empty());

    helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .tasks()
        .add_tag(task.id.sid().into(), tag_id)
        .await
        .unwrap();
    let tagged = helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .tasks()
        .get(task.id.sid().into())
        .await
        .unwrap();
    assert_eq!(tagged.tag_ids, vec![tag_id]);

    helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .tasks()
        .remove_tag(task.id.sid().into(), tag_id)
        .await
        .unwrap();
    let untagged = helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .tasks()
        .get(task.id.sid().into())
        .await
        .unwrap();
    assert!(untagged.tag_ids.is_empty());
}

#[tokio::test]
async fn list_tasks_includes_tag_ids() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let tag_id = make_tag(&pool).await;

    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Task With Tag".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                status: None,
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .tasks()
        .add_tag(task.id.sid().into(), tag_id)
        .await
        .unwrap();

    let all_tasks = helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .tasks()
        .list()
        .await
        .unwrap();
    let found = all_tasks.iter().find(|t| t.id == task.id).unwrap();
    assert_eq!(found.tag_ids, vec![tag_id]);
}

#[tokio::test]
async fn update_task_title() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Old Title".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                status: None,
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    let updated = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = update_task(
            &mut db,
            task.id.sid().into(),
            UpdateTaskRequest {
                title: Some("New Title".into()),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    assert_eq!(updated.title, "New Title");
}

/// The flag's whole round trip: set, kept through an unrelated edit, and cleared back to
/// inheriting. The clear is the interesting half — it is the one a nested `Option` would have
/// turned into a silent no-op.
#[tokio::test]
async fn agentic_is_set_kept_and_cleared_back_to_inheriting() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Cast the bell".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();
    assert_eq!(
        task.agentic, None,
        "a new task inherits rather than deciding for itself"
    );

    let flagged = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = update_task(
            &mut db,
            task.id.sid().into(),
            UpdateTaskRequest {
                agentic: Some(TaskAgentic::Yes),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();
    assert_eq!(flagged.agentic, Some(true));

    let renamed = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = update_task(
            &mut db,
            task.id.sid().into(),
            UpdateTaskRequest {
                title: Some("Re-cast the bell".into()),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();
    assert_eq!(
        renamed.agentic,
        Some(true),
        "an edit that says nothing leaves the flag alone"
    );

    let refused = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = update_task(
            &mut db,
            task.id.sid().into(),
            UpdateTaskRequest {
                agentic: Some(TaskAgentic::No),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();
    assert_eq!(
        refused.agentic,
        Some(false),
        "an explicit no is stored, not collapsed to a clear"
    );

    let cleared = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = update_task(
            &mut db,
            task.id.sid().into(),
            UpdateTaskRequest {
                agentic: Some(TaskAgentic::Inherit),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();
    assert_eq!(cleared.agentic, None);

    let stored: Option<bool> = sqlx::query_scalar("SELECT agentic FROM tasks WHERE id = ?")
        .bind(task.id.sid())
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        stored, None,
        "inheriting is the stored NULL, not a stored false"
    );
}

/// The Asynchronous flag's round trip: off on arrival, set, kept through an unrelated edit, and
/// turned off again. Unflagging is the interesting half — with a plain boolean, `Some(false)` has
/// to be a real answer and only an absent field may leave the column alone.
#[tokio::test]
async fn asynchronous_is_set_kept_and_cleared_again() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Order the casting".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();
    assert!(!task.asynchronous, "nothing arrives flagged");

    let flagged = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = update_task(
            &mut db,
            task.id.sid().into(),
            UpdateTaskRequest {
                asynchronous: Some(true),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();
    assert!(flagged.asynchronous);

    let renamed = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = update_task(
            &mut db,
            task.id.sid().into(),
            UpdateTaskRequest {
                title: Some("Order the bell casting".into()),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();
    assert!(
        renamed.asynchronous,
        "an edit that says nothing leaves the flag alone"
    );

    let cleared = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = update_task(
            &mut db,
            task.id.sid().into(),
            UpdateTaskRequest {
                asynchronous: Some(false),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();
    assert!(!cleared.asynchronous);

    let stored: bool = sqlx::query_scalar("SELECT asynchronous FROM tasks WHERE id = ?")
        .bind(task.id.sid())
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(
        !stored,
        "the column holds the boolean, with no NULL third state to fall into"
    );
}

/// Asynchronous does not inherit — deliberately unlike Agentic. A subtask of a Task that starts a
/// wait is usually the work you do *after* the wait, so the flag stops at the row it is set on.
#[tokio::test]
async fn a_child_of_an_asynchronous_task_is_not_itself_asynchronous() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let parent = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Send the brief".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                asynchronous: Some(true),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();
    assert!(parent.asynchronous);

    let child = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Read the reply".into(),
                parent_type: "task".into(),
                parent_id: parent.id.sid(),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();
    assert!(
        !child.asynchronous,
        "the flag is a property of one concrete action, not of a branch"
    );
}

/// Agentic and Delegation are independent: a task can be both, and setting one never moves the
/// other.
#[tokio::test]
async fn a_task_can_be_agentic_and_delegated_at_once() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let person = helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .people()
        .create(arlesh_lib::knowledge_base::model::CreatePersonRequest {
            name: "Ada".into(),
            aliases: None,
            linked_note: None,
        })
        .await
        .unwrap()
        .id;

    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Cast the bell".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                agentic: Some(TaskAgentic::Yes),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    let delegated = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = update_task(
            &mut db,
            task.id.sid().into(),
            UpdateTaskRequest {
                delegate_to: Some(Some(arlesh_lib::tasks::model::Delegate::Person {
                    id: person,
                })),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    assert_eq!(delegated.agentic, Some(true));
    assert_eq!(
        delegated.delegate_to,
        Some(arlesh_lib::tasks::model::Delegate::Person { id: person })
    );
}

/// Applies one update request, read from its wire JSON, the way an IPC call arrives.
async fn update_task_from_wire(
    pool: &sqlx::SqlitePool,
    task_id: i64,
    wire: &str,
) -> arlesh_lib::tasks::model::Task {
    let request: UpdateTaskRequest = serde_json::from_str(wire).unwrap();
    let mut db = helpers::session_factory(pool).begin().await.unwrap();
    let task = update_task(&mut db, task_id.into(), request).await.unwrap();
    db.commit().await.unwrap();
    task
}

/// The one-click delegate button's two halves, exactly as the frontend sends them: `{"kind":
/// "agent"}` to delegate, and an explicit `null` to take it back. The toggle-off half is the one
/// that used to be silently ignored on the wire (Arlesh-atb), so it is exercised from JSON rather
/// than from a hand-built request.
#[tokio::test]
async fn a_task_is_delegated_to_the_agent_and_back_over_the_wire() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let task = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Draft the migration".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                agentic: Some(TaskAgentic::Yes),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        db.commit().await.unwrap();
        task
    };

    let delegated =
        update_task_from_wire(&pool, task.id.sid(), r#"{"delegate_to":{"kind":"agent"}}"#).await;
    assert_eq!(
        delegated.delegate_to,
        Some(arlesh_lib::tasks::model::Delegate::Agent)
    );
    let stored: (Option<String>, Option<i64>) =
        sqlx::query_as("SELECT delegate_kind, delegate_id FROM tasks WHERE id = ?")
            .bind(task.id.sid())
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(stored, (Some("agent".to_string()), None));

    let cleared = update_task_from_wire(&pool, task.id.sid(), r#"{"delegate_to":null}"#).await;
    assert_eq!(
        cleared.delegate_to, None,
        "an explicit null clears the Agent"
    );
    assert_eq!(cleared.agentic, Some(true), "and leaves the flag alone");
}

/// Delegating to a Person who does not exist is refused, exactly as it was when the column was a
/// plain foreign key: `delegate_id` still references `people`.
#[tokio::test]
async fn delegating_to_a_person_who_does_not_exist_is_refused() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let task = create_task(
        &mut db,
        CreateTaskRequest {
            title: "Orphan".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let refused = update_task(
        &mut db,
        task.id.sid().into(),
        UpdateTaskRequest {
            delegate_to: Some(Some(arlesh_lib::tasks::model::Delegate::Person {
                id: 9_999,
            })),
            ..Default::default()
        },
    )
    .await;
    assert!(refused.is_err(), "a delegate must name a real Person");
}

#[tokio::test]
async fn delete_task() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Doomed Task".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                status: None,
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = arlesh_lib::tasks::delete_task(&mut db, task.id.sid().into()).await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    let err = helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .tasks()
        .get(task.id.sid().into())
        .await
        .unwrap_err();
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
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Dep".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                status: None,
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Task".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                status: None,
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = add_task_dependency(
            &mut db,
            task.id.sid().into(),
            Dependency::Task { id: dep.id.sid() },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();
    helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .tasks()
        .remove_dependency(task.id.sid().into(), Dependency::Task { id: dep.id.sid() })
        .await
        .unwrap();

    let deps = helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .tasks()
        .list_dependencies(task.id.sid().into())
        .await
        .unwrap();
    assert!(deps.is_empty());
}

#[tokio::test]
async fn update_goal_title() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let goal = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_goal(
            &mut db,
            CreateGoalRequest {
                title: "Old Goal".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                status: None,
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    let updated = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = update_goal(
            &mut db,
            goal.id.sid().into(),
            UpdateGoalRequest {
                title: Some("New Goal".into()),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
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
        let __r = create_goal(
            &mut db,
            CreateGoalRequest {
                title: "Doomed Goal".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                status: None,
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = arlesh_lib::tasks::delete_goal(&mut db, goal.id.sid().into()).await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    let err = helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .goals()
        .get(goal.id.sid().into())
        .await
        .unwrap_err();
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
        let __r = create_goal(
            &mut db,
            CreateGoalRequest {
                title: "Tagged Goal".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                status: None,
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    assert!(goal.tag_ids.is_empty());

    helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .goals()
        .add_tag(goal.id.sid().into(), tag_id)
        .await
        .unwrap();
    let tagged = helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .goals()
        .get(goal.id.sid().into())
        .await
        .unwrap();
    assert_eq!(tagged.tag_ids, vec![tag_id]);

    helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .goals()
        .remove_tag(goal.id.sid().into(), tag_id)
        .await
        .unwrap();
    let untagged = helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .goals()
        .get(goal.id.sid().into())
        .await
        .unwrap();
    assert!(untagged.tag_ids.is_empty());
}

#[tokio::test]
async fn list_goals_includes_tag_ids() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let tag_id = make_tag(&pool).await;

    let goal = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_goal(
            &mut db,
            CreateGoalRequest {
                title: "Goal With Tag".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                status: None,
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .goals()
        .add_tag(goal.id.sid().into(), tag_id)
        .await
        .unwrap();

    let all_goals = helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .goals()
        .list()
        .await
        .unwrap();
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
    let project_b_id = helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .domains()
        .create(CreateDomainRequest {
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
        let __r = create_goal(
            &mut db,
            CreateGoalRequest {
                title: "Movable Goal".into(),
                parent_type: "project".into(),
                parent_id: project_a_id,
                status: None,
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    assert_eq!(goal.parent_id, project_a_id);

    let moved = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = update_goal(
            &mut db,
            goal.id.sid().into(),
            UpdateGoalRequest {
                parent_type: Some("project".into()),
                parent_id: Some(project_b_id),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
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
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "In Progress Task".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                status: None,
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    assert_eq!(task.status, "todo");

    let updated = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = update_task(
            &mut db,
            task.id.sid().into(),
            UpdateTaskRequest {
                status: Some(TaskStatus::InProgress),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
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
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Blockable Task".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                status: None,
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = db
            .block_reasons()
            .set(
                "task",
                task.id.sid(),
                &["Waiting on design".into(), "Needs review".into()],
            )
            .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();
    assert_eq!(
        helpers::session_factory(&pool)
            .connect()
            .await
            .unwrap()
            .block_reasons()
            .list_for("task", task.id.sid())
            .await
            .unwrap(),
        vec!["Waiting on design".to_string(), "Needs review".to_string()],
    );

    // Setting an empty list clears them; blank reasons are dropped.
    {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = db
            .block_reasons()
            .set("task", task.id.sid(), &[String::new(), "   ".into()])
            .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();
    assert!(helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .block_reasons()
        .list_for("task", task.id.sid())
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn explicit_block_reason_surfaces_in_get_with_blockers() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Blocked Task".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                status: None,
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = db
            .block_reasons()
            .set("task", task.id.sid(), &["Explicit reason".into()])
            .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    let with_blockers = {
        let mut db = helpers::session_factory(&pool).connect().await.unwrap();
        get_task_with_blockers(&mut db, task.id.sid().into()).await
    }
    .unwrap();
    assert!(with_blockers
        .block_reasons
        .iter()
        .any(|r| r.contains("Explicit reason")));
}

#[tokio::test]
async fn update_task_scope() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let scope = arlesh_lib::scopes::model::Scope::containing(
        ScopeKind::Day,
        chrono::NaiveDate::from_ymd_opt(2026, 7, 1).unwrap(),
    )
    .unwrap();

    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Scoped Task".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                status: None,
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    assert!(task.time_scope.is_none());

    let updated = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = update_task(
            &mut db,
            task.id.sid().into(),
            UpdateTaskRequest {
                time_scope: Some(Some(TimeScope {
                    start_id: scope.id,
                    end_id: scope.id,
                    duration: None,
                })),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
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
    let scope = arlesh_lib::scopes::model::Scope::containing(
        ScopeKind::Week,
        chrono::NaiveDate::from_ymd_opt(2026, 7, 1).unwrap(),
    )
    .unwrap();

    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Duration Task".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                time_scope: Some(TimeScope {
                    start_id: scope.id,
                    end_id: scope.id,
                    duration: Some(DurationSpec {
                        n: 3,
                        kind: "week".into(),
                    }),
                }),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    // The snapshotted window persists alongside the remembered duration parameters.
    let duration = task
        .time_scope
        .and_then(|ts| ts.duration)
        .expect("duration kept");
    assert_eq!(duration.n, 3);
    assert_eq!(duration.kind, "week");
}

#[tokio::test]
async fn task_plan_is_independent_of_time_scope() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let week = arlesh_lib::scopes::model::Scope::containing(
        ScopeKind::Week,
        chrono::NaiveDate::from_ymd_opt(2026, 7, 1).unwrap(),
    )
    .unwrap();
    let day = arlesh_lib::scopes::model::Scope::containing(
        ScopeKind::Day,
        chrono::NaiveDate::from_ymd_opt(2026, 7, 1).unwrap(),
    )
    .unwrap();

    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Planned Task".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                time_scope: Some(TimeScope {
                    start_id: week.id,
                    end_id: week.id,
                    duration: None,
                }),
                plan: Some(single(day.id)),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    assert_eq!(task.time_scope.expect("time scope").start_id, week.id);
    assert_eq!(
        task.plan.map(|p| (p.start_id, p.end_id)),
        Some((day.id, day.id))
    );

    // Clearing the Plan leaves the Time Scope intact.
    let cleared = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = update_task(
            &mut db,
            task.id.sid().into(),
            UpdateTaskRequest {
                plan: Some(None),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();
    assert!(cleared.plan.is_none());
    assert!(
        cleared.time_scope.is_some(),
        "clearing Plan must not clear Time Scope"
    );
}

#[tokio::test]
async fn plan_within_time_scope_is_accepted() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    // 2026-07-01 (Wed) sits inside its own Sun–Sat week.
    let week = arlesh_lib::scopes::model::Scope::containing(
        ScopeKind::Week,
        chrono::NaiveDate::from_ymd_opt(2026, 7, 1).unwrap(),
    )
    .unwrap();
    let day = arlesh_lib::scopes::model::Scope::containing(
        ScopeKind::Day,
        chrono::NaiveDate::from_ymd_opt(2026, 7, 1).unwrap(),
    )
    .unwrap();

    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Planned".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                time_scope: Some(TimeScope {
                    start_id: week.id,
                    end_id: week.id,
                    duration: None,
                }),
                plan: Some(single(day.id)),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();
    assert_eq!(
        task.plan.map(|p| (p.start_id, p.end_id)),
        Some((day.id, day.id))
    );
}

#[tokio::test]
async fn plan_outside_time_scope_is_rejected() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let week = arlesh_lib::scopes::model::Scope::containing(
        ScopeKind::Week,
        chrono::NaiveDate::from_ymd_opt(2026, 7, 1).unwrap(),
    )
    .unwrap();
    // A day three weeks later is not contained in the time-scope week.
    let far_day = arlesh_lib::scopes::model::Scope::containing(
        ScopeKind::Day,
        chrono::NaiveDate::from_ymd_opt(2026, 7, 20).unwrap(),
    )
    .unwrap();

    let result = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Bad plan".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                time_scope: Some(TimeScope {
                    start_id: week.id,
                    end_id: week.id,
                    duration: None,
                }),
                plan: Some(single(far_day.id)),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    };

    assert!(
        matches!(
            result,
            Err(arlesh_lib::tasks::error::TaskError::ScopeContainment(_))
        ),
        "plan outside the time scope should be rejected, got {result:?}",
    );
}

// --- Cross-tree containment (child within ancestor, cascade detection, reparent) ---

fn single(scope_id: ScopeKey) -> TimeScope {
    TimeScope {
        start_id: scope_id,
        end_id: scope_id,
        duration: None,
    }
}

async fn july_scopes(_pool: &sqlx::SqlitePool) -> (ScopeKey, ScopeKey, ScopeKey) {
    let july = arlesh_lib::scopes::model::Scope::containing(
        ScopeKind::Month,
        chrono::NaiveDate::from_ymd_opt(2026, 7, 15).unwrap(),
    )
    .unwrap();
    let week_in_july = arlesh_lib::scopes::model::Scope::containing(
        ScopeKind::Week,
        chrono::NaiveDate::from_ymd_opt(2026, 7, 15).unwrap(),
    )
    .unwrap();
    let week_in_august = arlesh_lib::scopes::model::Scope::containing(
        ScopeKind::Week,
        chrono::NaiveDate::from_ymd_opt(2026, 8, 15).unwrap(),
    )
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
        let __r = create_goal(
            &mut db,
            CreateGoalRequest {
                title: "July Goal".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                time_scope: Some(single(july)),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Week Task".into(),
                parent_type: "goal".into(),
                parent_id: goal.id.sid(),
                time_scope: Some(single(week_in_july)),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    };
    assert!(
        task.is_ok(),
        "a week inside the goal's month should be accepted: {task:?}"
    );
}

#[tokio::test]
async fn child_time_scope_outside_ancestor_is_rejected() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let (july, _, week_in_august) = july_scopes(&pool).await;

    let goal = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_goal(
            &mut db,
            CreateGoalRequest {
                title: "July Goal".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                time_scope: Some(single(july)),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    let result = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "August Task".into(),
                parent_type: "goal".into(),
                parent_id: goal.id.sid(),
                time_scope: Some(single(week_in_august)),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
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
        let __r = create_goal(
            &mut db,
            CreateGoalRequest {
                title: "July Goal".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                time_scope: Some(single(july)),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();
    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Whole July Task".into(),
                parent_type: "goal".into(),
                parent_id: goal.id.sid(),
                time_scope: Some(single(july)),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    // Narrowing the goal to a single week would orphan the month-scoped task.
    let conflicts = {
        let mut db = helpers::session_factory(&pool).connect().await.unwrap();
        conflicts_for_new_time_scope(&mut db, "goal", goal.id.sid(), &single(week_in_july)).await
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
        let __r = create_goal(
            &mut db,
            CreateGoalRequest {
                title: "July Goal".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                time_scope: Some(single(july)),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();
    let august_goal = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_goal(
            &mut db,
            CreateGoalRequest {
                title: "August Goal".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                time_scope: Some(single(week_in_august)),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();
    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Week Task".into(),
                parent_type: "goal".into(),
                parent_id: july_goal.id.sid(),
                time_scope: Some(single(week_in_july)),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    // Moving the July-week task under the August goal must be rejected.
    let result = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = update_task(
            &mut db,
            task.id.sid().into(),
            UpdateTaskRequest {
                parent_type: Some("goal".into()),
                parent_id: Some(august_goal.id.sid()),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
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
        let __r = create_goal(
            &mut db,
            CreateGoalRequest {
                title: "July".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                time_scope: Some(single(july)),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();
    // A task scoped to August, currently under the (unscoped) project.
    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "August task".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                time_scope: Some(single(week_in_august)),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    let result = {
        let mut db = helpers::session_factory(&pool).connect().await.unwrap();
        reparent_conflicts(&mut db, "task", task.id.sid(), "goal", july_goal.id.sid()).await
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
        let __r = create_goal(
            &mut db,
            CreateGoalRequest {
                title: "July".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                time_scope: Some(single(july)),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();
    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Fits".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                time_scope: Some(single(week_in_july)),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    let result = {
        let mut db = helpers::session_factory(&pool).connect().await.unwrap();
        reparent_conflicts(&mut db, "task", task.id.sid(), "goal", july_goal.id.sid()).await
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
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Scoped".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                time_scope: Some(single(week_in_august)),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    let result = {
        let mut db = helpers::session_factory(&pool).connect().await.unwrap();
        reparent_conflicts(&mut db, "task", task.id.sid(), "project", project_id).await
    }
    .unwrap();
    assert!(result.ancestor_time_scope.is_none());
    assert!(result.conflicts.is_empty());
}

#[tokio::test]
async fn update_rejects_plan_outside_time_scope() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let week = arlesh_lib::scopes::model::Scope::containing(
        ScopeKind::Week,
        chrono::NaiveDate::from_ymd_opt(2026, 7, 1).unwrap(),
    )
    .unwrap();
    let far_day = arlesh_lib::scopes::model::Scope::containing(
        ScopeKind::Day,
        chrono::NaiveDate::from_ymd_opt(2026, 7, 20).unwrap(),
    )
    .unwrap();

    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Scoped".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                time_scope: Some(TimeScope {
                    start_id: week.id,
                    end_id: week.id,
                    duration: None,
                }),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    let result = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = update_task(
            &mut db,
            task.id.sid().into(),
            UpdateTaskRequest {
                plan: Some(Some(single(far_day.id))),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
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
        let __r = create_goal(
            &mut db,
            CreateGoalRequest {
                title: "Blockable Goal".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                status: None,
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = db
            .block_reasons()
            .set("goal", goal.id.sid(), &["Waiting on funding".into()])
            .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();
    assert_eq!(
        helpers::session_factory(&pool)
            .connect()
            .await
            .unwrap()
            .block_reasons()
            .list_for("goal", goal.id.sid())
            .await
            .unwrap(),
        vec!["Waiting on funding".to_string()]
    );

    {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = db.block_reasons().set("goal", goal.id.sid(), &[]).await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();
    assert!(helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .block_reasons()
        .list_for("goal", goal.id.sid())
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn update_goal_scope() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let scope = arlesh_lib::scopes::model::Scope::containing(
        ScopeKind::Month,
        chrono::NaiveDate::from_ymd_opt(2026, 7, 1).unwrap(),
    )
    .unwrap();

    let goal = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_goal(
            &mut db,
            CreateGoalRequest {
                title: "Scoped Goal".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                status: None,
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    let updated = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = update_goal(
            &mut db,
            goal.id.sid().into(),
            UpdateGoalRequest {
                time_scope: Some(Some(TimeScope {
                    start_id: scope.id,
                    end_id: scope.id,
                    duration: None,
                })),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
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
        let __r = create_goal(
            &mut db,
            CreateGoalRequest {
                title: "Status Goal".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                status: None,
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    let frozen = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = update_goal(
            &mut db,
            goal.id.sid().into(),
            UpdateGoalRequest {
                status: Some(GoalStatus::Frozen),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();
    assert_eq!(frozen.status, "frozen");

    let archived = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = update_goal(
            &mut db,
            goal.id.sid().into(),
            UpdateGoalRequest {
                status: Some(GoalStatus::Archived),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
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
        let __r = create_goal(
            &mut db,
            CreateGoalRequest {
                title: "Achievement Goal".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                status: None,
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    assert!(!helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .goals()
        .is_achieved(goal.id.sid().into())
        .await
        .unwrap());

    {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = update_goal(
            &mut db,
            goal.id.sid().into(),
            UpdateGoalRequest {
                status: Some(GoalStatus::Achieved),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    assert!(helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .goals()
        .is_achieved(goal.id.sid().into())
        .await
        .unwrap());
}

// --- On-exit behavior + derived scope lifecycle (Feature A / S2) ---

async fn day_scope(_pool: &sqlx::SqlitePool, y: i32, m: u32, d: u32) -> ScopeKey {
    arlesh_lib::scopes::model::Scope::containing(
        ScopeKind::Day,
        NaiveDate::from_ymd_opt(y, m, d).unwrap(),
    )
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

fn task_state(
    states: &[arlesh_lib::tasks::lifecycle::ItemLifecycle],
    id: i64,
) -> arlesh_lib::tasks::lifecycle::ItemLifecycle {
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
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Scoped".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                time_scope: Some(TimeScope {
                    start_id: scope,
                    end_id: scope,
                    duration: None,
                }),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();
    assert_eq!(scoped.on_scope_exit, Some(OnScopeExit::Keep));

    // Unscoped but an on-exit was provided → dropped (invariant: on-exit present iff scoped).
    let unscoped = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Unscoped".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                on_scope_exit: Some(OnScopeExit::Archive),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
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
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Archive me".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                time_scope: Some(TimeScope {
                    start_id: scope,
                    end_id: scope,
                    duration: None,
                }),
                on_scope_exit: Some(OnScopeExit::Archive),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();
    assert_eq!(task.on_scope_exit, Some(OnScopeExit::Archive));

    let cleared = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = update_task(
            &mut db,
            task.id.sid().into(),
            UpdateTaskRequest {
                time_scope: Some(None),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
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
    let scope = || {
        Some(TimeScope {
            start_id: past,
            end_id: past,
            duration: None,
        })
    };

    let keep = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Keep".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                time_scope: scope(),
                on_scope_exit: Some(OnScopeExit::Keep),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();
    let archive = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Archive".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                time_scope: scope(),
                on_scope_exit: Some(OnScopeExit::Archive),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();
    let done = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Done".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                status: Some(TaskStatus::Done),
                time_scope: scope(),
                on_scope_exit: Some(OnScopeExit::Archive),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    // Well past the 2026-01-05 window.
    let now = NaiveDate::from_ymd_opt(2026, 2, 1)
        .unwrap()
        .and_hms_opt(12, 0, 0)
        .unwrap();
    let states = lifecycles(&pool, now).await;

    let keep_state = task_state(&states, keep.id.sid());
    assert_eq!(keep_state.timing, Timing::Lapsed);
    assert_eq!(keep_state.resolution, Some(Resolution::Overdue));
    assert_eq!(keep_state.archival, Archival::Live); // Overdue never forces archival

    let archive_state = task_state(&states, archive.id.sid());
    assert_eq!(archive_state.timing, Timing::Lapsed);
    assert_eq!(archive_state.resolution, Some(Resolution::Missed));
    assert_eq!(archive_state.archival, Archival::Archived);

    // A Done task is no longer exempt from Timing — once its window passes, it's Lapsed +
    // Completed, and now also archives (the behavior this whole model was introduced to fix).
    let done_state = task_state(&states, done.id.sid());
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
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Parent".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                time_scope: Some(TimeScope {
                    start_id: past,
                    end_id: past,
                    duration: None,
                }),
                on_scope_exit: Some(OnScopeExit::Archive),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();
    // Child carries no scope of its own — it inherits the parent's window and on-exit.
    let child = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Child".into(),
                parent_type: "task".into(),
                parent_id: parent.id.sid(),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();
    assert_eq!(child.time_scope, None);
    assert_eq!(child.on_scope_exit, None); // nothing stored on the child

    let now = NaiveDate::from_ymd_opt(2026, 2, 1)
        .unwrap()
        .and_hms_opt(12, 0, 0)
        .unwrap();
    let states = lifecycles(&pool, now).await;
    // Inherits Archive → Lapsed + Missed, even though the child itself is unscoped.
    let child_state = task_state(&states, child.id.sid());
    assert_eq!(child_state.timing, Timing::Lapsed);
    assert_eq!(child_state.resolution, Some(Resolution::Missed));
}

fn goal_state(
    states: &[arlesh_lib::tasks::lifecycle::ItemLifecycle],
    id: i64,
) -> arlesh_lib::tasks::lifecycle::ItemLifecycle {
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
    let scope = || {
        Some(TimeScope {
            start_id: past,
            end_id: past,
            duration: None,
        })
    };

    let keep = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_goal(
            &mut db,
            CreateGoalRequest {
                title: "Keep".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                time_scope: scope(),
                on_scope_exit: Some(OnScopeExit::Keep),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();
    let archive = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_goal(
            &mut db,
            CreateGoalRequest {
                title: "Archive".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                time_scope: scope(),
                on_scope_exit: Some(OnScopeExit::Archive),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();
    let achieved = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_goal(
            &mut db,
            CreateGoalRequest {
                title: "Achieved".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                status: Some(GoalStatus::Achieved),
                time_scope: scope(),
                on_scope_exit: Some(OnScopeExit::Archive),
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    let now = NaiveDate::from_ymd_opt(2026, 2, 1)
        .unwrap()
        .and_hms_opt(12, 0, 0)
        .unwrap();
    let states = lifecycles(&pool, now).await;

    let keep_state = goal_state(&states, keep.id.sid());
    assert_eq!(keep_state.timing, Timing::Lapsed);
    assert_eq!(keep_state.resolution, Some(Resolution::Overdue));
    assert_eq!(keep_state.archival, Archival::Live);

    let archive_state = goal_state(&states, archive.id.sid());
    assert_eq!(archive_state.timing, Timing::Lapsed);
    assert_eq!(archive_state.resolution, Some(Resolution::Missed));
    assert_eq!(archive_state.archival, Archival::Archived);

    // An Achieved goal is no longer exempt from Timing — once its window passes, it's Lapsed +
    // Completed, and now also archives (Achieved itself stays untouched as its own stored status).
    let achieved_state = goal_state(&states, achieved.id.sid());
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
        let __r = create_goal(
            &mut db,
            CreateGoalRequest {
                title: "Parent".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();
    let child = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Child".into(),
                parent_type: "goal".into(),
                parent_id: parent.id.sid(),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();
    // Orphan the child directly (a raw delete that skips the cascade), simulating stale data.
    sqlx::query("DELETE FROM goals WHERE id = ?")
        .bind(parent.id.sid())
        .execute(&pool)
        .await
        .unwrap();

    // Deriving every item's lifecycle must NOT crash on the dangling ancestor (the render bug);
    // the orphan is simply unconstrained → Active.
    let now = NaiveDate::from_ymd_opt(2026, 2, 1)
        .unwrap()
        .and_hms_opt(12, 0, 0)
        .unwrap();
    let states = lifecycles(&pool, now).await;
    assert_eq!(task_state(&states, child.id.sid()).timing, Timing::Active);
}

#[tokio::test]
async fn deleting_a_goal_cascades_its_subtree() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let parent = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_goal(
            &mut db,
            CreateGoalRequest {
                title: "Parent".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();
    let sub_goal = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_goal(
            &mut db,
            CreateGoalRequest {
                title: "Sub".into(),
                parent_type: "goal".into(),
                parent_id: parent.id.sid(),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();
    let sub_task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Step".into(),
                parent_type: "goal".into(),
                parent_id: sub_goal.id.sid(),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = arlesh_lib::tasks::delete_goal(&mut db, parent.id.sid().into()).await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();

    // The whole subtree is gone — nothing is orphaned.
    assert!(helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .goals()
        .get(sub_goal.id.sid().into())
        .await
        .is_err());
    assert!(helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .tasks()
        .get(sub_task.id.sid().into())
        .await
        .is_err());
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
    helpers::session_factory(pool)
        .connect()
        .await
        .unwrap()
        .domains()
        .create(CreateDomainRequest {
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
    sqlx::query_as(&format!(
        "SELECT title, parent_id FROM {table} WHERE id = ?"
    ))
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

    let (title, position) = title_and_position(&pool, "tasks", created.id.sid()).await;
    assert_eq!(
        title, "Committed Task",
        "the command must commit the insert, not roll it back"
    );
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
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Before".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();
    let app = helpers::command_host(&pool);

    task_commands::update_task(
        app.state(),
        task.id.clone(),
        UpdateTaskRequest {
            title: Some("After".into()),
            parent_type: Some("project".into()),
            parent_id: Some(other_project_id),
            ..Default::default()
        },
        None,
    )
    .await
    .unwrap();

    // Two separate UPDATE statements: the parent move and the field write. Both or neither.
    let (title, parent_id) = title_and_parent(&pool, "tasks", task.id.sid()).await;
    assert_eq!(title, "After", "the command must commit the field update");
    assert_eq!(
        parent_id, other_project_id,
        "the command must commit the reparent"
    );
}

#[tokio::test]
async fn the_delete_task_command_commits_the_whole_subtree() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let root = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Root".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();
    let child = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Child".into(),
                parent_type: "task".into(),
                parent_id: root.id.sid(),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();
    sqlx::query(
        "INSERT INTO infos (body, parent_type, parent_id, position) VALUES (?, 'task', ?, 0)",
    )
    .bind("A note on the child")
    .bind(child.id.sid())
    .execute(&pool)
    .await
    .unwrap();
    {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = db
            .block_reasons()
            .set("task", root.id.sid(), &["waiting".to_string()])
            .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();
    let app = helpers::command_host(&pool);

    task_commands::delete_task(app.state(), root.id.clone())
        .await
        .unwrap();

    assert_eq!(
        count_where(&pool, "tasks", "id", root.id.sid()).await,
        0,
        "the command must commit the root's deletion"
    );
    assert_eq!(
        count_where(&pool, "tasks", "id", child.id.sid()).await,
        0,
        "the descendant task must go with the root"
    );
    assert_eq!(
        count_where(&pool, "infos", "parent_id", child.id.sid()).await,
        0,
        "the descendant's infos must go with it"
    );
    assert_eq!(
        count_where(&pool, "block_reasons", "owner_id", root.id.sid()).await,
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

    let (title, position) = title_and_position(&pool, "goals", created.id.sid()).await;
    assert_eq!(
        title, "Committed Goal",
        "the command must commit the insert, not roll it back"
    );
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
        let __r = create_goal(
            &mut db,
            CreateGoalRequest {
                title: "Before".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();
    let app = helpers::command_host(&pool);

    task_commands::update_goal(
        app.state(),
        goal.id.clone(),
        UpdateGoalRequest {
            title: Some("After".into()),
            parent_type: Some("project".into()),
            parent_id: Some(other_project_id),
            ..Default::default()
        },
        None,
    )
    .await
    .unwrap();

    let (title, parent_id) = title_and_parent(&pool, "goals", goal.id.sid()).await;
    assert_eq!(title, "After", "the command must commit the field update");
    assert_eq!(
        parent_id, other_project_id,
        "the command must commit the reparent"
    );
}

#[tokio::test]
async fn the_delete_goal_command_commits_the_whole_subtree() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let root = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_goal(
            &mut db,
            CreateGoalRequest {
                title: "Root".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();
    let child = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Step".into(),
                parent_type: "goal".into(),
                parent_id: root.id.sid(),
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();
    let app = helpers::command_host(&pool);

    task_commands::delete_goal(app.state(), root.id.clone())
        .await
        .unwrap();

    assert_eq!(
        count_where(&pool, "goals", "id", root.id.sid()).await,
        0,
        "the command must commit the goal's deletion"
    );
    assert_eq!(
        count_where(&pool, "tasks", "id", child.id.sid()).await,
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
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Blocker".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();
    let blocked = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Blocked".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                ..Default::default()
            },
        )
        .await;
        if __r.is_ok() {
            db.commit().await.unwrap();
        }
        __r
    }
    .unwrap();
    let app = helpers::command_host(&pool);

    task_commands::add_task_dependency(
        app.state(),
        blocked.id.sid(),
        Dependency::Task {
            id: blocker.id.sid(),
        },
    )
    .await
    .unwrap();

    // One INSERT, but a transactional command: the cycle check in front of it is a read the write
    // depends on. The edge must still be on disk once the session closes.
    let edge: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM task_dependencies
         WHERE task_id = ? AND dependency_type = 'task' AND dependency_id = ?",
    )
    .bind(blocked.id.sid())
    .bind(blocker.id.sid())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        edge, 1,
        "the command must commit the dependency edge it validated"
    );

    // And the check itself still rejects the reverse edge, inside the transaction.
    let cycle = task_commands::add_task_dependency(
        app.state(),
        blocker.id.sid(),
        Dependency::Task {
            id: blocked.id.sid(),
        },
    )
    .await;
    assert!(
        cycle.is_err(),
        "the cycle check must still reject the reverse edge"
    );
    assert_eq!(
        count_where(&pool, "task_dependencies", "task_id", blocker.id.sid()).await,
        0,
        "a rejected dependency must leave nothing behind"
    );
}

// --- The broken-chain policy (Phase 3, Task 3.3) ---
//
// One corrupt tree, two callers, two answers. The renderer treats a chain it cannot follow as
// unconstrained and keeps drawing, because one bad row must not blank the whole mindmap; a write
// underneath that same row is refused, because the invariant it would have to satisfy cannot be
// read. Before the ancestry chain, "nothing found" said both of those at once, and which one you
// got depended on which of four near-identical walks you happened to call.

/// Inserts a task row straight into the database, skipping every rule, so a test can build a
/// tree the write path would never produce.
async fn insert_raw_task(pool: &sqlx::SqlitePool, id: i64, parent_type: &str, parent_id: i64) {
    sqlx::query(
        "INSERT INTO tasks (id, title, parent_type, parent_id, status) VALUES (?, ?, ?, ?, 'todo')",
    )
    .bind(id)
    .bind(format!("raw task {id}"))
    .bind(parent_type)
    .bind(parent_id)
    .execute(pool)
    .await
    .unwrap();
}

/// Creates a task through the real write path, which is where containment is checked.
async fn create_task_under(
    pool: &sqlx::SqlitePool,
    request: CreateTaskRequest,
) -> Result<arlesh_lib::tasks::model::Task, arlesh_lib::tasks::error::TaskError> {
    let mut db = helpers::session_factory(pool).begin().await.unwrap();
    let created = create_task(&mut db, request).await;
    if created.is_ok() {
        db.commit().await.unwrap();
    }
    created
}

/// Creates a goal through the real write path, for the fixtures below.
async fn create_goal_under(
    pool: &sqlx::SqlitePool,
    request: CreateGoalRequest,
) -> arlesh_lib::tasks::model::Goal {
    let mut db = helpers::session_factory(pool).begin().await.unwrap();
    let created = create_goal(&mut db, request).await.unwrap();
    db.commit().await.unwrap();
    created
}

#[tokio::test]
async fn a_dangling_ancestor_renders_fine_and_rejects_a_write() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let (_, week_in_july, _) = july_scopes(&pool).await;
    let goal = create_goal_under(
        &pool,
        CreateGoalRequest {
            title: "Doomed Parent".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            ..Default::default()
        },
    )
    .await;
    let orphan = create_task_under(
        &pool,
        CreateTaskRequest {
            title: "Orphan".into(),
            parent_type: "goal".into(),
            parent_id: goal.id.sid(),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    // A raw delete that skips the cascade — the shape stale data actually takes.
    sqlx::query("DELETE FROM goals WHERE id = ?")
        .bind(goal.id.sid())
        .execute(&pool)
        .await
        .unwrap();

    // Read path: the orphan is unconstrained, and everything still renders.
    let now = NaiveDate::from_ymd_opt(2026, 2, 1)
        .unwrap()
        .and_hms_opt(12, 0, 0)
        .unwrap();
    let states = lifecycles(&pool, now).await;
    assert_eq!(task_state(&states, orphan.id.sid()).timing, Timing::Active);

    // Write path: the very same chain refuses a scoped child, because the window that child
    // would have to fit inside cannot be read.
    let rejected = create_task_under(
        &pool,
        CreateTaskRequest {
            title: "Scoped Child".into(),
            parent_type: "task".into(),
            parent_id: orphan.id.sid(),
            time_scope: Some(single(week_in_july)),
            ..Default::default()
        },
    )
    .await;
    assert!(
        matches!(rejected, Err(arlesh_lib::tasks::error::TaskError::GoalNotFound(id)) if id == goal.id),
        "the write must name the reference it could not follow, got {rejected:?}",
    );
    assert_eq!(
        scoped_children_of(&pool, orphan.id.sid()).await,
        0,
        "a rejected write must leave nothing behind"
    );
}

/// Counts the tasks parented by task `parent_id`. Written out rather than reusing `count_where`
/// because the polymorphic parent link needs both halves: task 1 and goal 1 are different
/// parents, and matching on `parent_id` alone conflates them.
async fn scoped_children_of(pool: &sqlx::SqlitePool, parent_id: i64) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM tasks WHERE parent_type = 'task' AND parent_id = ?")
        .bind(parent_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn a_cyclic_ancestor_chain_renders_fine_and_rejects_a_write() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let (_, week_in_july, _) = july_scopes(&pool).await;
    let anchor = create_task_under(
        &pool,
        CreateTaskRequest {
            title: "Anchor".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    // 9001 and 9002 are each other's parent. Nothing in `update_task`, `reparent_conflicts` or
    // the schema prevents this today; before the chain's cycle guard every walk below spun
    // forever and hung the app.
    insert_raw_task(&pool, 9001, "task", 9002).await;
    insert_raw_task(&pool, 9002, "task", 9001).await;

    // Read path: the derivation terminates, the cyclic pair is unconstrained, and the healthy
    // task beside them still renders.
    let now = NaiveDate::from_ymd_opt(2026, 2, 1)
        .unwrap()
        .and_hms_opt(12, 0, 0)
        .unwrap();
    let states = lifecycles(&pool, now).await;
    assert_eq!(task_state(&states, 9001).timing, Timing::Active);
    assert_eq!(task_state(&states, anchor.id.sid()).timing, Timing::Active);

    // Write path: the same cycle refuses a scoped child.
    let rejected = create_task_under(
        &pool,
        CreateTaskRequest {
            title: "Scoped Child".into(),
            parent_type: "task".into(),
            parent_id: 9001,
            time_scope: Some(single(week_in_july)),
            ..Default::default()
        },
    )
    .await;
    assert!(
        matches!(
            rejected,
            Err(arlesh_lib::tasks::error::TaskError::AncestorCycle { .. })
        ),
        "a cyclic chain must reject the write rather than hang, got {rejected:?}",
    );
    assert_eq!(
        scoped_children_of(&pool, 9001).await,
        1,
        "only 9002 remains a child of 9001 — the rejected write left nothing behind"
    );
}

// ---------------------------------------------------------------------------
// retype_node — Phase 4
// ---------------------------------------------------------------------------

/// A goal worth retyping: scoped, private, tagged twice, blocked for a reason, depended on by two
/// tasks, and holding one task child and one info child.
struct RetypeFixture {
    project_id: i64,
    scope_id: ScopeKey,
    goal_id: i64,
    tag_ids: (i64, i64),
    dependents: (i64, i64),
    task_child_id: i64,
    info_child_id: i64,
}

async fn seed_retype_fixture(pool: &sqlx::SqlitePool) -> RetypeFixture {
    let project_id = make_project(pool).await;
    let tag_a = make_tag(pool).await;
    let tag_b = helpers::session_factory(pool)
        .connect()
        .await
        .unwrap()
        .domains()
        .create(CreateDomainRequest {
            title: "second-tag".into(),
            description: None,
            subtype: DomainSubtype::Tag,
            parent_id: None,
            status: None,
            knowledge_base_directory: None,
        })
        .await
        .unwrap()
        .id;
    let scope_id = arlesh_lib::scopes::model::Scope::containing(
        ScopeKind::Week,
        NaiveDate::from_ymd_opt(2026, 7, 1).unwrap(),
    )
    .unwrap()
    .id;

    let mut db = helpers::session_factory(pool).begin().await.unwrap();
    let goal = create_goal(
        &mut db,
        CreateGoalRequest {
            title: "Learn Rust".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: Some(GoalStatus::Frozen),
            time_scope: Some(TimeScope {
                start_id: scope_id,
                end_id: scope_id,
                duration: Some(DurationSpec {
                    n: 2,
                    kind: "week".into(),
                }),
            }),
            on_scope_exit: Some(OnScopeExit::Archive),
        },
    )
    .await
    .unwrap();
    update_goal(
        &mut db,
        arlesh_lib::tasks::model::GoalId(goal.id.sid()),
        UpdateGoalRequest {
            is_private: Some(true),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    db.goals()
        .add_tag(arlesh_lib::tasks::model::GoalId(goal.id.sid()), tag_a)
        .await
        .unwrap();
    db.goals()
        .add_tag(arlesh_lib::tasks::model::GoalId(goal.id.sid()), tag_b)
        .await
        .unwrap();
    db.block_reasons()
        .set(
            "goal",
            goal.id.sid(),
            &["waiting on the borrow checker".to_string()],
        )
        .await
        .unwrap();

    let task_child = create_task(
        &mut db,
        CreateTaskRequest {
            title: "Read the book".into(),
            parent_type: "goal".into(),
            parent_id: goal.id.sid(),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let info_child = db
        .infos()
        .create(arlesh_lib::infos::model::CreateInfoRequest {
            body: "ownership is the hard bit".into(),
            details: None,
            parent_type: "goal".into(),
            parent_id: goal.id.sid(),
            position: 0,
        })
        .await
        .unwrap();

    let mut dependents = Vec::new();
    for title in ["Ship the crate", "Write the post"] {
        let dependent = create_task(
            &mut db,
            CreateTaskRequest {
                title: title.into(),
                parent_type: "project".into(),
                parent_id: project_id,
                ..Default::default()
            },
        )
        .await
        .unwrap();
        add_task_dependency(
            &mut db,
            arlesh_lib::tasks::model::TaskId(dependent.id.sid()),
            Dependency::Goal { id: goal.id.sid() },
        )
        .await
        .unwrap();
        dependents.push(dependent.id);
    }
    db.commit().await.unwrap();

    RetypeFixture {
        project_id,
        scope_id,
        goal_id: goal.id.sid(),
        tag_ids: (tag_a, tag_b),
        dependents: (dependents[0].sid(), dependents[1].sid()),
        task_child_id: task_child.id.sid(),
        info_child_id: info_child.id,
    }
}

/// The columns a retyped task must have carried over, read straight off the row.
#[derive(sqlx::FromRow)]
struct RetypedTaskRow {
    title: String,
    status: String,
    time_scope_start_id: Option<ScopeKey>,
    time_scope_end_id: Option<ScopeKey>,
    time_scope_duration_n: Option<i64>,
    time_scope_duration_kind: Option<String>,
    on_scope_exit: Option<String>,
    is_private: bool,
}

async fn retyped_task_row(pool: &sqlx::SqlitePool, id: i64) -> RetypedTaskRow {
    sqlx::query_as(
        "SELECT title, status, time_scope_start_id, time_scope_end_id, time_scope_duration_n,
                time_scope_duration_kind, on_scope_exit, is_private FROM tasks WHERE id = ?",
    )
    .bind(id)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn dependency_rows(pool: &sqlx::SqlitePool) -> Vec<(i64, String, i64)> {
    sqlx::query_as(
        "SELECT task_id, dependency_type, dependency_id FROM task_dependencies ORDER BY task_id",
    )
    .fetch_all(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn the_retype_node_command_carries_a_goals_scope_tags_and_inbound_dependencies_onto_the_task()
{
    let pool = helpers::test_pool().await;
    let seeded = seed_retype_fixture(&pool).await;
    let app = helpers::command_host(&pool);

    // Nothing a task cannot hold, so no acknowledgement is asked for.
    let retyped = arlesh_lib::commands::retype::retype_node(
        app.state(),
        "goal".into(),
        seeded.goal_id.into(),
        "task".into(),
        None,
        None,
    )
    .await
    .expect("a goal with only task and info children loses nothing");
    let new_id = retyped.id;

    // The row itself — read back from the pool, so only a committed transaction can satisfy it.
    let row = retyped_task_row(&pool, new_id).await;
    assert_eq!(row.title, "Learn Rust");
    assert_eq!(row.status, "todo", "a frozen goal is not a done task");
    assert_eq!(
        (row.time_scope_start_id, row.time_scope_end_id),
        (Some(seeded.scope_id), Some(seeded.scope_id)),
        "the Time Scope"
    );
    assert_eq!(
        (
            row.time_scope_duration_n,
            row.time_scope_duration_kind.as_deref()
        ),
        (Some(2), Some("week")),
        "including the Duration form it was set in"
    );
    assert_eq!(
        row.on_scope_exit.as_deref(),
        Some("archive"),
        "and its on-exit behaviour"
    );
    assert!(
        row.is_private,
        "privacy carries — the flow-item precedent drops it, this must not"
    );

    // The tags moved into the task join table.
    let mut tags: Vec<i64> =
        sqlx::query_scalar("SELECT tag_id FROM tags_on_tasks WHERE task_id = ?")
            .bind(new_id)
            .fetch_all(&pool)
            .await
            .unwrap();
    tags.sort_unstable();
    let mut expected = vec![seeded.tag_ids.0, seeded.tag_ids.1];
    expected.sort_unstable();
    assert_eq!(
        tags, expected,
        "both tags must be re-attached to the new owner"
    );

    // The explicit block reason followed its owner.
    let reasons: Vec<String> = sqlx::query_scalar(
        "SELECT reason FROM block_reasons WHERE owner_type = 'task' AND owner_id = ?",
    )
    .bind(new_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(reasons, vec!["waiting on the borrow checker".to_string()]);
    assert_eq!(
        count_where(&pool, "block_reasons", "owner_id", seeded.goal_id).await,
        0,
        "and left none behind on the deleted goal"
    );

    // Both inbound dependency edges now name the task, and none dangles at the dead goal id.
    let mut edges = dependency_rows(&pool).await;
    edges.sort();
    assert_eq!(
        edges,
        vec![
            (
                seeded.dependents.0.min(seeded.dependents.1),
                "task".to_string(),
                new_id
            ),
            (
                seeded.dependents.0.max(seeded.dependents.1),
                "task".to_string(),
                new_id
            ),
        ],
        "every edge must be repointed: `dependency_id` has no foreign key and SQLite reuses freed ids"
    );

    // Children came with it, and the old row is gone.
    let (child_parent_type, child_parent_id): (String, i64) =
        sqlx::query_as("SELECT parent_type, parent_id FROM tasks WHERE id = ?")
            .bind(seeded.task_child_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        (child_parent_type.as_str(), child_parent_id),
        ("task", new_id)
    );
    let (info_parent_type, info_parent_id): (String, i64) =
        sqlx::query_as("SELECT parent_type, parent_id FROM infos WHERE id = ?")
            .bind(seeded.info_child_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        (info_parent_type.as_str(), info_parent_id),
        ("task", new_id)
    );
    assert_eq!(
        count_where(&pool, "goals", "id", seeded.goal_id).await,
        0,
        "the goal row is gone"
    );
}

#[tokio::test]
async fn the_retype_node_command_refuses_until_the_caller_acknowledges_the_children_it_would_strand(
) {
    let pool = helpers::test_pool().await;
    let seeded = seed_retype_fixture(&pool).await;
    let sub_goal = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let __r = create_goal(
            &mut db,
            CreateGoalRequest {
                title: "Finish the tutorial".into(),
                parent_type: "goal".into(),
                parent_id: seeded.goal_id,
                ..Default::default()
            },
        )
        .await
        .unwrap();
        db.commit().await.unwrap();
        __r
    };
    let app = helpers::command_host(&pool);

    let refused = arlesh_lib::commands::retype::retype_node(
        app.state(),
        "goal".into(),
        seeded.goal_id.into(),
        "task".into(),
        None,
        None,
    )
    .await
    .expect_err("a task cannot hold a sub-goal, so the command must ask first");

    let wire = serde_json::to_value(&refused).unwrap();
    assert_eq!(wire["kind"], serde_json::json!("needs_confirmation"));
    assert_eq!(
        wire["details"],
        serde_json::json!({
            "lost_children": [{ "kind": "goal", "id": sub_goal.id, "title": "Finish the tutorial" }],
            "lost_fields": [],
            "parent_climb": null,
        }),
        "the payload must name what is at stake — a refusal you can only accept blind is not consent"
    );
    assert_eq!(
        count_where(&pool, "goals", "id", seeded.goal_id).await,
        1,
        "and the refusal must write nothing"
    );

    // Acknowledged, with the sub-goal moved up rather than deleted.
    let retyped = arlesh_lib::commands::retype::retype_node(
        app.state(),
        "goal".into(),
        seeded.goal_id.into(),
        "task".into(),
        Some(arlesh_lib::tasks::retype::StrandedChildren::Reparent),
        None,
    )
    .await
    .unwrap();

    let (parent_type, parent_id): (String, i64) =
        sqlx::query_as("SELECT parent_type, parent_id FROM goals WHERE id = ?")
            .bind(sub_goal.id.sid())
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        (parent_type.as_str(), parent_id),
        ("project", seeded.project_id),
        "the stranded sub-goal moves up to the retyped node's own parent"
    );
    assert_eq!(count_where(&pool, "tasks", "id", retyped.id).await, 1);
    assert_eq!(count_where(&pool, "goals", "id", seeded.goal_id).await, 0);
}

#[tokio::test]
async fn a_retype_that_fails_after_the_create_leaves_the_tree_exactly_as_it_was() {
    let pool = helpers::test_pool().await;
    let seeded = seed_retype_fixture(&pool).await;

    // The command's own shape: begin, plan, apply, commit. This test stands in for the caller and
    // fails where the command's `?` would fire — after the create and the delete have both landed
    // inside the transaction.
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let planned = arlesh_lib::tasks::retype::plan_node_retype(
        &mut db,
        arlesh_lib::tasks::retype::RetypeKind::Goal,
        seeded.goal_id,
        arlesh_lib::tasks::retype::RetypeKind::Task,
    )
    .await
    .unwrap();
    let node = arlesh_lib::tasks::retype::apply_retype(
        &mut db,
        &planned,
        arlesh_lib::tasks::retype::StrandedChildren::Reparent,
    )
    .await
    .unwrap();

    // The retype really did get past its delete — otherwise the assertions below hold vacuously.
    assert!(
        db.tasks()
            .get(arlesh_lib::tasks::model::TaskId(node.id))
            .await
            .is_ok(),
        "the new task exists inside the transaction"
    );
    assert!(
        db.goals()
            .get(arlesh_lib::tasks::model::GoalId(seeded.goal_id))
            .await
            .is_err(),
        "and the goal is already gone inside it"
    );

    // The injected failure: a retype of a node that does not exist, rejected on real input. Any
    // error raised after `apply_retype` returns reaches the database the same way — the
    // `Db<Transactional>` is dropped without `commit()` and sqlx rolls back — so this stands for
    // the whole class, the failing `commit()` included.
    let rejected = arlesh_lib::tasks::retype::plan_node_retype(
        &mut db,
        arlesh_lib::tasks::retype::RetypeKind::Goal,
        909_909,
        arlesh_lib::tasks::retype::RetypeKind::Task,
    )
    .await;
    assert!(rejected.is_err(), "there is no goal 909909");
    drop(db);

    // Nothing moved.
    assert_eq!(
        count_where(&pool, "goals", "id", seeded.goal_id).await,
        1,
        "the goal is back"
    );
    assert_eq!(
        count_where(&pool, "tasks", "id", node.id).await,
        0,
        "the new task never existed"
    );
    assert_eq!(
        count_where(&pool, "tags_on_goals", "goal_id", seeded.goal_id).await,
        2,
        "its tags are still its own"
    );
    assert_eq!(
        count_where(&pool, "block_reasons", "owner_id", seeded.goal_id).await,
        1,
        "and its block reason"
    );
    let mut edges = dependency_rows(&pool).await;
    edges.sort();
    assert_eq!(
        edges,
        vec![
            (
                seeded.dependents.0.min(seeded.dependents.1),
                "goal".to_string(),
                seeded.goal_id
            ),
            (
                seeded.dependents.0.max(seeded.dependents.1),
                "goal".to_string(),
                seeded.goal_id
            ),
        ],
        "both dependency edges still name the goal"
    );
    let (child_parent_type, child_parent_id): (String, i64) =
        sqlx::query_as("SELECT parent_type, parent_id FROM tasks WHERE id = ?")
            .bind(seeded.task_child_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        (child_parent_type.as_str(), child_parent_id),
        ("goal", seeded.goal_id),
        "and the task child never moved"
    );
}

#[tokio::test]
async fn retyping_a_goal_to_a_project_ends_the_dependencies_it_announced_rather_than_dangling_them()
{
    let pool = helpers::test_pool().await;
    let seeded = seed_retype_fixture(&pool).await;
    let app = helpers::command_host(&pool);

    // A project cannot be depended on, cannot be scoped and cannot be tagged, so all of it is at
    // stake and the command refuses first.
    let refused = arlesh_lib::commands::retype::retype_node(
        app.state(),
        "goal".into(),
        seeded.goal_id.into(),
        "project".into(),
        None,
        None,
    )
    .await
    .expect_err("a project holds none of this");
    let wire = serde_json::to_value(&refused).unwrap();
    let lost: Vec<String> = wire["details"]["lost_fields"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["field"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(
        lost,
        vec!["time_scope", "tags", "block_reasons", "dependents"],
        "including the two tasks waiting on it, which are not a column of its row"
    );

    let retyped = arlesh_lib::commands::retype::retype_node(
        app.state(),
        "goal".into(),
        seeded.goal_id.into(),
        "project".into(),
        Some(arlesh_lib::tasks::retype::StrandedChildren::Reparent),
        None,
    )
    .await
    .unwrap();

    assert_eq!(
        dependency_rows(&pool).await,
        vec![],
        "the edges are deleted outright — left behind they would re-attach to the next row given the freed id"
    );
    let (subtype, status, is_private): (String, Option<String>, bool) =
        sqlx::query_as("SELECT subtype, status, is_private FROM domains WHERE id = ?")
            .bind(retyped.id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(subtype, "project");
    assert_eq!(
        status.as_deref(),
        Some("frozen"),
        "a project speaks the goal status vocabulary"
    );
    assert!(is_private, "and privacy still carries");
}

// --- beads_id: the link to a `bd` issue -------------------------------------------------------
//
// Settable only through the MCP server, which reaches `TaskOperator::set_beads_id` and
// `GoalOperator::set_beads_id` directly. No Tauri command writes it, and neither
// `UpdateTaskRequest` nor `UpdateGoalRequest` has a field for it — so the tests below pin both
// halves: the operators write and clear it, and a command round-trip leaves it exactly as it was.

/// A committed task under `project_id`, titled `title`.
async fn seed_task(pool: &sqlx::SqlitePool, project_id: i64, title: &str) -> i64 {
    let mut db = helpers::session_factory(pool).begin().await.unwrap();
    let task = create_task(
        &mut db,
        CreateTaskRequest {
            title: title.into(),
            parent_type: "project".into(),
            parent_id: project_id,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    db.commit().await.unwrap();
    task.id.sid()
}

/// A committed goal under `project_id`, titled `title`.
async fn seed_goal(pool: &sqlx::SqlitePool, project_id: i64, title: &str) -> i64 {
    let mut db = helpers::session_factory(pool).begin().await.unwrap();
    let goal = create_goal(
        &mut db,
        CreateGoalRequest {
            title: title.into(),
            parent_type: "project".into(),
            parent_id: project_id,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    db.commit().await.unwrap();
    goal.id.sid()
}

#[tokio::test]
async fn set_beads_id_is_carried_by_every_task_read() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let task_id = seed_task(&pool, project_id, "Tracked").await;
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();

    assert_eq!(
        db.tasks().get(task_id.into()).await.unwrap().beads_id,
        None,
        "a new task is linked to nothing"
    );

    db.tasks()
        .set_beads_id(task_id.into(), Some("Arlesh-5fs".into()))
        .await
        .unwrap();

    assert_eq!(
        db.tasks()
            .get(task_id.into())
            .await
            .unwrap()
            .beads_id
            .as_deref(),
        Some("Arlesh-5fs")
    );
    let listed = db.tasks().list().await.unwrap();
    assert_eq!(
        listed
            .iter()
            .find(|t| t.id == task_id)
            .unwrap()
            .beads_id
            .as_deref(),
        Some("Arlesh-5fs"),
        "a list read must carry the link too, not just a by-id read"
    );
}

#[tokio::test]
async fn set_beads_id_is_carried_by_every_goal_read() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let goal_id = seed_goal(&pool, project_id, "Tracked").await;
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();

    assert_eq!(
        db.goals().get(goal_id.into()).await.unwrap().beads_id,
        None,
        "a new goal is linked to nothing"
    );

    db.goals()
        .set_beads_id(goal_id.into(), Some("Arlesh-5fs".into()))
        .await
        .unwrap();

    assert_eq!(
        db.goals()
            .get(goal_id.into())
            .await
            .unwrap()
            .beads_id
            .as_deref(),
        Some("Arlesh-5fs")
    );
    let listed = db.goals().list().await.unwrap();
    assert_eq!(
        listed
            .iter()
            .find(|g| g.id == goal_id)
            .unwrap()
            .beads_id
            .as_deref(),
        Some("Arlesh-5fs"),
        "a list read must carry the link too, not just a by-id read"
    );
}

#[tokio::test]
async fn set_beads_id_clears_a_task_or_goal_link_when_given_none() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let task_id = seed_task(&pool, project_id, "Unlinked").await;
    let goal_id = seed_goal(&pool, project_id, "Unlinked").await;
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    db.tasks()
        .set_beads_id(task_id.into(), Some("Arlesh-5fs".into()))
        .await
        .unwrap();
    db.goals()
        .set_beads_id(goal_id.into(), Some("Arlesh-5fs".into()))
        .await
        .unwrap();

    db.tasks().set_beads_id(task_id.into(), None).await.unwrap();
    db.goals().set_beads_id(goal_id.into(), None).await.unwrap();

    assert_eq!(db.tasks().get(task_id.into()).await.unwrap().beads_id, None);
    assert_eq!(db.goals().get(goal_id.into()).await.unwrap().beads_id, None);
}

#[tokio::test]
async fn set_beads_id_rejects_an_unknown_task_or_goal() {
    let pool = helpers::test_pool().await;
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();

    let task_err = db
        .tasks()
        .set_beads_id(999_999.into(), Some("Arlesh-5fs".into()))
        .await
        .unwrap_err();
    assert!(
        matches!(
            task_err,
            arlesh_lib::tasks::error::TaskError::TaskNotFound(999_999)
        ),
        "expected TaskNotFound, got {task_err:?}"
    );

    let goal_err = db
        .goals()
        .set_beads_id(999_999.into(), Some("Arlesh-5fs".into()))
        .await
        .unwrap_err();
    assert!(
        matches!(
            goal_err,
            arlesh_lib::tasks::error::TaskError::GoalNotFound(999_999)
        ),
        "expected GoalNotFound, got {goal_err:?}"
    );
}

/// The write-path constraint: `update_task` is the only command that writes a task, and it can
/// neither set, change nor clear `beads_id`.
#[tokio::test]
async fn the_update_task_command_cannot_touch_beads_id() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let linked_id = seed_task(&pool, project_id, "Linked").await;
    let unlinked_id = seed_task(&pool, project_id, "Unlinked").await;
    {
        let mut db = helpers::session_factory(&pool).connect().await.unwrap();
        db.tasks()
            .set_beads_id(linked_id.into(), Some("Arlesh-5fs".into()))
            .await
            .unwrap();
    }

    let app = helpers::command_host(&pool);
    let updated = task_commands::update_task(
        app.state(),
        linked_id.into(),
        UpdateTaskRequest {
            title: Some("Renamed".into()),
            status: Some(TaskStatus::InProgress),
            is_private: Some(true),
            ..Default::default()
        },
        None,
    )
    .await
    .unwrap();
    assert_eq!(updated.title, "Renamed", "the update itself must land");
    assert_eq!(
        updated.beads_id.as_deref(),
        Some("Arlesh-5fs"),
        "an update must neither change nor clear the beads link"
    );

    let untouched = task_commands::update_task(
        app.state(),
        unlinked_id.into(),
        UpdateTaskRequest {
            title: Some("Also renamed".into()),
            ..Default::default()
        },
        None,
    )
    .await
    .unwrap();
    assert_eq!(
        untouched.beads_id, None,
        "and it must not be able to set one"
    );

    let stored: Option<String> = sqlx::query_scalar("SELECT beads_id FROM tasks WHERE id = ?")
        .bind(linked_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        stored.as_deref(),
        Some("Arlesh-5fs"),
        "and the stored row must agree"
    );
}

/// The goal half of the same constraint.
#[tokio::test]
async fn the_update_goal_command_cannot_touch_beads_id() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let linked_id = seed_goal(&pool, project_id, "Linked").await;
    let unlinked_id = seed_goal(&pool, project_id, "Unlinked").await;
    {
        let mut db = helpers::session_factory(&pool).connect().await.unwrap();
        db.goals()
            .set_beads_id(linked_id.into(), Some("Arlesh-5fs".into()))
            .await
            .unwrap();
    }

    let app = helpers::command_host(&pool);
    let updated = task_commands::update_goal(
        app.state(),
        linked_id.into(),
        UpdateGoalRequest {
            title: Some("Renamed".into()),
            status: Some(GoalStatus::Frozen),
            is_private: Some(true),
            ..Default::default()
        },
        None,
    )
    .await
    .unwrap();
    assert_eq!(updated.title, "Renamed", "the update itself must land");
    assert_eq!(
        updated.beads_id.as_deref(),
        Some("Arlesh-5fs"),
        "an update must neither change nor clear the beads link"
    );

    let untouched = task_commands::update_goal(
        app.state(),
        unlinked_id.into(),
        UpdateGoalRequest {
            title: Some("Also renamed".into()),
            ..Default::default()
        },
        None,
    )
    .await
    .unwrap();
    assert_eq!(
        untouched.beads_id, None,
        "and it must not be able to set one"
    );

    let stored: Option<String> = sqlx::query_scalar("SELECT beads_id FROM goals WHERE id = ?")
        .bind(linked_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        stored.as_deref(),
        Some("Arlesh-5fs"),
        "and the stored row must agree"
    );
}

// --- Backlog: the write-time invariant, and the lifecycle it feeds ---------------------------
//
// A Task is never both backlogged and planned. The rule is asymmetric on purpose: backlogging a
// planned Task is refused until the caller says to drop the Plan, while planning a backlogged one
// simply takes it out of the backlog. Both directions are asserted on the stored row, not on the
// absence of an error.

/// A project, a week Time Scope and a day inside it — the setting for every test below.
async fn backlog_fixture(pool: &sqlx::SqlitePool) -> (i64, TimeScope, TimeScope) {
    let project_id = make_project(pool).await;
    let week = arlesh_lib::scopes::model::Scope::containing(
        ScopeKind::Week,
        NaiveDate::from_ymd_opt(2026, 7, 1).unwrap(),
    )
    .unwrap();
    let day = arlesh_lib::scopes::model::Scope::containing(
        ScopeKind::Day,
        NaiveDate::from_ymd_opt(2026, 7, 1).unwrap(),
    )
    .unwrap();
    (project_id, single(week.id), single(day.id))
}

async fn new_task(
    pool: &sqlx::SqlitePool,
    request: CreateTaskRequest,
) -> arlesh_lib::tasks::model::Task {
    let mut db = helpers::session_factory(pool).begin().await.unwrap();
    let created = create_task(&mut db, request).await;
    if created.is_ok() {
        db.commit().await.unwrap();
    }
    created.unwrap()
}

async fn try_update(
    pool: &sqlx::SqlitePool,
    id: i64,
    request: UpdateTaskRequest,
) -> Result<arlesh_lib::tasks::model::Task, arlesh_lib::tasks::error::TaskError> {
    let mut db = helpers::session_factory(pool).begin().await.unwrap();
    let result = update_task(&mut db, id.into(), request).await;
    if result.is_ok() {
        db.commit().await.unwrap();
    }
    result
}

#[tokio::test]
async fn a_task_starts_out_in_play() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let task = new_task(
        &pool,
        CreateTaskRequest {
            title: "Ordinary".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            ..Default::default()
        },
    )
    .await;
    assert_eq!(task.archival, TaskArchival::Live);
}

#[tokio::test]
async fn an_unplanned_task_can_be_put_in_the_backlog_and_taken_back_out() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let task = new_task(
        &pool,
        CreateTaskRequest {
            title: "Not now".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: Some(TaskStatus::InProgress),
            ..Default::default()
        },
    )
    .await;

    let aside = try_update(
        &pool,
        task.id.sid(),
        UpdateTaskRequest {
            archival: Some(TaskArchival::Backlog),
            ..Default::default()
        },
    )
    .await
    .expect("backlogging an unplanned task is allowed");
    assert_eq!(aside.archival, TaskArchival::Backlog);
    // Backlog is the other axis: the work still says where it stands.
    assert_eq!(aside.status, TaskStatus::InProgress.as_str());

    let back = try_update(
        &pool,
        task.id.sid(),
        UpdateTaskRequest {
            archival: Some(TaskArchival::Live),
            ..Default::default()
        },
    )
    .await
    .expect("taking it back out is allowed");
    assert_eq!(back.archival, TaskArchival::Live);
    assert_eq!(back.status, TaskStatus::InProgress.as_str());
}

#[tokio::test]
async fn backlogging_a_planned_task_is_refused_pending_confirmation() {
    let pool = helpers::test_pool().await;
    let (project_id, week, day) = backlog_fixture(&pool).await;
    let task = new_task(
        &pool,
        CreateTaskRequest {
            title: "Scheduled".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(week),
            plan: Some(day.clone()),
            ..Default::default()
        },
    )
    .await;

    let refused = try_update(
        &pool,
        task.id.sid(),
        UpdateTaskRequest {
            archival: Some(TaskArchival::Backlog),
            ..Default::default()
        },
    )
    .await;
    assert!(
        matches!(
            refused,
            Err(arlesh_lib::tasks::error::TaskError::BacklogWithPlan)
        ),
        "expected a refusal the caller can answer, got {refused:?}",
    );

    // The refusal is a refusal: nothing was written, so both halves stand exactly as they were.
    let stored = helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .tasks()
        .get(task.id.sid().into())
        .await
        .unwrap();
    assert_eq!(stored.archival, TaskArchival::Live);
    assert_eq!(stored.plan.map(|p| p.start_id), Some(day.start_id));
}

#[tokio::test]
async fn clearing_the_plan_and_backlogging_in_one_request_is_accepted() {
    let pool = helpers::test_pool().await;
    let (project_id, week, day) = backlog_fixture(&pool).await;
    let task = new_task(
        &pool,
        CreateTaskRequest {
            title: "Scheduled".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(week),
            plan: Some(day),
            ..Default::default()
        },
    )
    .await;

    let aside = try_update(
        &pool,
        task.id.sid(),
        UpdateTaskRequest {
            archival: Some(TaskArchival::Backlog),
            plan: Some(None),
            ..Default::default()
        },
    )
    .await
    .expect("the acknowledged form of the same write goes through");
    assert_eq!(aside.archival, TaskArchival::Backlog);
    assert!(aside.plan.is_none());
    // Setting it aside touches nothing else about it.
    assert!(
        aside.time_scope.is_some(),
        "the Time Scope is not the Plan and must survive"
    );
}

#[tokio::test]
async fn planning_a_backlogged_task_takes_it_out_of_the_backlog() {
    let pool = helpers::test_pool().await;
    let (project_id, week, day) = backlog_fixture(&pool).await;
    let task = new_task(
        &pool,
        CreateTaskRequest {
            title: "Set aside".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(week),
            archival: Some(TaskArchival::Backlog),
            ..Default::default()
        },
    )
    .await;
    assert_eq!(task.archival, TaskArchival::Backlog);

    // No prompt, no second call: scheduling something is all it takes to put it back in play.
    let planned = try_update(
        &pool,
        task.id.sid(),
        UpdateTaskRequest {
            plan: Some(Some(day.clone())),
            ..Default::default()
        },
    )
    .await
    .expect("planning a backlogged task is never refused");
    assert_eq!(planned.archival, TaskArchival::Live);
    assert_eq!(planned.plan.map(|p| p.start_id), Some(day.start_id));
}

#[tokio::test]
async fn starting_a_backlogged_task_takes_it_out_of_the_backlog() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let task = new_task(
        &pool,
        CreateTaskRequest {
            title: "Set aside".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            archival: Some(TaskArchival::Backlog),
            ..Default::default()
        },
    )
    .await;
    assert_eq!(task.archival, TaskArchival::Backlog);

    // One write, so one undo step: you cannot be actively doing something you have put down.
    let started = try_update(
        &pool,
        task.id.sid(),
        UpdateTaskRequest {
            status: Some(TaskStatus::InProgress),
            ..Default::default()
        },
    )
    .await
    .expect("starting a backlogged task is never refused");
    assert_eq!(started.archival, TaskArchival::Live);
    assert_eq!(started.status, TaskStatus::InProgress.as_str());
}

#[tokio::test]
async fn finishing_a_backlogged_task_leaves_it_in_the_backlog() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let task = new_task(
        &pool,
        CreateTaskRequest {
            title: "Set aside".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            archival: Some(TaskArchival::Backlog),
            ..Default::default()
        },
    )
    .await;

    // Only In Progress says the work is under way. Ticking a set-aside task off is not a claim
    // that it ever came back into play.
    let done = try_update(
        &pool,
        task.id.sid(),
        UpdateTaskRequest {
            status: Some(TaskStatus::Done),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(done.archival, TaskArchival::Backlog);
}

#[tokio::test]
async fn a_request_naming_the_backlog_alongside_in_progress_is_taken_at_its_word() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let task = new_task(
        &pool,
        CreateTaskRequest {
            title: "Under way".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: Some(TaskStatus::InProgress),
            ..Default::default()
        },
    )
    .await;

    // The rule is one-directional, and not an invariant: a task already under way may still be
    // set aside, and keeps its status so it says where the work stood when it is pulled back.
    let set_aside = try_update(
        &pool,
        task.id.sid(),
        UpdateTaskRequest {
            status: Some(TaskStatus::InProgress),
            archival: Some(TaskArchival::Backlog),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(set_aside.archival, TaskArchival::Backlog);
    assert_eq!(set_aside.status, TaskStatus::InProgress.as_str());
}

#[tokio::test]
async fn editing_a_backlogged_task_leaves_it_in_the_backlog() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let task = new_task(
        &pool,
        CreateTaskRequest {
            title: "Set aside".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            archival: Some(TaskArchival::Backlog),
            ..Default::default()
        },
    )
    .await;

    let renamed = try_update(
        &pool,
        task.id.sid(),
        UpdateTaskRequest {
            title: Some("Set aside, renamed".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(renamed.archival, TaskArchival::Backlog);
}

#[tokio::test]
async fn creating_a_task_both_backlogged_and_planned_is_refused() {
    let pool = helpers::test_pool().await;
    let (project_id, week, day) = backlog_fixture(&pool).await;
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let refused = create_task(
        &mut db,
        CreateTaskRequest {
            title: "Contradiction".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(week),
            plan: Some(day),
            archival: Some(TaskArchival::Backlog),
            ..Default::default()
        },
    )
    .await;
    assert!(
        matches!(
            refused,
            Err(arlesh_lib::tasks::error::TaskError::BacklogWithPlan)
        ),
        "the invariant holds on create too, got {refused:?}",
    );
}

#[tokio::test]
async fn a_backlogged_task_reports_backlog_through_the_lifecycle_derivation() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let task = new_task(
        &pool,
        CreateTaskRequest {
            title: "Set aside".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            archival: Some(TaskArchival::Backlog),
            ..Default::default()
        },
    )
    .await;

    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    let lifecycles = derive_all_scope_lifecycles(
        &mut db,
        NaiveDate::from_ymd_opt(2026, 7, 1)
            .unwrap()
            .and_hms_opt(12, 0, 0)
            .unwrap(),
    )
    .await
    .unwrap();
    let entry = lifecycles
        .iter()
        .find(|l| l.node_type == "task" && l.node_id == task.id)
        .expect("the task is in the derivation");
    assert_eq!(entry.archival, Archival::Backlog);
    assert!(!entry.archival_conflict);
}

#[tokio::test]
async fn a_scoped_backlogged_task_still_lapses_missed_when_its_window_closes() {
    let pool = helpers::test_pool().await;
    let (project_id, week, _) = backlog_fixture(&pool).await;
    let task = new_task(
        &pool,
        CreateTaskRequest {
            title: "Set aside, and scoped".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(week),
            on_scope_exit: Some(OnScopeExit::Archive),
            archival: Some(TaskArchival::Backlog),
            ..Default::default()
        },
    )
    .await;

    // Long after the week has closed, unfinished.
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    let lifecycles = derive_all_scope_lifecycles(
        &mut db,
        NaiveDate::from_ymd_opt(2026, 9, 1)
            .unwrap()
            .and_hms_opt(0, 0, 0)
            .unwrap(),
    )
    .await
    .unwrap();
    let entry = lifecycles
        .iter()
        .find(|l| l.node_type == "task" && l.node_id == task.id)
        .expect("the task is in the derivation");
    assert_eq!(entry.timing, Timing::Lapsed);
    assert_eq!(entry.resolution, Some(Resolution::Missed));
    // Setting a scoped task aside does not protect it from its own window — and the override of a
    // deliberate choice is flagged rather than performed quietly.
    assert_eq!(entry.archival, Archival::Archived);
    assert!(entry.archival_conflict);
}

// --- Clearing a Task's or Goal's nullable fields (Arlesh-atb) ---
//
// `Option<Option<T>>` spells *absent = leave unchanged, null = clear*, but serde collapses both
// spellings to `None` on its own — which every `merge` reads as "unchanged". The task and goal
// editors send the whole form on every save, so emptying a Time Scope, a Plan or a delegate puts a
// JSON `null` on the wire and the save used to succeed while changing nothing. One test per field:
// each carries its own `#[serde(default, deserialize_with = "crate::wire::null_clears")]`, and a
// missing attribute on any one of them is its own silent drop.

#[test]
fn an_explicit_null_delegate_in_a_task_update_payload_clears_it() {
    let absent: UpdateTaskRequest = serde_json::from_str(r#"{"title":"Renamed"}"#).unwrap();
    assert_eq!(
        absent.delegate_to, None,
        "an absent key leaves the delegate alone"
    );
    let nulled: UpdateTaskRequest = serde_json::from_str(r#"{"delegate_to":null}"#).unwrap();
    assert_eq!(
        nulled.delegate_to,
        Some(None),
        "an explicit null clears the delegate"
    );
    let set: UpdateTaskRequest =
        serde_json::from_str(r#"{"delegate_to":{"kind":"person","id":7}}"#).unwrap();
    assert_eq!(
        set.delegate_to,
        Some(Some(arlesh_lib::tasks::model::Delegate::Person { id: 7 }))
    );
    let agent: UpdateTaskRequest =
        serde_json::from_str(r#"{"delegate_to":{"kind":"agent"}}"#).unwrap();
    assert_eq!(
        agent.delegate_to,
        Some(Some(arlesh_lib::tasks::model::Delegate::Agent))
    );
}

#[test]
fn an_explicit_null_time_scope_in_a_task_update_payload_clears_it() {
    let absent: UpdateTaskRequest = serde_json::from_str(r#"{"title":"Renamed"}"#).unwrap();
    assert_eq!(
        absent.time_scope, None,
        "an absent key leaves the Time Scope alone"
    );
    let nulled: UpdateTaskRequest = serde_json::from_str(r#"{"time_scope":null}"#).unwrap();
    assert_eq!(
        nulled.time_scope,
        Some(None),
        "an explicit null clears the Time Scope"
    );
    let set: UpdateTaskRequest = serde_json::from_str(
        r#"{"time_scope":{"start_id":"day:2026-07-01","end_id":"day:2026-07-02"}}"#,
    )
    .unwrap();
    assert_eq!(
        set.time_scope,
        Some(Some(TimeScope {
            start_id: "day:2026-07-01".parse().unwrap(),
            end_id: "day:2026-07-02".parse().unwrap(),
            duration: None
        }))
    );
}

#[test]
fn an_explicit_null_on_scope_exit_in_a_task_update_payload_clears_it() {
    let absent: UpdateTaskRequest = serde_json::from_str(r#"{"title":"Renamed"}"#).unwrap();
    assert_eq!(
        absent.on_scope_exit, None,
        "an absent key leaves the on-exit behavior alone"
    );
    let nulled: UpdateTaskRequest = serde_json::from_str(r#"{"on_scope_exit":null}"#).unwrap();
    assert_eq!(
        nulled.on_scope_exit,
        Some(None),
        "an explicit null clears the on-exit behavior"
    );
    let set: UpdateTaskRequest = serde_json::from_str(r#"{"on_scope_exit":"archive"}"#).unwrap();
    assert_eq!(set.on_scope_exit, Some(Some(OnScopeExit::Archive)));
}

#[test]
fn an_explicit_null_plan_in_a_task_update_payload_clears_it() {
    let absent: UpdateTaskRequest = serde_json::from_str(r#"{"title":"Renamed"}"#).unwrap();
    assert_eq!(absent.plan, None, "an absent key leaves the Plan alone");
    let nulled: UpdateTaskRequest = serde_json::from_str(r#"{"plan":null}"#).unwrap();
    assert_eq!(nulled.plan, Some(None), "an explicit null clears the Plan");
    let set: UpdateTaskRequest =
        serde_json::from_str(r#"{"plan":{"start_id":"day:2026-07-03","end_id":"day:2026-07-04"}}"#)
            .unwrap();
    assert_eq!(
        set.plan,
        Some(Some(TimeScope {
            start_id: "day:2026-07-03".parse().unwrap(),
            end_id: "day:2026-07-04".parse().unwrap(),
            duration: None
        }))
    );
}

#[test]
fn an_explicit_null_time_scope_in_a_goal_update_payload_clears_it() {
    let absent: UpdateGoalRequest = serde_json::from_str(r#"{"title":"Renamed"}"#).unwrap();
    assert_eq!(
        absent.time_scope, None,
        "an absent key leaves the Time Scope alone"
    );
    let nulled: UpdateGoalRequest = serde_json::from_str(r#"{"time_scope":null}"#).unwrap();
    assert_eq!(
        nulled.time_scope,
        Some(None),
        "an explicit null clears the Time Scope"
    );
    let set: UpdateGoalRequest = serde_json::from_str(
        r#"{"time_scope":{"start_id":"day:2026-07-01","end_id":"day:2026-07-02"}}"#,
    )
    .unwrap();
    assert_eq!(
        set.time_scope,
        Some(Some(TimeScope {
            start_id: "day:2026-07-01".parse().unwrap(),
            end_id: "day:2026-07-02".parse().unwrap(),
            duration: None
        }))
    );
}

#[test]
fn an_explicit_null_on_scope_exit_in_a_goal_update_payload_clears_it() {
    let absent: UpdateGoalRequest = serde_json::from_str(r#"{"title":"Renamed"}"#).unwrap();
    assert_eq!(
        absent.on_scope_exit, None,
        "an absent key leaves the on-exit behavior alone"
    );
    let nulled: UpdateGoalRequest = serde_json::from_str(r#"{"on_scope_exit":null}"#).unwrap();
    assert_eq!(
        nulled.on_scope_exit,
        Some(None),
        "an explicit null clears the on-exit behavior"
    );
    let set: UpdateGoalRequest = serde_json::from_str(r#"{"on_scope_exit":"keep"}"#).unwrap();
    assert_eq!(set.on_scope_exit, Some(Some(OnScopeExit::Keep)));
}

#[tokio::test]
async fn a_task_plan_is_placed_against_now_on_the_two_oclock_day_boundary() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let week = arlesh_lib::scopes::model::Scope::containing(
        ScopeKind::Week,
        NaiveDate::from_ymd_opt(2026, 7, 1).unwrap(),
    )
    .unwrap()
    .id;
    let friday = day_scope(&pool, 2026, 7, 3).await;
    let planned = new_task(
        &pool,
        CreateTaskRequest {
            title: "Planned for Friday".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(single(week)),
            plan: Some(single(friday)),
            ..Default::default()
        },
    )
    .await;
    let unplanned = new_task(
        &pool,
        CreateTaskRequest {
            title: "Unplanned".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            ..Default::default()
        },
    )
    .await;

    let at = |d: u32, h: u32, m: u32| {
        NaiveDate::from_ymd_opt(2026, 7, d)
            .unwrap()
            .and_hms_opt(h, m, 0)
            .unwrap()
    };
    for (now, expected) in [
        (at(1, 12, 0), Timing::Pending),
        // Friday's Day begins at 02:00, not midnight.
        (at(3, 1, 30), Timing::Pending),
        (at(3, 12, 0), Timing::Active),
        // …and runs until 02:00 on Saturday.
        (at(4, 1, 30), Timing::Active),
        (at(4, 3, 0), Timing::Lapsed),
    ] {
        let states = lifecycles(&pool, now).await;
        assert_eq!(
            task_state(&states, planned.id.sid()).plan_timing,
            Some(expected),
            "at {now}"
        );
        assert_eq!(task_state(&states, unplanned.id.sid()).plan_timing, None);
    }
}
