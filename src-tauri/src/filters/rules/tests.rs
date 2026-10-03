//! Each predicate on its own, at the boundaries the specification names.

use super::*;
use crate::filters::model::{BoardFilter, NodeFacts, NodeKind, OverrideMode, Preset, TagMode};
use crate::tasks::{lifecycle::Timing, model::Verdict};

fn task(status: &str) -> NodeFacts {
    let mut node = NodeFacts::new("task-1", NodeKind::Task);
    node.status = Some(status.to_string());
    node
}

fn goal(status: &str) -> NodeFacts {
    let mut node = NodeFacts::new("goal-1", NodeKind::Goal);
    node.status = Some(status.to_string());
    node
}

fn commitment(verdict: Verdict, timing: Timing) -> NodeFacts {
    let mut node = NodeFacts::new("commitment-1", NodeKind::Commitment);
    node.verdict = Some(verdict);
    node.timing = Some(timing);
    node
}

fn project(status: &str) -> NodeFacts {
    let mut node = NodeFacts::new("domain-1", NodeKind::Project);
    node.status = Some(status.to_string());
    node
}

fn matches(node: &NodeFacts, preset: Preset) -> bool {
    passes_status(node, &BoardFilter::preset(preset), UNSET_STATUS, false)
}

#[test]
fn all_shows_every_kind() {
    for node in [
        task("done"),
        goal("achieved"),
        commitment(Verdict::Kept, Timing::Lapsed),
    ] {
        assert!(
            matches(&node, Preset::All),
            "{:?} should show under All",
            node.kind
        );
    }
}

#[test]
fn plan_drops_done_tasks_and_resolved_goals() {
    assert!(matches(&task("todo"), Preset::Plan));
    assert!(matches(&task("in_progress"), Preset::Plan));
    assert!(!matches(&task("done"), Preset::Plan));
    assert!(matches(&goal("active"), Preset::Plan));
    for resolved in ["achieved", "frozen", "archived"] {
        assert!(!matches(&goal(resolved), Preset::Plan), "{resolved}");
    }
}

#[test]
fn plan_drops_an_item_a_resolution_archived_whatever_its_stored_status_says() {
    let mut node = task("todo");
    node.timing = Some(Timing::Lapsed);
    node.archived = true;
    assert!(!matches(&node, Preset::Plan));

    let mut still_active_goal = goal("active");
    still_active_goal.archived = true;
    assert!(!matches(&still_active_goal, Preset::Plan));
}

#[test]
fn start_drops_a_lapsed_window_even_when_nothing_else_would() {
    let mut node = task("todo");
    node.timing = Some(Timing::Lapsed);
    assert!(
        matches(&node, Preset::Plan),
        "Plan still shows an Overdue item"
    );
    assert!(!matches(&node, Preset::Start));
}

fn overdue(mut node: NodeFacts) -> NodeFacts {
    node.timing = Some(Timing::Lapsed);
    node.overdue = true;
    node
}

#[test]
fn start_keeps_an_overdue_task_or_goal_whose_window_has_lapsed() {
    for node in [overdue(task("todo")), overdue(goal("active"))] {
        assert!(matches(&node, Preset::Start), "{:?}", node.kind);
        assert!(matches(&node, Preset::Plan), "{:?}", node.kind);
    }
}

#[test]
fn start_keeps_a_task_overdue_inside_its_open_window() {
    let mut node = task("todo");
    node.timing = Some(Timing::Active);
    node.overdue = true;
    assert!(matches(&node, Preset::Start));
}

#[test]
fn an_overdue_item_still_drops_out_of_start_for_every_other_reason() {
    let mut delegated = overdue(task("todo"));
    delegated.delegated = true;
    assert!(!matches(&delegated, Preset::Start), "delegated");

    let mut blocked = overdue(task("todo"));
    blocked.is_blocked = true;
    assert!(
        is_held_by_block(&blocked, &None, &BoardFilter::preset(Preset::Start)),
        "blocked"
    );

    let mut backlogged = overdue(task("todo"));
    backlogged.backlogged = true;
    assert!(
        is_hidden_backlog(&backlogged, &BoardFilter::preset(Preset::Start)),
        "backlogged"
    );

    let mut planned_ahead = overdue(task("todo"));
    planned_ahead.plan_timing = Some(Timing::Pending);
    assert!(
        is_planned_ahead(&planned_ahead, &BoardFilter::preset(Preset::Start), None),
        "rescheduled into a Plan still ahead"
    );

    let bare_in_progress = overdue(task("in_progress"));
    assert!(
        !matches(&bare_in_progress, Preset::Start),
        "in progress with nothing left to start"
    );
}

