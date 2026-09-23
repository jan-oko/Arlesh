//! Editing one virtual Habit occurrence on its own: its title, its block reason, its Plan, its
//! dependencies in that iteration, and deleting it from that iteration alone.
//!
//! Every edit is a **divergence** from the template, written to the overlay the instance model
//! was designed around — `habit_instance_modifications` for the per-occurrence fields,
//! `habit_instance_dependencies` for the per-iteration edges. The occurrence stays virtual
//! (ADR 0002). Each edit is written so that setting a field back to what the template says
//! clears it, and a Modification row that no longer diverges in anything is deleted, so storage
//! stays proportional to what actually differs.
//!
//! The pure half — what a stored text means, which edges an iteration ends up with, whether a
//! set of edges is circular — is free of the database and tested on its own.

use std::collections::{BTreeSet, HashMap, HashSet};

use crate::database::session::{Db, Transactional};

use super::error::FlowError;
use super::model::{
    DependencyDivergence, FlowCycleInput, FlowDependency, FlowId, FlowItemCycle, FlowItemRef,
    FlowItemType, HabitInstanceRef, PlanOverride, UpdateFlowRequest, NO_CYCLE,
};
use super::{FlowOperator, InstanceKey};

/// Everything one occurrence diverges by on its Modification row, apart from its status.
///
/// The default is an occurrence nobody touched.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct OccurrenceOverlay {
    /// Its own title, when it has one.
    pub title: Option<String>,
    /// Its block reason, when it has one.
    pub blocked_reason: Option<String>,
    /// Whether it was deleted from its iteration.
    pub deleted: bool,
    /// Its own Plan, or [`PlanOverride::Inherit`].
    pub plan: PlanOverride,
}

/// One overlay row as read: the key's four fields, then title, block reason, tombstone, and the
/// three plan columns.
type OverlayRow = (
    String,
    i64,
    i64,
    i64,
    Option<String>,
    Option<String>,
    Option<String>,
    bool,
    Option<i64>,
    Option<i64>,
);

/// The tombstone an occurrence deleted on its own carries.
const DELETED: &str = "deleted";

/// A text a user typed for an occurrence, as it is stored: trimmed, and `None` when it is empty
/// or says exactly what the template already says — so typing the template's own title back
/// clears the divergence instead of recording a copy of it.
pub fn stored_text(value: Option<String>, template: Option<&str>) -> Option<String> {
    let trimmed = value?.trim().to_string();
    if trimmed.is_empty() || Some(trimmed.as_str()) == template {
        return None;
    }
    Some(trimmed)
}

/// The template's dependency edges, as `(dependent, blocker)` item pairs.
fn template_edges(template: &[FlowDependency]) -> Vec<(FlowItemRef, FlowItemRef)> {
    template
        .iter()
        .map(|edge| {
            (
                FlowItemRef {
                    item_type: edge.dependent_type.clone(),
                    item_id: edge.dependent_id,
                },
                FlowItemRef {
                    item_type: edge.depends_on_type.clone(),
                    item_id: edge.depends_on_id,
                },
            )
        })
        .collect()
}

/// Every edge one iteration ends up with: the template's, minus the ones that iteration removed,
/// plus the ones it added. Sorted and without repeats.
pub fn iteration_edges(
    template: &[FlowDependency],
    divergences: &[DependencyDivergence],
    iteration_scope_id: i64,
) -> Vec<(FlowItemRef, FlowItemRef)> {
    let mut edges: BTreeSet<(FlowItemRef, FlowItemRef)> =
        template_edges(template).into_iter().collect();
    for divergence in divergences
        .iter()
        .filter(|divergence| divergence.iteration_scope_id == iteration_scope_id)
    {
        let edge = (
            FlowItemRef {
                item_type: divergence.dependent_type.clone(),
                item_id: divergence.dependent_id,
            },
            FlowItemRef {
                item_type: divergence.depends_on_type.clone(),
                item_id: divergence.depends_on_id,
            },
        );
        if divergence.added {
            edges.insert(edge);
        } else {
            edges.remove(&edge);
        }
    }
    edges.into_iter().collect()
}

