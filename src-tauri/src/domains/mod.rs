//! Domain resources: Aspects, Projects, Domains, Tags.

pub mod error;
pub mod model;

use std::time::{SystemTime, UNIX_EPOCH};

use error::DomainError;
use model::{CreateDomainRequest, Domain, DomainId, DomainSubtype, UpdateDomainRequest};

/// Reads and writes aspects, projects, domains and tags on a session's connection.
///
/// Obtained as `db.domains()` and used inline; see [`Db`](crate::database::session::Db) for
/// the borrow rules and for where an operation belongs.
pub struct DomainOperator<'session> {
    /// The session's connection, borrowed for the duration of this operator's life.
    connection: &'session mut sqlx::SqliteConnection,
}

impl<'session> DomainOperator<'session> {
    /// Wraps the connection a session is lending.
    pub(crate) fn new(connection: &'session mut sqlx::SqliteConnection) -> Self {
        Self { connection }
    }

    /// Creates a new domain. Aspects cannot be created via this method.
    ///
    /// Multi-statement — an insert followed by a position update — and so **not atomic on its
    /// own**. It opens no transaction: per ADR-0004 only the outermost caller decides the
    /// boundary, and a method that began its own could never join one.
    ///
    /// ```no_run
    /// # use arlesh_lib::database::session::SessionFactory;
    /// # use arlesh_lib::domains::model::{CreateDomainRequest, DomainSubtype};
    /// # async fn create(factory: &SessionFactory) -> Result<(), arlesh_lib::domains::error::DomainError> {
    /// let mut db = factory.begin().await?;
    /// db.domains().create(CreateDomainRequest {
    ///     title: "Learn Rust".into(),
    ///     description: None,
    ///     subtype: DomainSubtype::Domain,
    ///     parent_id: None,
    ///     status: None,
    ///     knowledge_base_directory: None,
    /// }).await?;
    /// db.commit().await?;
    /// # Ok(())
    /// # }
    /// ```
    pub async fn create(&mut self, request: CreateDomainRequest) -> Result<Domain, DomainError> {
        if request.subtype == DomainSubtype::Aspect {
            return Err(DomainError::FixedAspect);
        }
        self.validate_parent(&request.subtype, request.parent_id).await?;

        let subtype_str = subtype_to_str(&request.subtype);
        // A Project with no status already *reads* as Active everywhere (`UNSET_STATUS` in
        // `filter-tree.ts`), but a stored NULL matches no value, so List View's Project-status
        // filter silently excluded every such Project along with its whole subtree of tasks.
        // Store what the app already means. Only a Project carries a status — a Domain or Tag
        // keeps NULL, since the vocabulary does not apply to them.
        let status_str = match request.status.as_ref() {
            Some(status) => Some(status_to_str(status)),
            None if request.subtype == DomainSubtype::Project => {
                Some(status_to_str(&model::ProjectStatus::Active))
            }
            None => None,
        };

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
        .execute(&mut *self.connection)
        .await?
        .last_insert_rowid();

        let position = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        sqlx::query("UPDATE domains SET position = ? WHERE id = ?")
            .bind(position)
            .bind(id)
            .execute(&mut *self.connection)
            .await?;

        self.get(DomainId(id)).await
    }

    /// Fetches a domain by id.
    pub async fn get(&mut self, id: DomainId) -> Result<Domain, DomainError> {
        sqlx::query_as::<_, Domain>("SELECT * FROM domains WHERE id = ?")
            .bind(id.0)
            .fetch_optional(&mut *self.connection)
            .await?
            .ok_or(DomainError::NotFound(id.0))
    }

    /// Lists all domains, optionally filtered to a specific subtype.
    pub async fn list(&mut self, subtype: Option<DomainSubtype>) -> Result<Vec<Domain>, DomainError> {
        match subtype {
            Some(subtype_value) => {
                sqlx::query_as::<_, Domain>(
                    "SELECT * FROM domains WHERE subtype = ? ORDER BY position ASC",
                )
                .bind(subtype_to_str(&subtype_value))
                .fetch_all(&mut *self.connection)
                .await
                .map_err(Into::into)
            }
            None => sqlx::query_as::<_, Domain>("SELECT * FROM domains ORDER BY position ASC")
                .fetch_all(&mut *self.connection)
                .await
                .map_err(Into::into),
        }
    }

