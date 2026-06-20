//! Domain resources: Aspects, Projects, Domains, Tags.

pub mod error;
pub mod model;

use crate::db::DbPool;
use error::DomainError;
use model::{CreateDomainRequest, Domain, DomainId, DomainSubtype, UpdateDomainRequest};

/// Repository for all domain CRUD operations.
pub struct DomainRepository<'a> {
    pool: &'a DbPool,
}

impl<'a> DomainRepository<'a> {
    /// Creates a new repository backed by `pool`.
    pub fn new(pool: &'a DbPool) -> Self {
        Self { pool }
    }

    /// Creates a new domain. Aspects cannot be created via this method.
    pub async fn create(&self, req: CreateDomainRequest) -> Result<Domain, DomainError> {
        if req.subtype == DomainSubtype::Aspect {
            return Err(DomainError::FixedAspect);
        }
        self.validate_parent(&req.subtype, req.parent_id).await?;

        let subtype_str = subtype_to_str(&req.subtype);
        let status_str = req.status.as_ref().map(|s| status_to_str(s));

        let id = sqlx::query(
            "INSERT INTO domains (title, description, subtype, parent_id, status, kb_dir)
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(&req.title)
        .bind(&req.description)
        .bind(subtype_str)
        .bind(req.parent_id)
        .bind(status_str)
        .bind(&req.kb_dir)
        .execute(self.pool)
        .await?
        .last_insert_rowid();

        self.get(DomainId(id)).await
    }

    /// Fetches a domain by id.
    pub async fn get(&self, id: DomainId) -> Result<Domain, DomainError> {
        sqlx::query_as::<_, Domain>("SELECT * FROM domains WHERE id = ?")
            .bind(id.0)
            .fetch_optional(self.pool)
            .await?
            .ok_or(DomainError::NotFound(id.0))
    }

    /// Lists all domains, optionally filtered to a specific subtype.
    pub async fn list(&self, subtype: Option<DomainSubtype>) -> Result<Vec<Domain>, DomainError> {
        match subtype {
            Some(st) => {
                sqlx::query_as::<_, Domain>(
                    "SELECT * FROM domains WHERE subtype = ? ORDER BY title",
                )
                .bind(subtype_to_str(&st))
                .fetch_all(self.pool)
                .await
                .map_err(Into::into)
            }
            None => sqlx::query_as::<_, Domain>("SELECT * FROM domains ORDER BY title")
                .fetch_all(self.pool)
                .await
                .map_err(Into::into),
        }
    }

    /// Updates an existing domain. Aspects cannot be updated.
    pub async fn update(
        &self,
        id: DomainId,
        req: UpdateDomainRequest,
    ) -> Result<Domain, DomainError> {
        let domain = self.get(id).await?;
        if domain.subtype == "aspect" {
            return Err(DomainError::FixedAspect);
        }

        let title = req.title.unwrap_or(domain.title);
        let description = req.description.or(domain.description);
        let parent_id = req.parent_id.or(domain.parent_id);
        let status = req.status.as_ref().map(|s| status_to_str(s).to_string()).or(domain.status);
        let kb_dir = req.kb_dir.or(domain.kb_dir);

        sqlx::query(
            "UPDATE domains SET title=?, description=?, parent_id=?, status=?, kb_dir=? WHERE id=?",
        )
        .bind(&title)
        .bind(&description)
        .bind(parent_id)
        .bind(&status)
        .bind(&kb_dir)
        .bind(id.0)
        .execute(self.pool)
        .await?;

        self.get(id).await
    }

    /// Deletes a domain by id. Aspects cannot be deleted.
    pub async fn delete(&self, id: DomainId) -> Result<(), DomainError> {
        let domain = self.get(id).await?;
        if domain.subtype == "aspect" {
            return Err(DomainError::FixedAspect);
        }
        sqlx::query("DELETE FROM domains WHERE id = ?")
            .bind(id.0)
            .execute(self.pool)
            .await?;
        Ok(())
    }

    async fn validate_parent(
        &self,
        subtype: &DomainSubtype,
        parent_id: Option<i64>,
    ) -> Result<(), DomainError> {
        match subtype {
            DomainSubtype::Project => {
                let pid = parent_id.ok_or_else(|| {
                    DomainError::InvalidParent("Projects require a parent".into())
                })?;
                let parent = self.get(DomainId(pid)).await?;
                if parent.subtype != "aspect" && parent.subtype != "project" {
                    return Err(DomainError::InvalidParent(
                        "Project parent must be an Aspect or Project".into(),
                    ));
                }
            }
            DomainSubtype::Tag => {
                if let Some(pid) = parent_id {
                    let parent = self.get(DomainId(pid)).await?;
                    if parent.subtype == "tag" {
                        return Err(DomainError::TagCannotHaveChildren);
                    }
                }
            }
            DomainSubtype::Domain | DomainSubtype::Aspect => {}
        }
        Ok(())
    }
}

fn subtype_to_str(s: &DomainSubtype) -> &'static str {
    match s {
        DomainSubtype::Aspect => "aspect",
        DomainSubtype::Project => "project",
        DomainSubtype::Domain => "domain",
        DomainSubtype::Tag => "tag",
    }
}

fn status_to_str(s: &model::ProjectStatus) -> &'static str {
    match s {
        model::ProjectStatus::Active => "active",
        model::ProjectStatus::Achieved => "achieved",
        model::ProjectStatus::Frozen => "frozen",
        model::ProjectStatus::Archived => "archived",
    }
}
