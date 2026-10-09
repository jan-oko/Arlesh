//! The domain rules: which status a domain row may carry.
//!
//! Pure functions over values: no session (`Db`, `SessionMode`), no `sqlx`, no `tauri`, no `tokio`
//! and no file system. `scripts/check-rules-purity.sh` enforces this in CI. See ADR 0010 and
//! `.claude/rules/rust.md`.

use super::error::DomainError;
use super::model::{DomainSubtype, ProjectStatus};

/// What the `status` column stores when a row of `subtype` is asked to take `requested`.
///
/// A **Project** takes all four statuses. A **Domain** can only be archived (Task bd3): Archived
/// stores `archived`, and Active — unarchiving — stores nothing, so it reads as no status at all
/// again, exactly as before it was archived; Achieved and Frozen are a Project's vocabulary and
/// are refused. A **Tag** carries none, and an Aspect is never written.
pub fn stored_status(
    subtype: &DomainSubtype,
    requested: &ProjectStatus,
) -> Result<Option<&'static str>, DomainError> {
    match (subtype, requested) {
        (DomainSubtype::Project, status) => Ok(Some(status.as_str())),
        (DomainSubtype::Domain, ProjectStatus::Archived) => {
            Ok(Some(ProjectStatus::Archived.as_str()))
        }
        (DomainSubtype::Domain, ProjectStatus::Active) => Ok(None),
        (DomainSubtype::Domain, status) => Err(DomainError::StatusRefused(format!(
            "a domain can be archived or unarchived, not set {}",
            status.as_str()
        ))),
        (DomainSubtype::Tag | DomainSubtype::Aspect, _) => Err(DomainError::StatusRefused(
            "only a project or a domain carries a status".into(),
        )),
    }
}

#[cfg(test)]
mod tests;
