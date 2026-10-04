//! When each finished item was finished — what a compound Habit occurrence's **done time** is the
//! latest of (`docs/spec/habits.md`, *Iteration resolution*).
//!
//! Every kind records its own instant: a Task its `done_at`, a Goal its `achieved_at`, a wait its
//! `released_at`, a Commitment its `verdict_at` (migration 0089), a check its `resolved_at`, and a
//! Habit occurrence its overlay's `resolved_at`. A row finished before its kind recorded one has
//! none, and is simply not among them: it still counts as finished, and adds no instant.

use std::collections::HashMap;

use chrono::NaiveDateTime;

use crate::{
    nodes::{
        id::NodeId,
        key::{CheckKey, DerivedKey, OccurrenceKey},
        overlay::HabitOverlays,
    },
    tasks::{
        error::TaskError,
        waits::{instant_from_column, WaitRef},
        TaskOperator,
    },
};

/// Each finished item's instant, by the id its row travels under.
pub type Instants = HashMap<NodeId, NaiveDateTime>;

/// An overlay's `resolved_at` — epoch milliseconds — as the UTC-naive instant every count from a
/// completion reads it as.
fn from_millis(at: i64) -> Option<NaiveDateTime> {
    chrono::DateTime::from_timestamp_millis(at).map(|at| at.naive_utc())
}

/// The instants one Habit's occurrences record in their overlays.
pub fn occurrence_instants(overlays: &HabitOverlays) -> Instants {
    let tasks = overlays
        .tasks
        .iter()
        .map(|(key, overlay)| (key, overlay.resolved_at));
    let goals = overlays
        .goals
        .iter()
        .map(|(key, overlay)| (key, overlay.resolved_at));
    // A Commitment item's verdict and a wait item's release are their occurrences' finish.
    let commitments = overlays
        .commitments
        .iter()
        .map(|(key, overlay)| (key, overlay.resolved_at));
    let waits = overlays.expectations.iter().map(|(key, overlay)| {
        let released = instant_from_column(overlay.released_at.clone())
            .map(|at| at.and_utc().timestamp_millis());
        (key, released)
    });
    tasks
        .chain(goals)
        .chain(commitments)
        .chain(waits)
        .filter_map(|(key, at)| {
            let id = NodeId::Derived(OccurrenceKey::parse(key)?.id());
            Some((id, from_millis(at?)?))
        })
        .collect()
}

/// A wait check as stored.
#[derive(sqlx::FromRow)]
struct CheckRow {
    wait_kind: String,
    wait_id: Option<i64>,
    wait_key: Option<String>,
    due_at: String,
    resolved_at: String,
}

impl CheckRow {
    /// The check task's id, and when it was made.
    fn instant(self) -> Option<(NodeId, NaiveDateTime)> {
        let wait = match (self.wait_kind.as_str(), self.wait_id, self.wait_key) {
            ("stored", Some(id), _) => WaitRef::Stored(id),
            ("spawned", Some(id), _) => WaitRef::Spawned(id),
            ("occurrence", _, Some(key)) => WaitRef::Occurrence(key),
            _ => return None,
        };
        let key = CheckKey {
            wait,
            due_at: instant_from_column(Some(self.due_at))?,
        };
        let id = DerivedKey::Check(key).node_id();
        Some((id, instant_from_column(Some(self.resolved_at))?))
    }
}

impl TaskOperator<'_> {
    /// Every stored row's completion instant, and every derived wait's and check's — each by the
    /// id its row travels under.
    pub async fn completion_instants(&mut self) -> Result<Instants, TaskError> {
        let mut instants = Instants::new();
        for (table, column, kind) in [
            ("tasks", "done_at", "task"),
            ("goals", "achieved_at", "goal"),
            ("commitments", "verdict_at", "commitment"),
            ("expectations", "released_at", "expectation"),
        ] {
            let rows: Vec<(i64, String)> = sqlx::query_as(&format!(
                "SELECT id, {column} FROM {table} WHERE {column} IS NOT NULL"
            ))
            .fetch_all(&mut *self.connection)
            .await?;
            tracing::debug!(kind, rows = rows.len(), "completion instants read");
            for (id, at) in rows {
                if let Some(at) = instant_from_column(Some(at)) {
                    instants.insert(NodeId::Stored(id), at);
                }
            }
        }
        let spawned: Vec<(i64, String)> = sqlx::query_as(
            "SELECT task_id, released_at FROM spawned_waits WHERE released_at IS NOT NULL",
        )
        .fetch_all(&mut *self.connection)
        .await?;
        for (task_id, at) in spawned {
            if let Some(at) = instant_from_column(Some(at)) {
                let wait = DerivedKey::SpawnedWait(NodeId::Stored(task_id));
                instants.insert(wait.node_id(), at);
            }
        }
        let occurrence_spawned: Vec<(String, String)> = sqlx::query_as(
            "SELECT node_key, released_at FROM occurrence_spawned_waits
             WHERE released_at IS NOT NULL",
        )
        .fetch_all(&mut *self.connection)
        .await?;
        for (node_key, at) in occurrence_spawned {
            let (Some(key), Some(at)) = (
                OccurrenceKey::parse(&node_key),
                instant_from_column(Some(at)),
            ) else {
                continue;
            };
            let wait = DerivedKey::SpawnedWait(NodeId::Derived(key.id()));
            instants.insert(wait.node_id(), at);
        }
        let checks: Vec<CheckRow> = sqlx::query_as(
            "SELECT wait_kind, wait_id, wait_key, due_at, resolved_at FROM wait_checks",
        )
        .fetch_all(&mut *self.connection)
        .await?;
        instants.extend(checks.into_iter().filter_map(CheckRow::instant));
        Ok(instants)
    }
}

#[cfg(test)]
mod tests;
