use super::*;

#[test]
fn an_edge_names_each_end_by_the_id_it_travels_under() {
    let edge = DerivedEdge {
        dependent_id: None,
        dependent_key: Some("flow_task:1:{\"kind\":\"day\",\"date\":\"2026-01-05\"}:0".into()),
        target_type: "task".into(),
        target_id: Some(7),
        target_key: None,
        added: true,
    };
    assert_eq!(edge.target(), Some(NodeId::Stored(7)));
    assert_eq!(
        edge.dependent(),
        Some(NodeId::Derived(super::super::id::DerivedId::of_key(
            "flow_task:1:{\"kind\":\"day\",\"date\":\"2026-01-05\"}:0"
        )))
    );
    let empty = DerivedEdge {
        dependent_id: None,
        dependent_key: None,
        ..edge
    };
    assert_eq!(empty.dependent(), None);
}

#[test]
fn an_endpoint_fills_exactly_one_column() {
    assert_eq!(Endpoint::Stored(3).columns(), (Some(3), None));
    assert_eq!(Endpoint::Derived("k".into()).columns(), (None, Some("k")));
}
