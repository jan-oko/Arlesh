use super::*;

#[test]
fn verdict_as_str_covers_all_variants() {
    assert_eq!(Verdict::Unresolved.as_str(), "unresolved");
    assert_eq!(Verdict::Kept.as_str(), "kept");
    assert_eq!(Verdict::Broken.as_str(), "broken");
}

#[test]
fn verdict_from_db_roundtrips_every_variant() {
    for verdict in [Verdict::Unresolved, Verdict::Kept, Verdict::Broken] {
        assert_eq!(Verdict::from_db(verdict.as_str()), Some(verdict));
    }
}

#[test]
fn verdict_from_db_rejects_the_task_and_goal_vocabularies() {
    // A commitment is neither done nor achieved: it is kept or broken, and a row spelling a
    // Task's or a Goal's word for resolution is corrupt rather than translatable.
    assert_eq!(Verdict::from_db("done"), None);
    assert_eq!(Verdict::from_db("achieved"), None);
    assert_eq!(Verdict::from_db("bogus"), None);
}

#[test]
fn an_unjudged_commitment_is_unresolved() {
    assert_eq!(Verdict::default(), Verdict::Unresolved);
}

#[test]
fn only_kept_and_broken_count_as_having_said_something() {
    assert!(!Verdict::Unresolved.is_resolved());
    assert!(Verdict::Kept.is_resolved());
    assert!(Verdict::Broken.is_resolved());
}

#[test]
fn commitment_id_roundtrip() {
    let id = CommitmentId::from(21_i64);
    assert_eq!(i64::from(id), 21);
}
