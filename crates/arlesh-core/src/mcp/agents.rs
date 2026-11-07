//! The agents tool: how a session becomes an Agent, and what that Agent does with its Claim.
//!
//! The only tool an unattached session may call, and then only `attach` (see
//! [`ArleshMcp::admit`](super::ArleshMcp)). Everything else it does is about itself: its Claim,
//! and the usage of its account.

use rmcp::{
    handler::server::wrapper::Parameters,
    model::{CallToolResult, ErrorData},
    tool, tool_router,
};
use serde::Serialize;

use super::{
    ids::{IdRefusal, NodeNames},
    lookup::Board,
    params::{AgentsOperation, NodeRef, UsageWindowParam},
    result::{self, attempt},
    session::Binding,
    ArleshMcp,
};
use crate::{
    access::model::{NodeKey, NodeTable},
    agents::{
        error::AgentError,
        model::{Agent, AgentAction, AgentId, AgentStanding, CapacityCause, UsageWindow},
        service::{self, AttachRequest, Credential},
    },
    database::session::{Db, Transactional},
    nodes::id::NodeId,
};

/// The name of the tool: the one an unattached session may call.
pub(super) const TOOL: &str = "arlesh_agents";

/// What `attach` and `status` answer.
#[derive(Debug, Serialize)]
struct Identity {
    agent: Agent,
    standing: AgentStanding,
    at_capacity: Option<CapacityCause>,
    /// The agent token, shown this once, when a PIN made the agent. Keep it: it lets the agent
    /// attach again after the server restarts or the session is resumed.
    #[serde(skip_serializing_if = "Option::is_none")]
    token: Option<String>,
}

/// What `attach` answers: the identity, and why the claim asked for in the same call was refused,
/// if it was.
#[derive(Debug, Serialize)]
struct Attachment {
    #[serde(flatten)]
    identity: Identity,
    #[serde(skip_serializing_if = "Option::is_none")]
    claim_refused: Option<String>,
}

impl ArleshMcp {
    /// The session's binding, when this handler serves sessions that must attach.
    fn binding(&self) -> Option<&Binding> {
        match &self.callers {
            super::Callers::Session(binding) => Some(binding),
            super::Callers::Anyone => None,
        }
    }

    /// The Agent this session is, or the refusal that says it must attach.
    fn attached(&self) -> Result<AgentId, Result<CallToolResult, ErrorData>> {
        self.binding()
            .and_then(Binding::agent)
            .ok_or_else(|| result::failed(AgentError::NotAttached))
    }

    /// The node a `subtree` parameter names, among those the user's MCP roots open.
    ///
    /// Resolved against the user's view, not the agent's own: an agent that has not claimed
    /// anything yet sees nothing, and is told which subtree to take by id. A refusal never lists
    /// candidates, so an ambiguous id does not describe nodes the agent has no right to see.
    async fn subtree_node(
        &self,
        db: &mut Db<Transactional>,
        subtree: &NodeRef,
    ) -> Result<NodeKey, Result<CallToolResult, ErrorData>> {
        let now = self.now();
        let user_map = crate::access::access_map(db)
            .await
            .map_err(result::failed)?;
        let board = Board::read_with(db, now, false, user_map)
            .await
            .map_err(result::failed)?;
        let table = NodeTable::from_reference(&subtree.node_type);
        let names: &NodeNames = &board.names;
        match names.resolve_as(&subtree.node_id.text(), table) {
            Ok(named) => match (&named.node_id, table) {
                (NodeId::Stored(row), Some(kind)) => Ok(NodeKey::new(kind, *row)),
                _ => Err(result::refused(
                    "only a stored node can be claimed, not a Habit occurrence",
                )),
            },
            Err(IdRefusal::Unknown) => Err(result::not_permitted(
                "no node inside the MCP roots has that id, so it cannot be claimed",
            )),
            Err(IdRefusal::Ambiguous(_)) => Err(result::refused(
                "that id matches more than one node: give a longer id",
            )),
            Err(IdRefusal::WrongKind(_)) => Err(result::refused(format!(
                "that id is not a {}",
                subtree.node_type
            ))),
        }
    }

    async fn identity(
        &self,
        db: &mut Db<Transactional>,
        id: AgentId,
        token: Option<String>,
    ) -> Result<Identity, AgentError> {
        let now = self.now();
        let overview = service::overview(db, now).await?;
        let summary = overview
            .agents
            .into_iter()
            .find(|summary| summary.agent.id == id)
            .ok_or(AgentError::NotAttached)?;
        Ok(Identity {
            agent: summary.agent,
            standing: summary.standing,
            at_capacity: summary.at_capacity,
            token,
        })
    }

    async fn attach(
        &self,
        session_id: String,
        pin: Option<String>,
        token: Option<String>,
        name: Option<String>,
        account: Option<String>,
        subtree: Option<NodeRef>,
    ) -> Result<CallToolResult, ErrorData> {
        let Some(binding) = self.binding() else {
            return result::refused("this endpoint serves no sessions to attach");
        };
        let credential = match (pin, token) {
            (Some(pin), None) => Credential::Pin(pin),
            (None, Some(token)) => Credential::Token(token),
            _ => return result::refused("give either `pin` or `token`, not both and not neither"),
        };
        let attached = attempt!(
            service::attach(
                &self.factory,
                self.now(),
                AttachRequest {
                    credential,
                    session_uuid: session_id,
                    name,
                    account,
                },
            )
            .await
        );
        let id = attached.agent.id;
        binding.bind(id);
        // The claim is a step of its own, once the session has proved itself: a caller that has
        // not learns nothing of the board from how its subtree fares. A claim that fails does not
        // lose the token this attach is the only chance to hand over, so it is told alongside.
        let claim_refused = match subtree {
            Some(subtree) => self.try_claim(id, &subtree).await,
            None => None,
        };
        (self.announce)(None);
        let mut db = attempt!(self.factory.begin().await);
        let identity = attempt!(self.identity(&mut db, id, attached.token).await);
        result::ok(Attachment {
            identity,
            claim_refused,
        })
    }

