//! Knowledge-base tools — the resources the snapshot does not carry.

use rmcp::{
    handler::server::wrapper::Parameters,
    model::{CallToolResult, ErrorData},
    tool, tool_router,
};

use super::{params::KbOperation, result, ArleshMcp};
use crate::knowledge_base::model::PersonId;

#[tool_router(router = kb_router, vis = "pub(super)")]
impl ArleshMcp {
    /// People, events and threads.
    ///
    /// These are absent from `arlesh_snapshot`, which carries only the planning graph, so this is
    /// the only way to reach them.
    #[tool(
        name = "arlesh_kb",
        annotations(title = "Arlesh knowledge base", read_only_hint = true)
    )]
    pub async fn kb(
        &self,
        Parameters(operation): Parameters<KbOperation>,
    ) -> Result<CallToolResult, ErrorData> {
        let mut db = match self.factory.connect().await {
            Ok(db) => db,
            Err(error) => return result::failed(error),
        };

        match operation {
            KbOperation::ListPeople => result::respond(db.people().list().await),
            KbOperation::GetPerson { id } => result::respond(db.people().get(PersonId(id)).await),
            KbOperation::ListEvents => result::respond(db.events().list().await),
            KbOperation::ListThreads => result::respond(db.threads().list().await),
        }
    }
}
