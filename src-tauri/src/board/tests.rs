use super::*;

fn labels(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_string()).collect()
}

#[test]
fn a_change_from_one_window_reaches_the_other_two() {
    let open = labels(&["main", "board-a", "board-b"]);
    assert_eq!(recipients(&open, Some("main")), vec!["board-a", "board-b"]);
}

#[test]
fn a_change_from_the_only_window_reaches_nobody() {
    let open = labels(&["main"]);
    assert!(recipients(&open, Some("main")).is_empty());
}

#[test]
fn a_change_from_outside_every_window_reaches_all_of_them() {
    let open = labels(&["main", "board-a"]);
    assert_eq!(recipients(&open, None), vec!["main", "board-a"]);
}

#[test]
fn an_origin_that_has_already_closed_takes_nobody_with_it() {
    let open = labels(&["main", "board-a"]);
    assert_eq!(recipients(&open, Some("board-gone")), vec!["main", "board-a"]);
}

#[test]
fn a_silent_announce_is_callable_and_does_nothing() {
    silent()(Some("main"));
    silent()(None);
}