#[test]
fn a_missed_item_is_never_overdue_and_drops_out_of_start() {
    let mut missed = task("todo");
    missed.timing = Some(Timing::Lapsed);
    missed.archived = true;
    assert!(!matches(&missed, Preset::Start));
}

#[test]
fn start_keeps_a_pending_wait_that_is_overdue() {
    let wait = overdue(expectation("pending"));
    assert!(passes_expectation_preset(
        &wait,
        &BoardFilter::preset(Preset::Start)
    ));
}

#[test]
fn start_drops_a_task_or_goal_whose_window_has_not_begun_and_no_other_preset_does() {
    for mut node in [task("todo"), goal("active")] {
        node.timing = Some(Timing::Pending);
        assert!(matches(&node, Preset::All));
        assert!(
            matches(&node, Preset::Plan),
            "Plan still shows work scheduled ahead"
        );
        assert!(!matches(&node, Preset::Start), "{:?}", node.kind);
        node.timing = Some(Timing::Active);
        assert!(matches(&node, Preset::Start), "{:?}", node.kind);
    }
}

#[test]
fn a_task_whose_window_has_not_begun_fails_only_its_own_match_under_start() {
    let mut node = task("todo");
    node.timing = Some(Timing::Pending);
    assert!(
        !type_hard_hidden(&node, &BoardFilter::preset(Preset::Start)),
        "a child with its own open window must still be able to hold it on screen"
    );
}

#[test]
fn start_drops_an_in_progress_task_with_nothing_left_to_start() {
    let bare = task("in_progress");
    assert!(!matches(&bare, Preset::Start));
    let mut parent = task("in_progress");
    parent.has_todo_child = true;
    assert!(matches(&parent, Preset::Start));
}

#[test]
fn do_shows_in_progress_tasks_and_nothing_else() {
    assert!(matches(&task("in_progress"), Preset::Do));
    assert!(!matches(&task("todo"), Preset::Do));
    assert!(!matches(&goal("active"), Preset::Do));
}

#[test]
fn plan_shows_a_started_task_and_start_shows_one_by_default_and_do_does_not() {
    let started = task("started");
    assert!(matches(&started, Preset::All));
    assert!(matches(&started, Preset::Plan));
    assert!(
        matches(&started, Preset::Start),
        "Start shows Started by default"
    );
    assert!(
        !matches(&started, Preset::Do),
        "Do hides Started by default"
    );
    assert!(!matches(&started, Preset::Backlog));
}

#[test]
fn the_two_settings_switch_started_in_start_and_do() {
    let started = task("started");
    let start_off = BoardFilter {
        start_shows_started: false,
        ..BoardFilter::preset(Preset::Start)
    };
    assert!(!passes_status(&started, &start_off, UNSET_STATUS, false));
    let do_on = BoardFilter {
        do_shows_started: true,
        ..BoardFilter::preset(Preset::Do)
    };
    assert!(passes_status(&started, &do_on, UNSET_STATUS, false));
    // Neither setting reaches any other status.
    assert!(passes_status(
        &task("in_progress"),
        &do_on,
        UNSET_STATUS,
        false
    ));
    assert!(!passes_status(&task("todo"), &do_on, UNSET_STATUS, false));
    assert!(passes_status(
        &task("todo"),
        &start_off,
        UNSET_STATUS,
        false
    ));
}

#[test]
fn backlog_shows_what_was_set_aside_and_what_sits_under_it() {
    let mut node = task("todo");
    node.backlogged = true;
    assert!(matches(&node, Preset::Backlog));
    assert!(!matches(&task("todo"), Preset::Backlog));
    assert!(passes_status(
        &task("todo"),
        &BoardFilter::preset(Preset::Backlog),
        UNSET_STATUS,
        true
    ));
}

#[test]
fn a_structural_container_shows_alone_only_in_plan_and_only_while_active() {
    let active = project("active");
    assert!(matches(&active, Preset::Plan));
    assert!(!matches(&active, Preset::Start));
    assert!(!matches(&active, Preset::Do));
    assert!(!matches(&project("achieved"), Preset::Plan));
    assert!(!matches(
        &NodeFacts::new("domain-2", NodeKind::Tag),
        Preset::Plan
    ));
}

