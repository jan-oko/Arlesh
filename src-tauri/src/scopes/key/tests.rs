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

// --- spelling ---

#[test]
fn every_kind_spells_its_own_start() {
    let wednesday = d(2026, 9, 23);
    let spell = |kind| ScopeKey::containing(kind, wednesday).unwrap().to_string();
    assert_eq!(spell(ScopeKind::Season), "season:2026-09-01");
    assert_eq!(spell(ScopeKind::Month), "month:2026-09-01");
    assert_eq!(spell(ScopeKind::Week), "week:2026-09-20");
    assert_eq!(spell(ScopeKind::Day), "day:2026-09-23");
    assert_eq!(
        ScopeKey::part(wednesday, PartOfDay::Morning).to_string(),
        "part_of_day:2026-09-23:morning"
    );
    assert_eq!(
        ScopeKey::exact(dt(2026, 9, 23, 14, 0), dt(2026, 9, 23, 15, 30))
            .unwrap()
            .to_string(),
        "exact:2026-09-23T14:00:00/2026-09-23T15:30:00"
    );
}

#[test]
fn a_january_date_names_the_winter_that_began_in_december() {
    assert_eq!(
        ScopeKey::containing(ScopeKind::Season, d(2027, 1, 15))
            .unwrap()
            .to_string(),
        "season:2026-12-01"
    );
}

#[test]
fn every_spelling_round_trips() {
    for raw in [
        "season:2026-12-01",
        "month:2024-02-01",
        "week:2026-12-27",
        "day:2026-09-23",
        "part_of_day:2026-09-23:night",
        "exact:2026-09-23T14:00:00/2026-09-24T01:00:00",
    ] {
        assert_eq!(key(raw).to_string(), raw);
    }
}

#[test]
fn a_date_that_is_not_its_scopes_start_is_refused_rather_than_snapped() {
    for raw in [
        "week:2026-09-23",
        "month:2026-09-02",
        "season:2026-10-01",
        "day:2026-9-23",
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
        "week",
        "fortnight:2026-09-20",
        "part_of_day:2026-09-23",
        "part_of_day:2026-09-23:dusk",
        "exact:2026-09-23T14:00:00",
        "12",
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
    assert!("exact:2026-09-23T15:00:00/2026-09-23T14:00:00"
        .parse::<ScopeKey>()
        .is_err());
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
fn a_key_serializes_as_its_string() {
    let week = key("week:2026-09-20");
    assert_eq!(serde_json::to_string(&week).unwrap(), "\"week:2026-09-20\"");
    let back: ScopeKey = serde_json::from_str("\"week:2026-09-20\"").unwrap();
    assert_eq!(back, week);
    assert!(serde_json::from_str::<ScopeKey>("\"week:2026-09-23\"").is_err());
    assert!(serde_json::from_str::<ScopeKey>("12").is_err());
}

// --- derivation ---

#[test]
fn a_week_scope_derives_its_dates_label_and_bounds() {
    let scope = key("week:2026-09-20").scope();
    assert_eq!(scope.kind, "week");
    assert_eq!(scope.start_date, "2026-09-20");
    assert_eq!(scope.end_date, "2026-09-26");
    assert_eq!(scope.label, "Week 39 2026");
    assert_eq!(scope.part, None);
    assert_eq!(
        key("week:2026-09-20").bounds(),
        (dt(2026, 9, 20, 2, 0), dt(2026, 9, 27, 2, 0))
    );
}

#[test]
fn a_night_ends_on_the_next_day() {
    let night = key("part_of_day:2026-09-23:night");
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
    let scope = key("exact:2026-09-23T14:00:00/2026-09-24T01:00:00").scope();
    assert_eq!(scope.kind, "exact");
    assert_eq!(scope.start_date, "2026-09-23");
    assert_eq!(scope.end_date, "2026-09-24");
    assert_eq!(scope.start_datetime.as_deref(), Some("2026-09-23T14:00:00"));
    assert_eq!(scope.end_datetime.as_deref(), Some("2026-09-24T01:00:00"));
    assert!(scope.id.is_exact());
}

#[test]
fn the_same_scope_reached_from_any_of_its_days_is_one_key() {
    let from_sunday = ScopeKey::containing(ScopeKind::Week, d(2026, 9, 20)).unwrap();
    let from_saturday = ScopeKey::containing(ScopeKind::Week, d(2026, 9, 26)).unwrap();
    assert_eq!(from_sunday, from_saturday);
}
