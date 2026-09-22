//! Commitments: rules held over a window, kept or broken.
//!
//! A Commitment is a content node beside Goal and Task, not a variant of either. It lives
//! anywhere a Task can, holds Tasks and other Commitments, and carries a window like everything
//! else — but instead of a status it carries a **Verdict**, which nothing derives. See
//! `docs/adr/0005-commitment-node-kind.md`.
//!
//! The module follows the shape its neighbours already have (ADR-0004): single-resource SQL on
//! [`CommitmentOperator`], and anything that also has to read scopes — which is every write,
//! because every write checks the effective-scope rule — as a free function over a [`Db`]
//! session. [`create_commitment`], [`update_commitment`] and [`delete_commitment`] are the only
//! ways to write a row; the operator methods underneath them are module-private.
//!
//! It lives inside `tasks` rather than beside it because a Commitment sits on the *same* scoped
//! parent chain a Task and a Goal do: `ancestry::climb` walks through commitment links, a Task
//! inherits its window from a Commitment ancestor, and the containment rules are the ones in
//! `scope_rules`. Splitting it out would mean either duplicating that chain or making it public.

use crate::database::session::{Db, SessionMode, Transactional};

use super::ancestry::{AncestryLink, NodeKind, NodeRef};
use super::error::TaskError;
use super::model::{
    Commitment, CommitmentId, CreateCommitmentRequest, DurationSpec, OnScopeExit, TimeScope,
    UpdateCommitmentRequest, Verdict,
};
use super::{insertion_position, scope_rules, time_scope_columns, time_scope_from_row};

/// The stored shape of a commitment row.
#[derive(sqlx::FromRow)]
struct CommitmentRow {
    id: i64,
    title: String,
    parent_type: String,
    parent_id: i64,
    verdict: String,
    time_scope_start_id: Option<i64>,
    time_scope_end_id: Option<i64>,
    time_scope_duration_n: Option<i64>,
    time_scope_duration_kind: Option<String>,
    verdict_window_n: Option<i64>,
    verdict_window_kind: Option<String>,
    position: i64,
    is_private: bool,
    beads_id: Option<String>,
}

/// Reassembles a Verdict Window from its two flat columns. A schema CHECK keeps the pair whole,
/// so half of one can only be corruption — and reads as no window rather than as a guess.
fn verdict_window_from_row(n: Option<i64>, kind: Option<String>) -> Option<DurationSpec> {
    match (n, kind) {
        (Some(n), Some(kind)) => Some(DurationSpec { n, kind }),
        _ => None,
    }
}

/// Decomposes a Verdict Window into its two column values.
fn verdict_window_columns(window: &Option<DurationSpec>) -> (Option<i64>, Option<String>) {
    match window {
        Some(duration) => (Some(duration.n), Some(duration.kind.clone())),
        None => (None, None),
    }
}

impl From<CommitmentRow> for Commitment {
    fn from(row: CommitmentRow) -> Self {
        Self {
            id: row.id,
            title: row.title,
            parent_type: row.parent_type,
            parent_id: row.parent_id,
            // An unrecognised spelling reads as Unresolved, which is the one value that asserts
            // nothing about what happened. The CHECK constraint is what keeps it from arising.
            verdict: Verdict::from_db(&row.verdict).unwrap_or_default(),
            time_scope: time_scope_from_row(
                row.time_scope_start_id,
                row.time_scope_end_id,
                row.time_scope_duration_n,
                row.time_scope_duration_kind,
            ),
            verdict_window: verdict_window_from_row(row.verdict_window_n, row.verdict_window_kind),
            tag_ids: vec![],
            position: row.position,
            is_private: row.is_private,
            beads_id: row.beads_id,
        }
    }
}

/// The column values a commitment update writes: the caller's request merged over the stored row.
///
/// Private, like [`CommitmentOperator::update`] which consumes it: together they close the write
/// path, so [`update_commitment`] — where the scope rules are checked — is the only way to change
/// a commitment.
struct CommitmentWrite {
    /// The new parent, when the request asks for a move; `None` leaves the parent link alone.
    reparent: Option<(String, i64)>,
    /// The parent the merged Time Scope is validated against — the new one when reparenting.
    parent_type: String,
    /// Id of that same parent.
    parent_id: i64,
    /// Final title.
    title: String,
    /// Final verdict.
    verdict: Verdict,
    /// Final Time Scope, or `None` for inherited.
    time_scope: Option<TimeScope>,
    /// Final Verdict Window, or `None` for inherited.
    verdict_window: Option<DurationSpec>,
    /// Final sort position.
    position: i64,
    /// Final privacy flag.
    is_private: bool,
}

