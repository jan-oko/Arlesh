//! The wire form: what an MCP caller writes, and what it means when they leave a field out.

use super::*;

#[test]
fn naming_only_a_preset_leaves_every_other_axis_at_the_apps_own_default() {
    let filter: BoardFilter =
        serde_json::from_str(r#"{"preset":"start"}"#).expect("a preset alone is a filter");
    assert_eq!(filter, BoardFilter::preset(Preset::Start));
    assert!(filter.include_flows && filter.show_info && filter.show_flow);
    assert!(
        !filter.private_mode,
        "the app's default hides private nodes"
    );
}

#[test]
fn an_empty_filter_is_the_neutral_one() {
    let filter: BoardFilter = serde_json::from_str("{}").expect("an empty object is a filter");
    assert_eq!(filter, BoardFilter::default());
}

#[test]
fn every_axis_is_spelled_the_way_the_wire_spells_it() {
    let filter: BoardFilter = serde_json::from_str(
        r#"{
            "preset": "backlog",
            "unblock": true,
            "include_flows": false,
            "tags": [{"tag_id": 7, "mode": "exclude"}],
            "show_info": false,
            "show_flow": false,
            "private_mode": true,
            "archived": "include",
            "backlog": "exclude"
        }"#,
    )
    .expect("the wire form parses");
    assert_eq!(filter.preset, Preset::Backlog);
    assert!(filter.unblock && filter.private_mode);
    assert!(!filter.include_flows && !filter.show_info && !filter.show_flow);
    assert_eq!(
        filter.tags,
        vec![TagFilter {
            tag_id: 7,
            mode: TagMode::Exclude
        }]
    );
    assert_eq!(filter.archived, OverrideMode::Include);
    assert_eq!(filter.backlog, OverrideMode::Exclude);
}

#[test]
fn an_unknown_preset_is_refused_rather_than_read_as_all() {
    assert!(serde_json::from_str::<BoardFilter>(r#"{"preset":"unblock"}"#).is_err());
}
