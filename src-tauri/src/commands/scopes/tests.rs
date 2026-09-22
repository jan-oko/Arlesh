use super::*;

fn scope(kind: &str, start: &str, end: &str) -> Scope {
    Scope {
        id: 1,
        kind: kind.to_string(),
        label: "test".to_string(),
        start_date: start.to_string(),
        end_date: end.to_string(),
        week_id: None,
        month_id: None,
        season_id: None,
        day_id: None,
        part: None,
        start_datetime: None,
        end_datetime: None,
    }
}

fn at(text: &str) -> NaiveDateTime {
    NaiveDateTime::parse_from_str(text, EXACT_DATETIME_FORMAT).unwrap()
}

#[test]
fn resolve_reports_iso_half_open_bounds() {
    let resolved = resolve(
        &scope("day", "2026-06-20", "2026-06-20"),
        at("2026-06-20T09:00:00"),
    )
    .unwrap();
    assert_eq!(resolved.start, "2026-06-20T02:00:00");
    assert_eq!(resolved.end, "2026-06-21T02:00:00");
}

#[test]
fn resolve_marks_active_only_inside_the_window() {
    let day = scope("day", "2026-06-20", "2026-06-20");
    assert!(resolve(&day, at("2026-06-20T02:00:00")).unwrap().active);
    assert!(resolve(&day, at("2026-06-20T23:59:00")).unwrap().active);
    // Past midnight is still the same day, right up to 02:00.
    assert!(resolve(&day, at("2026-06-21T01:59:00")).unwrap().active);
    assert!(!resolve(&day, at("2026-06-21T02:00:00")).unwrap().active);
    assert!(!resolve(&day, at("2026-06-20T01:59:00")).unwrap().active);
}

#[test]
fn resolve_propagates_malformed_scope_errors() {
    assert!(resolve(
        &scope("decade", "2026-06-20", "2026-06-20"),
        at("2026-06-20T09:00:00")
    )
    .is_err());
}