/// What `dependent` waits on in one iteration.
pub fn effective_dependencies(
    template: &[FlowDependency],
    divergences: &[DependencyDivergence],
    iteration_scope_id: i64,
    dependent: &FlowItemRef,
) -> Vec<FlowItemRef> {
    iteration_edges(template, divergences, iteration_scope_id)
        .into_iter()
        .filter(|(waiting, _)| waiting == dependent)
        .map(|(_, blocker)| blocker)
        .collect()
}

/// The divergence rows that make `dependent` wait on exactly `desired` in one iteration, given
/// what the template has it wait on: a template blocker left out is removed (`false`), a blocker
/// the template lacks is added (`true`). Wanting exactly the template's set needs no rows at all.
pub fn divergence_rows(
    template_blockers: &[FlowItemRef],
    desired: &[FlowItemRef],
) -> Vec<(FlowItemRef, bool)> {
    let template: BTreeSet<&FlowItemRef> = template_blockers.iter().collect();
    let wanted: BTreeSet<&FlowItemRef> = desired.iter().collect();
    let removed = template
        .difference(&wanted)
        .map(|blocker| ((*blocker).clone(), false));
    let added = wanted
        .difference(&template)
        .map(|blocker| ((*blocker).clone(), true));
    removed.chain(added).collect()
}

/// Whether a set of `(dependent, blocker)` edges contains a cycle.
pub fn is_circular(edges: &[(FlowItemRef, FlowItemRef)]) -> bool {
    let mut next: HashMap<&FlowItemRef, Vec<&FlowItemRef>> = HashMap::new();
    for (dependent, blocker) in edges {
        next.entry(dependent).or_default().push(blocker);
    }
    let mut finished: HashSet<&FlowItemRef> = HashSet::new();
    for start in next.keys() {
        let mut on_path: HashSet<&FlowItemRef> = HashSet::new();
        if reaches_itself(start, &next, &mut on_path, &mut finished) {
            return true;
        }
    }
    false
}

/// Depth-first walk for [`is_circular`]: `true` when a node on the current path is met again.
fn reaches_itself<'edge>(
    node: &'edge FlowItemRef,
    next: &HashMap<&'edge FlowItemRef, Vec<&'edge FlowItemRef>>,
    on_path: &mut HashSet<&'edge FlowItemRef>,
    finished: &mut HashSet<&'edge FlowItemRef>,
) -> bool {
    if on_path.contains(node) {
        return true;
    }
    if !finished.insert(node) {
        return false;
    }
    on_path.insert(node);
    let circular = next
        .get(node)
        .into_iter()
        .flatten()
        .any(|blocker| reaches_itself(blocker, next, on_path, finished));
    on_path.remove(node);
    circular
}

/// A kept pair: the stored pair's id, and the index of the asked-for pair it becomes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KeptPair {
    /// The stored pair's id, which survives.
    pub id: i64,
    /// Its index in the asked-for list, which is also its new position.
    pub position: usize,
}

/// How an item's stored cycle pairs become the asked-for ones.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CycleDiff {
    /// Pairs that survive, keeping their ids.
    pub kept: Vec<KeptPair>,
    /// Indices, in the asked-for list, of pairs that are new.
    pub added: Vec<usize>,
    /// Ids of stored pairs that go.
    pub removed: Vec<i64>,
}

/// Matches asked-for cycle pairs to stored ones by **Cycle Scope**: a pair whose `(scope_kind,
/// scope_index)` is still asked for survives, whatever became of its Cycle Plan, because it still
/// draws the same occurrence in the same window. Repeated scopes match in order. A pair whose
/// Cycle Scope moved is a different occurrence — it is removed and a new one added — since an
/// edit recorded against the old window would not belong to the new one.
pub fn diff_cycles(existing: &[FlowItemCycle], wanted: &[FlowCycleInput]) -> CycleDiff {
    let mut unmatched: Vec<&FlowItemCycle> = existing.iter().collect();
    let mut diff = CycleDiff::default();
    for (position, pair) in wanted.iter().enumerate() {
        let found = unmatched.iter().position(|stored| {
            stored.scope_kind == pair.scope_kind && stored.scope_index == pair.scope_index
        });
        match found {
            Some(index) => {
                let stored = unmatched.remove(index);
                diff.kept.push(KeptPair {
                    id: stored.id,
                    position,
                });
            }
            None => diff.added.push(position),
        }
    }
    diff.removed = unmatched.iter().map(|stored| stored.id).collect();
    diff
}