#[test]
fn a_status_less_container_reads_its_nearest_status_bearing_ancestor() {
    let domain = NodeFacts::new("domain-2", NodeKind::Domain);
    let plan = BoardFilter::preset(Preset::Plan);
    assert!(passes_status(&domain, &plan, "active", false));
    assert!(!passes_status(&domain, &plan, "achieved", false));
    // Nothing above it carrying one at all reads as Active.
    assert!(passes_status(&domain, &plan, UNSET_STATUS, false));
}

#[test]
fn a_commitment_answers_its_own_branch_of_the_rules() {
    let unresolved = commitment(Verdict::Unresolved, Timing::Active);
    for preset in [Preset::All, Preset::Plan, Preset::Start, Preset::Do] {
        assert!(passes_commitment_preset(
            &unresolved,
            &BoardFilter::preset(preset)
        ));
    }
    assert!(!passes_commitment_preset(
        &unresolved,
        &BoardFilter::preset(Preset::Backlog)
    ));

    let kept = commitment(Verdict::Kept, Timing::Active);
    assert!(passes_commitment_preset(
        &kept,
        &BoardFilter::preset(Preset::All)
    ));
    assert!(!passes_commitment_preset(
        &kept,
        &BoardFilter::preset(Preset::Plan)
    ));
}

#[test]
fn plan_start_and_do_hide_a_broken_commitment_even_while_its_window_is_open() {
    // A Broken verdict is an answer, like Kept: Plan no longer keeps it on screen until the
    // window closes (ruled 2026-09-23).
    let open = commitment(Verdict::Broken, Timing::Active);
    for preset in [Preset::Plan, Preset::Start, Preset::Do, Preset::Backlog] {
        assert!(!passes_commitment_preset(
            &open,
            &BoardFilter::preset(preset)
        ));
    }
    assert!(passes_commitment_preset(
        &open,
        &BoardFilter::preset(Preset::All)
    ));
}

fn expectation(status: &str) -> NodeFacts {
    let mut node = NodeFacts::new("expectation-1", NodeKind::Expectation);
    node.status = Some(status.to_string());
    node
}

#[test]
fn with_the_setting_on_start_shows_a_pending_wait_only_without_checks() {
    let bare = expectation("pending");
    let mut checked = expectation("pending");
    checked.has_check = true;
    for (preset, bare_shows, checked_shows) in [
        (Preset::All, true, true),
        (Preset::Plan, true, true),
        (Preset::Start, true, false),
        (Preset::Do, false, false),
        (Preset::Backlog, false, false),
    ] {
        let filter = BoardFilter {
            start_hides_checked_waits: true,
            ..BoardFilter::preset(preset)
        };
        assert_eq!(
            passes_expectation_preset(&bare, &filter),
            bare_shows,
            "{preset:?}"
        );
        assert_eq!(
            passes_expectation_preset(&checked, &filter),
            checked_shows,
            "{preset:?}"
        );
    }
}

#[test]
fn by_default_start_shows_a_pending_wait_whether_or_not_it_is_checked_on() {
    let bare = expectation("pending");
    let mut checked = expectation("pending");
    checked.has_check = true;
    let start = BoardFilter::preset(Preset::Start);
    assert!(!start.start_hides_checked_waits, "off by default");
    assert!(passes_expectation_preset(&bare, &start));
    assert!(passes_expectation_preset(&checked, &start));
    // A passed window still drops it, checked or not.
    checked.timing = Some(Timing::Lapsed);
    assert!(!passes_expectation_preset(&checked, &start));
}

#[test]
fn start_hides_a_wait_whose_window_has_not_begun_together_with_its_check_tasks() {
    let mut ahead = expectation("pending");
    ahead.timing = Some(Timing::Pending);
    let start = BoardFilter::preset(Preset::Start);
    assert!(!passes_expectation_preset(&ahead, &start));
    assert!(
        is_unopened_wait(&ahead, &start),
        "gates its subtree, so a check due already goes with it"
    );
    assert!(type_hard_hidden(&ahead, &start));
    for preset in [Preset::All, Preset::Plan, Preset::Do, Preset::Backlog] {
        assert!(
            !is_unopened_wait(&ahead, &BoardFilter::preset(preset)),
            "{preset:?}"
        );
    }
    assert!(passes_expectation_preset(
        &ahead,
        &BoardFilter::preset(Preset::Plan)
    ));

    let mut open = expectation("pending");
    open.timing = Some(Timing::Active);
    assert!(!is_unopened_wait(&open, &start));
    assert!(passes_expectation_preset(&open, &start));
}

