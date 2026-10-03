use super::*;

#[test]
fn an_error_from_the_board_keeps_its_kind_where_a_flow_error_has_one() {
    let task = flow_error(AppError::Task(crate::tasks::error::TaskError::NotDone));
    assert!(matches!(task, FlowError::Task(_)));
    let flow = flow_error(AppError::Flow(FlowError::NotFound(3)));
    assert!(matches!(flow, FlowError::NotFound(3)));
}
