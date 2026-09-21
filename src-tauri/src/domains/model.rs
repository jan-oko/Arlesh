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

impl DomainSubtype {
    /// Parses the `subtype` column's spelling, if it names a *writable* subtype.
    ///
    /// `"aspect"` returns `None` rather than [`Self::Aspect`], and that is the point: every
    /// caller that parses a stored subtype is about to create or update a row, and an Aspect is
    /// fixed. Refusing it here turns "the row said aspect" into a `None` the caller must handle,
    /// instead of a value the write layer has to reject a step later.
    pub fn from_db(value: &str) -> Option<Self> {
        match value {
            "project" => Some(Self::Project),
            "domain" => Some(Self::Domain),
            "tag" => Some(Self::Tag),
            _ => None,
        }
    }
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

impl ProjectStatus {
    /// Returns the database string representation.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Achieved => "achieved",
            Self::Frozen => "frozen",
            Self::Archived => "archived",
        }
    }

    /// Parses the database string representation, if recognized.
    pub fn from_db(value: &str) -> Option<Self> {
        match value {
            "active" => Some(Self::Active),
            "achieved" => Some(Self::Achieved),
            "frozen" => Some(Self::Frozen),
            "archived" => Some(Self::Archived),
            _ => None,
        }
    }
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
    /// Sort position among siblings; defaults to id (insertion order).
    pub position: i64,
    /// Whether this node is private (hidden unless Private Mode is on).
    pub is_private: bool,
    /// The `bd` issue tracking this Project, if any (e.g. `"Arlesh-5fs"`). Sourced only from the
    /// MCP server, through [`DomainOperator::set_beads_id`](crate::domains::DomainOperator::set_beads_id);
    /// no update request carries it. Duplicating a node propagates the id it already has, and the
    /// Issue row's × drops the link — neither writes a new one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub beads_id: Option<String>,
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
#[derive(Debug, Default, Deserialize)]
pub struct UpdateDomainRequest {
    /// New title (if provided).
    pub title: Option<String>,
    /// New description (if provided).
    pub description: Option<String>,
    /// New parent id (if provided).
    pub parent_id: Option<i64>,
    /// New subtype — used for domain↔project conversion. Must not be `Aspect`.
    pub subtype: Option<DomainSubtype>,
    /// New project status (if provided).
    pub status: Option<ProjectStatus>,
    /// New Obsidian directory link (if provided).
    pub knowledge_base_directory: Option<String>,
    /// New sort position among siblings (for sibling reordering).
    pub position: Option<i64>,
    /// New private flag, if changing.
    pub is_private: Option<bool>,
}

#[cfg(test)]
mod tests;
