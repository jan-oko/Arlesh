use super::*;

#[test]
fn a_silent_announce_is_callable_and_does_nothing() {
    silent()(Some("main"));
    silent()(None);
}

#[test]
fn a_publication_with_no_new_write_is_the_work_of_time() {
    assert_eq!(ChangeOrigin::between(4, 4, &[]), ChangeOrigin::Time);
}

#[test]
fn writes_by_no_agent_are_the_users() {
    assert_eq!(ChangeOrigin::between(4, 6, &[2, 9]), ChangeOrigin::User);
}

#[test]
fn an_agents_write_among_the_new_ones_makes_the_publication_the_agents() {
    assert_eq!(ChangeOrigin::between(4, 6, &[5]), ChangeOrigin::Agent);
    assert_eq!(ChangeOrigin::between(4, 6, &[6]), ChangeOrigin::Agent);
}

#[test]
fn an_agents_write_at_or_before_the_previous_publication_is_not_new() {
    assert_eq!(ChangeOrigin::between(4, 6, &[4]), ChangeOrigin::User);
}

#[test]
fn only_the_users_own_changes_are_silent() {
    assert!(!ChangeOrigin::User.notifies());
    assert!(ChangeOrigin::Agent.notifies());
    assert!(ChangeOrigin::Time.notifies());
}

#[test]
fn an_origin_travels_as_a_lowercase_word() {
    assert_eq!(
        serde_json::to_string(&ChangeOrigin::User).unwrap(),
        "\"user\""
    );
    let back: ChangeOrigin = serde_json::from_str("\"time\"").unwrap();
    assert_eq!(back, ChangeOrigin::Time);
}
