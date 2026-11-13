//! Who is calling, and what that caller may see: the seam between a handler and the Agents.
//!
//! In-process (`Callers::Anyone`) a call sees what the user's MCP roots open. Over a session
//! (`Callers::Session`) it sees only its Agent's Claim, and a session that has not attached is
//! turned away from every tool but the attach tool.

use chrono::NaiveDateTime;
use rmcp::model::{CallToolResult, ErrorData};

use super::{agents, lookup::Board, result, ArleshMcp, Callers};
use crate::{
    access::{
        model::{NodeKey, NodeTable},
        resolve::AccessMap,
    },
    agents::{
        error::AgentError,
        model::{AgentId, AgentStanding},
        rules::refusals,
        service,
    },
    capacity::blocks::Blocking,
    database::session::{Db, SessionMode, Transactional},
    error::AppError,
    nodes::id::NodeId,
};

impl ArleshMcp {
    /// What the caller may see and write, as the board stands now.
    pub(super) async fn caller_map<M: SessionMode>(
        &self,
        db: &mut Db<M>,
    ) -> Result<AccessMap, AppError> {
        match &self.callers {
            Callers::Anyone => Ok(crate::access::access_map(db).await?),
            Callers::Session(_) => {
                let id = self.acting_agent().ok_or(AgentError::NotAttached)?;
                let view = service::view(db, id).await?;
                Ok(view.ok_or(AgentError::NotAttached)?.map)
            }
        }
    }

    /// The Agent this call runs as: the child its `sub_token` named, else the session's own.
    pub(super) fn acting_agent(&self) -> Option<AgentId> {
        self.acting.or_else(|| match &self.callers {
            Callers::Session(binding) => binding.agent(),
            Callers::Anyone => None,
        })
    }

    /// A handler that runs one call as the child of this session's Agent whose sub-token is
    /// `token`, or the refusal that ends the call.
    pub(super) async fn as_child(
        &self,
        token: &str,
    ) -> Result<Self, Result<CallToolResult, ErrorData>> {
        let Callers::Session(binding) = &self.callers else {
            return Err(result::refused("sub_token needs an attached MCP session"));
        };
        let parent = binding
            .agent()
            .ok_or_else(|| result::failed(AgentError::NotAttached))?;
        let mut db = self.factory.begin().await.map_err(result::failed)?;
        let child = service::child_for_sub_token(&mut db, parent, token)
            .await
            .map_err(result::failed)?;
        Ok(Self {
            acting: Some(child),
            ..self.clone()
        })
    }

    /// A child agent's refusal, worded for the child: the generic "not inside the MCP roots" hides
    /// two causes a child can act on, a paused Claim and a node outside its sub-Claim that lies
    /// inside its parent's. Every other answer, and every other caller's, passes through. A node
    /// outside the parent's Claim keeps the generic words, so nothing new is revealed.
    pub(super) async fn explain_to_child(
        &self,
        response: rmcp::model::CallToolResponse,
    ) -> rmcp::model::CallToolResponse {
        use rmcp::model::CallToolResponse::Complete;
        let (Some(child), Complete(result)) = (self.acting, &response) else {
            return response;
        };
        match self.worded_for(child, result).await {
            Some(reworded) => Complete(reworded),
            None => response,
        }
    }

    async fn worded_for(&self, child: AgentId, result: &CallToolResult) -> Option<CallToolResult> {
        if result.is_error != Some(true) {
            return None;
        }
        let mut body = result.structured_content.clone()?;
        if body.get("kind")? != "not_permitted" {
            return None;
        }
        let message = body.get("message")?.as_str()?.to_owned();
        let named = refusals::named_node(&message)?;
        let mut db = self.factory.begin().await.ok()?;
        let view = service::view(&mut db, child).await.ok()??;
        let said = if view.standing == AgentStanding::Paused && refusals::is_write_refusal(&message)
        {
            refusals::paused(&message)
        } else if view.standing == AgentStanding::Active {
            let parent = service::view(&mut db, view.agent.parent_id?).await.ok()??;
            let board =
                Board::read_with(&mut db, self.now(), Blocking::default(), parent.map.clone())
                    .await
                    .ok()?;
            let table = named.node_type.and_then(NodeTable::from_reference);
            let found = board.names.resolve_as(named.id, table).ok()?;
            let NodeId::Stored(row) = found.node_id else {
                return None;
            };
            if !parent.map.can_read(NodeKey::new(found.table, row)) {
                return None;
            }
            refusals::outside_claim(&named)
        } else {
            return None;
        };
        body["message"] = serde_json::Value::String(said);
        Some(CallToolResult::structured_error(body))
    }

    /// What the capacity blocks cover now: the Claims of agents at capacity.
    pub(super) async fn blocking<M: SessionMode>(
        &self,
        db: &mut Db<M>,
        now: NaiveDateTime,
    ) -> Result<Blocking, AppError> {
        Ok(service::blocking(db, now).await?)
    }

    /// The board as the caller sees it, blocked as the user's own board is.
    pub(super) async fn board(
        &self,
        db: &mut Db<Transactional>,
        now: NaiveDateTime,
    ) -> Result<Board, AppError> {
        let blocking = self.blocking(db, now).await?;
        let map = self.caller_map(db).await?;
        Board::read_with(db, now, blocking, map).await
    }

    /// The refusal that turns an unattached session away from `tool`, or `None` to let the call
    /// through. The attach tool is open to everyone: it decides for itself what each operation
    /// needs.
    pub(super) fn admit(&self, tool: &str) -> Option<Result<CallToolResult, ErrorData>> {
        match &self.callers {
            Callers::Anyone => None,
            // An unknown tool is the router's own protocol error, as for any caller: the names of
            // the tools are public.
            Callers::Session(binding) => (tool != agents::TOOL
                && self.tool_router.has_route(tool)
                && binding.agent().is_none())
            .then(|| result::failed(AgentError::NotAttached)),
        }
    }
}