/// The occurrence keys (`cycle_id`s) a cycle edit leaves behind: every removed pair's, and the
/// no-pair sentinel's when an item that had no pairs is given some — its occurrences stop being
/// drawn by [`NO_CYCLE`]. An item losing all its pairs orphans those pairs, which are removed.
pub fn orphaned_cycle_ids(
    existing: &[FlowItemCycle],
    wanted: &[FlowCycleInput],
    diff: &CycleDiff,
) -> Vec<i64> {
    let mut orphaned = diff.removed.clone();
    if existing.is_empty() && !wanted.is_empty() {
        orphaned.push(NO_CYCLE);
    }
    orphaned
}

/// What a cycle edit that would orphan recorded edits does instead of losing them — the Habit
/// editor's own two answers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Reconcile {
    /// Archive & new: the edit lands on a fork of the Habit, and the original keeps its history.
    Fork,
    /// Discard & regenerate: the Habit's recorded edits are cleared, and the edit lands on it.
    Discard,
}

/// The fork an "Archive & new" item edit landed on: the new flow, and old→new item ids, so the
/// rest of the save (title, dependencies) can be applied to the fork's copy of the item.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct ForkedTemplate {
    /// The fork's flow id.
    pub flow_id: i64,
    /// Old→new `flow_goals` ids.
    pub goals: Vec<(i64, i64)>,
    /// Old→new `flow_tasks` ids.
    pub tasks: Vec<(i64, i64)>,
}

/// How many iterations hold recorded edits a cycle edit would orphan: a Modification row (a
/// status, an own title, block reason, Plan or tombstone) or an added child keyed on one of the
/// occurrence keys the edit leaves behind. Zero means the edit is safe to make as it stands.
pub async fn orphaned_edits(
    db: &mut Db<Transactional>,
    item_type: FlowItemType,
    item_id: i64,
    cycles: &[FlowCycleInput],
) -> Result<i64, FlowError> {
    let existing = db.flows().item_cycles(item_type, item_id).await?;
    let diff = diff_cycles(&existing, cycles);
    let orphaned = orphaned_cycle_ids(&existing, cycles, &diff);
    if orphaned.is_empty() {
        return Ok(0);
    }
    db.flows()
        .iterations_keyed_on(item_type, item_id, &orphaned)
        .await
}

/// Saves an item's cycle pairs, answering a would-be orphaning with `reconcile` when the caller
/// has asked the question. `None` writes as asked — the caller checks [`orphaned_edits`] first.
///
/// - **Discard** clears the Habit's recorded edits, exactly as the Habit editor's
///   delete-and-regenerate does, then saves.
/// - **Fork** forks the Habit exactly as the Habit editor's "Archive & new" does — the template,
///   with none of the history — and carries over what the item editor does not restate: the
///   Recurrence and privacy. The pairs are saved on the fork's copy of the item, and the
///   old→new ids are returned so the rest of the save lands there too.
#[tracing::instrument(skip(db))]
pub async fn set_item_cycles(
    db: &mut Db<Transactional>,
    flow_id: FlowId,
    item_type: FlowItemType,
    item_id: i64,
    cycles: &[FlowCycleInput],
    reconcile: Option<Reconcile>,
) -> Result<Option<ForkedTemplate>, FlowError> {
    match reconcile {
        None => {
            db.flows()
                .set_cycles(flow_id.0, item_type, item_id, cycles)
                .await?;
            Ok(None)
        }
        Some(Reconcile::Discard) => {
            db.flows().clear_habit_modifications(flow_id).await?;
            db.flows()
                .set_cycles(flow_id.0, item_type, item_id, cycles)
                .await?;
            Ok(None)
        }
        Some(Reconcile::Fork) => fork_and_set_cycles(db, flow_id, item_type, item_id, cycles)
            .await
            .map(Some),
    }
}

