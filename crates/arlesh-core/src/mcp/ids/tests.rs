use super::*;
use crate::nodes::id::DerivedId;

fn entry(table: NodeTable, id: i64, title: &str, parent: Option<(NodeTable, i64)>) -> Entry {
    Entry {
        table,
        id: NodeId::Stored(id),
        kind: table.as_str().to_string(),
        title: title.into(),
        parent: parent.map(|(table, id)| (table, NodeId::Stored(id))),
    }
}

/// Growth › Code › Arlesh › Features, and a task under Features.
fn board() -> NodeNames {
    NodeNames::from_entries(vec![
        entry(NodeTable::Domain, 1, "Growth", None),
        entry(NodeTable::Domain, 2, "Code", Some((NodeTable::Domain, 1))),
        entry(NodeTable::Domain, 3, "Arlesh", Some((NodeTable::Domain, 2))),
        entry(NodeTable::Goal, 4, "Features", Some((NodeTable::Domain, 3))),
        entry(NodeTable::Task, 5, "Search", Some((NodeTable::Goal, 4))),
    ])
}

#[test]
fn a_stored_nodes_full_id_is_a_uuid_v5_of_its_kind_and_row() {
    let id = full_id(NodeTable::Task, &NodeId::Stored(5));

    assert_eq!(id, uuid_v5(&NODE_NAMESPACE, "task:5"));
    assert_eq!(
        id,
        full_id(NodeTable::Task, &NodeId::Stored(5)),
        "deterministic"
    );
    assert_ne!(
        id,
        full_id(NodeTable::Goal, &NodeId::Stored(5)),
        "the kind is part of it"
    );
}

#[test]
fn a_derived_row_keeps_its_own_uuid() {
    let derived = DerivedId::of_key("flow_task:1:x:0");

    assert_eq!(
        full_id(NodeTable::Task, &NodeId::Derived(derived.clone())),
        derived.as_str()
    );
}

#[test]
fn every_short_id_is_a_prefix_of_three_or_more_that_no_other_node_shares() {
    let names = board();

    for node in &names.nodes {
        assert!(node.short_id.len() >= SHORTEST, "{}", node.short_id);
        assert!(node.hex.starts_with(&node.short_id));
        let sharing = names
            .nodes
            .iter()
            .filter(|other| other.hex.starts_with(&node.short_id))
            .count();
        assert_eq!(sharing, 1, "{} is unique", node.short_id);
    }
}

#[test]
fn a_short_id_grows_only_as_far_as_a_collision_needs() {
    let names = NodeNames::from_entries(Vec::new());
    assert!(names.nodes.is_empty());

    // Two ids sharing their first five digits need six to tell apart; a third that shares
    // nothing needs only three.
    let names = with_short_ids(vec![
        named("f00000", NodeTable::Task, 3),
        named("abcde2", NodeTable::Task, 2),
        named("abcde1", NodeTable::Task, 1),
    ]);
    let short = |id: i64| {
        names
            .short_id(NodeTable::Task, &NodeId::Stored(id))
            .unwrap_or("")
    };
    assert_eq!(short(1), "abcde1");
    assert_eq!(short(2), "abcde2");
    assert_eq!(short(3), "f00");
}

fn named(hex: &str, table: NodeTable, id: i64) -> Named {
    Named {
        short_id: String::new(),
        id: hex.into(),
        node_id: NodeId::Stored(id),
        kind: "task".into(),
        title: format!("task {id}"),
        path: String::new(),
        table,
        hex: hex.into(),
    }
}

fn with_short_ids(nodes: Vec<Named>) -> NodeNames {
    NodeNames::from_named(nodes)
}

#[test]
fn a_short_id_a_longer_prefix_and_the_full_id_all_resolve() {
    let names = board();
    let search = names
        .nodes
        .iter()
        .find(|node| node.title == "Search")
        .cloned()
        .expect("the task is named");

    for text in [
        search.short_id.clone(),
        search.hex[..search.short_id.len() + 1].to_string(),
        search.id.clone(),
        search.id.to_uppercase(),
    ] {
        let resolved = names.resolve(&text).expect("it names the task");
        assert_eq!(resolved.node_id, NodeId::Stored(5), "{text}");
    }
}

#[test]
fn a_prefix_shared_by_several_nodes_lists_them_with_their_paths() {
    let names = with_short_ids({
        let mut nodes = vec![
            named("abcde1", NodeTable::Task, 1),
            named("abcde2", NodeTable::Task, 2),
        ];
        nodes[0].path = "Growth › Code".into();
        nodes
    });

    match names.resolve("abc") {
        Err(IdRefusal::Ambiguous(candidates)) => {
            let shorts: Vec<&str> = candidates
                .iter()
                .map(|node| node.short_id.as_str())
                .collect();
            assert_eq!(shorts, vec!["abcde1", "abcde2"]);
            assert_eq!(candidates[0].path, "Growth › Code");
        }
        other => panic!("expected ambiguity, got {other:?}"),
    }
}

