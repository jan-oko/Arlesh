use super::*;

fn d(y: i32, m: u32, day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(y, m, day).unwrap()
}

fn dt(y: i32, m: u32, day: u32, h: u32, min: u32) -> NaiveDateTime {
    d(y, m, day).and_hms_opt(h, min, 0).unwrap()
}

fn key(raw: &str) -> ScopeKey {
    raw.parse().unwrap()
}

// --- the canonical text ---

#[test]
fn every_kind_writes_its_own_start_in_canonical_text() {
    let wednesday = d(2026, 9, 23);
    let text = |kind| ScopeKey::containing(kind, wednesday).unwrap().canonical();
    assert_eq!(
        text(ScopeKind::Season),
        r#"{"kind":"season","date":"2026-09-01"}"#
    );
    assert_eq!(
        text(ScopeKind::Month),
        r#"{"kind":"month","date":"2026-09-01"}"#
    );
    assert_eq!(
        text(ScopeKind::Week),
        r#"{"kind":"week","date":"2026-09-20"}"#
    );
    assert_eq!(
        text(ScopeKind::Day),
        r#"{"kind":"day","date":"2026-09-23"}"#
    );
    assert_eq!(
        ScopeKey::part(wednesday, PartOfDay::Morning).canonical(),
        r#"{"kind":"part_of_day","date":"2026-09-23","part":"morning"}"#
    );
    assert_eq!(
        ScopeKey::exact(dt(2026, 9, 23, 14, 0), dt(2026, 9, 23, 15, 30))
            .unwrap()
            .canonical(),
        r#"{"kind":"exact","start":"2026-09-23T14:00:00","end":"2026-09-23T15:30:00"}"#
    );
}