/// The "Archive & new" half of [`set_item_cycles`].
async fn fork_and_set_cycles(
    db: &mut Db<Transactional>,
    flow_id: FlowId,
    item_type: FlowItemType,
    item_id: i64,
    cycles: &[FlowCycleInput],
) -> Result<ForkedTemplate, FlowError> {
    let source = db.flows().get(flow_id).await?;
    let clone = db.flows().clone_template(flow_id, None).await?;
    let fork = FlowId(clone.flow.id);
    db.flows().copy_recurrence(flow_id, fork).await?;
    for (old, new) in &clone.goals {
        db.flows()
            .copy_item_privacy(FlowItemType::FlowGoal, *old, *new)
            .await?;
    }
    for (old, new) in &clone.tasks {
        db.flows()
            .copy_item_privacy(FlowItemType::FlowTask, *old, *new)
            .await?;
    }
    if source.is_private {
        db.flows()
            .update(
                fork,
                UpdateFlowRequest {
                    is_private: Some(true),
                    ..Default::default()
                },
            )
            .await?;
    }
    let ids = match item_type {
        FlowItemType::FlowGoal => &clone.goals,
        FlowItemType::FlowTask => &clone.tasks,
    };
    let forked_item = *ids.get(&item_id).ok_or_else(|| {
        FlowError::Invalid("the item is not part of the habit it was edited in".to_string())
    })?;
    db.flows()
        .set_cycles(fork.0, item_type, forked_item, cycles)
        .await?;
    let mut goals: Vec<(i64, i64)> = clone.goals.into_iter().collect();
    let mut tasks: Vec<(i64, i64)> = clone.tasks.into_iter().collect();
    goals.sort_unstable();
    tasks.sort_unstable();
    Ok(ForkedTemplate {
        flow_id: fork.0,
        goals,
        tasks,
    })
}

/// Which text column of the overlay an edit writes.
#[derive(Debug, Clone, Copy)]
enum OverlayText {
    /// The occurrence's own title.
    Title,
    /// The occurrence's block reason.
    BlockedReason,
}

