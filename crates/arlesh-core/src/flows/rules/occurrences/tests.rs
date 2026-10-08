use chrono::NaiveDate;

use super::*;
use crate::flows::rules::compound_readings::Reading;

fn at(day: u32, hour: u32) -> NaiveDateTime {
    NaiveDate::from_ymd_opt(2026, 9, day)
        .unwrap()
        .and_hms_opt(hour, 0, 0)
        .unwrap()
}

fn slot(index: i64, day: u32) -> SlotWindow {
    SlotWindow {
        index,
        scope_id: ScopeKey::day(NaiveDate::from_ymd_opt(2026, 9, day).unwrap()),
        start: at(day, 2),
        end: at(day + 1, 2),
    }
}

fn root(flow_id: i64) -> TemplateItem {
    TemplateItem {
        item_type: TemplateKind::FlowRoot,
        item_id: flow_id,
    }
}

fn item(item_id: i64) -> TemplateItem {
    TemplateItem {
        item_type: TemplateKind::FlowTask,
        item_id,
    }
}

fn done_task(at_ms: i64) -> TaskOverlay {
    TaskOverlay {
        status: Some("done".into()),
        resolved_at: Some(at_ms),
        ..TaskOverlay::default()
    }
}

fn key_on(template: TemplateItem, day: u32, cycle: i64) -> String {
    OccurrenceKey {
        item: template,
        iteration: ScopeKey::day(NaiveDate::from_ymd_opt(2026, 9, day).unwrap()),
        cycle,
    }
    .node_key()
}

#[test]
fn an_iteration_resolves_only_when_every_instance_is_done() {
    let keys = vec![(root(1), NO_CYCLE), (item(5), 7), (item(5), 8)];
    let mut overlays = HabitOverlays::default();
    overlays.tasks.insert(key_on(root(1), 20, 0), done_task(10));
    overlays.tasks.insert(key_on(item(5), 20, 7), done_task(30));
    overlays.tasks.insert(key_on(item(5), 20, 8), done_task(20));
    overlays.tasks.insert(key_on(root(1), 21, 0), done_task(40));

    let resolved = resolutions(
        &[slot(0, 20), slot(1, 21)],
        &keys,
        (&overlays, (&HashSet::new(), &Readings::new())),
        &HashMap::new(),
    );
    assert_eq!(resolved.len(), 1, "the second iteration has undone items");
    let instant = resolved.get(&0).copied().unwrap();
    assert_eq!(
        instant,
        chrono::DateTime::from_timestamp_millis(30)
            .unwrap()
            .naive_utc(),
        "the latest completion is when it resolved"
    );
}

#[test]
fn a_missed_or_in_progress_instance_does_not_count_as_done() {
    let keys = vec![(root(1), NO_CYCLE)];
    let mut overlays = HabitOverlays::default();
    let mut missed = done_task(1);
    missed.tombstone = Some("missed".into());
    overlays.tasks.insert(key_on(root(1), 20, 0), missed);
    overlays.tasks.insert(
        key_on(root(1), 21, 0),
        TaskOverlay {
            status: Some("in_progress".into()),
            ..TaskOverlay::default()
        },
    );
    assert!(resolutions(
        &[slot(0, 20), slot(1, 21)],
        &keys,
        (&overlays, (&HashSet::new(), &Readings::new())),
        &HashMap::new()
    )
    .is_empty());
}

fn archived() -> TaskOverlay {
    TaskOverlay {
        tombstone: Some("archived".into()),
        ..TaskOverlay::default()
    }
}

/// Stretch (5) with a morning (7) and an evening (8) pair; Cool down (6) nested under Stretch.
fn nested() -> (Vec<InstanceKey>, HashMap<InstanceKey, InstanceKey>) {
    let keys = vec![
        (root(1), NO_CYCLE),
        (item(5), 7),
        (item(5), 8),
        (item(6), NO_CYCLE),
    ];
    let parents = HashMap::from([
        ((item(5), 7), (root(1), NO_CYCLE)),
        ((item(5), 8), (root(1), NO_CYCLE)),
        ((item(6), NO_CYCLE), (item(5), 7)),
    ]);
    (keys, parents)
}

