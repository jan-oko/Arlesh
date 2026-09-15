//! The Tauri command for retyping a node.
//!
//! Retyping used to happen in the frontend as an unbounded sequence of separate `invoke` calls —
//! create, reparent each child, delete — with no transaction around them and no accounting of
//! what the new kind could not hold. A failure part-way left two nodes or a split subtree, and a
//! success dropped the node's Time Scope, tags and block reasons without a word. This is that
//! sequence, moved behind one atomic call that says what it is about to lose first.

use tauri::State;

use crate::{
    database::session::SessionFactory,
    error::WireError,
    tasks::retype::{
        apply_retype, plan_node_retype, PlannedRetype, RetypeKind, RetypedNode, StrandedChildren,
    },
};

/// Retypes a node, atomically, refusing until the caller has acknowledged what would be lost.
///
/// `stranded_children` doubles as the acknowledgement: `None` means the caller has not been told
/// yet, and any retype that would lose a child or a field is refused with
/// [`NeedsConfirmation`](crate::error::WireErrorKind::NeedsConfirmation) and a `details` payload
/// naming every one of them. `Some(_)` is the caller saying it has seen that list and choosing
/// what happens to the children the new kind cannot hold.
///
/// The consent rule is **uniform**: a lost field prompts exactly as a lost child does. A
/// task→goal retype therefore always prompts when the task has a Plan, which is common — that
/// noise is deliberate, and the fallback if it is judged too high is an asymmetric rule (consent
/// for children, notification for fields) rather than a silent drop.
///
/// Both halves run on one transactional session, so the plan cannot go stale between being shown
/// to the caller and being carried out — and a failure anywhere leaves the tree exactly as it
/// was.
#[tauri::command]
pub async fn retype_node(
    factory: State<'_, SessionFactory>,
    node_type: String,
    node_id: i64,
    target_type: String,
    stranded_children: Option<StrandedChildren>,
) -> Result<RetypedNode, WireError> {
    let source_kind = parse_kind(&node_type)?;
    let target = parse_kind(&target_type)?;

    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    let planned = plan_node_retype(&mut db, source_kind, node_id, target)
        .await
        .map_err(WireError::from_error)?;

    let Some(stranded) = stranded_children else {
        if planned.plan.loses_anything() {
            return Err(refusal(&planned));
        }
        // Nothing at stake, so nothing to choose: the action is moot when no child is stranded.
        let node = apply_retype(&mut db, &planned, StrandedChildren::Reparent)
            .await
            .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)?;
        return Ok(node);
    };

    let node = apply_retype(&mut db, &planned, stranded)
        .await
        .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)?;
    Ok(node)
}

/// The refusal a retype with something at stake returns until the caller acknowledges it.
fn refusal(planned: &PlannedRetype) -> WireError {
    let plan = &planned.plan;
    WireError::needs_confirmation(
        format!(
            "retyping to {} would lose {} child(ren) and {} field(s)",
            plan.target.as_str(),
            plan.lost_children.len(),
            plan.lost_fields.len()
        ),
        plan.details(),
    )
}

/// Reads a kind off the wire, refusing the two child-only kinds by name rather than by silence.
fn parse_kind(value: &str) -> Result<RetypeKind, WireError> {
    RetypeKind::from_db(value)
        .ok_or_else(|| WireError::invalid_request(format!("{value} is not a retypeable kind")))
}