impl FlowOperator<'_> {
    /// Every touched occurrence of this Habit, keyed as its Modification row is. An occurrence
    /// missing from the map diverges in nothing but, perhaps, its status.
    pub async fn occurrence_overlays(
        &mut self,
        flow_id: FlowId,
    ) -> Result<HashMap<InstanceKey, OccurrenceOverlay>, FlowError> {
        let rows: Vec<OverlayRow> = sqlx::query_as(
            "SELECT item_type, item_id, iteration_scope_id, cycle_id, title, blocked_reason,
                    tombstone_kind, plan_overridden, plan_start_id, plan_end_id
             FROM habit_instance_modifications WHERE flow_id = ?",
        )
        .bind(flow_id.0)
        .fetch_all(&mut *self.connection)
        .await?;
        Ok(rows
            .into_iter()
            .map(
                |(
                    item_type,
                    item_id,
                    scope,
                    cycle,
                    title,
                    reason,
                    tombstone,
                    overridden,
                    start,
                    end,
                )| {
                    (
                        (item_type, item_id, scope, cycle),
                        OccurrenceOverlay {
                            title,
                            blocked_reason: reason,
                            deleted: tombstone.as_deref() == Some(DELETED),
                            plan: PlanOverride::from_columns(overridden, start, end),
                        },
                    )
                },
            )
            .collect())
    }

    /// Every per-iteration dependency divergence of this Habit.
    pub async fn dependency_divergences(
        &mut self,
        flow_id: FlowId,
    ) -> Result<Vec<DependencyDivergence>, FlowError> {
        Ok(sqlx::query_as::<_, DependencyDivergence>(
            "SELECT iteration_scope_id, dependent_type, dependent_id, depends_on_type,
                    depends_on_id, added
             FROM habit_instance_dependencies WHERE flow_id = ?",
        )
        .bind(flow_id.0)
        .fetch_all(&mut *self.connection)
        .await?)
    }

    /// The template's dependency edges within one flow.
    pub async fn flow_dependencies(
        &mut self,
        flow_id: FlowId,
    ) -> Result<Vec<FlowDependency>, FlowError> {
        Ok(
            sqlx::query_as::<_, FlowDependency>(
                "SELECT * FROM flow_dependencies WHERE flow_id = ?",
            )
            .bind(flow_id.0)
            .fetch_all(&mut *self.connection)
            .await?,
        )
    }

    /// Writes one text field of an occurrence's overlay, or clears it with `None`.
    async fn set_overlay_text(
        &mut self,
        flow_id: FlowId,
        instance: &HabitInstanceRef,
        field: OverlayText,
        value: Option<&str>,
    ) -> Result<(), FlowError> {
        let sql = match field {
            OverlayText::Title => {
                "INSERT INTO habit_instance_modifications
                    (flow_id, item_type, item_id, iteration_scope_id, cycle_id, title)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON CONFLICT(item_type, item_id, iteration_scope_id, cycle_id)
                 DO UPDATE SET title = excluded.title"
            }
            OverlayText::BlockedReason => {
                "INSERT INTO habit_instance_modifications
                    (flow_id, item_type, item_id, iteration_scope_id, cycle_id, blocked_reason)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON CONFLICT(item_type, item_id, iteration_scope_id, cycle_id)
                 DO UPDATE SET blocked_reason = excluded.blocked_reason"
            }
        };
        sqlx::query(sql)
            .bind(flow_id.0)
            .bind(&instance.item_type)
            .bind(instance.item_id)
            .bind(instance.iteration_scope_id)
            .bind(instance.cycle_id)
            .bind(value)
            .execute(&mut *self.connection)
            .await?;
        self.prune_empty_modifications(flow_id).await
    }

    /// Deletes an occurrence from its iteration (a tombstone), or restores it.
    async fn set_tombstone(
        &mut self,
        flow_id: FlowId,
        instance: &HabitInstanceRef,
        deleted: bool,
    ) -> Result<(), FlowError> {
        sqlx::query(
            "INSERT INTO habit_instance_modifications
                (flow_id, item_type, item_id, iteration_scope_id, cycle_id, tombstone_kind)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(item_type, item_id, iteration_scope_id, cycle_id)
             DO UPDATE SET tombstone_kind = excluded.tombstone_kind",
        )
        .bind(flow_id.0)
        .bind(&instance.item_type)
        .bind(instance.item_id)
        .bind(instance.iteration_scope_id)
        .bind(instance.cycle_id)
        .bind(deleted.then_some(DELETED))
        .execute(&mut *self.connection)
        .await?;
        self.prune_empty_modifications(flow_id).await
    }

    /// Replaces one dependent's divergence rows in one iteration with `rows`.
    async fn replace_dependency_divergences(
        &mut self,
        flow_id: FlowId,
        iteration_scope_id: i64,
        dependent: &FlowItemRef,
        rows: &[(FlowItemRef, bool)],
    ) -> Result<(), FlowError> {
        sqlx::query(
            "DELETE FROM habit_instance_dependencies
             WHERE flow_id = ? AND iteration_scope_id = ? AND dependent_type = ? AND dependent_id = ?",
        )
        .bind(flow_id.0)
        .bind(iteration_scope_id)
        .bind(&dependent.item_type)
        .bind(dependent.item_id)
        .execute(&mut *self.connection)
        .await?;
        for (blocker, added) in rows {
            sqlx::query(
                "INSERT INTO habit_instance_dependencies
                    (flow_id, iteration_scope_id, dependent_type, dependent_id,
                     depends_on_type, depends_on_id, added)
                 VALUES (?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(flow_id.0)
            .bind(iteration_scope_id)
            .bind(&dependent.item_type)
            .bind(dependent.item_id)
            .bind(&blocker.item_type)
            .bind(blocker.item_id)
            .bind(added)
            .execute(&mut *self.connection)
            .await?;
        }
        Ok(())
    }

    /// How many distinct iterations hold a Modification row or an added child on one of an
    /// item's occurrences drawn by `cycle_ids`.
    async fn iterations_keyed_on(
        &mut self,
        item_type: FlowItemType,
        item_id: i64,
        cycle_ids: &[i64],
    ) -> Result<i64, FlowError> {
        let placeholders = vec!["?"; cycle_ids.len()].join(", ");
        let sql = format!(
            "SELECT COUNT(*) FROM (
                 SELECT iteration_scope_id FROM habit_instance_modifications
                 WHERE item_type = ? AND item_id = ? AND cycle_id IN ({placeholders})
                 UNION
                 SELECT iteration_scope_id FROM habit_instance_children
                 WHERE item_type = ? AND item_id = ? AND cycle_id IN ({placeholders})
             )"
        );
        let mut query = sqlx::query_scalar::<_, i64>(&sql)
            .bind(item_type.as_str())
            .bind(item_id);
        for id in cycle_ids {
            query = query.bind(*id);
        }
        query = query.bind(item_type.as_str()).bind(item_id);
        for id in cycle_ids {
            query = query.bind(*id);
        }
        Ok(query.fetch_one(&mut *self.connection).await?)
    }

    /// The deleted occurrences of one iteration, as `(item_type, item_id, cycle_id)`.
    pub(super) async fn deleted_in_iteration(
        &mut self,
        flow_id: FlowId,
        iteration_scope_id: i64,
    ) -> Result<HashSet<(String, i64, i64)>, FlowError> {
        let rows: Vec<(String, i64, i64)> = sqlx::query_as(
            "SELECT item_type, item_id, cycle_id FROM habit_instance_modifications
             WHERE flow_id = ? AND iteration_scope_id = ? AND tombstone_kind = 'deleted'",
        )
        .bind(flow_id.0)
        .bind(iteration_scope_id)
        .fetch_all(&mut *self.connection)
        .await?;
        Ok(rows.into_iter().collect())
    }

    /// How many occurrences each iteration of this Habit has had deleted, by iteration scope.
    pub(super) async fn deleted_per_iteration(
        &mut self,
        flow_id: FlowId,
    ) -> Result<HashMap<i64, usize>, FlowError> {
        let rows: Vec<(i64, i64)> = sqlx::query_as(
            "SELECT iteration_scope_id, COUNT(*) FROM habit_instance_modifications
             WHERE flow_id = ? AND tombstone_kind = 'deleted' GROUP BY iteration_scope_id",
        )
        .bind(flow_id.0)
        .fetch_all(&mut *self.connection)
        .await?;
        Ok(rows
            .into_iter()
            .map(|(scope, count)| (scope, usize::try_from(count).unwrap_or(0)))
            .collect())
    }

    /// The template's title for one flow item.
    async fn item_title(&mut self, item: FlowItemType, item_id: i64) -> Result<String, FlowError> {
        let sql = match item {
            FlowItemType::FlowGoal => "SELECT title FROM flow_goals WHERE id = ?",
            FlowItemType::FlowTask => "SELECT title FROM flow_tasks WHERE id = ?",
        };
        sqlx::query_scalar(sql)
            .bind(item_id)
            .fetch_optional(&mut *self.connection)
            .await?
            .ok_or_else(|| FlowError::Invalid(format!("no {} {item_id}", item.as_str())))
    }

    /// Whether a flow item has items nested under it in the template.
    async fn has_child_items(&mut self, item: &FlowItemRef) -> Result<bool, FlowError> {
        let count: i64 = sqlx::query_scalar(
            "SELECT (SELECT COUNT(*) FROM flow_goals WHERE parent_type = ?1 AND parent_id = ?2)
                  + (SELECT COUNT(*) FROM flow_tasks WHERE parent_type = ?1 AND parent_id = ?2)",
        )
        .bind(&item.item_type)
        .bind(item.item_id)
        .fetch_one(&mut *self.connection)
        .await?;
        Ok(count > 0)
    }
}

