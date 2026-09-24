//! The per-kind **overlays**: what makes one derived row differ from its template.
//!
//! One table per kind (`task_overlays`, `goal_overlays`, `commitment_overlays`), mirroring that
//! kind's columns and keyed by the occurrence's value key (migration 0060). A NULL column inherits
//! the template's value; a `*_set` flag marks a column overridden **to** NULL where NULL is itself
//! a value. A row whose every column inherits says nothing, and is deleted rather than kept — so
//! an occurrence nobody has touched has no row at all, and storage stays proportional to
//! divergences (ADR 0002).
//!
//! Reads are by Habit, since the virtual tables derive a Habit's occurrences together; writes
//! replace one occurrence's whole row, read-modify-write, inside the caller's transaction.

use std::collections::HashMap;

use sqlx::SqliteConnection;

use super::key::{CheckKey, OccurrenceKey};
use crate::scopes::{error::ScopeError, key::ScopeKey, ScopeOperator};

/// One occurrence's Task overlay. Every field inherits when empty.
#[derive(Debug, Clone, Default, PartialEq, Eq, sqlx::FromRow)]
pub struct TaskOverlay {
    /// The occurrence's status; `None` reads as To Do.
    pub status: Option<String>,
    /// When it was completed, epoch milliseconds.
    pub resolved_at: Option<i64>,
    /// `archived` (deleted by hand, which archives) or `missed`.
    pub tombstone: Option<String>,
    /// Its own title.
    pub title: Option<String>,
    /// Its own Plan's start boundary scope.
    pub plan_start_id: Option<ScopeKey>,
    /// Its own Plan's end boundary scope.
    pub plan_end_id: Option<ScopeKey>,
    /// Whether the Plan above is its own — possibly none at all — rather than its Cycle Plan.
    pub plan_set: bool,
    /// Its own delegate's kind.
    pub delegate_kind: Option<String>,
    /// Its own delegate's Person.
    pub delegate_id: Option<i64>,
    /// Whether the delegate above is its own, possibly nobody.
    pub delegate_set: bool,
    /// Its own Agentic flag.
    pub agentic: Option<bool>,
    /// Whether the Agentic flag above is its own, possibly Inherit.
    pub agentic_set: bool,
    /// Its own Asynchronous flag.
    pub asynchronous: Option<bool>,
    /// Its own Backlog state.
    pub archival: Option<String>,
    /// Its own privacy.
    pub is_private: Option<bool>,
    /// Its own beads id.
    pub beads_id: Option<String>,
    /// Whether the beads id above is its own, possibly none.
    pub beads_id_set: bool,
    /// Its own sort position among its siblings.
    pub position: Option<i64>,
    /// Whether its block reasons are its own list rather than its template's.
    pub block_reasons_set: bool,
}

impl TaskOverlay {
    /// Whether the row says nothing, so an occurrence reads exactly as its template draws it.
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }
}

/// One occurrence's Goal overlay.
#[derive(Debug, Clone, Default, PartialEq, Eq, sqlx::FromRow)]
pub struct GoalOverlay {
    /// The occurrence's status; `None` reads as Active.
    pub status: Option<String>,
    /// When it was achieved, epoch milliseconds.
    pub resolved_at: Option<i64>,
    /// `archived` or `missed`.
    pub tombstone: Option<String>,
    /// Its own title.
    pub title: Option<String>,
    /// Its own privacy.
    pub is_private: Option<bool>,
    /// Its own beads id.
    pub beads_id: Option<String>,
    /// Whether the beads id above is its own, possibly none.
    pub beads_id_set: bool,
    /// Its own sort position.
    pub position: Option<i64>,
    /// Whether its block reasons are its own list.
    pub block_reasons_set: bool,
}

impl GoalOverlay {
    /// Whether the row says nothing.
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }
}

/// One occurrence's Commitment overlay.
#[derive(Debug, Clone, Default, PartialEq, Eq, sqlx::FromRow)]
pub struct CommitmentOverlay {
    /// The recorded verdict (`kept`/`broken`); `None` is Unresolved.
    pub verdict: Option<String>,
    /// When the verdict was recorded, epoch milliseconds.
    pub resolved_at: Option<i64>,
    /// `archived` or `missed`.
    pub tombstone: Option<String>,
    /// Its own title.
    pub title: Option<String>,
    /// Its own privacy.
    pub is_private: Option<bool>,
    /// Its own beads id.
    pub beads_id: Option<String>,
    /// Whether the beads id above is its own, possibly none.
    pub beads_id_set: bool,
    /// Its own sort position.
    pub position: Option<i64>,
}