#[test]
fn nothing_archived_sets_nothing_aside() {
    let (keys, parents) = nested();
    assert!(set_aside(&keys, &HashSet::new(), &parents).is_empty());
}

#[test]
fn an_archived_root_sets_its_whole_iteration_aside_and_the_iteration_resolves() {
    let (keys, parents) = nested();
    let aside = set_aside(&keys, &HashSet::from([(root(1), NO_CYCLE)]), &parents);
    assert_eq!(aside.len(), 4);
    let mut overlays = HabitOverlays::default();
    overlays.tasks.insert(key_on(root(1), 20, 0), archived());
    let resolved = resolutions(
        &[slot(0, 20)],
        &keys,
        (&overlays, (&HashSet::new(), &Readings::new())),
        &parents,
    );
    assert_eq!(
        resolved.get(&0).copied(),
        Some(at(21, 2)),
        "set aside whole, it is over"
    );
}

#[test]
fn an_archived_occurrence_takes_what_is_nested_under_it_and_nothing_else() {
    let (keys, parents) = nested();
    let aside = set_aside(&keys, &HashSet::from([(item(5), 7)]), &parents);
    assert_eq!(aside, HashSet::from([(item(5), 7), (item(6), NO_CYCLE)]));
    // The evening occurrence and the root still have to be done.
    let mut overlays = HabitOverlays::default();
    overlays.tasks.insert(key_on(item(5), 20, 7), archived());
    overlays.tasks.insert(key_on(root(1), 20, 0), done_task(5));
    assert!(resolutions(
        &[slot(0, 20)],
        &keys,
        (&overlays, (&HashSet::new(), &Readings::new())),
        &parents
    )
    .is_empty());
    overlays.tasks.insert(key_on(item(5), 20, 8), done_task(9));
    assert_eq!(
        resolutions(
            &[slot(0, 20)],
            &keys,
            (&overlays, (&HashSet::new(), &Readings::new())),
            &parents
        )
        .len(),
        1
    );
}

#[test]
fn an_achieved_goal_counts_and_a_missing_instant_falls_back_to_the_window_end() {
    let keys = vec![(root(1), NO_CYCLE)];
    let mut overlays = HabitOverlays::default();
    overlays.goals.insert(
        key_on(root(1), 20, 0),
        GoalOverlay {
            status: Some("achieved".into()),
            ..GoalOverlay::default()
        },
    );
    let resolved = resolutions(
        &[slot(0, 20)],
        &keys,
        (&overlays, (&HashSet::new(), &Readings::new())),
        &HashMap::new(),
    );
    assert_eq!(resolved.get(&0).copied(), Some(at(21, 2)));
}

#[test]
fn a_lapsed_occurrence_archives_as_completed_or_missed() {
    let id = NodeId::Stored(1);
    let done = work_lifecycle(
        "task",
        id.clone(),
        InstanceTiming::Lapsed,
        true,
        false,
        false,
        false,
    );
    assert_eq!(done.timing, Timing::Lapsed);
    assert_eq!(done.resolution, Some(Resolution::Completed));
    assert_eq!(done.archival, Archival::Archived);

    let missed = work_lifecycle(
        "task",
        id.clone(),
        InstanceTiming::Lapsed,
        false,
        false,
        false,
        true,
    );
    assert_eq!(missed.resolution, Some(Resolution::Missed));
    assert!(
        missed.archival_conflict,
        "a backlog overridden by the window passing"
    );
}

#[test]
fn an_open_or_unopened_occurrence_has_no_resolution() {
    let id = NodeId::Stored(1);
    let pending = work_lifecycle(
        "goal",
        id.clone(),
        InstanceTiming::Pending,
        false,
        false,
        false,
        false,
    );
    assert_eq!(
        (pending.timing, pending.resolution),
        (Timing::Pending, None)
    );
    assert_eq!(pending.archival, Archival::Live);
    let active = work_lifecycle(
        "task",
        id.clone(),
        InstanceTiming::Active,
        false,
        false,
        false,
        true,
    );
    assert_eq!(active.archival, Archival::Backlog);
    let archived = work_lifecycle(
        "task",
        id,
        InstanceTiming::Active,
        false,
        false,
        true,
        false,
    );
    assert_eq!(
        archived.archival,
        Archival::Archived,
        "a tombstone archives it by hand"
    );
}

