use super::*;

#[test]
fn a_child_with_no_claim_holds_nothing() {
    assert_eq!(holds(Claimed::Nothing), None);
}

#[test]
fn a_task_still_on_an_agent_is_held_whatever_else_is_true() {
    for open_waits in [0, 2] {
        assert_eq!(
            holds(Claimed::Task {
                on_agent: true,
                open_waits
            }),
            Some(Holds::Task)
        );
    }
}

#[test]
fn a_task_given_back_or_taken_is_held_only_while_a_wait_is_open_under_it() {
    assert_eq!(
        holds(Claimed::Task {
            on_agent: false,
            open_waits: 0
        }),
        None
    );
    assert_eq!(
        holds(Claimed::Task {
            on_agent: false,
            open_waits: 1
        }),
        Some(Holds::OpenWaits)
    );
}

#[test]
fn a_claim_on_anything_but_a_task_is_held_until_released() {
    assert_eq!(holds(Claimed::Other), Some(Holds::Claim));
}
