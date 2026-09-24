use super::*;

fn template() -> AgenticBrief {
    AgenticBrief {
        priority: Some(2),
        spec: "Water the plants".into(),
        design: "Kitchen first".into(),
        acceptance: "Soil damp".into(),
        notes: "".into(),
    }
}

#[test]
fn an_untouched_occurrence_reads_its_templates_brief_whole() {
    let overlay = TaskOverlay::default();

    assert_eq!(overlay.brief_over(Some(&template())), Some(template()));
    assert_eq!(overlay.brief_over(None), None);
}

#[test]
fn an_occurrence_overrides_only_the_fields_it_changes() {
    let mut overlay = TaskOverlay::default();
    let own = AgenticBrief {
        spec: "Water the plants, and the herbs".into(),
        ..template()
    };

    overlay.set_brief(Some(&own), Some(&template()));

    assert_eq!(
        overlay.brief_spec.as_deref(),
        Some("Water the plants, and the herbs")
    );
    assert_eq!(overlay.brief_design, None, "an unchanged field inherits");
    assert!(!overlay.brief_priority_set);

    // The template changes later: the occurrence follows it on every field it did not override.
    let revised = AgenticBrief {
        design: "Balcony first".into(),
        ..template()
    };
    let read = overlay
        .brief_over(Some(&revised))
        .expect("the occurrence has a brief");
    assert_eq!(read.spec, "Water the plants, and the herbs");
    assert_eq!(read.design, "Balcony first");
}

#[test]
fn clearing_a_priority_is_an_override_of_its_own() {
    let mut overlay = TaskOverlay::default();

    overlay.set_brief(
        Some(&AgenticBrief {
            priority: None,
            ..template()
        }),
        Some(&template()),
    );

    assert!(overlay.brief_priority_set);
    assert_eq!(
        overlay
            .brief_over(Some(&template()))
            .and_then(|brief| brief.priority),
        None
    );
}

#[test]
fn emptying_the_spec_is_kept_as_empty_rather_than_read_as_inherit() {
    let mut overlay = TaskOverlay::default();

    overlay.set_brief(
        Some(&AgenticBrief {
            spec: String::new(),
            ..template()
        }),
        Some(&template()),
    );

    assert_eq!(overlay.brief_spec.as_deref(), Some(""));
    assert_eq!(
        overlay
            .brief_over(Some(&template()))
            .map(|brief| brief.spec),
        Some(String::new())
    );
}

#[test]
fn removing_the_brief_goes_back_to_the_templates() {
    let mut overlay = TaskOverlay::default();
    overlay.set_brief(
        Some(&AgenticBrief {
            notes: "just this week".into(),
            ..template()
        }),
        Some(&template()),
    );

    overlay.set_brief(None, Some(&template()));

    assert!(overlay.is_empty());
    assert_eq!(overlay.brief_over(Some(&template())), Some(template()));
}

#[test]
fn an_occurrence_can_have_a_brief_its_template_lacks() {
    let mut overlay = TaskOverlay::default();

    overlay.set_brief(Some(&template()), None);

    assert_eq!(overlay.brief_over(None), Some(template()));
}