#[test]
fn an_expired_iteration_archives_its_steps_without_a_resolution() {
    let expired = work_lifecycle(
        "task",
        NodeId::Stored(1),
        InstanceTiming::Active,
        false,
        true,
        false,
        false,
    );
    assert_eq!(expired.timing, Timing::Lapsed);
    assert_eq!(expired.resolution, None);
    assert_eq!(expired.archival, Archival::Archived);
}

/// A day-long occurrence's lifecycle on the day after its window, as `task_row` derives it: the
/// clock's timing, settled by whether it is done.
fn day_after(clock: Clock, done: bool, closes_when_done: bool) -> ItemLifecycle {
    let timing = instance_timing(
        clock,
        IterationStatus::Active,
        (at(20, 2), at(21, 2)),
        at(22, 9),
    );
    work_lifecycle(
        "task",
        NodeId::Stored(1),
        settled_timing(timing, done, closes_when_done),
        done,
        false,
        false,
        false,
    )
}

#[test]
fn a_done_owed_overdue_or_interval_occurrence_past_its_window_is_completed_and_archived() {
    for clock in [
        Clock::Window(MissPolicy::Owed),
        Clock::Window(MissPolicy::Overdue),
        Clock::Interval,
    ] {
        let done = day_after(clock, true, true);
        assert_eq!(done.timing, Timing::Lapsed);
        assert_eq!(done.resolution, Some(Resolution::Completed));
        assert_eq!(done.archival, Archival::Archived);
    }
}

#[test]
fn an_unfinished_owed_occurrence_past_its_window_stays_open() {
    let open = day_after(Clock::Window(MissPolicy::Owed), false, true);
    assert_eq!((open.timing, open.resolution), (Timing::Active, None));
    assert_eq!(open.archival, Archival::Live);
}

#[test]
fn an_archive_occurrence_past_its_window_lapses_done_or_not() {
    let done = day_after(Clock::Window(MissPolicy::Archive), true, true);
    assert_eq!(done.resolution, Some(Resolution::Completed));
    assert_eq!(done.archival, Archival::Archived);
    let missed = day_after(Clock::Window(MissPolicy::Archive), false, true);
    assert_eq!(missed.resolution, Some(Resolution::Missed));
    assert_eq!(missed.archival, Archival::Archived);
}

#[test]
fn being_done_settles_nothing_until_the_occurrence_closes() {
    assert_eq!(
        settled_timing(InstanceTiming::Active, true, false),
        InstanceTiming::Active,
        "a done occurrence whose window is still open stays Active"
    );
    assert_eq!(
        settled_timing(InstanceTiming::Pending, false, false),
        InstanceTiming::Pending
    );
    let open = day_after(Clock::Window(MissPolicy::Owed), true, false);
    assert_eq!(
        (open.timing, open.archival),
        (Timing::Active, Archival::Live)
    );
}

#[test]
fn only_an_occurrence_with_a_window_of_its_own_reads_an_on_exit() {
    let window = Some(TimeScope::single(ScopeKey::day(
        NaiveDate::from_ymd_opt(2026, 9, 20).unwrap(),
    )));
    assert_eq!(
        on_exit(Clock::Window(MissPolicy::Archive), &window),
        Some(OnScopeExit::Archive)
    );
    for clock in [
        Clock::Window(MissPolicy::Owed),
        Clock::Window(MissPolicy::Overdue),
        Clock::Interval,
    ] {
        assert_eq!(on_exit(clock, &window), Some(OnScopeExit::Keep));
    }
    assert_eq!(on_exit(Clock::Window(MissPolicy::Archive), &None), None);
}

#[test]
fn an_occurrence_is_due_by_its_habits_clock() {
    let window = Some((at(20, 2), at(21, 2)));
    assert_eq!(
        default_due(Clock::Window(MissPolicy::Archive), window),
        None
    );
    assert_eq!(default_due(Clock::Window(MissPolicy::Owed), window), window);
    assert_eq!(
        default_due(Clock::Window(MissPolicy::Overdue), window),
        window
    );
    assert_eq!(default_due(Clock::Interval, window), window);
    // An Unscoped Interval Habit's instance has no window, and so no due.
    assert_eq!(default_due(Clock::Interval, None), None);
}

