use super::*;

#[test]
fn a_project_stores_every_status_as_spelled() {
    for status in [
        ProjectStatus::Active,
        ProjectStatus::Achieved,
        ProjectStatus::Frozen,
        ProjectStatus::Archived,
    ] {
        let spelled = status.as_str();
        assert_eq!(
            stored_status(&DomainSubtype::Project, &status).ok(),
            Some(Some(spelled))
        );
    }
}

#[test]
fn a_domain_archives_to_archived_and_unarchives_to_no_status() {
    assert_eq!(
        stored_status(&DomainSubtype::Domain, &ProjectStatus::Archived).ok(),
        Some(Some("archived"))
    );
    assert_eq!(
        stored_status(&DomainSubtype::Domain, &ProjectStatus::Active).ok(),
        Some(None)
    );
}

#[test]
fn a_domain_refuses_achieved_and_frozen() {
    for status in [ProjectStatus::Achieved, ProjectStatus::Frozen] {
        assert!(matches!(
            stored_status(&DomainSubtype::Domain, &status),
            Err(DomainError::StatusRefused(_))
        ));
    }
}

#[test]
fn a_tag_refuses_every_status() {
    assert!(matches!(
        stored_status(&DomainSubtype::Tag, &ProjectStatus::Archived),
        Err(DomainError::StatusRefused(_))
    ));
}