#[test]
fn the_archived_pill_on_include_still_shows_an_archived_wait_whose_window_is_ahead() {
    let mut archived = expectation("pending");
    archived.timing = Some(Timing::Pending);
    archived.archived = true;
    let filter = BoardFilter {
        archived: OverrideMode::Include,
        ..BoardFilter::preset(Preset::Start)
    };
    assert!(!is_unopened_wait(&archived, &filter));
}

#[test]
fn a_released_or_archived_expectation_shows_under_all_only() {
    let released = expectation("released");
    let mut archived = expectation("pending");
    archived.archived = true;
    for node in [&released, &archived] {
        assert!(passes_expectation_preset(
            node,
            &BoardFilter::preset(Preset::All)
        ));
        assert!(!passes_expectation_preset(
            node,
            &BoardFilter::preset(Preset::Plan)
        ));
        assert!(!passes_expectation_preset(
            node,
            &BoardFilter::preset(Preset::Start)
        ));
    }
    // The Archived pill's Include still force-shows the archived one, through `passes_status`.
    let include = BoardFilter {
        archived: OverrideMode::Include,
        ..BoardFilter::preset(Preset::Plan)
    };
    assert!(passes_status(&archived, &include, UNSET_STATUS, false));
    assert!(!passes_status(&released, &include, UNSET_STATUS, false));
}

#[test]
fn a_delegated_task_is_not_archived_and_the_delegated_pill_off_drops_it_under_plan_and_start_only()
{
    let mut delegated = task("in_progress");
    delegated.delegated = true;
    assert!(!is_archived(&delegated));
    for preset in [Preset::Plan, Preset::Start] {
        assert!(
            !passes_status(
                &delegated,
                &BoardFilter::preset(preset),
                UNSET_STATUS,
                false
            ),
            "{preset:?}"
        );
    }
    assert!(passes_status(
        &delegated,
        &BoardFilter::preset(Preset::Do),
        UNSET_STATUS,
        false
    ));
    let archived_excluded = BoardFilter {
        archived: OverrideMode::Exclude,
        ..BoardFilter::preset(Preset::All)
    };
    assert!(!type_hard_hidden(&delegated, &archived_excluded));
}

#[test]
fn the_delegated_pill_on_include_keeps_a_delegated_task_and_on_exclude_hides_it_everywhere() {
    let mut delegated = task("todo");
    delegated.delegated = true;
    let include = BoardFilter {
        delegated: OverrideMode::Include,
        ..BoardFilter::preset(Preset::Plan)
    };
    assert!(passes_status(&delegated, &include, UNSET_STATUS, false));
    for preset in [Preset::All, Preset::Do, Preset::Plan] {
        let exclude = BoardFilter {
            delegated: OverrideMode::Exclude,
            ..BoardFilter::preset(preset)
        };
        assert!(type_hard_hidden(&delegated, &exclude), "{preset:?}");
    }
}

#[test]
fn a_frozen_or_archived_project_shelves_its_subtree_in_plan_and_start_only() {
    for status in ["frozen", "archived"] {
        let node = project(status);
        assert!(
            is_shelved_project(&node, &BoardFilter::preset(Preset::Plan)),
            "{status}"
        );
        assert!(
            is_shelved_project(&node, &BoardFilter::preset(Preset::Start)),
            "{status}"
        );
        assert!(
            !is_shelved_project(&node, &BoardFilter::preset(Preset::All)),
            "{status}"
        );
    }
    // Achieved keeps the ordinary ancestor-keeping.
    assert!(!is_shelved_project(
        &project("achieved"),
        &BoardFilter::preset(Preset::Plan)
    ));
}

#[test]
fn the_archived_pill_include_rescues_an_archived_project_but_not_a_frozen_one() {
    let filter = BoardFilter {
        archived: OverrideMode::Include,
        ..BoardFilter::preset(Preset::Plan)
    };
    assert!(!is_shelved_project(&project("archived"), &filter));
    assert!(is_shelved_project(&project("frozen"), &filter));
}

