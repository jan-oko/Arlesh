use super::*;

fn brief(priority: Option<u8>, spec: &str) -> Option<AgenticBrief> {
    Some(AgenticBrief {
        priority,
        spec: spec.to_string(),
        ..Default::default()
    })
}

#[test]
fn every_priority_from_p0_to_p4_is_accepted() {
    for priority in 0..=4 {
        assert!(
            validate_brief(&brief(Some(priority), "")).is_ok(),
            "P{priority}"
        );
    }
    assert!(validate_brief(&brief(None, "")).is_ok());
    assert!(validate_brief(&None).is_ok());
}

#[test]
fn a_priority_past_p4_is_refused() {
    assert!(matches!(
        validate_brief(&brief(Some(5), "")),
        Err(TaskError::AgenticPriorityOutOfRange(5))
    ));
}

#[test]
fn whitespace_is_not_a_spec() {
    assert!(!AgenticBrief {
        spec: "  \n\t".into(),
        ..Default::default()
    }
    .has_spec());
    assert!(AgenticBrief {
        spec: "Add a settings page".into(),
        ..Default::default()
    }
    .has_spec());
}
