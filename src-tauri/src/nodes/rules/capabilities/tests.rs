//! What a row may be done to, by where it came from.

use super::*;
use crate::{
    nodes::origin::{CheckOrigin, Origin},
    tasks::waits::WaitKind,
};

#[test]
fn a_row_made_by_hand_may_be_done_anything_to() {
    assert!(of(&Origin::Manual).is_full());
}

#[test]
fn a_check_task_may_be_done_nothing_to_but_its_check() {
    let check = Origin::Check(CheckOrigin {
        wait_kind: WaitKind::Stored,
        wait_id: 4.into(),
        due_at: chrono::NaiveDateTime::default(),
    });
    let capabilities = of(&check);
    assert!(!capabilities.delete);
    assert!(!capabilities.copy);
    assert!(!capabilities.drag);
    assert!(!capabilities.compound);
    assert!(!capabilities.dependencies);
}
