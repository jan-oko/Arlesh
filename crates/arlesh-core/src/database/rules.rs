//! The database's rules: where a database's schema stands against the migrations this build
//! carries.
//!
//! Pure functions over values: no session (`Db`, `SessionMode`), no `sqlx`, no `tauri`, no `tokio`
//! and no `std::fs`. The caller reads the applied versions and passes them in. See ADR 0010.

use std::collections::BTreeSet;

/// Where a database's schema stands against the migrations a build knows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SchemaState {
    /// Every known migration is applied, and nothing else is.
    Current,
    /// Some known migrations are not applied yet. A write-open applies them; a read-only open
    /// refuses, because it may not migrate and the build cannot read an older shape.
    Behind {
        /// The versions not yet applied, oldest first.
        pending: Vec<i64>,
    },
    /// The database carries migrations this build does not know: a newer build wrote it. Always
    /// refused — reading or writing a schema the code was not written for is how data is lost.
    Ahead {
        /// The versions this build does not know, oldest first.
        unknown: Vec<i64>,
    },
}

/// Compares the migrations a database has applied against the ones a build carries.
///
/// A database that is both behind and ahead — a gap in the middle as well as a newer migration on
/// top — is [`SchemaState::Ahead`]: whatever else is true, a newer build has written it.
pub fn schema_state(known: &[i64], applied: &[i64]) -> SchemaState {
    let known: BTreeSet<i64> = known.iter().copied().collect();
    let applied: BTreeSet<i64> = applied.iter().copied().collect();
    let unknown: Vec<i64> = applied.difference(&known).copied().collect();
    if !unknown.is_empty() {
        return SchemaState::Ahead { unknown };
    }
    let pending: Vec<i64> = known.difference(&applied).copied().collect();
    if !pending.is_empty() {
        return SchemaState::Behind { pending };
    }
    SchemaState::Current
}

#[cfg(test)]
mod tests;
