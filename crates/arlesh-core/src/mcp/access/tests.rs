use super::*;
use crate::access::model::StoredNode;
use crate::nodes::id::tid;
use crate::nodes::id::tkey;

fn node(kind: NodeTable, id: i64, parent: Option<NodeKey>) -> StoredNode {
    StoredNode {
        key: NodeKey::new(kind, tid(id)),
        parent,
        is_private: false,
        agentic: None,
        occurrence_agentic: None,
    }
}

/// Project 1 holds tasks 10 and 11; project 2 holds task 20. Only project 1 is an MCP root.
fn map() -> AccessMap {
    let project_one = NodeKey::new(NodeTable::Domain, tid(1));
    let project_two = NodeKey::new(NodeTable::Domain, tid(2));
    AccessMap::resolve(
        &[
            node(NodeTable::Domain, 1, None),
            node(NodeTable::Domain, 2, None),
            node(NodeTable::Task, 10, Some(project_one)),
            node(NodeTable::Task, 11, Some(project_one)),
            node(NodeTable::Task, 20, Some(project_two)),
        ],
        &[project_one],
    )
}

#[test]
fn a_reason_naming_an_unreadable_dependency_is_dropped_and_the_rest_are_kept() {
    let mut reasons = vec![
        "Waiting on the vendor".to_string(),
        format!("Blocked by task {} (Readable)", tid(11)),
        format!("Blocked by task {} (Secret)", tid(20)),
        format!("Blocked by goal {} (Missing)", tid(404)),
    ];

    restrict_block_reasons(
        &mut reasons,
        &[
            Dependency::Task { id: 11.into() },
            Dependency::Task { id: 20.into() },
            Dependency::Goal { id: 404.into() },
        ],
        &map(),
        &std::collections::HashMap::new(),
    );

    assert_eq!(
        reasons,
        vec![
            "Waiting on the vendor".to_string(),
            format!("Blocked by task {} (Readable)", tid(11)),
        ]
    );
}

#[test]
fn a_hidden_dependency_does_not_take_a_reason_whose_id_merely_starts_the_same() {
    // Task 1 is unreadable; the reason for task 11 must not be mistaken for it.
    let mut reasons = vec![format!("Blocked by task {} (Readable)", tid(11))];

    restrict_block_reasons(
        &mut reasons,
        &[Dependency::Task { id: 1.into() }],
        &map(),
        &std::collections::HashMap::new(),
    );

    assert_eq!(reasons.len(), 1);
}

#[test]
fn a_reason_names_its_dependency_by_short_id_and_is_matched_that_way() {
    let mut reasons = vec![
        "Blocked by task 6f3 (Secret)".to_string(),
        "Blocked by task a1c (Readable)".to_string(),
    ];
    let names = std::collections::HashMap::from([
        (tkey("task", 20), "6f3".to_string()),
        (tkey("task", 11), "a1c".to_string()),
    ]);

    restrict_block_reasons(
        &mut reasons,
        &[
            Dependency::Task { id: 11.into() },
            Dependency::Task { id: 20.into() },
        ],
        &map(),
        &names,
    );

    assert_eq!(reasons, vec!["Blocked by task a1c (Readable)".to_string()]);
}

#[test]
fn a_knowledge_base_entity_is_visible_only_through_a_readable_node() {
    let references = vec![
        KnowledgeBaseReference {
            owner: NodeKey::new(NodeTable::Task, tid(10)),
            entity_type: "person".into(),
            entity_id: tid(1),
        },
        KnowledgeBaseReference {
            owner: NodeKey::new(NodeTable::Task, tid(20)),
            entity_type: "person".into(),
            entity_id: tid(2),
        },
        KnowledgeBaseReference {
            owner: NodeKey::new(NodeTable::Task, tid(11)),
            entity_type: "thread".into(),
            entity_id: tid(2),
        },
    ];

    let visible = visible_knowledge_base(&references, &map());

    assert!(visible.contains(&("person".to_string(), tid(1))));
    assert!(!visible.contains(&("person".to_string(), tid(2))));
    assert!(visible.contains(&("thread".to_string(), tid(2))));
}