impl CommitmentWrite {
    /// Merges `request` over the `stored` row. Pure — it reads nothing and writes nothing.
    ///
    /// There is no equivalent here of a Task's "scheduling a backlogged task un-backlogs it"
    /// rule: a Commitment has no pair of fields that contradict each other, so the merge is the
    /// plain field-by-field one and nothing is resolved in anybody's favour.
    fn merge(stored: Commitment, request: UpdateCommitmentRequest) -> Self {
        let reparent = match (request.parent_type, request.parent_id) {
            (Some(parent_type), Some(parent_id)) => Some((parent_type, parent_id)),
            _ => None,
        };
        let (parent_type, parent_id) = reparent
            .clone()
            .unwrap_or((stored.parent_type, stored.parent_id));
        Self {
            reparent,
            parent_type,
            parent_id,
            title: request.title.unwrap_or(stored.title),
            verdict: request.verdict.unwrap_or(stored.verdict),
            time_scope: match request.time_scope {
                Some(new_time_scope) => new_time_scope,
                None => stored.time_scope,
            },
            verdict_window: match request.verdict_window {
                Some(new_window) => new_window,
                None => stored.verdict_window,
            },
            position: request.position.unwrap_or(stored.position),
            is_private: request.is_private.unwrap_or(stored.is_private),
        }
    }
}

/// Reads and writes commitments on a session's connection.
///
/// Obtained as `db.commitments()` and used inline; see [`Db`] for the borrow rules and for where
/// an operation belongs. The scope rules are **not** checked here — they read scopes as well as
/// commitments, so they live in [`create_commitment`] and [`update_commitment`].
pub struct CommitmentOperator<'session> {
    /// The session's connection, borrowed for the duration of this operator's life.
    connection: &'session mut sqlx::SqliteConnection,
}

impl<'session> CommitmentOperator<'session> {
    /// Wraps the connection a session is lending.
    pub(crate) fn new(connection: &'session mut sqlx::SqliteConnection) -> Self {
        Self { connection }
    }

    /// Inserts a commitment row and returns it, **without checking the scope rules** — use
    /// [`create_commitment`], this method's only caller.
    ///
    /// **Module-private on purpose**, for the reason `TaskOperator::insert` is: it takes a
    /// request whose every field is public and skips the rules, so it must not be reachable from
    /// another module. Multi-statement, and so not atomic on its own; it opens no transaction.
    async fn insert(&mut self, request: CreateCommitmentRequest) -> Result<Commitment, TaskError> {
        let verdict = request.verdict.unwrap_or_default();
        let (ts_start, ts_end, ts_n, ts_kind) = time_scope_columns(&request.time_scope);
        let (vw_n, vw_kind) = verdict_window_columns(&request.verdict_window);
        let id = sqlx::query(
            "INSERT INTO commitments
                (title, parent_type, parent_id, verdict,
                 time_scope_start_id, time_scope_end_id, time_scope_duration_n,
                 time_scope_duration_kind, verdict_window_n, verdict_window_kind)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&request.title)
        .bind(&request.parent_type)
        .bind(request.parent_id)
        .bind(verdict.as_str())
        .bind(ts_start)
        .bind(ts_end)
        .bind(ts_n)
        .bind(&ts_kind)
        .bind(vw_n)
        .bind(&vw_kind)
        .execute(&mut *self.connection)
        .await?
        .last_insert_rowid();
        sqlx::query("UPDATE commitments SET position = ? WHERE id = ?")
            .bind(insertion_position())
            .bind(id)
            .execute(&mut *self.connection)
            .await?;
        self.get(CommitmentId(id)).await
    }

    /// Fetches a commitment by id.
    pub async fn get(&mut self, id: CommitmentId) -> Result<Commitment, TaskError> {
        let row = sqlx::query_as::<_, CommitmentRow>("SELECT * FROM commitments WHERE id = ?")
            .bind(id.0)
            .fetch_optional(&mut *self.connection)
            .await?
            .ok_or(TaskError::CommitmentNotFound(id.0))?;
        let tag_ids = self.tag_ids(id).await?;
        Ok(Commitment {
            tag_ids,
            ..row.into()
        })
    }

    /// The tag domain ids attached to one commitment, in id order.
    async fn tag_ids(&mut self, id: CommitmentId) -> Result<Vec<i64>, TaskError> {
        Ok(sqlx::query_scalar::<_, i64>(
            "SELECT tag_id FROM tags_on_commitments WHERE commitment_id = ? ORDER BY tag_id",
        )
        .bind(id.0)
        .fetch_all(&mut *self.connection)
        .await?)
    }

