//! The Plan View's rules, ported from `src/utils/plan-triage.test.ts`, `plan-take-out.test.ts` and
//! `plan-scope.test.ts`. The whole triage is pinned by `conformance/plan-triage.json`.

use super::*;
use chrono::NaiveDate;

fn date(iso: &str) -> NaiveDate {
    NaiveDate::parse_from_str(iso, "%Y-%m-%d").unwrap_or_default()
}

fn week(iso: &str) -> ScopeKey {
    ScopeKey::containing(ScopeKind::Week, date(iso)).unwrap()
}

fn on(key: ScopeKey) -> TimeScope {
    TimeScope {
        start_id: key,
        end_id: key,
        duration: None,
    }
}

fn row(id: &str) -> PlanRow {
    PlanRow {
        id: id.to_string(),
        stored: true,
        time_scope: None,
        plan: None,
        overdue: false,
        ancestors: Vec::new(),
    }
}

fn ids(rows: &[&PlanRow]) -> Vec<String> {
    rows.iter().map(|row| row.id.clone()).collect()
}

#[test]
fn a_week_has_the_month_it_starts_in_for_its_parent_and_a_season_has_none() {
    let month = ScopeKey::containing(ScopeKind::Month, date("2026-09-27")).unwrap();
    assert_eq!(parent_of(&week("2026-10-01")), Some(month));
    let season = ScopeKey::containing(ScopeKind::Season, date("2026-09-01")).unwrap();
    assert_eq!(parent_of(&season), None);
}

#[test]
fn work_taken_out_goes_one_rung_up_or_loses_its_plan_at_the_top() {
    assert_eq!(take_out(true, "week", Some("month")), TakeOut::Plan("week"));
    assert_eq!(
        take_out(false, "week", Some("month")),
        TakeOut::Plan("month")
    );
    assert_eq!(take_out(false, "season", None), TakeOut::Clear);
}

#[test]
fn the_three_heaps_and_what_falls_in_none() {
    let target = week("2026-09-14");
    let month = parent_of(&target);
    let unscoped = row("unscoped");
    let mut relevant = row("relevant");
    relevant.time_scope = Some(on(ScopeKey::containing(
        ScopeKind::Month,
        date("2026-09-14"),
    )
    .unwrap()));
    let mut elsewhere_scope = row("not-relevant");
    elsewhere_scope.time_scope = Some(on(week("2026-10-05")));
    let mut planned = row("planned");
    planned.plan = Some(on(ScopeKey::day(date("2026-09-15"))));
    let mut to_parent = row("to-parent");
    to_parent.plan = month.map(on);
    let mut elsewhere = row("planned-elsewhere");
    elsewhere.plan = Some(on(week("2026-09-21")));
    let rows = [
        unscoped,
        relevant,
        elsewhere_scope,
        planned,
        to_parent,
        elsewhere,
    ];
    let panes = triage(&rows, target.bounds(), month.as_ref());
    assert_eq!(ids(&panes.unplanned), ["unscoped", "relevant"]);
    assert_eq!(ids(&panes.planned), ["planned"]);
    assert_eq!(ids(&panes.parent_planned), ["to-parent"]);
}

#[test]
fn a_move_out_of_the_own_window_is_refused_unless_the_task_is_overdue() {
    let mut task = row("t");
    task.time_scope = Some(on(week("2026-09-14")));
    let next_week = week("2026-09-21").bounds();
    assert_eq!(task.refusal(next_week), Some(PlanRefusal::OwnTimeScope));
    task.overdue = true;
    assert_eq!(task.refusal(next_week), None);
}

#[test]
fn a_move_out_of_the_parents_plan_is_refused_and_a_wait_cuts_the_chain() {
    let mut task = row("t");
    task.ancestors = vec![PlanAncestor {
        is_wait: false,
        time_scope: None,
        plan: Some(on(week("2026-09-14"))),
    }];
    let next_week = week("2026-09-21").bounds();
    assert_eq!(task.refusal(next_week), Some(PlanRefusal::ParentPlan));
    task.ancestors.push(PlanAncestor {
        is_wait: true,
        time_scope: None,
        plan: None,
    });
    assert_eq!(task.refusal(next_week), None, "a check task under a wait");
}

#[test]
fn a_month_splits_into_every_week_touching_it_and_the_edge_weeks_are_partial() {
    let month = ScopeKey::containing(ScopeKind::Month, date("2026-09-01")).unwrap();
    let mut early = row("early");
    early.plan = Some(on(ScopeKey::day(date("2026-09-02"))));
    let mut whole = row("whole");
    whole.plan = Some(on(month));
    let rows = [early, whole];
    let planned: Vec<&PlanRow> = rows.iter().collect();
    let split = split(&planned, &month, false).unwrap();
    let partial: Vec<bool> = split
        .sections
        .iter()
        .map(|section| section.partial)
        .collect();
    assert_eq!(partial, [true, false, false, false, true]);
    assert_eq!(ids(&split.sections[0].rows), ["early"]);
    assert_eq!(
        ids(&split.unplaced),
        ["whole"],
        "planned to the month itself"
    );
}