#[test]
fn every_domain_spelling_is_checked_against_the_domain_row() {
    let map = map();

    for spelling in ["aspect", "project", "domain", "tag"] {
        assert!(reads(&map, spelling, tid(1)), "{spelling}");
        assert!(!reads(&map, spelling, tid(2)), "{spelling}");
    }
}

#[test]
fn a_reference_to_no_stored_kind_is_never_permitted() {
    assert!(!reads(&map(), "flow_root", tid(1)));
    assert!(!permits(&map(), "task", tid(10), AccessLevel::Write));
    assert!(permits(&map(), "task", tid(10), AccessLevel::Read));
}

fn catalogue_node(
    kind: NodeTable,
    id: i64,
    title: &str,
    parent: Option<NodeKey>,
    is_private: bool,
) -> CatalogueNode {
    CatalogueNode {
        node_kind: kind,
        node_id: tid(id),
        subtype: (kind == NodeTable::Domain).then(|| {
            if parent.is_none() {
                "aspect".to_string()
            } else {
                "project".to_string()
            }
        }),
        title: title.to_string(),
        parent_kind: parent.map(|key| key.node_kind),
        parent_id: parent.map(|key| key.node_id),
        is_private,
        agentic: None,
    }
}

/// Growth › Code › Arlesh › Features › Search, plus a private diary under Growth.
fn catalogue() -> Vec<CatalogueNode> {
    let growth = NodeKey::new(NodeTable::Domain, tid(1));
    let code = NodeKey::new(NodeTable::Domain, tid(2));
    let arlesh = NodeKey::new(NodeTable::Domain, tid(3));
    let features = NodeKey::new(NodeTable::Goal, tid(4));
    vec![
        catalogue_node(NodeTable::Domain, 1, "Growth", None, false),
        catalogue_node(NodeTable::Domain, 2, "Code", Some(growth), false),
        catalogue_node(NodeTable::Domain, 3, "Arlesh", Some(code), false),
        catalogue_node(NodeTable::Goal, 4, "Features", Some(arlesh), false),
        catalogue_node(NodeTable::Task, 5, "Search", Some(features), false),
        catalogue_node(NodeTable::Domain, 6, "Diary", Some(growth), true),
    ]
}

fn instructions_for(roots: &[NodeKey]) -> String {
    let nodes = catalogue();
    let stored: Vec<StoredNode> = nodes.iter().map(CatalogueNode::stored).collect();
    roots_instructions(&nodes, roots, &AccessMap::resolve(&stored, roots))
}

#[test]
fn with_no_roots_the_instructions_say_the_board_is_closed() {
    let text = instructions_for(&[]);

    assert!(text.starts_with("MCP ROOTS: none."), "{text}");
    assert!(text.contains("Settings › MCP access"), "{text}");
}

#[test]
fn each_root_is_named_by_short_path_kind_and_id() {
    let text = instructions_for(&[
        NodeKey::new(NodeTable::Task, tid(5)),
        NodeKey::new(NodeTable::Domain, tid(2)),
    ]);

    assert!(
        text.contains(&format!(
            "- … › Arlesh › Features › Search (task {})",
            tid(5)
        )),
        "{text}"
    );
    assert!(
        text.contains(&format!("- Growth › Code (project {})", tid(2))),
        "{text}"
    );
    assert!(text.contains("Agentic tasks"), "{text}");
}

#[test]
fn a_root_at_the_top_of_the_board_is_its_own_title() {
    let text = instructions_for(&[NodeKey::new(NodeTable::Domain, tid(1))]);

    assert!(
        text.contains(&format!("- Growth (aspect {})", tid(1))),
        "{text}"
    );
}

#[test]
fn a_private_root_is_not_named() {
    let text = instructions_for(&[NodeKey::new(NodeTable::Domain, tid(6))]);

    assert!(!text.contains("Diary"), "{text}");
    assert!(text.starts_with("MCP ROOTS: none."), "{text}");
}