#[test]
fn nothing_shorter_than_three_digits_or_that_is_not_hex_resolves() {
    let names = board();

    assert!(matches!(names.resolve("ab"), Err(IdRefusal::Unknown)));
    assert!(matches!(names.resolve("xyz1"), Err(IdRefusal::Unknown)));
    assert!(matches!(
        names.resolve("000000000"),
        Err(IdRefusal::Unknown)
    ));
}

#[test]
fn a_path_names_the_nearest_three_ancestors_outermost_first() {
    let names = board();
    let path = |title: &str| {
        names
            .nodes
            .iter()
            .find(|node| node.title == title)
            .map(|node| node.path.clone())
            .unwrap_or_default()
    };

    assert_eq!(path("Growth"), "");
    assert_eq!(path("Arlesh"), "Growth › Code");
    assert_eq!(path("Search"), "… › Code › Arlesh › Features");
}

#[test]
fn a_node_not_yet_listed_gets_the_short_id_it_would_have_among_them() {
    let names = with_short_ids(vec![
        named("abcde1", NodeTable::Task, 1),
        named("f00000", NodeTable::Task, 3),
    ]);

    assert_eq!(
        names.short_id_among("abcd99"),
        "abcd9",
        "past its neighbour's shared digits"
    );
    assert_eq!(
        names.short_id_among("123c56"),
        "123",
        "sharing nothing, three digits"
    );
    assert_eq!(
        names.short_id_among("abcde1"),
        "abc",
        "a listed node is not its own neighbour"
    );
}

#[test]
fn a_digit_only_short_id_is_handed_out_and_resolves() {
    let names = with_short_ids(vec![
        named("269590f6", NodeTable::Task, 1),
        named("2a0000", NodeTable::Task, 2),
    ]);

    assert_eq!(
        names.short_id(NodeTable::Task, &NodeId::Stored(1)),
        Some("269")
    );
    assert!(matches!(
        names.resolve("269").map(|node| node.node_id.clone()),
        Ok(NodeId::Stored(1))
    ));
}

#[test]
fn a_string_that_is_both_a_row_id_and_a_prefix_is_ambiguous_listing_both() {
    let names = with_short_ids(vec![
        named("269590f6", NodeTable::Task, 1),
        named("abc123", NodeTable::Task, 269),
    ]);

    match names.resolve("269") {
        Err(IdRefusal::Ambiguous(candidates)) => {
            let rows: Vec<Option<i64>> = candidates
                .iter()
                .map(|candidate| candidate.node_id.stored())
                .collect();
            assert_eq!(rows.len(), 2);
            assert!(rows.contains(&Some(1)) && rows.contains(&Some(269)));
        }
        other => panic!("expected ambiguous_id, got {other:?}"),
    }
    assert!(matches!(
        names.resolve("abc").map(|node| node.node_id.clone()),
        Ok(NodeId::Stored(269))
    ));
}

#[test]
fn no_short_id_handed_out_equals_a_visible_row_id() {
    let names = with_short_ids(vec![
        named("269590f6", NodeTable::Task, 1),
        named("abc123", NodeTable::Task, 269),
        named("2695f000", NodeTable::Goal, 2695),
        named("777000", NodeTable::Task, 7),
    ]);

    let rows: Vec<String> = names
        .nodes
        .iter()
        .filter_map(|node| node.node_id.stored().map(|row| row.to_string()))
        .collect();
    for node in &names.nodes {
        assert!(
            !rows.contains(&node.short_id),
            "{} is a row id",
            node.short_id
        );
        assert!(node.short_id.len() >= SHORTEST);
    }
    assert_eq!(
        names.short_id(NodeTable::Task, &NodeId::Stored(1)),
        Some("26959"),
        "past 269 (a row id) and 2695 (another)"
    );
    assert_eq!(
        names.short_id_among("269500"),
        "26950",
        "a node not yet listed obeys the same rule"
    );
}

#[test]
fn a_node_of_another_kind_is_named_in_the_refusal() {
    let names = with_short_ids(vec![named("abc123", NodeTable::Goal, 4)]);

    assert!(matches!(
        names.resolve_as("abc", Some(NodeTable::Task)),
        Err(IdRefusal::WrongKind(node)) if node.node_id == NodeId::Stored(4)
    ));
    assert!(names.resolve_as("abc", Some(NodeTable::Goal)).is_ok());
    assert!(names.resolve_as("4", Some(NodeTable::Goal)).is_ok());
}