/// The flow-item table an `item_type` names. The root's `flow_root` sentinel is not one: its title
/// is derived from the iteration, and deleting it would be deleting the iteration.
fn item_kind(item_type: &str) -> Result<FlowItemType, FlowError> {
    match item_type {
        "flow_task" => Ok(FlowItemType::FlowTask),
        "flow_goal" => Ok(FlowItemType::FlowGoal),
        other => Err(FlowError::Invalid(format!(
            "only a flow item's occurrence is edited on its own — not a {other}"
        ))),
    }
}

/// Checks that `instance` names an occurrence of one of this Habit's **items** — not the root —
/// and returns which kind of item. The iteration root is refused: its title is derived from the
/// iteration, and deleting it would be deleting the iteration.
pub(super) async fn item_occurrence(
    db: &mut Db<Transactional>,
    flow_id: FlowId,
    instance: &HabitInstanceRef,
) -> Result<FlowItemType, FlowError> {
    let kind = item_kind(&instance.item_type)?;
    if db.flows().item_flow_id(kind, instance.item_id).await? != flow_id.0 {
        return Err(FlowError::Invalid(
            "that occurrence belongs to another flow".to_string(),
        ));
    }
    if instance.cycle_id != NO_CYCLE {
        let pair = db.flows().cycle(instance.cycle_id).await?;
        let drawn_by_item = pair.is_some_and(|pair| {
            pair.item_type == instance.item_type && pair.item_id == instance.item_id
        });
        if !drawn_by_item {
            return Err(FlowError::Invalid(
                "that cycle pair does not draw this occurrence".to_string(),
            ));
        }
    }
    if db.flows().get_recurrence(flow_id).await?.is_none() {
        return Err(FlowError::Invalid("flow is not a habit".to_string()));
    }
    Ok(kind)
}