    /// Returns the ids of the domains parented directly by `parent_id`.
    ///
    /// The `domains` counterpart of [`GoalOperator::child_ids`](crate::tasks::GoalOperator::child_ids)
    /// and its siblings: a subtree walk collects its children a level at a time, and this is the
    /// one query that walk needs on this table.
    pub async fn child_ids(&mut self, parent_id: DomainId) -> Result<Vec<i64>, DomainError> {
        Ok(
            sqlx::query_scalar("SELECT id FROM domains WHERE parent_id = ?")
                .bind(parent_id.0)
                .fetch_all(&mut *self.connection)
                .await?,
        )
    }

    /// Updates an existing domain. Aspects cannot be updated.
    ///
    /// A single `UPDATE` statement (preceded and followed by reads), so it is atomic on its own —
    /// SQLite gives statement-level atomicity to a single write.
    pub async fn update(
        &mut self,
        id: DomainId,
        request: UpdateDomainRequest,
    ) -> Result<Domain, DomainError> {
        let domain = self.get(id).await?;
        if domain.subtype == "aspect" {
            return Err(DomainError::FixedAspect);
        }

        let subtype = match request.subtype {
            Some(DomainSubtype::Aspect) => return Err(DomainError::FixedAspect),
            Some(DomainSubtype::Project) => "project".to_string(),
            Some(DomainSubtype::Domain) => "domain".to_string(),
            Some(DomainSubtype::Tag) => "tag".to_string(),
            None => domain.subtype.clone(),
        };
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
        let position = request.position.unwrap_or(domain.position);
        let is_private = request.is_private.unwrap_or(domain.is_private);

        sqlx::query(
            "UPDATE domains SET title=?, description=?, subtype=?, parent_id=?, status=?, knowledge_base_directory=?, position=?, is_private=? WHERE id=?",
        )
        .bind(&title)
        .bind(&description)
        .bind(&subtype)
        .bind(parent_id)
        .bind(&status)
        .bind(&knowledge_base_directory)
        .bind(position)
        .bind(is_private)
        .bind(id.0)
        .execute(&mut *self.connection)
        .await?;

        self.get(id).await
    }

    /// Deletes a domain by id. Aspects cannot be deleted.
    ///
    /// A single `DELETE` statement (preceded by a read), so it is atomic on its own.
    pub async fn delete(&mut self, id: DomainId) -> Result<(), DomainError> {
        let domain = self.get(id).await?;
        if domain.subtype == "aspect" {
            return Err(DomainError::FixedAspect);
        }
        sqlx::query("DELETE FROM domains WHERE id = ?")
            .bind(id.0)
            .execute(&mut *self.connection)
            .await?;
        Ok(())
    }

    /// Links a domain to the `bd` issue tracking it, or unlinks it when given `None`.
    ///
    /// **The only setter of `beads_id`, and the MCP server is its only *source*.**
    /// [`UpdateDomainRequest`] has no field for it, so no gesture can author, edit or clear a link from the UI.
    /// One command does reach this method: [`duplicate_subtree`](crate::duplicate::duplicate_subtree)
    /// *propagates* an id a node already carries onto its copy — SPEC's named exception. It can
    /// only ever pass on a value `bd` issued, never invent or change one.
    ///
    /// `bd` owns the issue; the app only mirrors which one a node belongs to.
    ///
    /// Only a Project is meant to carry one, and only a Project shows it; the subtype is not
    /// checked here, because a check-then-write on an operator would be exactly the shape ADR-0004
    /// reserves for a free function over a transactional session, and nothing in the schema backs
    /// the invariant. The MCP tool resolves the node it was given and is where the subtype is
    /// established.
    ///
    /// One statement over one column, so it needs no transaction of its own. Errors with
    /// [`DomainError::NotFound`] when no domain has that id, rather than reporting success for a
    /// write that landed nowhere.
    pub async fn set_beads_id(
        &mut self,
        id: DomainId,
        beads_id: Option<String>,
    ) -> Result<(), DomainError> {
        let affected = sqlx::query("UPDATE domains SET beads_id = ? WHERE id = ?")
            .bind(&beads_id)
            .bind(id.0)
            .execute(&mut *self.connection)
            .await?
            .rows_affected();
        if affected == 0 {
            return Err(DomainError::NotFound(id.0));
        }
        Ok(())
    }

    /// Validates that `parent_id` is an acceptable parent for a domain of the given `subtype`.
    async fn validate_parent(
        &mut self,
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
