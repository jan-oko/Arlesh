use super::*;

fn ids() -> IdMap {
    let mut ids = IdMap::default();
    for (kind, old) in [
        ("flow_task", 12),
        ("flow", 20),
        ("task", 5),
        ("expectation", 7),
        ("flow_item_cycle", 3),
    ] {
        ids.insert(kind, old, new_id(kind, old));
    }
    ids
}

#[test]
fn a_stored_row_keeps_the_full_id_the_mcp_always_showed() {
    // `uuid_v5("task:5")` in the namespace every node id lives in: pinned so a change to either
    // the namespace or the spelling is caught, since existing short ids hang on it.
    assert_eq!(new_id("task", 5), uuid_v5(&NODE_NAMESPACE, "task:5"));
    assert_eq!(new_id("task", 5).len(), 36);
}

#[test]
fn an_occurrence_key_is_spelled_with_the_new_ids_of_its_item_and_cycle() {
    let ids = ids();
    let scope = r#"{"kind":"week","date":"2026-09-20"}"#;
    let old = format!("flow_task:12:{scope}:3");
    let new = rewrite_key(&old, &ids).expect("known row");
    assert_eq!(
        new,
        format!(
            "flow_task:{}:{scope}:{}",
            new_id("flow_task", 12),
            new_id("flow_item_cycle", 3)
        )
    );
}

#[test]
fn no_cycle_becomes_the_nil_uuid_and_a_root_reads_the_flow() {
    let ids = ids();
    let scope = r#"{"kind":"day","date":"2026-09-22"}"#;
    let new = rewrite_key(&format!("flow_root:20:{scope}:0"), &ids).expect("known row");
    assert_eq!(
        new,
        format!("flow_root:{}:{scope}:{NO_CYCLE_ID}", new_id("flow", 20))
    );
}

#[test]
fn a_check_key_rewrites_the_wait_it_names() {
    let ids = ids();
    let new = rewrite_key("check:stored:7@2026-09-20T09:00:00", &ids).expect("known row");
    assert_eq!(
        new,
        format!("check:stored:{}@2026-09-20T09:00:00", new_id("expectation", 7))
    );
    let spelled = rewrite_key("stored:7", &ids).expect("known row");
    assert_eq!(spelled, format!("stored:{}", new_id("expectation", 7)));
}

#[test]
fn a_key_naming_a_row_the_map_lacks_is_left_for_the_caller() {
    assert_eq!(rewrite_key("flow_task:999:{}:0", &ids()), None);
    assert_eq!(rewrite_key("not a key", &ids()), None);
}

#[test]
fn a_spawned_wait_of_an_occurrence_follows_the_occurrences_new_id() {
    let mut ids = ids();
    let scope = r#"{"kind":"week","date":"2026-09-20"}"#;
    let occurrence = format!("flow_task:12:{scope}:3");
    let derived_old = uuid_v5(&NODE_NAMESPACE, &occurrence);
    let keys = vec![
        format!("spawned_wait:{derived_old}"),
        format!("delegation_wait:5"),
        occurrence.clone(),
    ];
    let pairs = rewrite_keys(&keys, &mut ids);
    let new_occurrence = rewrite_key(&occurrence, &ids).expect("known row");
    let new_derived = uuid_v5(&NODE_NAMESPACE, &new_occurrence);
    assert!(pairs.contains(&(
        format!("spawned_wait:{derived_old}"),
        format!("spawned_wait:{new_derived}")
    )));
    assert!(pairs.contains(&(
        "delegation_wait:5".to_string(),
        format!("delegation_wait:{}", new_id("task", 5))
    )));
}