    async fn act(&self, action: AgentAction) -> Result<CallToolResult, ErrorData> {
        let id = match self.attached() {
            Ok(id) => id,
            Err(refusal) => return refusal,
        };
        let mut db = attempt!(self.factory.begin().await);
        attempt!(service::act(&mut db, id, action).await);
        let identity = attempt!(self.identity(&mut db, id, None).await);
        attempt!(db.commit().await);
        (self.announce)(None);
        result::ok(identity)
    }

    async fn claim(&self, subtree: NodeRef) -> Result<CallToolResult, ErrorData> {
        let id = match self.attached() {
            Ok(id) => id,
            Err(refusal) => return refusal,
        };
        let mut db = attempt!(self.factory.begin().await);
        let node = match self.subtree_node(&mut db, &subtree).await {
            Ok(node) => node,
            Err(refusal) => return refusal,
        };
        attempt!(service::claim(&mut db, id, node, self.now()).await);
        let identity = attempt!(self.identity(&mut db, id, None).await);
        attempt!(db.commit().await);
        (self.announce)(None);
        result::ok(identity)
    }

    /// Claims `subtree` for the newly attached `id`; the reason it was refused, if it was.
    async fn try_claim(&self, id: AgentId, subtree: &NodeRef) -> Option<String> {
        let mut db = self.factory.begin().await.ok()?;
        let refusal = match self.subtree_node(&mut db, subtree).await {
            Ok(node) => match service::claim(&mut db, id, node, self.now()).await {
                Ok(_) => {
                    return db.commit().await.err().map(|error| error.to_string());
                }
                Err(error) => error.to_string(),
            },
            Err(_) => "the subtree could not be found inside the MCP roots".to_owned(),
        };
        Some(refusal)
    }

    async fn report_usage(
        &self,
        windows: Vec<UsageWindowParam>,
    ) -> Result<CallToolResult, ErrorData> {
        let id = match self.attached() {
            Ok(id) => id,
            Err(refusal) => return refusal,
        };
        let windows: Vec<UsageWindow> = windows
            .into_iter()
            .map(|window| UsageWindow {
                kind: window.kind,
                percent_used: window.percent_used,
                resets_at: window.resets_at,
            })
            .collect();
        let mut db = attempt!(self.factory.begin().await);
        attempt!(service::report_usage(&mut db, id, &windows, self.now()).await);
        let identity = attempt!(self.identity(&mut db, id, None).await);
        attempt!(db.commit().await);
        (self.announce)(None);
        result::ok(identity)
    }
}

#[tool_router(router = agents_router, vis = "pub(super)")]
impl ArleshMcp {
    /// This session's identity. A session that has not attached can call only `attach`, and sees
    /// nothing of the board until it does.
    ///
    /// **Attach once per session**: get a one-time PIN from Settings → Agents in the desktop app
    /// (or from the app's loopback door), then `attach` with it, your session id, a `name`, your
    /// `account` label and the `subtree` you were asked to work. The answer holds your **agent
    /// token**: keep it, and attach with it (`token` instead of `pin`) after a server restart or a
    /// resumed session. Subagents share this connection and are covered by your attach.
    ///
    /// A **Claim** is a subtree and it is your whole view: you read and write only inside it, as
    /// if it were your own MCP root. Only one agent's active Claim may cover any node. `pause`
    /// lets another agent claim the subtree while you keep your token (you read, but write
    /// nothing); `resume` takes it back if nobody else has; `release` lets go. The Claim lasts
    /// until released. When your account's plan limit is used up your claimed Agentic tasks read
    /// blocked until it resets; `report_usage` tells the server how much is used.
    #[tool(
        name = "arlesh_agents",
        annotations(
            title = "Arlesh agent identity",
            read_only_hint = false,
            destructive_hint = false
        )
    )]
    pub async fn agents(
        &self,
        Parameters(operation): Parameters<AgentsOperation>,
    ) -> Result<CallToolResult, ErrorData> {
        match operation {
            AgentsOperation::Attach {
                session_id,
                pin,
                token,
                name,
                account,
                subtree,
            } => {
                self.attach(session_id, pin, token, name, account, subtree)
                    .await
            }
            AgentsOperation::Status => {
                let id = match self.attached() {
                    Ok(id) => id,
                    Err(refusal) => return refusal,
                };
                let mut db = attempt!(self.factory.begin().await);
                result::ok(attempt!(self.identity(&mut db, id, None).await))
            }
            AgentsOperation::Claim { subtree } => self.claim(subtree).await,
            AgentsOperation::Pause => self.act(AgentAction::Pause).await,
            AgentsOperation::Resume => self.act(AgentAction::Resume).await,
            AgentsOperation::Release => self.act(AgentAction::Release).await,
            AgentsOperation::ReportUsage { windows } => self.report_usage(windows).await,
        }
    }
}

#[cfg(test)]
mod tests;
