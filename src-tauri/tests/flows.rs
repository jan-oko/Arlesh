mod helpers;

use arlesh_lib::flows::{
    model::{CreateFlowItemRequest, CreateFlowRequest, FlowId, InstanceType, UpdateFlowRequest},
    FlowRepository,
};

// Flows are parented under a seeded aspect (ids 1-6 exist from the initial migration).
fn create_req(title: &str) -> CreateFlowRequest {
    CreateFlowRequest {
        title: title.into(),
        instance_type: Some(InstanceType::Task),
        parent_type: "aspect".into(),
        parent_id: 1,
        flow_duration_n: Some(2),
        flow_duration_kind: Some("week".into()),
        ..Default::default()
    }
}

#[tokio::test]
async fn create_and_get_flow() {
    let pool = helpers::test_pool().await;
    let repo = FlowRepository::new(&pool);

    let flow = repo.create(create_req("Add Feature")).await.unwrap();
    assert_eq!(flow.title, "Add Feature");
    assert_eq!(flow.instance_type, "task");
    assert_eq!(flow.parent_type, "aspect");
    assert_eq!(flow.flow_duration_n, Some(2));
    assert_eq!(flow.flow_duration_kind.as_deref(), Some("week"));

    let fetched = repo.get(FlowId(flow.id)).await.unwrap();
    assert_eq!(fetched.id, flow.id);
}

#[tokio::test]
async fn instance_type_defaults_to_task() {
    let pool = helpers::test_pool().await;
    let repo = FlowRepository::new(&pool);
    let flow = repo
        .create(CreateFlowRequest { title: "F".into(), parent_type: "aspect".into(), parent_id: 1, ..Default::default() })
        .await
        .unwrap();
    assert_eq!(flow.instance_type, "task");
}

#[tokio::test]
async fn update_flow_changes_fields() {
    let pool = helpers::test_pool().await;
    let repo = FlowRepository::new(&pool);
    let flow = repo.create(create_req("Draft")).await.unwrap();

    let updated = repo
        .update(
            FlowId(flow.id),
            UpdateFlowRequest {
                title: Some("Renamed".into()),
                instance_type: Some(InstanceType::Goal),
                target_type: Some(Some("domain".into())),
                target_id: Some(Some(3)),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(updated.title, "Renamed");
    assert_eq!(updated.instance_type, "goal");
    assert_eq!(updated.target_type.as_deref(), Some("domain"));
    assert_eq!(updated.target_id, Some(3));
}

#[tokio::test]
async fn flow_items_are_created_and_listed() {
    let pool = helpers::test_pool().await;
    let repo = FlowRepository::new(&pool);
    let flow = repo.create(create_req("Feature")).await.unwrap();

    let specify = repo
        .create_task(CreateFlowItemRequest {
            flow_id: flow.id,
            title: "Specify".into(),
            parent_type: "flow".into(),
            parent_id: flow.id,
        })
        .await
        .unwrap();
    assert_eq!(specify.flow_id, flow.id);
    assert_eq!(specify.status, "todo");

    repo.create_goal(CreateFlowItemRequest {
        flow_id: flow.id,
        title: "Milestone".into(),
        parent_type: "flow".into(),
        parent_id: flow.id,
    })
    .await
    .unwrap();

    let tasks = repo.list_tasks(FlowId(flow.id)).await.unwrap();
    let goals = repo.list_goals(FlowId(flow.id)).await.unwrap();
    assert_eq!(tasks.len(), 1);
    assert_eq!(goals.len(), 1);
    assert_eq!(goals[0].status, "active");
}

#[tokio::test]
async fn deleting_a_flow_cascades_to_its_items() {
    let pool = helpers::test_pool().await;
    let repo = FlowRepository::new(&pool);
    let flow = repo.create(create_req("Doomed")).await.unwrap();
    repo.create_task(CreateFlowItemRequest {
        flow_id: flow.id,
        title: "T".into(),
        parent_type: "flow".into(),
        parent_id: flow.id,
    })
    .await
    .unwrap();

    repo.delete(FlowId(flow.id)).await.unwrap();

    assert!(repo.get(FlowId(flow.id)).await.is_err());
    assert!(repo.list_tasks(FlowId(flow.id)).await.unwrap().is_empty());
}
