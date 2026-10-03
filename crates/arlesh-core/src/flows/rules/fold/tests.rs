//! The Habit fold, ported from `src/utils/habit-collapse.test.ts` as its specification. The whole
//! fold is pinned by `conformance/habit-fold.json`; these name its parts.

use super::*;

fn date(iso: &str) -> NaiveDate {
    NaiveDate::parse_from_str(iso, "%Y-%m-%d").unwrap_or_default()
}

fn day(iso: &str) -> Iteration {
    Iteration {
        flow_id: 1,
        scope_kind: Some(ScopeKind::Day),
        anchor_date: date(iso),
        passed: true,
        done: true,
        owed: false,
    }
}

fn of_kind(kind: ScopeKind, iso: &str) -> Iteration {
    Iteration {
        scope_kind: Some(kind),
        ..day(iso)
    }
}

#[test]
fn both_halves_of_a_winter_straddling_new_year_share_a_season_and_a_year() {
    assert_eq!(
        unit_key(Level::Season, date("2026-12-20")),
        unit_key(Level::Season, date("2027-01-10"))
    );
    assert_eq!(
        unit_key(Level::Year, date("2027-01-10")),
        unit_key(Level::Year, date("2026-12-20"))
    );
}

#[test]
fn a_week_keys_by_its_sunday_and_a_month_by_its_first_day() {
    assert_eq!(
        unit_key(Level::Week, date("2026-09-14")),
        date("2026-09-13")
    );
    assert_eq!(
        unit_key(Level::Month, date("2026-09-14")),
        date("2026-09-01")
    );
}

#[test]
fn a_level_is_inserted_only_where_the_run_spans_more_than_one_unit() {
    let five_days: Vec<_> = [
        "2026-09-14",
        "2026-09-15",
        "2026-09-16",
        "2026-09-17",
        "2026-09-18",
    ]
    .into_iter()
    .map(day)
    .collect();
    assert!(levels_for_run(&five_days).is_empty());
    let three_weeks: Vec<_> = ["2026-09-07", "2026-09-14", "2026-09-21"]
        .into_iter()
        .map(day)
        .collect();
    assert_eq!(levels_for_run(&three_weeks), [Level::Week]);
    let three_months: Vec<_> = ["2026-08-10", "2026-09-10", "2026-10-10"]
        .into_iter()
        .map(day)
        .collect();
    assert_eq!(
        levels_for_run(&three_months),
        [Level::Season, Level::Month, Level::Week]
    );
}

#[test]
fn no_level_at_or_below_the_iterations_own_kind_and_a_sub_day_window_is_a_day() {
    let months = [
        of_kind(ScopeKind::Month, "2026-09-01"),
        of_kind(ScopeKind::Month, "2026-10-01"),
    ];
    assert!(levels_for_run(&months).is_empty());
    let seasons = [
        of_kind(ScopeKind::Season, "2026-09-01"),
        of_kind(ScopeKind::Season, "2027-03-01"),
    ];
    assert_eq!(levels_for_run(&seasons), [Level::Year]);
    let phases: Vec<_> = ["2026-09-14", "2026-09-15"]
        .into_iter()
        .map(|iso| Iteration {
            scope_kind: None,
            ..day(iso)
        })
        .collect();
    assert!(levels_for_run(&phases).is_empty());
}

fn ids(folded: &[Folded<&'static str>]) -> Vec<String> {
    folded
        .iter()
        .map(|child| match child {
            Folded::Node(id) => (*id).to_string(),
            Folded::Group(group) => group.id.clone(),
        })
        .collect()
}

#[test]
fn a_run_folds_at_the_threshold_and_owed_work_is_drawn_after_it() {
    let mut owed = day("2026-09-16");
    owed.owed = true;
    owed.done = false;
    let mut missed = day("2026-09-15");
    missed.done = false;
    let mut open = day("2026-09-18");
    open.passed = false;
    let children = vec![
        Child::Iteration("a", day("2026-09-14")),
        Child::Iteration("b", missed),
        Child::Iteration("owed", owed),
        Child::Iteration("c", day("2026-09-17")),
        Child::Iteration("open", open),
        Child::Other("note"),
    ];
    let folded = fold(children, 3);
    assert_eq!(ids(&folded), ["habitrun-1-virtual", "owed", "open", "note"]);
    let Some(Folded::Group(run)) = folded.first() else {
        panic!("the run folded");
    };
    assert_eq!(
        run.tally,
        Tally {
            passed: 3,
            done: 2,
            missed: 1
        }
    );
}

#[test]
fn a_run_short_of_the_threshold_stands_as_it_was() {
    let children = vec![
        Child::Iteration("a", day("2026-09-14")),
        Child::Iteration("b", day("2026-09-15")),
    ];
    assert_eq!(ids(&fold(children, 3)), ["a", "b"]);
}
