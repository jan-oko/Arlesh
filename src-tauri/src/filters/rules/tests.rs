//! Each predicate on its own, at the boundaries the specification names.

use super::*;
use crate::filters::model::{
    BoardFilter, NodeFacts, NodeKind, OverrideMode, Preset, ScopeAxis, ScopeMatch, ScopeWindow,
    TagMode,
};
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
fn plan_alone_shows_a_broken_commitment_whose_window_is_still_open() {
    let open = commitment(Verdict::Broken, Timing::Active);
    let closed = commitment(Verdict::Broken, Timing::Lapsed);
    assert!(passes_commitment_preset(
        &open,
        &BoardFilter::preset(Preset::Plan)
    ));
    assert!(!passes_commitment_preset(
        &closed,
        &BoardFilter::preset(Preset::Plan)
    ));
    // The carve-out mirrors no Task rule, and no other preset repeats it.
    assert!(!passes_commitment_preset(
        &open,
        &BoardFilter::preset(Preset::Start)
    ));
    assert!(!passes_commitment_preset(
        &open,
        &BoardFilter::preset(Preset::Do)
    ));
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
fn start_hard_hides_a_blocked_task_and_only_a_task_or_goal_is_blocked() {
    let mut node = task("todo");
    node.is_blocked = true;
    assert!(type_hard_hidden(&node, &BoardFilter::preset(Preset::Start)));
    assert!(!type_hard_hidden(&node, &BoardFilter::preset(Preset::Plan)));

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
    assert!(!self_matches(&node, &filter, Inherited::default()));
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

// ===========================================================================
// The scope selector
// ===========================================================================

/// A window from two `YYYY-MM-DD` dates, taken at the 02:00 boundary the whole scope ladder runs
/// on — so a "day" here is the same interval `canonical_bounds` resolves one to.
fn window(start: &str, end: &str) -> ScopeWindow {
    let at = |date: &str| {
        crate::scopes::resolve::day_boundary(
            date.parse::<chrono::NaiveDate>().expect("a date parses"),
        )
    };
    ScopeWindow {
        start: at(start),
        end: at(end),
    }
}

/// Monday 24 August through Monday 31 August — the W35 of the bead.
fn week() -> ScopeWindow {
    window("2026-08-24", "2026-08-31")
}

fn scoped(axis: ScopeAxis, rule: ScopeMatch, target: ScopeWindow) -> BoardFilter {
    BoardFilter {
        scope: Some(crate::filters::model::ScopeFilter {
            window: target,
            axis,
            match_rule: rule,
        }),
        ..BoardFilter::default()
    }
}

#[test]
fn within_keeps_the_day_inside_the_week_and_drops_the_season_around_it() {
    let filter = scoped(ScopeAxis::Relevance, ScopeMatch::Within, week());
    let mut day = task("todo");
    day.window = Some(window("2026-08-26", "2026-08-27"));
    let mut season = task("todo");
    season.window = Some(window("2026-06-01", "2026-09-01"));
    assert!(passes_scope(&day, &filter, None));
    assert!(!passes_scope(&season, &filter, None));
}

#[test]
fn overlapping_keeps_both_the_day_inside_the_week_and_the_season_around_it() {
    let filter = scoped(ScopeAxis::Relevance, ScopeMatch::Overlapping, week());
    let mut day = task("todo");
    day.window = Some(window("2026-08-26", "2026-08-27"));
    let mut season = task("todo");
    season.window = Some(window("2026-06-01", "2026-09-01"));
    assert!(passes_scope(&day, &filter, None));
    assert!(passes_scope(&season, &filter, None));
}

#[test]
fn the_week_after_starts_where_this_one_ends_and_so_does_not_overlap_it() {
    let filter = scoped(ScopeAxis::Relevance, ScopeMatch::Overlapping, week());
    let mut next = task("todo");
    next.window = Some(window("2026-08-31", "2026-09-07"));
    assert!(!passes_scope(&next, &filter, None));
}

#[test]
fn an_item_with_no_window_of_its_own_matches_through_its_nearest_scoped_ancestor() {
    let inherited = Some(window("2026-08-26", "2026-08-27"));
    let node = task("todo");
    assert!(passes_scope(
        &node,
        &scoped(ScopeAxis::Relevance, ScopeMatch::Within, week()),
        inherited
    ));
    assert!(!passes_scope(
        &node,
        &scoped(
            ScopeAxis::Relevance,
            ScopeMatch::Within,
            window("2026-08-31", "2026-09-07")
        ),
        inherited
    ));
}

#[test]
fn an_items_own_window_beats_the_one_it_would_have_inherited() {
    let mut node = task("todo");
    node.window = Some(window("2026-09-03", "2026-09-04"));
    let inherited = Some(window("2026-08-26", "2026-08-27"));
    assert!(!passes_scope(
        &node,
        &scoped(ScopeAxis::Relevance, ScopeMatch::Within, week()),
        inherited
    ));
}

#[test]
fn an_unscoped_item_overlaps_every_scope_and_is_wholly_inside_none() {
    let node = task("todo");
    assert!(passes_scope(
        &node,
        &scoped(ScopeAxis::Relevance, ScopeMatch::Overlapping, week()),
        None
    ));
    assert!(!passes_scope(
        &node,
        &scoped(ScopeAxis::Relevance, ScopeMatch::Within, week()),
        None
    ));
}

#[test]
fn the_plan_axis_reads_the_plan_and_never_the_time_scope() {
    let filter = scoped(ScopeAxis::Plan, ScopeMatch::Within, week());
    let mut planned = task("todo");
    planned.window = Some(window("2026-06-01", "2026-09-01"));
    planned.plan_window = Some(window("2026-08-26", "2026-08-27"));
    let mut unplanned = task("todo");
    unplanned.window = Some(window("2026-08-26", "2026-08-27"));
    assert!(passes_scope(&planned, &filter, None));
    assert!(
        !passes_scope(&unplanned, &filter, None),
        "an unplanned task is not in the picked scope, whatever its window says"
    );
}

#[test]
fn a_plan_is_never_inherited_from_an_ancestor() {
    let filter = scoped(ScopeAxis::Plan, ScopeMatch::Overlapping, week());
    let node = task("todo");
    assert!(!passes_scope(
        &node,
        &filter,
        Some(window("2026-08-26", "2026-08-27"))
    ));
}

#[test]
fn a_container_is_never_judged_on_a_filter_it_has_no_window_to_answer() {
    for node in [
        project("active"),
        NodeFacts::new("domain-2", NodeKind::Domain),
    ] {
        assert!(passes_scope(
            &node,
            &scoped(ScopeAxis::Relevance, ScopeMatch::Within, week()),
            None
        ));
    }
}

#[test]
fn no_scope_selection_judges_nothing() {
    let node = task("todo");
    assert!(passes_scope(&node, &BoardFilter::default(), None));
}
