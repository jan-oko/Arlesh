//! Domain resource models.

use serde::{Deserialize, Serialize};

/// Identifies a domain row by its primary key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct DomainId(pub i64);

impl From<i64> for DomainId {
    fn from(value: i64) -> Self {
        Self(value)
    }
}

impl From<DomainId> for i64 {
    fn from(id: DomainId) -> Self {
        id.0
    }
}

/// The four subtypes stored in the `domains` table.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum DomainSubtype {
    /// Fixed, color-coded top-level container. Not user-managed.
    Aspect,
    /// Large domain with an optional Obsidian directory link.
    Project,
    /// General-purpose organizational container.
    Domain,
    /// Flat leaf node used as a resource marker.
    Tag,
}

/// Project lifecycle status.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum ProjectStatus {
    /// Actively being worked on.
    Active,
    /// Successfully completed.
    Achieved,
    /// Temporarily paused.
    Frozen,
    /// No longer relevant.
    Archived,
}

/// A domain row as returned from the database.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Domain {
    /// Primary key.
    pub id: i64,
    /// Display title.
    pub title: String,
    /// Optional description.
    pub description: Option<String>,
    /// Subtype discriminator.
    pub subtype: String,
    /// Parent domain id (nullable).
    pub parent_id: Option<i64>,
    /// Color hex string (Aspects only).
    pub color: Option<String>,
    /// Project status (Projects only).
    pub status: Option<String>,
    /// Linked Obsidian directory (Projects only).
    pub knowledge_base_directory: Option<String>,
}

/// Request body for creating a new domain.
#[derive(Debug, Deserialize)]
pub struct CreateDomainRequest {
    /// Display title.
    pub title: String,
    /// Optional description.
    pub description: Option<String>,
    /// Subtype of the domain being created. Must not be `Aspect`.
    pub subtype: DomainSubtype,
    /// Parent domain id. Required for Projects (must be Aspect or Project).
    pub parent_id: Option<i64>,
    /// Initial project status (Projects only).
    pub status: Option<ProjectStatus>,
    /// Linked Obsidian directory (Projects only).
    pub knowledge_base_directory: Option<String>,
}

/// Request body for updating an existing domain.
#[derive(Debug, Deserialize)]
pub struct UpdateDomainRequest {
    /// New title (if provided).
    pub title: Option<String>,
    /// New description (if provided).
    pub description: Option<String>,
    /// New parent id (if provided).
    pub parent_id: Option<i64>,
    /// New project status (if provided).
    pub status: Option<ProjectStatus>,
    /// New Obsidian directory link (if provided).
    pub knowledge_base_directory: Option<String>,
}
