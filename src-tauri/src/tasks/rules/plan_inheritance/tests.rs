//! Plan inheritance, case by case: what a node reads, what it breaks, and what a new Plan above it
//! would clamp.

use super::*;
use crate::scopes::model::ScopeKind;
use chrono::NaiveDate;

fn date(iso: &str) -> NaiveDate {
    NaiveDate::parse_from_str(iso, "%Y-%m-%d").unwrap_or_default()
}

fn scope(kind: ScopeKind, iso: &str) -> TimeScope {
    let key = ScopeKey::containing(kind, date(iso)).unwrap();
    TimeScope::single(key)
}

fn week(iso: &str) -> TimeScope {
    scope(ScopeKind::Week, iso)
}

fn month(iso: &str) -> TimeScope {
    scope(ScopeKind::Month, iso)
}

fn day(iso: &str) -> TimeScope {
    scope(ScopeKind::Day, iso)
}

fn days(first: &str, last: &str) -> TimeScope {
    TimeScope {
        start_id: ScopeKey::day(date(first)),
        end_id: ScopeKey::day(date(last)),
        duration: None,
    }
}

fn task(parent: Option<&'static str>) -> PlanLink<&'static str> {
    PlanLink {
        parent,
        plan: None,
        time_scope: None,
        clips: true,
        is_task: true,
    }
}

fn planned(parent: Option<&'static str>, plan: TimeScope) -> PlanLink<&'static str> {
    PlanLink {
        plan: Some(plan),
        ..task(parent)
    }
}

fn scoped(parent: Option<&'static str>, window: TimeScope) -> PlanLink<&'static str> {
    PlanLink {
        time_scope: Some(window),
        ..task(parent)
    }
}

fn board(
    links: Vec<(&'static str, PlanLink<&'static str>)>,
) -> HashMap<&'static str, PlanLink<&'static str>> {
    links.into_iter().collect()
}

#[test]
fn a_plan_inside_the_window_is_kept_and_a_window_inside_the_plan_is_taken() {
    assert_eq!(
        clip(&week("2026-10-04"), &month("2026-10-01")),
        Some(week("2026-10-04"))
    );
    assert_eq!(
        clip(&month("2026-10-01"), &week("2026-10-04")),
        Some(week("2026-10-04"))
    );
}

#[test]
fn a_partial_overlap_reads_as_the_days_both_hold() {
    // October against the week of Sunday 27 September: 1 to 3 October.
    assert_eq!(
        clip(&month("2026-10-01"), &week("2026-09-27")),
        Some(days("2026-10-01", "2026-10-03"))
    );
}

#[test]
fn windows_that_do_not_meet_clip_to_nothing() {
    assert_eq!(clip(&week("2026-10-11"), &week("2026-10-04")), None);
}

#[test]
fn a_child_with_no_plan_reads_its_parents_and_names_it() {
    let links = board(vec![
        ("parent", planned(None, week("2026-10-04"))),
        ("child", task(Some("parent"))),
        ("grandchild", task(Some("child"))),
    ]);
    let readings = read_plans(&links);
    assert_eq!(
        readings["grandchild"].effective,
        EffectivePlan::Inherited {
            plan: week("2026-10-04"),
            source: "parent"
        }
    );
    assert_eq!(readings["grandchild"].conflict, None);
}

#[test]
fn an_own_plan_overrides_the_inherited_one() {
    let links = board(vec![
        ("parent", planned(None, week("2026-10-04"))),
        ("child", planned(Some("parent"), day("2026-10-06"))),
    ]);
    let readings = read_plans(&links);
    assert_eq!(
        readings["child"].effective,
        EffectivePlan::Own(day("2026-10-06"))
    );
    assert_eq!(readings["child"].conflict, None);
}

#[test]
fn the_chain_climbs_through_goals_commitments_and_waits() {
    let pass = |parent| PlanLink {
        is_task: false,
        ..task(Some(parent))
    };
    let links = board(vec![
        ("task", planned(None, week("2026-10-04"))),
        ("commitment", pass("task")),
        ("wait", pass("commitment")),
        ("check", task(Some("wait"))),
    ]);
    assert_eq!(
        read_plans(&links)["check"].effective.plan(),
        Some(&week("2026-10-04"))
    );
}

#[test]
fn the_inherited_plan_is_clipped_to_the_childs_own_window() {
    let links = board(vec![
        ("parent", planned(None, month("2026-10-01"))),
        ("child", scoped(Some("parent"), week("2026-09-27"))),
    ]);
    assert_eq!(
        read_plans(&links)["child"].effective.plan(),
        Some(&days("2026-10-01", "2026-10-03"))
    );
}

#[test]
fn a_window_away_from_the_inherited_plan_leaves_it_empty_and_flagged() {
    let links = board(vec![
        ("parent", planned(None, week("2026-10-11"))),
        ("child", scoped(Some("parent"), week("2026-10-04"))),
        ("grandchild", task(Some("child"))),
    ]);
    let readings = read_plans(&links);
    assert_eq!(
        readings["child"].effective,
        EffectivePlan::Empty { source: "parent" }
    );
    assert_eq!(readings["child"].conflict, Some(PlanConflict::Empty));
    assert_eq!(readings["grandchild"].conflict, Some(PlanConflict::Empty));
}

#[test]
fn a_node_that_does_not_clip_inherits_the_whole_plan() {
    let links = board(vec![
        ("parent", planned(None, week("2026-10-11"))),
        (
            "check",
            PlanLink {
                clips: false,
                ..scoped(Some("parent"), day("2026-10-03"))
            },
        ),
    ]);
    assert_eq!(
        read_plans(&links)["check"].effective.plan(),
        Some(&week("2026-10-11"))
    );
}

#[test]
fn an_own_plan_outside_the_inherited_one_is_flagged() {
    let links = board(vec![
        ("parent", planned(None, week("2026-10-04"))),
        ("child", planned(Some("parent"), day("2026-10-12"))),
    ]);
    assert_eq!(
        read_plans(&links)["child"].conflict,
        Some(PlanConflict::ParentPlan)
    );
}

#[test]
fn only_a_task_is_flagged() {
    let links = board(vec![
        ("parent", planned(None, week("2026-10-11"))),
        (
            "goal",
            PlanLink {
                is_task: false,
                ..scoped(Some("parent"), week("2026-10-04"))
            },
        ),
    ]);
    assert_eq!(read_plans(&links)["goal"].conflict, None);
}

#[test]
fn nothing_above_planned_reads_unplanned() {
    let links = board(vec![("root", task(None)), ("child", task(Some("root")))]);
    assert_eq!(
        read_plans(&links)["child"].effective,
        EffectivePlan::Unplanned
    );
}

#[test]
fn a_loop_in_the_parents_still_reads() {
    let links = board(vec![("a", task(Some("b"))), ("b", task(Some("a")))]);
    assert_eq!(read_plans(&links).len(), 2);
}

#[test]
fn narrowing_a_parent_clamps_the_child_to_the_part_inside_and_spares_what_fits() {
    let links = board(vec![
        ("parent", planned(None, month("2026-10-01"))),
        ("inside", planned(Some("parent"), week("2026-10-04"))),
        (
            "across",
            planned(Some("parent"), days("2026-10-09", "2026-10-12")),
        ),
        ("under-across", planned(Some("across"), day("2026-10-12"))),
    ]);
    let clamps = clamps_for(&links, &"parent", Some(&days("2026-10-04", "2026-10-10")));
    assert_eq!(
        clamps,
        vec![
            PlanClamp {
                key: "across",
                clamp_to: Some(days("2026-10-09", "2026-10-10")),
            },
            PlanClamp {
                key: "under-across",
                clamp_to: Some(days("2026-10-09", "2026-10-10")),
            },
        ]
    );
}

#[test]
fn moving_a_parent_away_clamps_the_child_to_the_new_plan() {
    let links = board(vec![
        ("parent", planned(None, week("2026-10-04"))),
        ("child", planned(Some("parent"), day("2026-10-05"))),
    ]);
    let clamps = clamps_for(&links, &"parent", Some(&week("2026-10-11")));
    assert_eq!(
        clamps,
        vec![PlanClamp {
            key: "child",
            clamp_to: Some(week("2026-10-11")),
        }]
    );
}

#[test]
fn clearing_a_parents_plan_clamps_nothing() {
    let links = board(vec![
        ("parent", planned(None, week("2026-10-04"))),
        ("child", planned(Some("parent"), day("2026-10-05"))),
    ]);
    assert!(clamps_for(&links, &"parent", None).is_empty());
}

fn at(iso: &str) -> NaiveDateTime {
    date(iso).and_hms_opt(2, 0, 0).unwrap_or_default()
}

#[test]
fn an_endless_habit_needs_an_unscoped_and_unplanned_target() {
    let endless = Span {
        start: at("2026-10-04"),
        end: None,
    };
    let span = HabitSpan {
        time_scope: Some(endless),
        plan: Some(endless),
    };
    assert!(habit_conflicts(span, None, None).is_empty());
    assert_eq!(
        habit_conflicts(
            span,
            Some(month("2026-10-01").window()),
            Some(week("2026-10-04").window())
        ),
        vec![HabitConflict::TimeScope, HabitConflict::Plan]
    );
}

#[test]
fn a_bounded_habit_fits_a_target_that_holds_it() {
    let span = HabitSpan {
        time_scope: Some(Span {
            start: at("2026-10-04"),
            end: Some(at("2026-10-18")),
        }),
        plan: None,
    };
    assert!(habit_conflicts(span, Some(month("2026-10-01").window()), None).is_empty());
    assert_eq!(
        habit_conflicts(span, Some(week("2026-10-04").window()), None),
        vec![HabitConflict::TimeScope]
    );
}
