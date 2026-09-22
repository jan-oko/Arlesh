use super::*;

fn at(iso: &str) -> NaiveDateTime {
    NaiveDateTime::parse_from_str(iso, "%Y-%m-%dT%H:%M:%S").unwrap()
}

fn window() -> Bounds {
    (at("2026-01-05T00:00:00"), at("2026-01-12T00:00:00"))
}

// --- Timing ---

#[test]
fn unscoped_is_always_active() {
    assert_eq!(
        derive_timing(None, at("2030-01-01T00:00:00")),
        Timing::Active
    );
}

#[test]
fn before_window_start_is_pending() {
    assert_eq!(
        derive_timing(Some(window()), at("2026-01-01T00:00:00")),
        Timing::Pending
    );
}

#[test]
fn within_window_is_active() {
    assert_eq!(
        derive_timing(Some(window()), at("2026-01-08T09:00:00")),
        Timing::Active
    );
}

#[test]
fn at_or_after_window_end_is_lapsed() {
    assert_eq!(
        derive_timing(Some(window()), at("2026-01-12T00:00:00")),
        Timing::Lapsed
    );
    assert_eq!(
        derive_timing(Some(window()), at("2026-01-20T00:00:00")),
        Timing::Lapsed
    );
}

// --- Resolution ---

#[test]
fn resolution_is_none_while_pending_or_active() {
    assert_eq!(
        derive_resolution(Timing::Pending, false, Some(OnScopeExit::Archive)),
        None
    );
    assert_eq!(
        derive_resolution(Timing::Active, false, Some(OnScopeExit::Archive)),
        None
    );
}

#[test]
fn lapsed_and_resolved_is_completed_regardless_of_on_exit() {
    assert_eq!(
        derive_resolution(Timing::Lapsed, true, Some(OnScopeExit::Archive)),
        Some(Resolution::Completed)
    );
    assert_eq!(
        derive_resolution(Timing::Lapsed, true, Some(OnScopeExit::Keep)),
        Some(Resolution::Completed)
    );
    assert_eq!(
        derive_resolution(Timing::Lapsed, true, None),
        Some(Resolution::Completed)
    );
}

#[test]
fn lapsed_unresolved_archive_on_exit_is_missed() {
    assert_eq!(
        derive_resolution(Timing::Lapsed, false, Some(OnScopeExit::Archive)),
        Some(Resolution::Missed)
    );
}

#[test]
fn lapsed_unresolved_keep_on_exit_is_overdue() {
    assert_eq!(
        derive_resolution(Timing::Lapsed, false, Some(OnScopeExit::Keep)),
        Some(Resolution::Overdue)
    );
}

#[test]
fn lapsed_unresolved_missing_on_exit_defensively_falls_back_to_overdue() {
    assert_eq!(
        derive_resolution(Timing::Lapsed, false, None),
        Some(Resolution::Overdue)
    );
}

// --- Archival ---

#[test]
fn no_forcing_resolution_keeps_the_stored_value() {
    assert_eq!(
        derive_archival(Some(Archival::Frozen), None).effective,
        Archival::Frozen
    );
    assert_eq!(
        derive_archival(Some(Archival::Frozen), Some(Resolution::Overdue)).effective,
        Archival::Frozen
    );
    assert_eq!(
        derive_archival(Some(Archival::Archived), None).effective,
        Archival::Archived
    );
}

#[test]
fn nothing_stored_and_no_forcing_defaults_to_live() {
    let result = derive_archival(None, None);
    assert_eq!(result.effective, Archival::Live);
    assert!(!result.conflict);
}

#[test]
fn overdue_never_forces_archival() {
    let result = derive_archival(Some(Archival::Live), Some(Resolution::Overdue));
    assert_eq!(result.effective, Archival::Live);
    assert!(!result.conflict);
}

#[test]
fn completed_forces_archival_for_a_task_with_nothing_stored() {
    let result = derive_archival(None, Some(Resolution::Completed));
    assert_eq!(result.effective, Archival::Archived);
    assert!(!result.conflict); // nothing manual to conflict with
}

#[test]
fn missed_forces_archival_regardless_of_stored_value() {
    assert_eq!(
        derive_archival(Some(Archival::Live), Some(Resolution::Missed)).effective,
        Archival::Archived
    );
    assert_eq!(
        derive_archival(Some(Archival::Archived), Some(Resolution::Missed)).effective,
        Archival::Archived
    );
}

#[test]
fn forcing_archival_over_a_manually_frozen_item_flags_a_conflict() {
    let result = derive_archival(Some(Archival::Frozen), Some(Resolution::Completed));
    assert_eq!(result.effective, Archival::Archived);
    assert!(result.conflict);
}

#[test]
fn forcing_archival_over_live_or_already_archived_is_not_a_conflict() {
    assert!(!derive_archival(Some(Archival::Live), Some(Resolution::Completed)).conflict);
    assert!(!derive_archival(Some(Archival::Archived), Some(Resolution::Missed)).conflict);
    assert!(!derive_archival(None, Some(Resolution::Completed)).conflict);
}

// --- Backlog ---

#[test]
fn a_backlogged_task_reads_as_backlogged_while_nothing_forces_it() {
    for resolution in [None, Some(Resolution::Overdue)] {
        let result = derive_archival(Some(Archival::Backlog), resolution);
        assert_eq!(result.effective, Archival::Backlog);
        assert!(!result.conflict);
    }
}