#[test]
fn an_unfinished_occurrence_past_its_due_is_overdue_until_it_is_done_or_archived() {
    let due = default_due(
        Clock::Window(MissPolicy::Owed),
        Some((at(20, 2), at(21, 2))),
    );
    let now = at(22, 9);
    assert!(derive_overdue(due, false, Archival::Live, now));
    assert!(!derive_overdue(due, true, Archival::Live, now));
    assert!(!derive_overdue(due, false, Archival::Archived, now));
    // Under Archive there is no due, so a passed occurrence is Missed rather than Overdue.
    let none = default_due(
        Clock::Window(MissPolicy::Archive),
        Some((at(20, 2), at(21, 2))),
    );
    assert!(!derive_overdue(none, false, Archival::Live, now));
}

fn flow(instance_type: &str) -> Flow {
    Flow {
        id: 1,
        title: "Habit".into(),
        instance_type: instance_type.into(),
        parent_type: "project".into(),
        parent_id: 2,
        target_type: None,
        target_id: None,
        flow_duration_n: Some(1),
        flow_duration_kind: Some("day".into()),
        flow_window_part: None,
        flow_window_time_start: None,
        flow_window_time_end: None,
        root_plan_kind: None,
        root_plan_start: None,
        root_plan_end: None,
        verdict_window_n: None,
        verdict_window_kind: None,
        is_habit: true,
        position: 0,
        is_private: false,
        template: TemplateFields::default(),
    }
}

#[test]
fn an_occurrence_is_its_template_items_kind_and_a_root_its_instance_type() {
    assert_eq!(
        occurrence_kind(&flow("task"), TemplateKind::FlowGoal),
        "goal"
    );
    assert_eq!(
        occurrence_kind(&flow("goal"), TemplateKind::FlowTask),
        "task"
    );
    assert_eq!(
        occurrence_kind(&flow("goal"), TemplateKind::FlowRoot),
        "goal"
    );
    assert_eq!(
        occurrence_kind(&flow("commitment"), TemplateKind::FlowRoot),
        "commitment"
    );
    assert_eq!(
        occurrence_kind(&flow("task"), TemplateKind::FlowRoot),
        "task"
    );
}

fn flow_task(id: i64, parent_type: &str, parent_id: i64) -> FlowTask {
    FlowTask {
        id,
        flow_id: 1,
        title: format!("step {id}"),
        parent_type: parent_type.into(),
        parent_id,
        position: id,
        is_private: false,
        template: TemplateFields::default(),
    }
}

fn pair(id: i64, item_id: i64, position: i64) -> FlowItemCycle {
    FlowItemCycle {
        id,
        flow_id: 1,
        item_type: "flow_task".into(),
        item_id,
        scope_kind: Some("part_of_day".into()),
        scope_index: Some(position + 1),
        plan_kind: None,
        plan_start: None,
        plan_end: None,
        position,
    }
}

#[test]
fn children_nest_under_their_parents_first_occurrence() {
    let template = Template {
        goals: HashMap::new(),
        commitments: HashMap::new(),
        expectations: HashMap::new(),
        tasks: [
            flow_task(1, "flow", 1),
            flow_task(2, "flow_task", 1),
            flow_task(3, "flow_task", 99),
        ]
        .into_iter()
        .map(|task| (task.id, task))
        .collect(),
        cycles: [(
            ("flow_task".to_string(), 1),
            vec![pair(11, 1, 0), pair(12, 1, 1)],
        )]
        .into_iter()
        .collect(),
    };
    assert_eq!(template.parent_of(item(1)), None, "on the flow: the root");
    assert_eq!(template.parent_of(item(2)), Some(item(1)));
    assert_eq!(
        template.parent_of(item(3)),
        None,
        "an unknown parent falls back to the root"
    );
    assert_eq!(template.parent_of(root(1)), None);
    assert_eq!(template.first_cycle(TemplateKind::FlowTask, 1), 11);
    assert_eq!(template.first_cycle(TemplateKind::FlowTask, 2), NO_CYCLE);
}

