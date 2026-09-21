//! The one issue-link write the UI is allowed to make: clearing it.
//!
//! The MCP server stays the sole *source* of a beads id — the UI can neither author nor edit one,
//! because it has no way to produce a value `bd` issued. Clearing needs no such value, so SPEC
//! carves it out: an × on the Issue row unlinks a node from a closed, wrong or duplicated issue
//! without a round trip through an agent. Nothing is told to `bd`; the issue is untouched and only
//! this app's mirror of the link goes.
//!
//! Deliberately a command of its own rather than a field on `UpdateTaskRequest` and friends. The
//! update requests have no beads field and are not given one, which keeps the restriction legible
//! as "one setter, one clear" and keeps this write clear of the `Option<Option<T>>` shape an
//! update request needs to tell *absent* from *null*: there is no value to send, so there is
//! nothing for a `null` to be confused with.

use tauri::State;

use crate::{
    database::session::SessionFactory,
    domains::model::DomainId,
    error::WireError,
    tasks::model::{CommitmentId, GoalId, TaskId},
};

/// Clears the `bd` issue link on a Task, Goal, Commitment or Project.
///
/// `node_type` is `task`, `goal`, `commitment` or `project` — the same vocabulary the MCP tool
/// uses, because this is the same write with the value fixed at null. Any other kind is refused by
/// name rather than treated as a no-op: nothing else carries the column.
///
/// Clearing a node that has no link is not an error. The × that reaches this command is only
/// rendered where one is set, but a second click on a stale editor should read as "already gone",
/// not as a failure. An unknown *node* is still an error — the operator setters report a write
/// that landed nowhere rather than claiming success for it.
///
/// Transactional for every kind, including the three that are one statement over one column. The
/// Project case reads the row before writing it, and per ADR-0004 a check-then-write belongs on a
/// transactional session: without it another writer could retype the domain between the check and
/// the update. The write is left on the journal's ambient source, which is the user — this is a
/// gesture, and Ctrl+Z puts the link back.
#[tauri::command]
pub async fn clear_beads_id(
    factory: State<'_, SessionFactory>,
    node_type: String,
    node_id: i64,
) -> Result<(), WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    match node_type.as_str() {
        "task" => db
            .tasks()
            .set_beads_id(TaskId(node_id), None)
            .await
            .map_err(WireError::from_error)?,
        "goal" => db
            .goals()
            .set_beads_id(GoalId(node_id), None)
            .await
            .map_err(WireError::from_error)?,
        "commitment" => db
            .commitments()
            .set_beads_id(CommitmentId(node_id), None)
            .await
            .map_err(WireError::from_error)?,
        // A Project is the `project` subtype of Domain, and the operator's setter deliberately
        // does not check the subtype — no schema constraint backs the invariant, so it is enforced
        // here, exactly as the MCP tool enforces it on the way in.
        "project" => {
            let domain = db
                .domains()
                .get(DomainId(node_id))
                .await
                .map_err(WireError::from_error)?;
            if domain.subtype != "project" {
                return Err(WireError::invalid_request(format!(
                    "domain {node_id} has subtype \"{}\", not \"project\"; only Tasks, Goals, \
                     Commitments and Projects can carry an issue link",
                    domain.subtype
                )));
            }
            db.domains()
                .set_beads_id(DomainId(node_id), None)
                .await
                .map_err(WireError::from_error)?
        }
        other => {
            return Err(WireError::invalid_request(format!(
                "{other} is not a kind that can carry an issue link; only Tasks, Goals, \
                 Commitments and Projects can"
            )))
        }
    }
    db.commit().await.map_err(WireError::from_error)?;
    Ok(())
}
