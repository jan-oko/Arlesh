use super::*;

#[test]
fn scope_containing_snaps_a_date_to_its_week() {
    let week = scope_containing(ScopeKind::Week, "2026-09-23".to_string()).unwrap();
    assert_eq!(
        week.id.to_string(),
        r#"{"kind":"week","date":"2026-09-20"}"#
    );
    assert_eq!(week.start_date, "2026-09-20");
}

#[test]
fn scope_containing_refuses_a_bad_date_and_a_kind_without_a_date_form() {
    assert!(scope_containing(ScopeKind::Day, "23/09/2026".to_string()).is_err());
    assert!(scope_containing(ScopeKind::Exact, "2026-09-23".to_string()).is_err());
}

#[test]
fn part_scope_names_the_band_on_its_day() {
    let part = part_scope("2026-09-23".to_string(), PartOfDay::Evening).unwrap();
    assert_eq!(
        part.id.to_string(),
        r#"{"kind":"part_of_day","date":"2026-09-23","part":"evening"}"#
    );
}

#[test]
fn exact_scope_refuses_an_inverted_window() {
    assert!(exact_scope(
        "2026-09-23T15:00:00".to_string(),
        "2026-09-23T14:00:00".to_string()
    )
    .is_err());
    let exact = exact_scope(
        "2026-09-23T14:00:00".to_string(),
        "2026-09-23T15:00:00".to_string(),
    )
    .unwrap();
    assert_eq!(exact.kind, "exact");
}

#[test]
fn get_scope_derives_the_scope_a_key_names() {
    let key: ScopeKey = r#"{"kind":"month","date":"2026-09-01"}"#.parse().unwrap();
    let month = get_scope(key);
    assert_eq!(month.label, "September 2026");
    assert_eq!(month.end_date, "2026-09-30");
}

#[test]
fn resolve_scope_reports_iso_half_open_bounds() {
    let key: ScopeKey = r#"{"kind":"day","date":"2026-06-20"}"#.parse().unwrap();
    let resolved = resolve_scope(key);
    assert_eq!(resolved.start, "2026-06-20T02:00:00");
    assert_eq!(resolved.end, "2026-06-21T02:00:00");
}