#[test]
fn an_occurrences_tags_are_its_templates_with_its_own_differences() {
    assert_eq!(effective_tags(&[3, 1], None), vec![1, 3]);
    let differences = vec![(3, false), (7, true), (1, true)];
    assert_eq!(
        effective_tags(&[3, 1], Some(&differences)),
        vec![1, 7],
        "a removed template tag goes, an added one comes, and a repeat is not doubled"
    );
}

#[test]
fn block_reasons_travel_in_order_under_their_owner() {
    let mut out = Vec::new();
    let id = NodeId::Stored(9);
    push_reasons(&mut out, "task", &id, vec!["a".into(), "b".into()]);
    assert_eq!(out.len(), 2);
    assert_eq!(out[1].position, 1);
    assert_eq!(out[1].owner_type, "task");
    assert_eq!(out[1].owner_id, id);
}

#[test]
fn a_compound_occurrence_counts_by_its_derived_status() {
    let keys = vec![(root(1), NO_CYCLE), (item(5), NO_CYCLE)];
    let mut overlays = HabitOverlays::default();
    overlays.tasks.insert(key_on(root(1), 20, 0), done_task(10));
    let compound = HashSet::from([item(5)]);
    let open = Readings::from([(
        key_on(item(5), 20, 0),
        Reading {
            status: Status::Ordinary(crate::tasks::model::TaskStatus::Started),
            done_at: None,
        },
    )]);
    assert!(
        resolutions(
            &[slot(0, 20)],
            &keys,
            (&overlays, (&compound, &open)),
            &HashMap::new()
        )
        .is_empty(),
        "its steps are not all done, so neither is its iteration"
    );
    assert!(
        resolutions(
            &[slot(0, 20)],
            &keys,
            (&overlays, (&compound, &Readings::new())),
            &HashMap::new()
        )
        .is_empty(),
        "nothing derived for it, it is not done"
    );

    let done = Readings::from([(
        key_on(item(5), 20, 0),
        Reading {
            status: Status::Ordinary(crate::tasks::model::TaskStatus::Done),
            done_at: Some(at(20, 11)),
        },
    )]);
    let resolved = resolutions(
        &[slot(0, 20)],
        &keys,
        (&overlays, (&compound, &done)),
        &HashMap::new(),
    );
    assert_eq!(
        resolved.get(&0).copied(),
        Some(at(20, 11)),
        "done at its subtree's latest finish, after the root's"
    );
    let finished = done_instants(&[slot(0, 20)], &keys, (&overlays, (&compound, &done)));
    assert_eq!(finished.get(&0).copied(), Some(at(20, 11)));
}

#[test]
fn an_occurrences_own_compound_flag_overrides_its_items() {
    let mut overlays = HabitOverlays::default();
    let key = key_on(item(5), 20, 0);
    let compound = HashSet::from([item(5)]);
    assert!(is_compound(&overlays, &compound, item(5), &key));
    overlays.tasks.insert(
        key.clone(),
        TaskOverlay {
            compound: Some(false),
            ..TaskOverlay::default()
        },
    );
    assert!(!is_compound(&overlays, &compound, item(5), &key));
    overlays.tasks.insert(
        key.clone(),
        TaskOverlay {
            compound: Some(true),
            ..TaskOverlay::default()
        },
    );
    assert!(is_compound(&overlays, &HashSet::new(), item(5), &key));
}

#[test]
fn a_tombstoned_compound_occurrence_is_not_done_whatever_it_derives() {
    let mut overlays = HabitOverlays::default();
    let key = key_on(item(5), 20, 0);
    overlays.tasks.insert(
        key.clone(),
        TaskOverlay {
            tombstone: Some("missed".into()),
            ..TaskOverlay::default()
        },
    );
    let done = Readings::from([(
        key.clone(),
        Reading {
            status: Status::Ordinary(crate::tasks::model::TaskStatus::Done),
            done_at: None,
        },
    )]);
    assert_eq!(compound_done_at(&overlays, &done, &key), None);
    assert_eq!(
        compound_done_at(&HabitOverlays::default(), &done, &key),
        Some(None),
        "done with no known instant"
    );
}
