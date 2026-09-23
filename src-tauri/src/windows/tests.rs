use super::*;

/// A 1920×1080 display with its top-left corner at the origin — the one everybody has.
fn primary() -> WindowRect {
    WindowRect {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
    }
}

/// A second display to the right of [`primary`], the arrangement a torn-off window is for.
fn secondary() -> WindowRect {
    WindowRect {
        x: 1920,
        y: 0,
        width: 1920,
        height: 1080,
    }
}

fn window_at(x: i32, y: i32) -> WindowRect {
    WindowRect {
        x,
        y,
        width: 800,
        height: 600,
    }
}

fn record(label: &str, rect: Option<WindowRect>) -> WindowRecord {
    WindowRecord {
        label: label.to_string(),
        rect,
        ordinal: 1,
    }
}

// -------------------------------------------------------------------------------------------
// Placement
// -------------------------------------------------------------------------------------------

#[test]
fn a_window_in_the_middle_of_a_display_reopens_exactly_where_it_was() {
    let placed = placement(Some(window_at(300, 200)), &[primary()]);
    assert_eq!(placed.position, Some((300, 200)));
    assert_eq!(placed.size, Some((800, 600)));
}

#[test]
fn a_window_on_the_second_display_reopens_there() {
    let placed = placement(Some(window_at(2200, 100)), &[primary(), secondary()]);
    assert_eq!(placed.position, Some((2200, 100)));
}

#[test]
fn a_window_on_a_display_that_is_gone_keeps_its_size_and_loses_its_position() {
    let placed = placement(Some(window_at(2200, 100)), &[primary()]);
    assert_eq!(placed.position, None);
    assert_eq!(placed.size, Some((800, 600)));
}

#[test]
fn a_window_hanging_off_an_edge_is_still_reachable_and_stays_put() {
    // Two hundred pixels of it are on the primary display, which is plenty to grab.
    let placed = placement(Some(window_at(-600, 40)), &[primary()]);
    assert_eq!(placed.position, Some((-600, 40)));
}

#[test]
fn a_window_with_a_sliver_on_screen_is_treated_as_unreachable() {
    // Ten pixels wide on screen: under MIN_VISIBLE, so it is centred rather than left there.
    let placed = placement(Some(window_at(-790, 40)), &[primary()]);
    assert_eq!(placed.position, None);
}

#[test]
fn a_window_just_below_the_bottom_edge_is_unreachable_even_though_it_overlaps_horizontally() {
    let placed = placement(Some(window_at(300, 1060)), &[primary()]);
    assert_eq!(placed.position, None);
}

#[test]
fn a_window_smaller_than_the_visibility_margin_is_not_asked_to_show_more_than_it_has() {
    let tiny = WindowRect {
        x: 0,
        y: 0,
        width: 20,
        height: 20,
    };
    let placed = placement(Some(tiny), &[primary()]);
    assert_eq!(placed.position, Some((0, 0)));
}

#[test]
fn an_unreadable_display_list_leaves_a_saved_position_alone() {
    let placed = placement(Some(window_at(2200, 100)), &[]);
    assert_eq!(placed.position, Some((2200, 100)));
}

#[test]
fn a_window_with_no_saved_rectangle_takes_the_configured_default() {
    let placed = placement(None, &[primary()]);
    assert_eq!(placed.position, None);
    assert_eq!(placed.size, None);
}

// -------------------------------------------------------------------------------------------
// What gets written down
// -------------------------------------------------------------------------------------------

#[test]
fn the_open_windows_are_what_is_saved() {
    let previous = WindowSession::bootstrap();
    let saved = session_to_save(
        vec![
            record("main", Some(window_at(0, 0))),
            record("board-a", Some(window_at(2000, 0))),
        ],
        &previous,
    );
    assert_eq!(saved.windows.len(), 2);
    assert_eq!(saved.windows[1].label, "board-a");
}

#[test]
fn the_last_window_closing_does_not_wipe_the_session() {
    let previous = WindowSession {
        windows: vec![record("board-a", Some(window_at(2000, 0)))],
    };
    let saved = session_to_save(Vec::new(), &previous);
    assert_eq!(saved, previous);
}

#[test]
fn a_bootstrap_session_is_one_window_with_no_geometry() {
    let session = WindowSession::bootstrap();
    assert_eq!(session.windows.len(), 1);
    assert_eq!(session.windows[0].label, BOOTSTRAP_LABEL);
    assert_eq!(session.windows[0].rect, None);
    assert!(session.holds(BOOTSTRAP_LABEL));
    assert!(!session.holds("board-a"));
}

// -------------------------------------------------------------------------------------------
// The file
// -------------------------------------------------------------------------------------------

/// A scratch directory for one test, removed when the test ends.
struct Scratch(std::path::PathBuf);

