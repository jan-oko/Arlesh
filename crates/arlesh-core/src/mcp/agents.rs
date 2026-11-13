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
use crate::capacity::blocks::Blocking;
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
    /// The claimed node's short id and title, so a client can draw what the agent is on.
    #[serde(skip_serializing_if = "Option::is_none")]
    claim_name: Option<String>,
    /// A child agent's sub-token, shown this once, by the `register_child` that made it.
    #[serde(skip_serializing_if = "Option::is_none")]
    sub_token: Option<String>,
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
        self.acting_agent()
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
        let board = Board::read_with(db, now, Blocking::default(), user_map)
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
            // One answer for every way an id can fail to name a node of that kind, so a claim
            // cannot be used to find out what exists, or how many, outside the agent's view.
            Err(IdRefusal::Unknown | IdRefusal::Ambiguous(_) | IdRefusal::WrongKind(_)) => {
                Err(result::not_permitted(format!(
                    "no {} inside the MCP roots has that id, so it cannot be claimed",
                    subtree.node_type
                )))
            }
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
        let claim_name = match &summary.agent.claim {
            Some(claim) => self.claim_name(db, claim.root).await,
            None => None,
        };
        Ok(Identity {
            agent: summary.agent,
            standing: summary.standing,
            at_capacity: summary.at_capacity,
            token,
            claim_name,
            sub_token: None,
        })
    }

    /// The short id and title of the claimed node `root`, read from the whole board the user's
    /// roots open: the Claim's root is the agent's own, whatever its view.
    async fn claim_name(&self, db: &mut Db<Transactional>, root: NodeKey) -> Option<String> {
        let user_map = crate::access::access_map(db).await.ok()?;
        let board = Board::read_with(db, self.now(), Blocking::default(), user_map)
            .await
            .ok()?;
        let short = board
            .names
            .short_id(root.node_kind, &NodeId::Stored(root.node_id))?;
        let title = db
            .access()
            .catalogue()
            .await
            .ok()?
            .into_iter()
            .find(|node| node.node_kind == root.node_kind && node.node_id == root.node_id)?
            .title;
        Some(format!("{short} {title}"))
    }

    async fn register_child(
        &self,
        name: String,
        client_id: String,
    ) -> Result<CallToolResult, ErrorData> {
        let parent = match self.attached() {
            Ok(id) => id,
            Err(refusal) => return refusal,
        };
        let mut db = attempt!(self.factory.begin().await);
        let (child, sub_token) =
            attempt!(service::register_child(&mut db, parent, &name, &client_id, self.now()).await);
        let mut identity = attempt!(self.identity(&mut db, child.id, None).await);
        attempt!(db.commit().await);
        identity.sub_token = sub_token;
        (self.announce)(None);
        result::ok(identity)
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
    /// resumed session.
    ///
    /// **Subagents** run over your connection. Register each one with `register_child` (its
    /// description as `name`, its id as `client_id`): the answer holds its **sub_token**. Hand it
    /// to the subagent, which passes `sub_token` on every Arlesh tool call and sees only its own
    /// **sub-Claim**. It takes one with `claim`: anything inside your Claim, replacing its own,
    /// and nowhere else. A call without `sub_token` runs as you, on your whole Claim. Register the
    /// same `client_id` again only if you lost the token: you get a new `sub_token` and the old one
    /// stops working. A child shares your account, cannot lock itself and cannot register
    /// children. It is paused while it is not running (a paused child reads, writes nothing, and
    /// you or the user resume it), and it is removed when its Task is set Done or you are removed.
    /// A removal because an agent set the Task Done cannot be undone with Ctrl+Z; if the Task is
    /// reopened and the subagent starts again, `register_child` makes a fresh child with a new
    /// `sub_token`. A child the user brings back with Ctrl+Z returns paused. A client with the
    /// arlesh-notify mod does all of this for its subagents.
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
            AgentsOperation::Attach { .. } if self.acting.is_some() => {
                result::refused("attach is not for a child agent: the session is attached already")
            }
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
            AgentsOperation::RegisterChild { .. } if self.acting.is_some() => {
                result::refused("a child agent cannot register children")
            }
            AgentsOperation::Lock | AgentsOperation::Unlock if self.acting.is_some() => {
                result::refused(
                    "a child agent's capacity follows its parent, so it cannot be locked",
                )
            }
            AgentsOperation::ReportUsage { .. } if self.acting.is_some() => {
                result::refused("a child agent's usage is its parent's account's")
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
            AgentsOperation::Lock => self.act(AgentAction::Lock { locked: true }).await,
            AgentsOperation::Unlock => self.act(AgentAction::Lock { locked: false }).await,
            AgentsOperation::ReportUsage { windows } => self.report_usage(windows).await,
            AgentsOperation::RegisterChild { name, client_id } => {
                self.register_child(name, client_id).await
            }
        }
    }
}

#[cfg(test)]
mod tests;
