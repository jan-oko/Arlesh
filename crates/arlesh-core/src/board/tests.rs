use super::*;

#[test]
fn a_silent_announce_is_callable_and_does_nothing() {
    silent()(Some("main"));
    silent()(None);
}