#[test]
fn a_backlogged_task_answers_the_preset_and_then_the_pill() {
    let mut node = task("todo");
    node.backlogged = true;
    assert!(is_hidden_backlog(&node, &BoardFilter::preset(Preset::Plan)));
    assert!(is_hidden_backlog(
        &node,
        &BoardFilter::preset(Preset::Start)
    ));
    assert!(!is_hidden_backlog(&node, &BoardFilter::preset(Preset::All)));
    assert!(!is_hidden_backlog(
        &node,
        &BoardFilter::preset(Preset::Backlog)
    ));

    let include = BoardFilter {
        backlog: OverrideMode::Include,
        ..BoardFilter::preset(Preset::Plan)
    };
    assert!(!is_hidden_backlog(&node, &include));
    let exclude = BoardFilter {
        backlog: OverrideMode::Exclude,
        ..BoardFilter::preset(Preset::All)
    };
    assert!(is_hidden_backlog(&node, &exclude));
}

#[test]
fn an_unopened_habit_occurrence_shows_under_all_and_nowhere_else() {
    let mut node = task("todo");
    node.is_habit_occurrence = true;
    node.timing = Some(Timing::Pending);
    assert!(!is_unopened_occurrence(
        &node,
        &BoardFilter::preset(Preset::All)
    ));
    assert!(is_unopened_occurrence(
        &node,
        &BoardFilter::preset(Preset::Plan)
    ));

    // A hand-made task scheduled for next week is Pending too, and still plans.
    let mut ordinary = task("todo");
    ordinary.timing = Some(Timing::Pending);
    assert!(!is_unopened_occurrence(
        &ordinary,
        &BoardFilter::preset(Preset::Plan)
    ));
}

#[test]
fn private_info_and_flow_hiding_all_gate_the_subtree() {
    let mut private = task("todo");
    private.is_private = true;
    assert!(type_hard_hidden(&private, &BoardFilter::default()));
    assert!(!type_hard_hidden(
        &private,
        &BoardFilter {
            private_mode: true,
            ..BoardFilter::default()
        }
    ));

    let info = NodeFacts::new("info-1", NodeKind::Info);
    assert!(!type_hard_hidden(&info, &BoardFilter::default()));
    assert!(type_hard_hidden(
        &info,
        &BoardFilter {
            show_info: false,
            ..BoardFilter::default()
        }
    ));
}

#[test]
fn start_holds_back_a_blocked_task_and_only_a_task_or_goal_is_blocked() {
    let mut node = task("todo");
    node.is_blocked = true;
    assert!(is_held_by_block(
        &node,
        &None,
        &BoardFilter::preset(Preset::Start)
    ));
    assert!(!is_held_by_block(
        &node,
        &None,
        &BoardFilter::preset(Preset::Plan)
    ));
    assert!(
        !type_hard_hidden(&node, &BoardFilter::preset(Preset::Start)),
        "held back, not hard-hidden: it can still stand over a child dependency"
    );

    let mut domain = NodeFacts::new("domain-1", NodeKind::Domain);
    domain.is_blocked = true;
    assert!(!is_blocked(&domain));
}

#[test]
fn a_habit_flow_drops_out_of_start_and_every_flow_drops_out_of_do() {
    let mut habit = NodeFacts::new("flow-1", NodeKind::Flow);
    habit.is_habit_flow = true;
    let plain = NodeFacts::new("flow-2", NodeKind::Flow);

    assert!(type_hard_hidden(
        &habit,
        &BoardFilter::preset(Preset::Start)
    ));
    assert!(!type_hard_hidden(
        &plain,
        &BoardFilter::preset(Preset::Start)
    ));
    assert!(type_hard_hidden(&plain, &BoardFilter::preset(Preset::Do)));
    assert!(type_hard_hidden(
        &plain,
        &BoardFilter {
            include_flows: false,
            ..BoardFilter::preset(Preset::Plan)
        }
    ));
    assert!(type_hard_hidden(
        &NodeFacts::new("flow_task-1", NodeKind::FlowTask),
        &BoardFilter {
            show_flow: false,
            ..BoardFilter::default()
        }
    ));
}

