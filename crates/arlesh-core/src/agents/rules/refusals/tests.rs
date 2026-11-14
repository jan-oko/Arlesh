use super::*;

#[test]
fn the_three_generic_refusals_name_their_node() {
    let write = "task 100 is not an Agentic task inside the MCP roots, so it cannot be written";
    let read = "task 100 is not inside the MCP roots";
    let unknown = "no node inside the MCP roots has the id 5ab";

    assert_eq!(
        named_node(write),
        Some(NamedNode {
            node_type: Some("task"),
            id: "100"
        })
    );
    assert_eq!(
        named_node(read),
        Some(NamedNode {
            node_type: Some("task"),
            id: "100"
        })
    );
    assert_eq!(
        named_node(unknown),
        Some(NamedNode {
            node_type: None,
            id: "5ab"
        })
    );
}

#[test]
fn a_message_that_is_not_a_generic_access_refusal_names_nothing() {
    for message in [
        "task 100 is not inside your parent agent's Claim, so it cannot be claimed",
        "the sub_token names no child agent of this session",
        "agent 7 not found",
        "this session is not attached: call arlesh_agents.attach first",
    ] {
        assert_eq!(named_node(message), None, "{message}");
    }
}

#[test]
fn only_the_write_refusal_is_a_write_refusal() {
    assert!(is_write_refusal(
        "task 100 is not an Agentic task inside the MCP roots, so it cannot be written"
    ));
    assert!(!is_write_refusal("task 100 is not inside the MCP roots"));
}

#[test]
fn a_paused_childs_refusal_says_it_is_paused_and_who_resumes_it() {
    let said =
        paused("task 100 is not an Agentic task inside the MCP roots, so it cannot be written");

    assert!(said.starts_with("task 100 is not an Agentic task"));
    assert!(said.contains("Your Claim is paused"));
    assert!(said.contains("parent agent or the user resumes it"));
}

#[test]
fn an_out_of_claim_refusal_says_where_the_node_is_and_how_to_claim_it() {
    let said = outside_claim(&NamedNode {
        node_type: Some("task"),
        id: "101",
    });

    assert!(said.starts_with("task 101 is outside your Claim"));
    assert!(said.contains("inside your parent agent's Claim"));
    assert!(said.contains("arlesh_agents.claim"));
    assert!(outside_claim(&NamedNode {
        node_type: None,
        id: "5ab"
    })
    .starts_with("node 5ab "));
}
