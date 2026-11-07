//! Who is calling, and what that caller may see: the seam between a handler and the Agents.
//!
//! In-process (`Callers::Anyone`) a call sees what the user's MCP roots open. Over a session
//! (`Callers::Session`) it sees only its Agent's Claim, and a session that has not attached is
//! turned away from every tool but the attach tool.

use chrono::NaiveDateTime;
use rmcp::model::{CallToolResult, ErrorData};

use super::{agents, lookup::Board, result, ArleshMcp, Callers};
use crate::{
    access::resolve::AccessMap,
    agents::{error::AgentError, service},
    capacity::blocks::Blocking,
    database::session::{Db, SessionMode, Transactional},
    error::AppError,
};

impl ArleshMcp {
    /// What the caller may see and write, as the board stands now.
    pub(super) async fn caller_map<M: SessionMode>(
        &self,
        db: &mut Db<M>,
    ) -> Result<AccessMap, AppError> {
        match &self.callers {
            Callers::Anyone => Ok(crate::access::access_map(db).await?),
            Callers::Session(binding) => {
                let id = binding.agent().ok_or(AgentError::NotAttached)?;
                let view = service::view(db, id).await?;
                Ok(view.ok_or(AgentError::NotAttached)?.map)
            }
        }
    }

    /// What the capacity blocks cover now: the global lock, and the Claims of agents at capacity.
    pub(super) async fn blocking<M: SessionMode>(
        &self,
        db: &mut Db<M>,
        now: NaiveDateTime,
    ) -> Result<Blocking, AppError> {
        let global = self.capacity.get().await.at_capacity;
        Ok(service::blocking(db, global, now).await?)
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