#[test]
fn tags_combine_as_any_and_all_and_not_exclude() {
    let tagged = |ids: &[i64]| {
        let mut node = task("todo");
        node.tag_ids = ids.to_vec();
        node
    };
    let with = |tags: Vec<(i64, TagMode)>| BoardFilter {
        tags: tags
            .into_iter()
            .map(|(tag_id, mode)| crate::filters::model::TagFilter { tag_id, mode })
            .collect(),
        ..BoardFilter::default()
    };

    assert!(passes_tags(&tagged(&[7]), &with(vec![(7, TagMode::Any)])));
    assert!(!passes_tags(&tagged(&[8]), &with(vec![(7, TagMode::Any)])));
    assert!(passes_tags(
        &tagged(&[7, 8]),
        &with(vec![(7, TagMode::All), (8, TagMode::All)])
    ));
    assert!(!passes_tags(
        &tagged(&[7]),
        &with(vec![(7, TagMode::All), (8, TagMode::All)])
    ));
    assert!(!passes_tags(
        &tagged(&[7]),
        &with(vec![(7, TagMode::Exclude)])
    ));

    // A kind that carries no tags is not judged, rather than read as having failed.
    assert!(passes_tags(
        &NodeFacts::new("domain-1", NodeKind::Domain),
        &with(vec![(7, TagMode::Any)])
    ));
}

#[test]
fn self_matches_needs_both_the_status_and_the_tags() {
    let mut node = task("todo");
    node.tag_ids = vec![7];
    let filter = BoardFilter {
        tags: vec![crate::filters::model::TagFilter {
            tag_id: 8,
            mode: TagMode::Any,
        }],
        ..BoardFilter::preset(Preset::Plan)
    };
    assert!(passes_status(&node, &filter, UNSET_STATUS, false));
    assert!(!self_matches(&node, &filter, UNSET_STATUS, false));
}

#[test]
fn the_default_filter_is_the_neutral_one() {
    let filter = BoardFilter::default();
    assert_eq!(filter.preset, Preset::All);
    assert!(!filter.unblock);
    assert!(filter.include_flows && filter.show_info && filter.show_flow);
    assert!(!filter.private_mode);
    assert_eq!(filter.archived, OverrideMode::Inactive);
    assert_eq!(filter.backlog, OverrideMode::Inactive);
    assert!(filter.start_shows_started, "Start shows Started by default");
    assert!(!filter.do_shows_started, "Do hides Started by default");
}

#[test]
fn kinds_know_which_group_they_belong_to() {
    assert!(NodeKind::Aspect.is_structural());
    assert!(NodeKind::Tag.is_structural());
    assert!(!NodeKind::Goal.is_structural());
    assert!(NodeKind::FlowGoal.is_flow());
    assert!(!NodeKind::HabitGroup.is_flow());
    assert_eq!(NodeFacts::new("x", NodeKind::Task).status_str(), "");
}

fn planned(timing: Option<Timing>) -> NodeFacts {
    let mut node = task("todo");
    node.plan_timing = timing;
    node
}

#[test]
fn start_hides_a_task_whose_own_plan_has_not_begun() {
    let start = BoardFilter::preset(Preset::Start);
    assert!(is_planned_ahead(
        &planned(Some(Timing::Pending)),
        &start,
        None
    ));
    assert!(!is_planned_ahead(
        &planned(Some(Timing::Active)),
        &start,
        None
    ));
    // A plan that ended unfulfilled leaves the Task on screen as missed work.
    assert!(!is_planned_ahead(
        &planned(Some(Timing::Lapsed)),
        &start,
        None
    ));
    assert!(!is_planned_ahead(&planned(None), &start, None));
}

#[test]
fn an_unplanned_task_is_read_by_the_plan_it_inherits_and_its_own_plan_wins() {
    let start = BoardFilter::preset(Preset::Start);
    assert!(is_planned_ahead(
        &planned(None),
        &start,
        Some(Timing::Pending)
    ));
    assert!(!is_planned_ahead(
        &planned(None),
        &start,
        Some(Timing::Active)
    ));
    assert!(!is_planned_ahead(
        &planned(Some(Timing::Active)),
        &start,
        Some(Timing::Pending)
    ));
}

#[test]
fn only_start_reads_a_plan_and_only_on_a_task() {
    let future = planned(Some(Timing::Pending));
    for preset in [Preset::All, Preset::Plan, Preset::Do, Preset::Backlog] {
        assert!(
            !is_planned_ahead(&future, &BoardFilter::preset(preset), None),
            "{preset:?}"
        );
    }
    let start = BoardFilter::preset(Preset::Start);
    assert!(!is_planned_ahead(
        &goal("active"),
        &start,
        Some(Timing::Pending)
    ));
    assert!(!is_planned_ahead(
        &commitment(Verdict::Unresolved, Timing::Active),
        &start,
        Some(Timing::Pending)
    ));
}

fn date(iso: &str) -> chrono::NaiveDate {
    chrono::NaiveDate::parse_from_str(iso, "%Y-%m-%d").unwrap()
}