impl Scratch {
    fn new(name: &str) -> Self {
        let path =
            std::env::temp_dir().join(format!("arlesh-windows-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&path).expect("create the scratch directory");
        Self(path)
    }

    fn file(&self) -> std::path::PathBuf {
        self.0.join("windows.json")
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn a_session_survives_a_write_and_a_read() {
    let scratch = Scratch::new("roundtrip");
    let session = WindowSession {
        windows: vec![
            record("main", Some(window_at(10, 20))),
            record("board-a", None),
        ],
    };
    write_session(&scratch.file(), &session);
    assert_eq!(read_session(&scratch.file()), session);
}

#[test]
fn a_missing_file_reads_as_one_window() {
    let scratch = Scratch::new("missing");
    assert_eq!(read_session(&scratch.file()), WindowSession::bootstrap());
}

#[test]
fn a_file_that_will_not_parse_reads_as_one_window() {
    let scratch = Scratch::new("garbage");
    std::fs::write(scratch.file(), "{ not json").expect("write");
    assert_eq!(read_session(&scratch.file()), WindowSession::bootstrap());
}

#[test]
fn a_file_holding_no_windows_reads_as_one_window() {
    let scratch = Scratch::new("empty");
    std::fs::write(scratch.file(), r#"{"windows":[]}"#).expect("write");
    assert_eq!(read_session(&scratch.file()), WindowSession::bootstrap());
}

#[test]
fn a_record_written_before_geometry_existed_reads_with_none() {
    let scratch = Scratch::new("legacy");
    std::fs::write(scratch.file(), r#"{"windows":[{"label":"main"}]}"#).expect("write");
    assert_eq!(read_session(&scratch.file()), WindowSession::bootstrap());
}

#[test]
fn a_directory_that_does_not_exist_yet_is_created_by_the_write() {
    let scratch = Scratch::new("nested");
    let path = scratch.0.join("deeper").join("windows.json");
    write_session(&path, &WindowSession::bootstrap());
    assert_eq!(read_session(&path), WindowSession::bootstrap());
}

#[test]
fn a_write_that_cannot_land_is_survivable() {
    let scratch = Scratch::new("unwritable");
    // A path whose parent is a file, not a directory: the write fails and nothing panics.
    let blocker = scratch.0.join("blocker");
    std::fs::write(&blocker, "x").expect("write");
    write_session(&blocker.join("windows.json"), &WindowSession::bootstrap());
}

// -------------------------------------------------------------------------------------------
// Numbering the windows.
// -------------------------------------------------------------------------------------------

#[test]
fn the_first_window_is_numbered_one() {
    assert_eq!(next_ordinal(&[]), 1);
}

#[test]
fn a_new_window_takes_the_next_number_when_none_is_free() {
    assert_eq!(next_ordinal(&[1, 2]), 3);
}

#[test]
fn a_closed_windows_number_is_handed_out_again_lowest_first() {
    // Windows 1 and 3 are open; 2 was closed. Window 3 keeps its number, and 2 is free again.
    assert_eq!(next_ordinal(&[1, 3]), 2);
    assert_eq!(next_ordinal(&[3, 4]), 1);
}

#[test]
fn the_bootstrap_session_starts_the_numbering_at_one() {
    assert_eq!(WindowSession::bootstrap().windows[0].ordinal, 1);
}

#[test]
fn a_restored_session_keeps_the_numbers_it_was_saved_with() {
    assert_eq!(restored_ordinals(&[1, 3, 2]), vec![1, 3, 2]);
    assert_eq!(restored_ordinals(&[4]), vec![4]);
}

#[test]
fn a_session_saved_before_numbering_gives_each_window_its_own_number() {
    // Records with no stored number read as 1, so every window of an old session claims it.
    assert_eq!(restored_ordinals(&[1, 1, 1]), vec![1, 2, 3]);
}

#[test]
fn a_duplicate_number_does_not_take_one_a_later_window_was_saved_with() {
    assert_eq!(restored_ordinals(&[1, 1, 2]), vec![1, 3, 2]);
}

#[test]
fn a_zero_number_is_read_as_missing() {
    assert_eq!(restored_ordinals(&[0, 1]), vec![2, 1]);
}

#[test]
fn every_window_carries_its_number_in_its_title_the_first_included() {
    assert_eq!(window_title("Arlesh", 1), "Arlesh 1");
    assert_eq!(window_title("Arlesh", 2), "Arlesh 2");
    assert_eq!(window_title("Arlesh", 11), "Arlesh 11");
}

#[test]
fn a_branch_instances_own_title_keeps_the_numbering() {
    // `scripts/branch-instance.sh` titles a branch's windows after its branch.
    assert_eq!(window_title("Arlesh (fxo)", 2), "Arlesh (fxo) 2");
}

#[test]
fn the_tray_lists_a_window_by_its_title_and_its_active_tab() {
    assert_eq!(titled_by_tab("Arlesh 2", "Bugfixes"), "Arlesh 2 — Bugfixes");
}

#[test]
fn a_window_with_nothing_to_add_keeps_its_plain_title() {
    assert_eq!(titled_by_tab("Arlesh 1", ""), "Arlesh 1");
    assert_eq!(titled_by_tab("Arlesh 1", "   "), "Arlesh 1");
}
