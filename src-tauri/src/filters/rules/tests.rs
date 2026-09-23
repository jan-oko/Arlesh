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
fn a_pending_expectation_shows_under_all_and_plan_and_under_start_only_without_checks() {
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
        let filter = BoardFilter::preset(preset);
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
fn a_delegated_task_reads_as_archived_under_plan_and_start_but_not_do() {
    let mut delegated = task("in_progress");
    delegated.delegated = true;
    assert!(is_archived(&delegated));
    assert!(!passes_status(
        &delegated,
        &BoardFilter::preset(Preset::Plan),
        UNSET_STATUS,
        false
    ));
    assert!(!passes_status(
        &delegated,
        &BoardFilter::preset(Preset::Start),
        UNSET_STATUS,
        false
    ));
    assert!(passes_status(
        &delegated,
        &BoardFilter::preset(Preset::Do),
        UNSET_STATUS,
        false
    ));
    let exclude = BoardFilter {
        archived: OverrideMode::Exclude,
        ..BoardFilter::preset(Preset::All)
    };
    assert!(type_hard_hidden(&delegated, &exclude));
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
