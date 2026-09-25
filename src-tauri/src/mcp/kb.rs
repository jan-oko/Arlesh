//! Knowledge-base tools — the resources the snapshot does not carry.

use rmcp::{
    handler::server::wrapper::Parameters,
    model::{CallToolResult, ErrorData},
    tool, tool_router,
};

use super::{access, lookup::plain_row, params::KbOperation, result, result::attempt, ArleshMcp};
use crate::{access::model::AccessLevel, knowledge_base::model::PersonId};

#[tool_router(router = kb_router, vis = "pub(super)")]
impl ArleshMcp {
    /// People, events and threads.
    ///
    /// These are absent from `arlesh_snapshot`, which carries only the planning graph, so this is
    /// the only way to reach them.
    ///
    /// People, events and threads hang on no node, so no MCP root contains them: one is here only when
    /// a task or goal the MCP can read is delegated to it or links it. `get_person` on anyone
    /// else is refused as `not_permitted`.
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

        let map = attempt!(crate::access::access_map(&mut db).await);
        let references = attempt!(db.access().knowledge_base_references().await);
        let visible = access::visible_knowledge_base(&references, &map);
        let sees = |entity: &str, id: i64| visible.contains(&(entity.to_string(), id));

        match operation {
            KbOperation::ListPeople => match db.people().list().await {
                Ok(mut people) => {
                    people.retain(|person| sees("person", person.id));
                    result::ok(people)
                }
                Err(error) => result::failed(error),
            },
            KbOperation::GetPerson { id } => {
                let Some(id) = plain_row(&id) else {
                    return result::refused(
                        "a person is named by their row id, a number; people have no short ids",
                    );
                };
                if !sees("person", id) {
                    return access::refuse("person", id, AccessLevel::Read);
                }
                result::respond(db.people().get(PersonId(id)).await)
            }
            KbOperation::ListEvents => match db.events().list().await {
                Ok(mut events) => {
                    events.retain(|event| sees("event", event.id));
                    result::ok(events)
                }
                Err(error) => result::failed(error),
            },
            KbOperation::ListThreads => match db.threads().list().await {
                Ok(mut threads) => {
                    threads.retain(|thread| sees("thread", thread.id));
                    result::ok(threads)
                }
                Err(error) => result::failed(error),
            },
        }
    }
}
