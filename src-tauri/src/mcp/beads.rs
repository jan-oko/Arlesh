//! The issue-link tool — the only write on this server.
//!
//! A Task, Goal, Commitment or Project can carry the id of the `bd` issue that tracks it. Nothing else can set
//! it: no Tauri command writes the column and the UI renders it read-only, so an issue id in
//! Arlesh always arrived through here. That is the whole point of the field — it records a link an
//! agent established, and the app displays it without pretending the user maintains it.

use rmcp::{
    handler::server::wrapper::Parameters,
    model::{CallToolResult, ErrorData},
    tool, tool_router,
};

use super::{
    params::{BeadsLink, BeadsNode, BeadsOperation},
    result, ArleshMcp,
};
use crate::{
    domains::model::DomainId,
    tasks::model::{CommitmentId, GoalId, TaskId},
};

#[tool_router(router = beads_router, vis = "pub(super)")]
impl ArleshMcp {
    /// Links a Task, Goal, Commitment or Project to a `bd` issue, or clears the link with a
    /// null `beads_id`.
    ///
    /// The id is stored verbatim and never parsed or validated against a tracker — it is a label
    /// Arlesh displays, not a foreign key. Setting it on an item that does not exist is an error,
    /// not a silent no-op.
    ///
    /// This is the only operation on this server that writes anything the user entered.
    #[tool(
        name = "arlesh_beads",
        annotations(
            title = "Arlesh issue links",
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = true
        )
    )]
    pub async fn beads(
        &self,
        Parameters(operation): Parameters<BeadsOperation>,
    ) -> Result<CallToolResult, ErrorData> {
        let BeadsOperation::Set {
            node_type,
            node_id,
            beads_id,
        } = operation;

        let link = BeadsLink {
            node_type: match node_type {
                BeadsNode::Task => "task".into(),
                BeadsNode::Goal => "goal".into(),
                BeadsNode::Commitment => "commitment".into(),
                BeadsNode::Project => "project".into(),
            },
            node_id,
            beads_id: beads_id.clone(),
        };

        match node_type {
            // One UPDATE over one column, so a pooled session is enough — SQLite gives a single
            // statement atomicity on its own.
            BeadsNode::Task => {
                let mut db = match self.factory.connect().await {
                    Ok(db) => db,
                    Err(error) => return result::failed(error),
                };
                match db.tasks().set_beads_id(TaskId(node_id), beads_id).await {
                    Ok(()) => result::ok(link),
                    Err(error) => result::failed(error),
                }
            }
            BeadsNode::Goal => {
                let mut db = match self.factory.connect().await {
                    Ok(db) => db,
                    Err(error) => return result::failed(error),
                };
                match db.goals().set_beads_id(GoalId(node_id), beads_id).await {
                    Ok(()) => result::ok(link),
                    Err(error) => result::failed(error),
                }
            }
            BeadsNode::Commitment => {
                let mut db = match self.factory.connect().await {
                    Ok(db) => db,
                    Err(error) => return result::failed(error),
                };
                match db
                    .commitments()
                    .set_beads_id(CommitmentId(node_id), beads_id)
                    .await
                {
                    Ok(()) => result::ok(link),
                    Err(error) => result::failed(error),
                }
            }
            // A Project is the `project` subtype of Domain, and the operator's setter deliberately
            // does not check the subtype — no schema constraint backs the invariant, so it is
            // enforced here. Reading the row and then writing it is two statements, which per
            // ADR-0004 means a transactional session: without it another writer could retype the
            // domain between the check and the update.
            BeadsNode::Project => {
                let mut db = match self.factory.begin().await {
                    Ok(db) => db,
                    Err(error) => return result::failed(error),
                };

                let domain = match db.domains().get(DomainId(node_id)).await {
                    Ok(domain) => domain,
                    Err(error) => return result::failed(error),
                };
                // `Domain.subtype` is the stored lowercase string, compared as the rest of the
                // domain module compares it (`domains/mod.rs:134`).
                if domain.subtype != "project" {
                    return result::refused(format!(
                        "domain {node_id} has subtype \"{}\", not \"project\"; only Tasks, \
                         Goals and Projects can carry an issue link",
                        domain.subtype
                    ));
                }

                if let Err(error) = db
                    .domains()
                    .set_beads_id(DomainId(node_id), beads_id)
                    .await
                {
                    return result::failed(error);
                }
                if let Err(error) = db.commit().await {
                    return result::failed(error);
                }

                result::ok(link)
            }
        }
    }
}