impl CommitmentOverlay {
    /// Whether the row says nothing.
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }
}

/// Every overlay a Habit's occurrences carry, keyed by canonical node key.
#[derive(Debug, Clone, Default)]
pub struct HabitOverlays {
    /// Task overlays.
    pub tasks: HashMap<String, TaskOverlay>,
    /// Goal overlays.
    pub goals: HashMap<String, GoalOverlay>,
    /// Commitment overlays.
    pub commitments: HashMap<String, CommitmentOverlay>,
}

/// A Task overlay as read back, beside its canonical key.
#[derive(sqlx::FromRow)]
struct KeyedTask {
    node_key: String,
    #[sqlx(flatten)]
    overlay: TaskOverlay,
}

/// A Goal overlay as read back, beside its canonical key.
#[derive(sqlx::FromRow)]
struct KeyedGoal {
    node_key: String,
    #[sqlx(flatten)]
    overlay: GoalOverlay,
}

/// A Commitment overlay as read back, beside its canonical key.
#[derive(sqlx::FromRow)]
struct KeyedCommitment {
    node_key: String,
    #[sqlx(flatten)]
    overlay: CommitmentOverlay,
}

const TASK_COLUMNS: &str = "status, resolved_at, tombstone, title, plan_start_id, plan_end_id, \
     plan_set, delegate_kind, delegate_id, delegate_set, agentic, agentic_set, asynchronous, \
     archival, is_private, beads_id, beads_id_set, position, block_reasons_set";
const GOAL_COLUMNS: &str =
    "status, resolved_at, tombstone, title, is_private, beads_id, beads_id_set, position, \
     block_reasons_set";
const COMMITMENT_COLUMNS: &str =
    "verdict, resolved_at, tombstone, title, is_private, beads_id, beads_id_set, position";

/// Reads and writes the overlays on one connection. Opens no transaction of its own.
pub struct OverlayOperator<'session> {
    connection: &'session mut SqliteConnection,
}

impl<'session> OverlayOperator<'session> {
    /// Wraps a connection.
    pub(crate) fn new(connection: &'session mut SqliteConnection) -> Self {
        Self { connection }
    }

    /// Every overlay one Habit's occurrences carry.
    pub async fn for_habit(&mut self, flow_id: i64) -> Result<HabitOverlays, sqlx::Error> {
        let tasks: Vec<KeyedTask> = sqlx::query_as(&format!(
            "SELECT node_key, {TASK_COLUMNS} FROM task_overlays WHERE flow_id = ?"
        ))
        .bind(flow_id)
        .fetch_all(&mut *self.connection)
        .await?;
        let goals: Vec<KeyedGoal> = sqlx::query_as(&format!(
            "SELECT node_key, {GOAL_COLUMNS} FROM goal_overlays WHERE flow_id = ?"
        ))
        .bind(flow_id)
        .fetch_all(&mut *self.connection)
        .await?;
        let commitments: Vec<KeyedCommitment> = sqlx::query_as(&format!(
            "SELECT node_key, {COMMITMENT_COLUMNS} FROM commitment_overlays WHERE flow_id = ?"
        ))
        .bind(flow_id)
        .fetch_all(&mut *self.connection)
        .await?;
        Ok(HabitOverlays {
            tasks: tasks
                .into_iter()
                .map(|row| (row.node_key, row.overlay))
                .collect(),
            goals: goals
                .into_iter()
                .map(|row| (row.node_key, row.overlay))
                .collect(),
            commitments: commitments
                .into_iter()
                .map(|row| (row.node_key, row.overlay))
                .collect(),
        })
    }

    /// The iterations of one Habit that carry an overlay — among the future iterations the virtual
    /// tables must still derive, so that an edit is never lost.
    pub async fn touched_iterations(&mut self, flow_id: i64) -> Result<Vec<ScopeKey>, sqlx::Error> {
        sqlx::query_scalar(
            "SELECT iteration_scope FROM task_overlays WHERE flow_id = ?1 AND origin = 'habit'
             UNION SELECT iteration_scope FROM goal_overlays WHERE flow_id = ?1
             UNION SELECT iteration_scope FROM commitment_overlays WHERE flow_id = ?1",
        )
        .bind(flow_id)
        .fetch_all(&mut *self.connection)
        .await
    }