/// The week of 2026-09-20 to 2026-09-26.
fn week() -> crate::scopes::key::ScopeKey {
    crate::scopes::key::ScopeKey::containing(
        crate::scopes::model::ScopeKind::Week,
        date("2026-09-20"),
    )
    .unwrap()
}

fn window(start: &str, end: &str) -> TimeScope {
    TimeScope {
        start_id: crate::scopes::key::ScopeKey::day(date(start)),
        end_id: crate::scopes::key::ScopeKey::day(date(end)),
        duration: None,
    }
}

fn scoped(time_scope: Option<TimeScope>) -> NodeFacts {
    let mut node = task("todo");
    node.time_scope = time_scope;
    node
}

fn narrowed(scope_match: crate::filters::model::ScopeMatch) -> BoardFilter {
    BoardFilter {
        plan_scope: Some(week()),
        scope_match,
        ..BoardFilter::preset(Preset::Plan)
    }
}

#[test]
fn the_plan_scope_keeps_a_task_whose_window_is_contained_or_equal() {
    let contained = narrowed(crate::filters::model::ScopeMatch::Contained);
    let tuesday = scoped(Some(window("2026-09-22", "2026-09-22")));
    let whole_week = scoped(Some(window("2026-09-20", "2026-09-26")));
    assert!(!is_outside_plan_scope(&tuesday, &contained, None));
    assert!(!is_outside_plan_scope(&whole_week, &contained, None));
}

#[test]
fn the_plan_scope_leaves_out_an_overlapping_window_and_an_unscoped_task_under_containment() {
    let contained = narrowed(crate::filters::model::ScopeMatch::Contained);
    let straddling = scoped(Some(window("2026-09-25", "2026-09-28")));
    assert!(is_outside_plan_scope(&straddling, &contained, None));
    assert!(is_outside_plan_scope(&scoped(None), &contained, None));
}

#[test]
fn the_plan_scope_reads_an_inherited_window_and_the_task_own_one_wins() {
    let contained = narrowed(crate::filters::model::ScopeMatch::Contained);
    let inside = window("2026-09-22", "2026-09-22");
    let outside = window("2026-10-05", "2026-10-05");
    assert!(!is_outside_plan_scope(
        &scoped(None),
        &contained,
        Some(&inside)
    ));
    assert!(is_outside_plan_scope(
        &scoped(None),
        &contained,
        Some(&outside)
    ));
    assert!(!is_outside_plan_scope(
        &scoped(Some(inside.clone())),
        &contained,
        Some(&outside)
    ));
}

#[test]
fn the_overlapping_match_keeps_a_straddling_window_and_an_unscoped_task() {
    let overlapping = narrowed(crate::filters::model::ScopeMatch::Overlapping);
    let straddling = scoped(Some(window("2026-09-25", "2026-09-28")));
    let next_week = scoped(Some(window("2026-09-27", "2026-09-30")));
    assert!(!is_outside_plan_scope(&straddling, &overlapping, None));
    assert!(!is_outside_plan_scope(&scoped(None), &overlapping, None));
    // Adjacent is not overlapping: next week begins where this one ends.
    assert!(is_outside_plan_scope(&next_week, &overlapping, None));
}

#[test]
fn only_the_plan_preset_narrows_by_scope_and_only_a_task() {
    let unscoped = scoped(None);
    for preset in [Preset::All, Preset::Start, Preset::Do, Preset::Backlog] {
        let filter = BoardFilter {
            plan_scope: Some(week()),
            ..BoardFilter::preset(preset)
        };
        assert!(
            !is_outside_plan_scope(&unscoped, &filter, None),
            "{preset:?}"
        );
    }
    let contained = narrowed(crate::filters::model::ScopeMatch::Contained);
    assert!(!is_outside_plan_scope(&goal("active"), &contained, None));
    assert!(!is_outside_plan_scope(
        &unscoped,
        &BoardFilter::preset(Preset::Plan),
        None
    ));
}

fn blocked_on(id: &str, dependencies: &[&str]) -> NodeFacts {
    let mut node = NodeFacts::new(id, NodeKind::Task);
    node.status = Some("todo".to_string());
    node.is_blocked = true;
    node.blocking_dependencies = dependencies.iter().map(|id| (*id).to_string()).collect();
    node
}

