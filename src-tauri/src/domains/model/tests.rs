use super::*;

#[test]
fn project_status_as_str_covers_all_variants() {
    assert_eq!(ProjectStatus::Active.as_str(), "active");
    assert_eq!(ProjectStatus::Achieved.as_str(), "achieved");
    assert_eq!(ProjectStatus::Frozen.as_str(), "frozen");
    assert_eq!(ProjectStatus::Archived.as_str(), "archived");
}

#[test]
fn project_status_from_db_roundtrips_every_variant() {
    for status in [
        ProjectStatus::Active,
        ProjectStatus::Achieved,
        ProjectStatus::Frozen,
        ProjectStatus::Archived,
    ] {
        assert_eq!(ProjectStatus::from_db(status.as_str()), Some(status));
    }
}

#[test]
fn domain_subtype_from_db_parses_every_writable_subtype() {
    assert_eq!(
        DomainSubtype::from_db("project"),
        Some(DomainSubtype::Project)
    );
    assert_eq!(
        DomainSubtype::from_db("domain"),
        Some(DomainSubtype::Domain)
    );
    assert_eq!(DomainSubtype::from_db("tag"), Some(DomainSubtype::Tag));
}

#[test]
fn domain_subtype_from_db_rejects_aspect_and_unrecognized_values() {
    assert_eq!(DomainSubtype::from_db("aspect"), None);
    assert_eq!(DomainSubtype::from_db("bogus"), None);
}

#[test]
fn project_status_from_db_rejects_unrecognized_values() {
    assert_eq!(ProjectStatus::from_db("bogus"), None);
}
