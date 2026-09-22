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

#[test]
fn a_scope_selection_arrives_as_a_window_an_axis_and_a_match_rule() {
    let filter: BoardFilter = serde_json::from_str(
        r#"{"preset":"all","scope":{"window":{"start":"2026-08-24T02:00:00","end":"2026-08-31T02:00:00"},"axis":"relevance","match":"overlapping"}}"#,
    )
    .expect("a scope selection is a filter");
    let scope = filter.scope.expect("the selection survived");
    assert_eq!(scope.axis, ScopeAxis::Relevance);
    assert_eq!(scope.match_rule, ScopeMatch::Overlapping);
    assert_eq!(
        scope.window.start.to_string(),
        "2026-08-24 02:00:00",
        "the 02:00 ladder boundary is carried through untouched"
    );
}

#[test]
fn leaving_the_scope_out_is_any_scope() {
    let filter: BoardFilter =
        serde_json::from_str(r#"{"preset":"all"}"#).expect("a preset alone is a filter");
    assert!(filter.scope.is_none());
}

#[test]
fn a_range_of_two_scopes_spans_from_the_first_start_to_the_last_end() {
    let first = (
        "2026-08-24T02:00:00".parse().expect("a datetime parses"),
        "2026-08-31T02:00:00".parse().expect("a datetime parses"),
    );
    let last = (
        "2026-09-07T02:00:00".parse().expect("a datetime parses"),
        "2026-09-14T02:00:00".parse().expect("a datetime parses"),
    );
    let spanned = ScopeWindow::spanning(first, last);
    assert_eq!(spanned.start, first.0);
    assert_eq!(spanned.end, last.1, "a range behaves as one window");
}