#[test]
fn a_blocked_node_gates_its_children_except_its_unmet_dependencies() {
    let start = BoardFilter::preset(Preset::Start);
    let parent = blocked_on("task-1", &["task-2"]);
    let gate = gate_below(&parent, &None, &start);
    assert!(is_admitted_by(
        &NodeFacts::new("task-2", NodeKind::Task),
        &gate
    ));
    assert!(!is_admitted_by(
        &NodeFacts::new("task-3", NodeKind::Task),
        &gate
    ));
    assert!(
        gate_below(&parent, &None, &BoardFilter::preset(Preset::Plan)).is_none(),
        "only Start gates"
    );
}

#[test]
fn an_admitted_dependency_lifts_the_gate_for_its_own_subtree() {
    let start = BoardFilter::preset(Preset::Start);
    let parent = blocked_on("task-1", &["task-2"]);
    let gate = gate_below(&parent, &None, &start);
    let mut dependency = task("todo");
    dependency.id = "task-2".to_string();
    assert!(gate_below(&dependency, &gate, &start).is_none());
}

#[test]
fn a_blocked_node_still_held_by_an_outer_gate_narrows_it_to_what_both_name() {
    let start = BoardFilter::preset(Preset::Start);
    let outer = blocked_on("task-1", &["task-3", "task-4"]);
    let gate = gate_below(&outer, &None, &start);
    let inner = blocked_on("task-2", &["task-3", "task-5"]);
    let narrowed = gate_below(&inner, &gate, &start);
    assert!(is_admitted_by(
        &NodeFacts::new("task-3", NodeKind::Task),
        &narrowed
    ));
    assert!(!is_admitted_by(
        &NodeFacts::new("task-4", NodeKind::Task),
        &narrowed
    ));
    assert!(!is_admitted_by(
        &NodeFacts::new("task-5", NodeKind::Task),
        &narrowed
    ));
}

#[test]
fn an_explicit_reason_alone_admits_nothing() {
    let start = BoardFilter::preset(Preset::Start);
    let parent = blocked_on("task-1", &[]);
    let gate = gate_below(&parent, &None, &start);
    assert!(!is_admitted_by(
        &NodeFacts::new("task-2", NodeKind::Task),
        &gate
    ));
}

fn agentic(status: &str) -> NodeFacts {
    let mut node = task(status);
    node.agentic = true;
    node
}

#[test]
fn start_shows_an_agentic_task_to_claim_and_one_awaiting_review() {
    assert!(matches(&agentic("todo"), Preset::Start));
    assert!(matches(&agentic("review"), Preset::Start));
    assert!(!matches(&agentic("done"), Preset::Start));
}

#[test]
fn start_and_do_hide_on_agent_unless_it_is_shown() {
    assert!(!matches(&agentic("on_agent"), Preset::Start));
    assert!(!matches(&agentic("on_agent"), Preset::Do));
    let shown = BoardFilter {
        show_on_agent: true,
        ..BoardFilter::default()
    };
    assert!(passes_status(
        &agentic("on_agent"),
        &BoardFilter {
            preset: Preset::Start,
            ..shown.clone()
        },
        UNSET_STATUS,
        false
    ));
    assert!(passes_status(
        &agentic("on_agent"),
        &BoardFilter {
            preset: Preset::Do,
            ..shown
        },
        UNSET_STATUS,
        false
    ));
}

#[test]
fn review_ignores_the_started_settings() {
    let strict = BoardFilter {
        preset: Preset::Start,
        start_shows_started: false,
        ..BoardFilter::default()
    };
    assert!(passes_status(
        &agentic("review"),
        &strict,
        UNSET_STATUS,
        false
    ));
    assert!(matches(&agentic("review"), Preset::Do));
}

#[test]
fn do_shows_doing_and_review_but_not_an_agentic_to_do() {
    assert!(matches(&agentic("doing"), Preset::Do));
    assert!(matches(&agentic("review"), Preset::Do));
    assert!(!matches(&agentic("todo"), Preset::Do));
}

#[test]
fn doing_drops_from_start_with_nothing_left_to_start() {
    assert!(!matches(&agentic("doing"), Preset::Start));
    let mut parent = agentic("doing");
    parent.has_todo_child = true;
    assert!(matches(&parent, Preset::Start));
}

#[test]
fn an_ordinary_status_spelled_like_an_agentic_one_is_not_read_as_it() {
    // The model is read off the fact, not guessed from the spelling.
    assert!(!matches(&task("review"), Preset::Do));
}
