use super::*;

#[test]
fn a_database_with_every_known_migration_is_current() {
    assert_eq!(schema_state(&[1, 2, 3], &[1, 2, 3]), SchemaState::Current);
}

#[test]
fn a_database_missing_known_migrations_is_behind_by_them() {
    assert_eq!(
        schema_state(&[1, 2, 3, 4], &[1, 2]),
        SchemaState::Behind {
            pending: vec![3, 4]
        }
    );
}

#[test]
fn a_fresh_database_is_behind_by_every_migration() {
    assert_eq!(
        schema_state(&[1, 2], &[]),
        SchemaState::Behind {
            pending: vec![1, 2]
        }
    );
}

#[test]
fn a_database_with_a_migration_the_build_does_not_know_is_ahead() {
    assert_eq!(
        schema_state(&[1, 2], &[1, 2, 3]),
        SchemaState::Ahead { unknown: vec![3] }
    );
}

#[test]
fn ahead_wins_over_behind() {
    assert_eq!(
        schema_state(&[1, 2, 3], &[1, 4]),
        SchemaState::Ahead { unknown: vec![4] }
    );
}
