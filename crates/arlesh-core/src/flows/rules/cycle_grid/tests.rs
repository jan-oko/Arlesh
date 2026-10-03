//! The cycle grid, ported from `src/utils/flow-cycle.test.ts`.

use super::*;

#[test]
fn a_week_holds_seven_days_and_a_season_twelve_weeks() {
    assert_eq!(subdivisions_between(ScopeKind::Week, ScopeKind::Day), 7);
    assert_eq!(subdivisions_between(ScopeKind::Season, ScopeKind::Week), 12);
    assert_eq!(subdivisions_between(ScopeKind::Day, ScopeKind::Day), 1);
    assert_eq!(subdivisions_between(ScopeKind::Day, ScopeKind::Week), 0);
    assert_eq!(subdivisions_between(ScopeKind::Exact, ScopeKind::Day), 0);
}

#[test]
fn the_navigator_steps_from_the_flows_period_down_and_its_path_is_one_flat_index() {
    let levels = cycle_levels(2, ScopeKind::Week, ScopeKind::PartOfDay);
    assert_eq!(
        levels,
        [
            CycleLevel {
                kind: ScopeKind::Week,
                count: 2
            },
            CycleLevel {
                kind: ScopeKind::Day,
                count: 7
            },
            CycleLevel {
                kind: ScopeKind::PartOfDay,
                count: 6
            },
        ]
    );
    // Week 2, Day 3, part 4: (1 * 7 + 2) * 6 + 3 + 1.
    assert_eq!(path_to_index(&levels, &[2, 3, 4]), 58);
    assert!(cycle_levels(1, ScopeKind::Day, ScopeKind::Week).is_empty());
}