/// Gives one occurrence its own title, or hands it back to the flow item's with `None`. A title
/// that is empty, or the same as the template's, clears the divergence.
#[tracing::instrument(skip(db))]
pub async fn set_instance_title(
    db: &mut Db<Transactional>,
    flow_id: FlowId,
    instance: &HabitInstanceRef,
    title: Option<String>,
) -> Result<(), FlowError> {
    let kind = item_occurrence(db, flow_id, instance).await?;
    let template = db.flows().item_title(kind, instance.item_id).await?;
    let stored = stored_text(title, Some(&template));
    db.flows()
        .set_overlay_text(flow_id, instance, OverlayText::Title, stored.as_deref())
        .await
}

/// Gives one occurrence a block reason, or clears it with `None` (or an empty one).
#[tracing::instrument(skip(db))]
pub async fn set_instance_block_reason(
    db: &mut Db<Transactional>,
    flow_id: FlowId,
    instance: &HabitInstanceRef,
    reason: Option<String>,
) -> Result<(), FlowError> {
    item_occurrence(db, flow_id, instance).await?;
    let stored = stored_text(reason, None);
    db.flows()
        .set_overlay_text(
            flow_id,
            instance,
            OverlayText::BlockedReason,
            stored.as_deref(),
        )
        .await
}

/// Deletes one occurrence from its iteration alone, or restores it.
///
/// An occurrence that holds something is refused, by name, rather than taking what it holds with
/// it: an added child hung on it, or — for the occurrence its template children nest under, the
/// item's first — the occurrences of those child items. Delete those first. A deleted occurrence
/// no longer counts towards its iteration's resolution, and nothing is taken from the template.
#[tracing::instrument(skip(db))]
pub async fn set_instance_deleted(
    db: &mut Db<Transactional>,
    flow_id: FlowId,
    instance: &HabitInstanceRef,
    deleted: bool,
) -> Result<(), FlowError> {
    item_occurrence(db, flow_id, instance).await?;
    if deleted {
        refuse_if_holding(db, flow_id, instance).await?;
    }
    db.flows().set_tombstone(flow_id, instance, deleted).await
}