    /// Records the Exact scopes an overlay row names, so the row's references into
    /// `exact_scopes` hold (migration 0046). Canonical keys need nothing.
    async fn register(
        &mut self,
        keys: impl IntoIterator<Item = ScopeKey>,
    ) -> Result<(), ScopeError> {
        ScopeOperator::new(&mut *self.connection)
            .register_all(keys)
            .await
    }

    /// One occurrence's Task overlay, empty when it has none.
    pub async fn task(&mut self, key: &OccurrenceKey) -> Result<TaskOverlay, sqlx::Error> {
        Ok(sqlx::query_as(&format!(
            "SELECT {TASK_COLUMNS} FROM task_overlays WHERE node_key = ?"
        ))
        .bind(key.node_key())
        .fetch_optional(&mut *self.connection)
        .await?
        .unwrap_or_default())
    }

    /// One occurrence's Goal overlay, empty when it has none.
    pub async fn goal(&mut self, key: &OccurrenceKey) -> Result<GoalOverlay, sqlx::Error> {
        Ok(sqlx::query_as(&format!(
            "SELECT {GOAL_COLUMNS} FROM goal_overlays WHERE node_key = ?"
        ))
        .bind(key.node_key())
        .fetch_optional(&mut *self.connection)
        .await?
        .unwrap_or_default())
    }

    /// One occurrence's Commitment overlay, empty when it has none.
    pub async fn commitment(
        &mut self,
        key: &OccurrenceKey,
    ) -> Result<CommitmentOverlay, sqlx::Error> {
        Ok(sqlx::query_as(&format!(
            "SELECT {COMMITMENT_COLUMNS} FROM commitment_overlays WHERE node_key = ?"
        ))
        .bind(key.node_key())
        .fetch_optional(&mut *self.connection)
        .await?
        .unwrap_or_default())
    }

