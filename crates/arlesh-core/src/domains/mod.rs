//! Domain resources: Aspects, Projects, Domains, Tags.

pub mod error;
pub mod model;
mod rows;
pub mod rules;

use crate::nodes::id::RowId;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::database::session::{Db, Transactional};
use crate::error::AppError;
use crate::flows::model::FlowId;
use crate::nodes::rules::parenting;
use error::DomainError;
use model::{CreateDomainRequest, Domain, DomainId, DomainSubtype, UpdateDomainRequest};
use rows::DomainRow;

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
    /// # use arlesh_core::database::session::SessionFactory;
    /// # use arlesh_core::domains::model::{CreateDomainRequest, DomainSubtype};
    /// # async fn create(factory: &SessionFactory) -> Result<(), arlesh_core::domains::error::DomainError> {
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
        self.validate_parent(&request.subtype, request.parent_id)
            .await?;

        let subtype_str = subtype_to_str(&request.subtype);
        // A Project with no status already *reads* as Active everywhere (`UNSET_STATUS` in
        // `filter-tree.ts`), but a stored NULL matches no value, so List View's Project-status
        // filter silently excluded every such Project along with its whole subtree of tasks.
        // Store what the app already means. Only a Project carries a status — a Domain or Tag
        // keeps NULL, since the vocabulary does not apply to them.
        let status_str = match request.status.as_ref() {
            Some(status) => rules::stored_status(&request.subtype, status)?,
            None if request.subtype == DomainSubtype::Project => {
                Some(model::ProjectStatus::Active.as_str())
            }
            None => None,
        };

        let id = sqlx::query_scalar::<_, RowId>(
            "INSERT INTO domains (id, title, description, subtype, parent_id, status, knowledge_base_directory)
             VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
        )
        .bind(request.id.unwrap_or_else(crate::nodes::new_id::new_row_id))
        .bind(&request.title)
        .bind(&request.description)
        .bind(subtype_str)
        .bind(request.parent_id)
        .bind(status_str)
        .bind(&request.knowledge_base_directory)
        .fetch_one(&mut *self.connection)
        .await?;

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
        sqlx::query_as::<_, DomainRow>("SELECT * FROM domains WHERE id = ?")
            .bind(id.0)
            .fetch_optional(&mut *self.connection)
            .await?
            .map(Domain::from)
            .ok_or(DomainError::NotFound(id.0))
    }

    /// Lists all domains, optionally filtered to a specific subtype.
    pub async fn list(
        &mut self,
        subtype: Option<DomainSubtype>,
    ) -> Result<Vec<Domain>, DomainError> {
        match subtype {
            Some(subtype_value) => sqlx::query_as::<_, DomainRow>(
                "SELECT * FROM domains WHERE subtype = ? ORDER BY position ASC",
            )
            .bind(subtype_to_str(&subtype_value))
            .fetch_all(&mut *self.connection)
            .await
            .map(|rows| rows.into_iter().map(Domain::from).collect())
            .map_err(Into::into),
            None => sqlx::query_as::<_, DomainRow>("SELECT * FROM domains ORDER BY position ASC")
                .fetch_all(&mut *self.connection)
                .await
                .map(|rows| rows.into_iter().map(Domain::from).collect())
                .map_err(Into::into),
        }
    }

    /// Returns the ids of the domains parented directly by `parent_id`.
    ///
    /// The `domains` counterpart of [`GoalOperator::child_ids`](crate::tasks::GoalOperator::child_ids)
    /// and its siblings: a subtree walk collects its children a level at a time, and this is the
    /// one query that walk needs on this table.
    pub async fn child_ids(&mut self, parent_id: DomainId) -> Result<Vec<RowId>, DomainError> {
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
            Some(subtype) => subtype,
            None => DomainSubtype::from_db(&domain.subtype).ok_or(DomainError::FixedAspect)?,
        };
        let title = request.title.unwrap_or(domain.title);
        let description = request.description.or(domain.description);
        let parent_id = request.parent_id.or(domain.parent_id);
        // An archived Domain unarchives to no status at all, so an asked-for status replaces the
        // stored one outright, `None` included.
        let status = match request.status.as_ref() {
            Some(requested) => rules::stored_status(&subtype, requested)?.map(str::to_string),
            None => domain.status,
        };
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
        .bind(subtype_to_str(&subtype))
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

    /// Validates that `parent_id` is an acceptable parent for a domain of the given `subtype`, by
    /// the one parenting table every writer asks ([`crate::nodes::rules::parenting::may_parent`]).
    /// A Project needs a parent; a Tag holds no domain.
    async fn validate_parent(
        &mut self,
        subtype: &DomainSubtype,
        parent_id: Option<RowId>,
    ) -> Result<(), DomainError> {
        let Some(parent_id) = parent_id else {
            return match subtype {
                DomainSubtype::Project => Err(DomainError::InvalidParent(
                    "Projects require a parent".into(),
                )),
                _ => Ok(()),
            };
        };
        let parent = self.get(DomainId(parent_id)).await?;
        if parent.subtype == "tag" {
            return Err(DomainError::TagCannotHaveChildren);
        }
        let child = subtype_to_str(subtype);
        let allowed = match (
            parenting::kind_of(child),
            parenting::kind_of(&parent.subtype),
        ) {
            (Some(child), Some(parent)) => parenting::may_parent(child, parent),
            _ => false,
        };
        if !allowed {
            return Err(DomainError::InvalidParent(format!(
                "a {child} cannot hang under a {}",
                parent.subtype
            )));
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

/// Deletes a Project, Domain or Tag with everything under it: the Domains, Projects and Tags
/// below it, and on each of those (and on the root) its Flows, Tasks, Goals, Commitments, waits
/// and notes, each with its own subtree.
///
/// A bare [`DomainOperator::delete`] removes one row, and the `domains.parent_id` foreign key
/// refuses it while a child domain remains; the content hangs by a polymorphic parent link with no
/// foreign key, so it would be left behind unparented. This walks the subtree and deletes it
/// children first, as the Mindmap's delete-with-subtree gesture does, so every caller — the
/// desktop app, the server and the gesture — gets the same result. Aspects are refused before
/// anything is deleted.
///
/// Transactional: a failure part-way must leave the tree as it was (ADR-0004).
#[tracing::instrument(skip(db))]
pub async fn delete_subtree(db: &mut Db<Transactional>, id: DomainId) -> Result<(), AppError> {
    let root = db.domains().get(id).await?;
    if root.subtype == "aspect" {
        return Err(DomainError::FixedAspect.into());
    }
    // A parent is discovered before its children, so deleting in reverse removes children first.
    let mut discovered = vec![id.0];
    let mut next = 0;
    while let Some(&parent) = discovered.get(next) {
        next += 1;
        let children = db.domains().child_ids(DomainId(parent)).await?;
        discovered.extend(children);
    }
    for domain_id in discovered.into_iter().rev() {
        let flows = db
            .flows()
            .ids_under(crate::access::model::NodeTable::Domain, domain_id)
            .await?;
        for flow in flows {
            crate::flows::delete_flow(db, FlowId(flow)).await?;
        }
        crate::tasks::delete_children_of(db, "domain", domain_id).await?;
        db.domains().delete(DomainId(domain_id)).await?;
    }
    Ok(())
}