    /// The ancestry fields of a commitment, as one step of an `ancestry::climb`.
    ///
    /// Module-private, like its Task and Goal counterparts: the climb is the only caller, and it
    /// is the only thing that should be reading a half-row.
    ///
    /// `on_scope_exit` is reported as [`OnScopeExit::Keep`] whenever the commitment is scoped,
    /// because a Commitment has no such column and never Archives on the way out. That matters
    /// to descendants rather than to the commitment itself: a Task inheriting its window from a
    /// Commitment ancestor inherits Keep with it, so the task lapses Overdue rather than Missed.
    pub(super) async fn ancestry_link(
        &mut self,
        id: CommitmentId,
    ) -> Result<AncestryLink, TaskError> {
        let commitment = self.get(id).await?;
        let on_scope_exit = commitment.time_scope.as_ref().map(|_| OnScopeExit::Keep);
        Ok(AncestryLink {
            kind: NodeKind::Commitment,
            id: id.0,
            parent: NodeRef::new(commitment.parent_type, commitment.parent_id),
            time_scope: commitment.time_scope,
            // A Commitment is never scheduled: the window *is* the commitment.
            plan: None,
            on_scope_exit,
            verdict_window: commitment.verdict_window,
        })
    }

    /// Lists all commitments, in sort-position order.
    pub async fn list(&mut self) -> Result<Vec<Commitment>, TaskError> {
        let rows =
            sqlx::query_as::<_, CommitmentRow>("SELECT * FROM commitments ORDER BY position ASC")
                .fetch_all(&mut *self.connection)
                .await?;
        let mut commitments = Vec::with_capacity(rows.len());
        for row in rows {
            let tag_ids = self.tag_ids(CommitmentId(row.id)).await?;
            commitments.push(Commitment {
                tag_ids,
                ..row.into()
            });
        }
        Ok(commitments)
    }

    /// Returns the ids of the commitments parented directly by `(parent_type, parent_id)`.
    ///
    /// The parent link is polymorphic and has no foreign key, so subtree walks collect their
    /// children a level at a time through this.
    pub async fn child_ids(
        &mut self,
        parent_type: &str,
        parent_id: i64,
    ) -> Result<Vec<i64>, TaskError> {
        Ok(
            sqlx::query_scalar(
                "SELECT id FROM commitments WHERE parent_type = ? AND parent_id = ?",
            )
            .bind(parent_type)
            .bind(parent_id)
            .fetch_all(&mut *self.connection)
            .await?,
        )
    }

    /// Writes already-merged column values onto a commitment. **Validates nothing** — see
    /// [`update_commitment`], this method's only caller. Module-private for the same reason
    /// [`Self::insert`] is.
    async fn update(
        &mut self,
        id: CommitmentId,
        write: CommitmentWrite,
    ) -> Result<Commitment, TaskError> {
        let (ts_start, ts_end, ts_n, ts_kind) = time_scope_columns(&write.time_scope);
        let (vw_n, vw_kind) = verdict_window_columns(&write.verdict_window);

        if let Some((new_parent_type, new_parent_id)) = &write.reparent {
            sqlx::query("UPDATE commitments SET parent_type = ?, parent_id = ? WHERE id = ?")
                .bind(new_parent_type)
                .bind(new_parent_id)
                .bind(id.0)
                .execute(&mut *self.connection)
                .await?;
        }

        sqlx::query(
            "UPDATE commitments SET title=?, verdict=?,
                time_scope_start_id=?, time_scope_end_id=?, time_scope_duration_n=?,
                time_scope_duration_kind=?, verdict_window_n=?, verdict_window_kind=?,
                position=?, is_private=? WHERE id=?",
        )
        .bind(&write.title)
        .bind(write.verdict.as_str())
        .bind(ts_start)
        .bind(ts_end)
        .bind(ts_n)
        .bind(&ts_kind)
        .bind(vw_n)
        .bind(&vw_kind)
        .bind(write.position)
        .bind(write.is_private)
        .bind(id.0)
        .execute(&mut *self.connection)
        .await?;
        self.get(id).await
    }

    /// Deletes one commitment row and nothing else. Descendants are the subtree cascade's job —
    /// see [`delete_commitment`].
    ///
    /// Module-private: called directly it orphans everything beneath, since the polymorphic
    /// parent links have no foreign key to cascade along.
    pub(super) async fn delete_row(&mut self, id: CommitmentId) -> Result<(), TaskError> {
        sqlx::query("DELETE FROM commitments WHERE id = ?")
            .bind(id.0)
            .execute(&mut *self.connection)
            .await?;
        Ok(())
    }

    /// Sets a commitment's privacy flag.
    ///
    /// One statement over one column, so it needs no scope check and no transaction of its own.
    pub async fn set_private(
        &mut self,
        id: CommitmentId,
        is_private: bool,
    ) -> Result<(), TaskError> {
        sqlx::query("UPDATE commitments SET is_private = ? WHERE id = ?")
            .bind(is_private)
            .bind(id.0)
            .execute(&mut *self.connection)
            .await?;
        Ok(())
    }

