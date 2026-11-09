use super::*;

#[test]
fn a_session_is_unbound_until_it_attaches_and_unbound_again_after() {
    let binding = Binding::default();
    assert_eq!(binding.agent(), None);

    binding.bind(AgentId(3));
    assert_eq!(binding.agent(), Some(AgentId(3)));

    binding.unbind();
    assert_eq!(binding.agent(), None);
}

#[test]
fn a_clone_of_a_binding_is_the_same_binding() {
    let binding = Binding::default();
    let shared = binding.clone();

    binding.bind(AgentId(1));

    assert_eq!(shared.agent(), Some(AgentId(1)));
}

#[test]
fn an_opened_session_is_found_by_its_id_and_gone_once_closed() {
    let sessions = Sessions::default();
    let id = sessions.open().unwrap();

    assert!(sessions.get(&id).is_some());
    assert!(sessions.close(&id));
    assert!(sessions.get(&id).is_none());
    assert!(!sessions.close(&id));
}

#[test]
fn an_id_nobody_issued_is_unknown() {
    assert!(Sessions::default().get("nope").is_none());
}

#[test]
fn two_sessions_do_not_share_a_binding() {
    let sessions = Sessions::default();
    let first = sessions.open().unwrap();
    let second = sessions.open().unwrap();

    sessions.get(&first).unwrap().bind(AgentId(1));

    assert_eq!(sessions.get(&second).unwrap().agent(), None);
}
