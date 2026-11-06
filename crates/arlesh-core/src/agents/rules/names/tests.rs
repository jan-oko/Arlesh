use super::*;

#[test]
fn whitespace_runs_become_one_space_and_the_ends_go() {
    assert_eq!(tidy("  review \t bot\n"), Some("review bot".to_owned()));
}

#[test]
fn control_characters_are_dropped() {
    assert_eq!(tidy("bo\u{7}t"), Some("bot".to_owned()));
}

#[test]
fn nothing_visible_is_no_name() {
    assert_eq!(tidy(" \t\n"), None);
}

#[test]
fn a_long_name_is_cut() {
    let long = "x".repeat(200);

    assert_eq!(tidy(&long).map(|name| name.chars().count()), Some(MAX_LENGTH));
}

#[test]
fn a_free_name_is_kept_and_a_taken_one_gets_a_number() {
    let taken = vec!["reviewer".to_owned(), "reviewer-2".to_owned()];

    assert_eq!(unique("writer", &taken), "writer");
    assert_eq!(unique("reviewer", &taken), "reviewer-3");
}