    /// Replaces one occurrence's Task overlay; an empty one deletes the row.
    pub async fn put_task(
        &mut self,
        flow_id: i64,
        key: &OccurrenceKey,
        overlay: &TaskOverlay,
    ) -> Result<(), ScopeError> {
        if overlay.is_empty() {
            sqlx::query("DELETE FROM task_overlays WHERE node_key = ?")
                .bind(key.node_key())
                .execute(&mut *self.connection)
                .await?;
            return Ok(());
        }
        self.register(
            [key.iteration]
                .into_iter()
                .chain(overlay.plan_start_id)
                .chain(overlay.plan_end_id),
        )
        .await?;
        sqlx::query(
            "INSERT INTO task_overlays
                (origin, flow_id, item_type, item_id, iteration_scope, cycle_id,
                 status, resolved_at, tombstone, title, plan_start_id, plan_end_id, plan_set,
                 delegate_kind, delegate_id, delegate_set, agentic, agentic_set, asynchronous,
                 archival, is_private, beads_id, beads_id_set, position, block_reasons_set)
             VALUES ('habit', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(node_key) DO UPDATE SET
                status = excluded.status, resolved_at = excluded.resolved_at,
                tombstone = excluded.tombstone, title = excluded.title,
                plan_start_id = excluded.plan_start_id, plan_end_id = excluded.plan_end_id,
                plan_set = excluded.plan_set, delegate_kind = excluded.delegate_kind,
                delegate_id = excluded.delegate_id, delegate_set = excluded.delegate_set,
                agentic = excluded.agentic, agentic_set = excluded.agentic_set,
                asynchronous = excluded.asynchronous, archival = excluded.archival,
                is_private = excluded.is_private, beads_id = excluded.beads_id,
                beads_id_set = excluded.beads_id_set, position = excluded.position,
                block_reasons_set = excluded.block_reasons_set",
        )
        .bind(flow_id)
        .bind(key.item.item_type.as_str())
        .bind(key.item.item_id)
        .bind(key.iteration)
        .bind(key.cycle)
        .bind(&overlay.status)
        .bind(overlay.resolved_at)
        .bind(&overlay.tombstone)
        .bind(&overlay.title)
        .bind(overlay.plan_start_id)
        .bind(overlay.plan_end_id)
        .bind(overlay.plan_set)
        .bind(&overlay.delegate_kind)
        .bind(overlay.delegate_id)
        .bind(overlay.delegate_set)
        .bind(overlay.agentic)
        .bind(overlay.agentic_set)
        .bind(overlay.asynchronous)
        .bind(&overlay.archival)
        .bind(overlay.is_private)
        .bind(&overlay.beads_id)
        .bind(overlay.beads_id_set)
        .bind(overlay.position)
        .bind(overlay.block_reasons_set)
        .execute(&mut *self.connection)
        .await?;
        Ok(())
    }

    /// Every wait check task's overlay, by node key.
    pub async fn check_tasks(&mut self) -> Result<HashMap<String, TaskOverlay>, sqlx::Error> {
        let rows: Vec<KeyedTask> = sqlx::query_as(&format!(
            "SELECT node_key, {TASK_COLUMNS} FROM task_overlays WHERE origin = 'check'"
        ))
        .fetch_all(&mut *self.connection)
        .await?;
        Ok(rows
            .into_iter()
            .map(|row| (row.node_key, row.overlay))
            .collect())
    }

    /// One check task's overlay, empty when it has none.
    pub async fn check_task(&mut self, key: &CheckKey) -> Result<TaskOverlay, sqlx::Error> {
        Ok(sqlx::query_as(&format!(
            "SELECT {TASK_COLUMNS} FROM task_overlays WHERE node_key = ?"
        ))
        .bind(key.node_key())
        .fetch_optional(&mut *self.connection)
        .await?
        .unwrap_or_default())
    }

    /// Replaces one check task's overlay; an empty one deletes the row. A check task is drawn
    /// from nothing but its wait, so everything but its own state is empty until it says otherwise.
    pub async fn put_check_task(
        &mut self,
        key: &CheckKey,
        overlay: &TaskOverlay,
    ) -> Result<(), ScopeError> {
        sqlx::query("DELETE FROM task_overlays WHERE node_key = ?")
            .bind(key.node_key())
            .execute(&mut *self.connection)
            .await?;
        if overlay.is_empty() {
            return Ok(());
        }
        self.register(overlay.plan_start_id.into_iter().chain(overlay.plan_end_id))
            .await?;
        sqlx::query(
            "INSERT INTO task_overlays
                (origin, wait_key, due_at,
                 status, resolved_at, tombstone, title, plan_start_id, plan_end_id, plan_set,
                 delegate_kind, delegate_id, delegate_set, agentic, agentic_set, asynchronous,
                 archival, is_private, beads_id, beads_id_set, position, block_reasons_set)
             VALUES ('check', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(key.wait_key())
        .bind(crate::tasks::waits::instant_column(key.due_at))
        .bind(&overlay.status)
        .bind(overlay.resolved_at)
        .bind(&overlay.tombstone)
        .bind(&overlay.title)
        .bind(overlay.plan_start_id)
        .bind(overlay.plan_end_id)
        .bind(overlay.plan_set)
        .bind(&overlay.delegate_kind)
        .bind(overlay.delegate_id)
        .bind(overlay.delegate_set)
        .bind(overlay.agentic)
        .bind(overlay.agentic_set)
        .bind(overlay.asynchronous)
        .bind(&overlay.archival)
        .bind(overlay.is_private)
        .bind(&overlay.beads_id)
        .bind(overlay.beads_id_set)
        .bind(overlay.position)
        .bind(overlay.block_reasons_set)
        .execute(&mut *self.connection)
        .await?;
        Ok(())
    }

    /// Replaces one occurrence's Goal overlay; an empty one deletes the row.
    pub async fn put_goal(
        &mut self,
        flow_id: i64,
        key: &OccurrenceKey,
        overlay: &GoalOverlay,
    ) -> Result<(), ScopeError> {
        if overlay.is_empty() {
            sqlx::query("DELETE FROM goal_overlays WHERE node_key = ?")
                .bind(key.node_key())
                .execute(&mut *self.connection)
                .await?;
            return Ok(());
        }
        self.register([key.iteration]).await?;
        sqlx::query(
            "INSERT INTO goal_overlays
                (flow_id, item_type, item_id, iteration_scope, cycle_id, status, resolved_at,
                 tombstone, title, is_private, beads_id, beads_id_set, position, block_reasons_set)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(node_key) DO UPDATE SET
                status = excluded.status, resolved_at = excluded.resolved_at,
                tombstone = excluded.tombstone, title = excluded.title,
                is_private = excluded.is_private, beads_id = excluded.beads_id,
                beads_id_set = excluded.beads_id_set, position = excluded.position,
                block_reasons_set = excluded.block_reasons_set",
        )
        .bind(flow_id)
        .bind(key.item.item_type.as_str())
        .bind(key.item.item_id)
        .bind(key.iteration)
        .bind(key.cycle)
        .bind(&overlay.status)
        .bind(overlay.resolved_at)
        .bind(&overlay.tombstone)
        .bind(&overlay.title)
        .bind(overlay.is_private)
        .bind(&overlay.beads_id)
        .bind(overlay.beads_id_set)
        .bind(overlay.position)
        .bind(overlay.block_reasons_set)
        .execute(&mut *self.connection)
        .await?;
        Ok(())
    }

    /// Replaces one occurrence's Commitment overlay; an empty one deletes the row.
    pub async fn put_commitment(
        &mut self,
        flow_id: i64,
        key: &OccurrenceKey,
        overlay: &CommitmentOverlay,
    ) -> Result<(), ScopeError> {
        if overlay.is_empty() {
            sqlx::query("DELETE FROM commitment_overlays WHERE node_key = ?")
                .bind(key.node_key())
                .execute(&mut *self.connection)
                .await?;
            return Ok(());
        }
        self.register([key.iteration]).await?;
        sqlx::query(
            "INSERT INTO commitment_overlays
                (flow_id, item_type, item_id, iteration_scope, cycle_id, verdict, resolved_at,
                 tombstone, title, is_private, beads_id, beads_id_set, position)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(node_key) DO UPDATE SET
                verdict = excluded.verdict, resolved_at = excluded.resolved_at,
                tombstone = excluded.tombstone, title = excluded.title,
                is_private = excluded.is_private, beads_id = excluded.beads_id,
                beads_id_set = excluded.beads_id_set, position = excluded.position",
        )
        .bind(flow_id)
        .bind(key.item.item_type.as_str())
        .bind(key.item.item_id)
        .bind(key.iteration)
        .bind(key.cycle)
        .bind(&overlay.verdict)
        .bind(overlay.resolved_at)
        .bind(&overlay.tombstone)
        .bind(&overlay.title)
        .bind(overlay.is_private)
        .bind(&overlay.beads_id)
        .bind(overlay.beads_id_set)
        .bind(overlay.position)
        .execute(&mut *self.connection)
        .await?;
        Ok(())
    }

    /// Deletes every overlay and relation one Habit's occurrences carry — delete-and-regenerate.
    pub async fn clear_habit(&mut self, flow_id: i64) -> Result<(), sqlx::Error> {
        for table in [
            "task_overlays",
            "goal_overlays",
            "commitment_overlays",
            "derived_tags",
            "derived_block_reasons",
            "derived_dependencies",
        ] {
            sqlx::query(&format!("DELETE FROM {table} WHERE flow_id = ?"))
                .bind(flow_id)
                .execute(&mut *self.connection)
                .await?;
        }
        Ok(())
    }

    /// Deletes every overlay drawn from one template item — the item itself is going.
    pub async fn clear_item(&mut self, item_type: &str, item_id: i64) -> Result<(), sqlx::Error> {
        for table in ["task_overlays", "goal_overlays"] {
            sqlx::query(&format!(
                "DELETE FROM {table} WHERE item_type = ? AND item_id = ?"
            ))
            .bind(item_type)
            .bind(item_id)
            .execute(&mut *self.connection)
            .await?;
        }
        let prefix = format!("{item_type}:{item_id}:%");
        for (table, column) in [
            ("derived_tags", "node_key"),
            ("derived_block_reasons", "node_key"),
            ("derived_dependencies", "dependent_key"),
            ("derived_dependencies", "target_key"),
        ] {
            sqlx::query(&format!("DELETE FROM {table} WHERE {column} LIKE ?"))
                .bind(&prefix)
                .execute(&mut *self.connection)
                .await?;
        }
        Ok(())
    }
}
