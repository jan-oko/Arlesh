use std::collections::HashSet;

use serde_json::json;

use super::*;

#[test]
fn a_write_names_the_ids_in_its_arguments_however_deep() {
    let args = json!([{"id": "a", "tags": ["b", {"x": "c"}]}, 5, null, "d"]);

    let found = strings_in(&args);

    assert_eq!(
        found,
        ["a", "b", "c", "d"]
            .iter()
            .map(|s| s.to_string())
            .collect::<HashSet<_>>()
    );
}

#[test]
fn a_press_names_a_provisional_id_only_when_it_is_in_the_arguments() {
    let provisional: HashSet<String> = ["p1".to_owned()].into();

    assert!(names_any(&json!({"parent_id": "p1"}), &provisional));
    assert!(!names_any(&json!({"parent_id": "other"}), &provisional));
    assert!(!names_any(&json!({"parent_id": "p1"}), &HashSet::new()));
}

#[test]
fn the_ids_a_prediction_made_that_the_press_named_are_not_provisional() {
    let args = json!({"id": "named"});

    let provisional = provisional_ids(vec!["named".into(), "by-a-trigger".into()], &args);

    assert_eq!(provisional, ["by-a-trigger".to_owned()].into());
}