/// The whole point of the uniform rule: setting a scoped task aside does not exempt it from
/// its own window. Table-driven over every (stored, resolution) pair that forces Archived, so
/// Backlog is pinned to behave exactly as Frozen does.
#[test]
fn backlog_loses_to_a_forced_archived_exactly_as_frozen_does() {
    let forcing = [Resolution::Completed, Resolution::Missed];
    for resolution in forcing {
        let backlogged = derive_archival(Some(Archival::Backlog), Some(resolution));
        let frozen = derive_archival(Some(Archival::Frozen), Some(resolution));
        assert_eq!(backlogged.effective, Archival::Archived);
        assert!(
            backlogged.conflict,
            "a deliberate Backlog was silently overridden"
        );
        assert_eq!(backlogged, frozen, "Backlog and Frozen resolve identically");
    }
}

#[test]
fn a_scoped_backlogged_task_that_lapses_unfinished_archives_as_missed_with_a_conflict() {
    let state = derive_item_state(
        Some(window()),
        Some(OnScopeExit::Archive),
        false,
        Some(Archival::Backlog),
        at("2026-01-20T00:00:00"),
    );
    assert_eq!(state.resolution, Some(Resolution::Missed));
    assert_eq!(state.archival, Archival::Archived);
    assert!(state.archival_conflict);
}

#[test]
fn a_backlogged_task_inside_its_window_is_simply_backlogged() {
    let state = derive_item_state(
        Some(window()),
        Some(OnScopeExit::Archive),
        false,
        Some(Archival::Backlog),
        at("2026-01-08T00:00:00"),
    );
    assert_eq!(state.timing, Timing::Active);
    assert_eq!(state.archival, Archival::Backlog);
    assert!(!state.archival_conflict);
}

#[test]
fn an_unscoped_backlogged_task_is_never_forced_into_anything() {
    let state = derive_item_state(
        None,
        None,
        false,
        Some(Archival::Backlog),
        at("2030-01-01T00:00:00"),
    );
    assert_eq!(state.archival, Archival::Backlog);
    assert!(!state.archival_conflict);
}

// --- Archival's database spellings ---

#[test]
fn a_tasks_stored_state_widens_onto_the_shared_axis() {
    assert_eq!(Archival::from(TaskArchival::Live), Archival::Live);
    assert_eq!(Archival::from(TaskArchival::Backlog), Archival::Backlog);
}

#[test]
fn archival_from_db_roundtrips_every_variant() {
    for archival in [
        Archival::Live,
        Archival::Frozen,
        Archival::Backlog,
        Archival::Archived,
    ] {
        assert_eq!(Archival::from_db(archival.as_str()), Some(archival));
    }
}

#[test]
fn archival_from_db_rejects_unrecognized_values() {
    assert_eq!(Archival::from_db("shelved"), None);
}

#[test]
fn archival_serialises_to_its_database_spelling() {
    for archival in [
        Archival::Live,
        Archival::Frozen,
        Archival::Backlog,
        Archival::Archived,
    ] {
        assert_eq!(
            serde_json::to_value(archival).expect("serialise"),
            serde_json::json!(archival.as_str()),
        );
    }
}

// --- derive_item_state (integration of all three axes) ---

#[test]
fn a_done_item_past_its_window_is_now_archived_not_silently_active() {
    // This is the behavior this module was rewritten to fix: a resolved item used to always
    // report Active, even once its window had fully passed.
    let state = derive_item_state(
        Some(window()),
        Some(OnScopeExit::Archive),
        true,
        None,
        at("2026-02-01T00:00:00"),
    );
    assert_eq!(state.timing, Timing::Lapsed);
    assert_eq!(state.resolution, Some(Resolution::Completed));
    assert_eq!(state.archival, Archival::Archived);
    assert!(!state.archival_conflict);
}

#[test]
fn a_resolved_item_within_its_window_is_still_just_active() {
    let state = derive_item_state(
        Some(window()),
        Some(OnScopeExit::Archive),
        true,
        None,
        at("2026-01-08T00:00:00"),
    );
    assert_eq!(state.timing, Timing::Active);
    assert_eq!(state.resolution, None);
    assert_eq!(state.archival, Archival::Live);
}

#[test]
fn an_unscoped_item_is_never_forced_into_anything() {
    let state = derive_item_state(
        None,
        None,
        false,
        Some(Archival::Frozen),
        at("2030-01-01T00:00:00"),
    );
    assert_eq!(state.timing, Timing::Active);
    assert_eq!(state.resolution, None);
    assert_eq!(state.archival, Archival::Frozen);
    assert!(!state.archival_conflict);
}

#[test]
fn passed_keep_item_is_overdue_and_stays_live() {
    let state = derive_item_state(
        Some(window()),
        Some(OnScopeExit::Keep),
        false,
        Some(Archival::Live),
        at("2026-01-20T00:00:00"),
    );
    assert_eq!(state.resolution, Some(Resolution::Overdue));
    assert_eq!(state.archival, Archival::Live);
}

#[test]
fn passed_archive_item_is_missed_and_becomes_archived() {
    let state = derive_item_state(
        Some(window()),
        Some(OnScopeExit::Archive),
        false,
        Some(Archival::Live),
        at("2026-01-20T00:00:00"),
    );
    assert_eq!(state.resolution, Some(Resolution::Missed));
    assert_eq!(state.archival, Archival::Archived);
}

#[test]
fn the_half_open_end_is_already_passed() {
    // now == end: the window [start, end) no longer contains `now`.
    let state = derive_item_state(
        Some(window()),
        Some(OnScopeExit::Archive),
        false,
        None,
        at("2026-01-12T00:00:00"),
    );
    assert_eq!(state.timing, Timing::Lapsed);
    assert_eq!(state.resolution, Some(Resolution::Missed));
}