    /// Links a commitment to the `bd` issue tracking it, or unlinks it when given `None`.
    ///
    /// **The only writer of `beads_id`, and the MCP server is its only *source*** — the same rule
    /// Tasks and Goals live under: [`UpdateCommitmentRequest`] has no field for it, and the one
    /// command that calls this ([`clear_beads_id`](crate::commands::beads::clear_beads_id))
    /// only ever passes `None`. Errors when no commitment has that id, rather than reporting
    /// success for a write that landed nowhere.
    pub async fn set_beads_id(
        &mut self,
        id: CommitmentId,
        beads_id: Option<String>,
    ) -> Result<(), TaskError> {
        let affected = sqlx::query("UPDATE commitments SET beads_id = ? WHERE id = ?")
            .bind(&beads_id)
            .bind(id.0)
            .execute(&mut *self.connection)
            .await?
            .rows_affected();
        if affected == 0 {
            return Err(TaskError::CommitmentNotFound(id.0));
        }
        Ok(())
    }

    /// Attaches a tag to a commitment.
    pub async fn add_tag(&mut self, id: CommitmentId, tag_id: i64) -> Result<(), TaskError> {
        sqlx::query(
            "INSERT OR IGNORE INTO tags_on_commitments (commitment_id, tag_id) VALUES (?, ?)",
        )
        .bind(id.0)
        .bind(tag_id)
        .execute(&mut *self.connection)
        .await?;
        Ok(())
    }

    /// Removes a tag from a commitment.
    pub async fn remove_tag(&mut self, id: CommitmentId, tag_id: i64) -> Result<(), TaskError> {
        sqlx::query("DELETE FROM tags_on_commitments WHERE commitment_id = ? AND tag_id = ?")
            .bind(id.0)
            .bind(tag_id)
            .execute(&mut *self.connection)
            .await?;
        Ok(())
    }
}

/// Creates a commitment, refusing one that could never come due and one whose window escapes its
/// parent's.
///
/// The first refusal is new to this kind. Every other node may be Unscoped — always active,
/// never lapsing — but a Commitment with no window has nothing to be kept or broken *over*, so
/// [`TaskError::CommitmentUnscoped`] is raised rather than a row written that no verdict could
/// ever be due on. The window may still be inherited: what is required is an **effective** one.
///
/// Reads scopes as well as commitments, so it is a free function over the session; transactional
/// because the insert writes twice and because validating inside the transaction is what stops
/// an ancestor's scope changing between the check and the write. This is the **only** way to
/// write a commitment row.
#[tracing::instrument(skip(db))]
pub async fn create_commitment(
    db: &mut Db<Transactional>,
    request: CreateCommitmentRequest,
) -> Result<Commitment, TaskError> {
    scope_rules::validate_commitment_scope(
        db,
        None,
        &request.parent_type,
        request.parent_id,
        &request.time_scope,
    )
    .await?;
    db.commitments().insert(request).await
}

/// Updates a commitment, refusing a write that would leave it without an effective window or
/// with one escaping its parent's.
///
/// Reads the stored row, merges the request over it, validates, then writes — all on one
/// transactional session, so the row cannot move underneath the check. This is the **only** way
/// to change a commitment row.
#[tracing::instrument(skip(db))]
pub async fn update_commitment(
    db: &mut Db<Transactional>,
    id: CommitmentId,
    request: UpdateCommitmentRequest,
) -> Result<Commitment, TaskError> {
    let stored = db.commitments().get(id).await?;
    let write = CommitmentWrite::merge(stored, request);
    scope_rules::validate_commitment_scope(
        db,
        Some(id),
        &write.parent_type,
        write.parent_id,
        &write.time_scope,
    )
    .await?;
    db.commitments().update(id, write).await
}

/// Deletes a commitment and its entire subtree (descendant tasks, goals and commitments, and the
/// infos and block reasons under them).
#[tracing::instrument(skip(db))]
pub async fn delete_commitment(
    db: &mut Db<Transactional>,
    id: CommitmentId,
) -> Result<(), TaskError> {
    db.commitments().get(id).await?;
    super::delete_node_subtree(db, "commitment", id.0).await
}

/// The **effective** Verdict Window governing a commitment: its own when it sets one, else the
/// nearest ancestor Commitment's, or `None` when nothing above it sets one either.
///
/// On the **read** path, so a broken chain leaves the commitment unbounded rather than failing —
/// one corrupt row must not blank the board, and leaving it answerable is the safe direction.
pub(super) async fn effective_verdict_window<M: SessionMode>(
    db: &mut Db<M>,
    id: CommitmentId,
) -> Result<Option<DurationSpec>, TaskError> {
    let chain = super::ancestry::climb(db, "commitment", id.0).await?;
    Ok(chain.nearest_verdict_window().or_unconstrained().cloned())
}

#[cfg(test)]
mod tests;
