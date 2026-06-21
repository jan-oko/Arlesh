//! Domain resources: Aspects, Projects, Domains, Tags.

pub mod error;
pub mod model;

use crate::database::DatabasePool;
use error::DomainError;
use model::{CreateDomainRequest, Domain, DomainId, DomainSubtype, UpdateDomainRequest};

/// Repository for all domain CRUD operations.
pub struct DomainRepository<'a> {
    pool: &'a DatabasePool,
}

impl<'a> DomainRepository<'a> {
    /// Creates a new repository backed by `pool`.
    pub fn new(pool: &'a DatabasePool) -> Self {
        Self { pool }
    }

    /// Creates a new domain. Aspects cannot be created via this method.
    pub async fn create(&self, request: CreateDomainRequest) -> Result<Domain, DomainError> {
        if request.subtype == DomainSubtype::Aspect {
            return Err(DomainError::FixedAspect);
        }
        self.validate_parent(&request.subtype, request.parent_id).await?;

        let subtype_str = subtype_to_str(&request.subtype);
        let status_str = request.status.as_ref().map(|s| status_to_str(s));

        let id = sqlx::query(
            "INSERT INTO domains (title, description, subtype, parent_id, status, knowledge_base_directory)
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(&request.title)
        .bind(&request.description)
        .bind(subtype_str)
        .bind(request.parent_id)
        .bind(status_str)
        .bind(&request.knowledge_base_directory)
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
            Some(subtype_value) => {
                sqlx::query_as::<_, Domain>(
                    "SELECT * FROM domains WHERE subtype = ? ORDER BY title",
                )
                .bind(subtype_to_str(&subtype_value))
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
        request: UpdateDomainRequest,
    ) -> Result<Domain, DomainError> {
        let domain = self.get(id).await?;
        if domain.subtype == "aspect" {
            return Err(DomainError::FixedAspect);
        }

        let title = request.title.unwrap_or(domain.title);
        let description = request.description.or(domain.description);
        let parent_id = request.parent_id.or(domain.parent_id);
        let status = request
            .status
            .as_ref()
            .map(|s| status_to_str(s).to_string())
            .or(domain.status);
        let knowledge_base_directory = request
            .knowledge_base_directory
            .or(domain.knowledge_base_directory);

        sqlx::query(
            "UPDATE domains SET title=?, description=?, parent_id=?, status=?, knowledge_base_directory=? WHERE id=?",
        )
        .bind(&title)
        .bind(&description)
        .bind(parent_id)
        .bind(&status)
        .bind(&knowledge_base_directory)
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
                let parent_id = parent_id.ok_or_else(|| {
                    DomainError::InvalidParent("Projects require a parent".into())
                })?;
                let parent = self.get(DomainId(parent_id)).await?;
                if parent.subtype != "aspect" && parent.subtype != "project" {
                    return Err(DomainError::InvalidParent(
                        "Project parent must be an Aspect or Project".into(),
                    ));
                }
            }
            DomainSubtype::Tag => {
                if let Some(parent_id) = parent_id {
                    let parent = self.get(DomainId(parent_id)).await?;
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

fn subtype_to_str(subtype: &DomainSubtype) -> &'static str {
    match subtype {
        DomainSubtype::Aspect => "aspect",
        DomainSubtype::Project => "project",
        DomainSubtype::Domain => "domain",
        DomainSubtype::Tag => "tag",
    }
}

fn status_to_str(status: &model::ProjectStatus) -> &'static str {
    match status {
        model::ProjectStatus::Active => "active",
        model::ProjectStatus::Achieved => "achieved",
        model::ProjectStatus::Frozen => "frozen",
        model::ProjectStatus::Archived => "archived",
    }
}
