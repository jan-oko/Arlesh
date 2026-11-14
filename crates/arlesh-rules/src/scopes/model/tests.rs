use super::*;

#[test]
fn scope_kind_as_str_covers_all_variants() {
    assert_eq!(ScopeKind::Season.as_str(), "season");
    assert_eq!(ScopeKind::Month.as_str(), "month");
    assert_eq!(ScopeKind::Week.as_str(), "week");
    assert_eq!(ScopeKind::Day.as_str(), "day");
    assert_eq!(ScopeKind::PartOfDay.as_str(), "part_of_day");
    assert_eq!(ScopeKind::Exact.as_str(), "exact");
}

#[test]
fn scope_kind_parse_db_roundtrips_every_variant() {
    for kind in [
        ScopeKind::Season,
        ScopeKind::Month,
        ScopeKind::Week,
        ScopeKind::Day,
        ScopeKind::PartOfDay,
        ScopeKind::Exact,
    ] {
        assert_eq!(ScopeKind::parse_db(kind.as_str()), Some(kind));
    }
    assert_eq!(ScopeKind::parse_db("nonsense"), None);
}

#[test]
fn part_of_day_str_roundtrips_every_variant() {
    for part in PartOfDay::CYCLE {
        assert_eq!(PartOfDay::parse_db(part.as_str()), Some(part));
    }
    assert_eq!(PartOfDay::parse_db("midnight"), None);
}

#[test]
fn part_of_day_bands_are_contiguous_and_cover_the_day() {
    // Every hour 0–23 maps to exactly one part, and that part's band contains it.
    for hour in 0u32..24 {
        let part = PartOfDay::containing(hour);
        let (start, end) = part.band();
        let in_band = if start <= end {
            (start..end).contains(&hour)
        } else {
            // Night wraps midnight: [22,24) ∪ [0,2)
            hour >= start || hour < end
        };
        assert!(in_band, "hour {hour} not in band of {:?}", part);
    }
}

#[test]
fn part_of_day_containing_picks_the_right_band() {
    assert_eq!(PartOfDay::containing(6), PartOfDay::Morning);
    assert_eq!(PartOfDay::containing(13), PartOfDay::Noon);
    assert_eq!(PartOfDay::containing(17), PartOfDay::Afternoon);
    assert_eq!(PartOfDay::containing(21), PartOfDay::Evening);
    assert_eq!(PartOfDay::containing(22), PartOfDay::Night);
    assert_eq!(PartOfDay::containing(1), PartOfDay::Night);
    assert_eq!(PartOfDay::containing(4), PartOfDay::Premorning);
}
