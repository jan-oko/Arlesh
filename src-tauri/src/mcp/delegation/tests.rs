use super::*;

#[test]
fn the_agents_wait_reads_agent_finish_then_the_task() {
    assert_eq!(
        finish_title(AGENT, "Write the release notes"),
        "Agent finish: Write the release notes"
    );
}

#[test]
fn a_persons_wait_reads_their_name_finish_then_the_task() {
    assert_eq!(
        finish_title("Tuli", "Book the venue"),
        "Tuli finish: Book the venue"
    );
}