/// Refuses deleting an occurrence that still holds something.
async fn refuse_if_holding(
    db: &mut Db<Transactional>,
    flow_id: FlowId,
    instance: &HabitInstanceRef,
) -> Result<(), FlowError> {
    let holds_added_child = db
        .flows()
        .list_instance_children(flow_id)
        .await?
        .iter()
        .any(|child| {
            child.item_type == instance.item_type
                && child.item_id == instance.item_id
                && child.iteration_scope_id == instance.iteration_scope_id
                && child.cycle_id == instance.cycle_id
        });
    if holds_added_child {
        return Err(FlowError::Invalid(
            "this occurrence still holds something added to it — delete that first".to_string(),
        ));
    }
    let item = FlowItemRef {
        item_type: instance.item_type.clone(),
        item_id: instance.item_id,
    };
    if is_first_occurrence(db, flow_id, instance).await?
        && db.flows().has_child_items(&item).await?
    {
        return Err(FlowError::Invalid(
            "this occurrence holds the occurrences of the steps nested under it — delete those \
             first"
                .to_string(),
        ));
    }
    Ok(())
}

/// Whether `instance` is the occurrence its item's template children nest under: the one drawn
/// by the item's first cycle pair, or the only one when it has none.
async fn is_first_occurrence(
    db: &mut Db<Transactional>,
    flow_id: FlowId,
    instance: &HabitInstanceRef,
) -> Result<bool, FlowError> {
    let cycles = db.flows().cycles_by_item(flow_id).await?;
    let first = cycles
        .get(&(instance.item_type.clone(), instance.item_id))
        .and_then(|pairs| pairs.first())
        .map_or(NO_CYCLE, |pair| pair.id);
    Ok(first == instance.cycle_id)
}

/// Sets what one task occurrence waits on in its iteration: `depends_on` is the whole set it
/// should end up with, and the template's own set clears every divergence.
///
/// A dependency is an item's, not one occurrence's — the overlay keys it by iteration and item —
/// so it applies to every occurrence of the item in that iteration, exactly as a template edge
/// fans in. Only a task waits, as everywhere else; a blocker is any other item of the same flow;
/// and a set that would make the iteration's graph circular is refused, as a circular dependency
/// is refused everywhere.
#[tracing::instrument(skip(db))]
pub async fn set_instance_dependencies(
    db: &mut Db<Transactional>,
    flow_id: FlowId,
    instance: &HabitInstanceRef,
    depends_on: Vec<FlowItemRef>,
) -> Result<(), FlowError> {
    if item_occurrence(db, flow_id, instance).await? != FlowItemType::FlowTask {
        return Err(FlowError::Invalid(
            "only a task waits on something — a goal occurrence has no dependencies".to_string(),
        ));
    }
    let dependent = FlowItemRef {
        item_type: instance.item_type.clone(),
        item_id: instance.item_id,
    };
    for blocker in &depends_on {
        let kind = item_kind(&blocker.item_type)?;
        if *blocker == dependent
            || db.flows().item_flow_id(kind, blocker.item_id).await? != flow_id.0
        {
            return Err(FlowError::Invalid(
                "an occurrence waits only on another item of its own habit".to_string(),
            ));
        }
    }
    let template = db.flows().flow_dependencies(flow_id).await?;
    let template_blockers: Vec<FlowItemRef> = template_edges(&template)
        .into_iter()
        .filter(|(waiting, _)| *waiting == dependent)
        .map(|(_, blocker)| blocker)
        .collect();
    let rows = divergence_rows(&template_blockers, &depends_on);

    let scope = instance.iteration_scope_id;
    let mut divergences: Vec<DependencyDivergence> = db
        .flows()
        .dependency_divergences(flow_id)
        .await?
        .into_iter()
        .filter(|divergence| {
            !(divergence.iteration_scope_id == scope
                && divergence.dependent_type == dependent.item_type
                && divergence.dependent_id == dependent.item_id)
        })
        .collect();
    divergences.extend(rows.iter().map(|(blocker, added)| DependencyDivergence {
        iteration_scope_id: scope,
        dependent_type: dependent.item_type.clone(),
        dependent_id: dependent.item_id,
        depends_on_type: blocker.item_type.clone(),
        depends_on_id: blocker.item_id,
        added: *added,
    }));
    if is_circular(&iteration_edges(&template, &divergences, scope)) {
        return Err(FlowError::Invalid(
            "circular dependency: that would make this iteration wait on itself".to_string(),
        ));
    }
    db.flows()
        .replace_dependency_divergences(flow_id, scope, &dependent, &rows)
        .await
}

#[cfg(test)]
mod tests;
