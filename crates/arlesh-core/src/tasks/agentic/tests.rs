use super::*;

#[test]
fn a_priority_is_spelled_by_its_label_and_stored_by_its_rank() {
    use crate::tasks::model::AgenticPriority;

    let all = [
        AgenticPriority::Mw,
        AgenticPriority::A,
        AgenticPriority::B,
        AgenticPriority::C,
    ];
    let labels: Vec<serde_json::Value> = all
        .iter()
        .map(|priority| serde_json::to_value(priority).unwrap())
        .collect();
    assert_eq!(labels, ["MW", "A", "B", "C"]);
    for priority in all {
        assert_eq!(AgenticPriority::from_rank(priority.rank()), Some(priority));
    }
    assert!(
        all.windows(2).all(|pair| pair[0] < pair[1]),
        "most urgent first"
    );
    assert_eq!(AgenticPriority::from_rank(4), None);
    assert!(serde_json::from_value::<AgenticPriority>(serde_json::json!("P0")).is_err());
}

#[test]
fn whitespace_is_not_a_spec() {
    assert!(!AgenticBrief {
        spec: "  \n\t".into(),
        ..Default::default()
    }
    .has_spec());
    assert!(AgenticBrief {
        spec: "Add a settings page".into(),
        ..Default::default()
    }
    .has_spec());
}