#[test]
fn display_is_the_canonical_text() {
    let week = key(r#"{"kind":"week","date":"2026-09-20"}"#);
    assert_eq!(week.to_string(), week.canonical());
}

#[test]
fn any_spelling_of_a_key_is_rewritten_to_the_one_canonical_text() {
    let spaced = key(r#"{ "date" : "2026-09-23", "part": "night", "kind": "part_of_day" }"#);
    assert_eq!(
        spaced.canonical(),
        r#"{"kind":"part_of_day","date":"2026-09-23","part":"night"}"#
    );
}

#[test]
fn a_january_date_names_the_winter_that_began_in_december() {
    assert_eq!(
        ScopeKey::containing(ScopeKind::Season, d(2027, 1, 15)).unwrap(),
        ScopeKey::Season {
            date: d(2026, 12, 1)
        }
    );
}

#[test]
fn a_date_that_is_not_its_scopes_start_is_refused_rather_than_snapped() {
    for raw in [
        r#"{"kind":"week","date":"2026-09-23"}"#,
        r#"{"kind":"month","date":"2026-09-02"}"#,
        r#"{"kind":"season","date":"2026-10-01"}"#,
        r#"{"kind":"day","date":"2026-9-23"}"#,
    ] {
        assert!(
            matches!(raw.parse::<ScopeKey>(), Err(ScopeError::MalformedKey(..))),
            "{raw} parsed"
        );
    }
}

#[test]
fn garbage_is_refused() {
    for raw in [
        "",
        "12",
        "week:2026-09-20",
        r#"{"kind":"fortnight","date":"2026-09-20"}"#,
        r#"{"kind":"part_of_day","date":"2026-09-23"}"#,
        r#"{"kind":"part_of_day","date":"2026-09-23","part":"dusk"}"#,
        r#"{"kind":"exact","start":"2026-09-23T14:00:00"}"#,
        r#"{"kind":"exact","start":"2026-09-23T14:00","end":"2026-09-23T15:00"}"#,
    ] {
        assert!(raw.parse::<ScopeKey>().is_err(), "{raw} parsed");
    }
}

#[test]
fn an_empty_or_inverted_exact_window_is_refused() {
    let at = dt(2026, 9, 23, 14, 0);
    assert!(matches!(
        ScopeKey::exact(at, at),
        Err(ScopeError::EmptyExact(..))
    ));
    assert!(
        r#"{"kind":"exact","start":"2026-09-23T15:00:00","end":"2026-09-23T14:00:00"}"#
            .parse::<ScopeKey>()
            .is_err()
    );
}

#[test]
fn a_hand_built_key_that_misses_its_start_fails_validation() {
    let wednesday = ScopeKey::Week {
        date: d(2026, 9, 23),
    };
    assert!(wednesday.validated().is_err());
}

#[test]
fn containing_refuses_the_kinds_that_carry_more_than_a_date() {
    for kind in [ScopeKind::PartOfDay, ScopeKind::Exact] {
        assert!(matches!(
            ScopeKey::containing(kind, d(2026, 9, 23)),
            Err(ScopeError::UnsupportedKind(_))
        ));
    }
}

#[test]
fn a_key_travels_as_a_json_object() {
    let week = key(r#"{"kind":"week","date":"2026-09-20"}"#);
    assert_eq!(
        serde_json::to_value(week).unwrap(),
        serde_json::json!({"kind": "week", "date": "2026-09-20"})
    );
    let back: ScopeKey =
        serde_json::from_value(serde_json::json!({"kind": "week", "date": "2026-09-20"})).unwrap();
    assert_eq!(back, week);
    assert!(serde_json::from_value::<ScopeKey>(
        serde_json::json!({"kind": "week", "date": "2026-09-23"})
    )
    .is_err());
    assert!(serde_json::from_str::<ScopeKey>("\"week:2026-09-20\"").is_err());
}

// --- derivation ---

#[test]
fn a_week_scope_derives_its_dates_label_and_bounds() {
    let week = key(r#"{"kind":"week","date":"2026-09-20"}"#);
    let scope = week.scope();
    assert_eq!(scope.kind, "week");
    assert_eq!(scope.start_date, "2026-09-20");
    assert_eq!(scope.end_date, "2026-09-26");
    assert_eq!(scope.label, "Week 39 2026");
    assert_eq!(scope.part, None);
    assert_eq!(
        week.bounds(),
        (dt(2026, 9, 20, 2, 0), dt(2026, 9, 27, 2, 0))
    );
}

#[test]
fn a_night_ends_on_the_next_day() {
    let night = ScopeKey::part(d(2026, 9, 23), PartOfDay::Night);
    let scope = night.scope();
    assert_eq!(scope.start_date, "2026-09-23");
    assert_eq!(scope.end_date, "2026-09-24");
    assert_eq!(scope.label, "2026-09-23 night");
    assert_eq!(scope.part.as_deref(), Some("night"));
    assert_eq!(
        night.bounds(),
        (dt(2026, 9, 23, 22, 0), dt(2026, 9, 24, 2, 0))
    );
}

#[test]
fn an_exact_scope_carries_its_two_datetimes() {
    let exact = ScopeKey::exact(dt(2026, 9, 23, 14, 0), dt(2026, 9, 24, 1, 0)).unwrap();
    let scope = exact.scope();
    assert_eq!(scope.kind, "exact");
    assert_eq!(scope.start_date, "2026-09-23");
    assert_eq!(scope.end_date, "2026-09-24");
    assert_eq!(scope.start_datetime.as_deref(), Some("2026-09-23T14:00:00"));
    assert_eq!(scope.end_datetime.as_deref(), Some("2026-09-24T01:00:00"));
}

#[test]
fn the_same_scope_reached_from_any_of_its_days_is_one_key() {
    let from_sunday = ScopeKey::containing(ScopeKind::Week, d(2026, 9, 20)).unwrap();
    let from_saturday = ScopeKey::containing(ScopeKind::Week, d(2026, 9, 26)).unwrap();
    assert_eq!(from_sunday, from_saturday);
    assert_eq!(from_sunday.canonical(), from_saturday.canonical());
}
