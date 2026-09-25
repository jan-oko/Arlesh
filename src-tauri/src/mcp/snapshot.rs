//! The whole-graph snapshot tool.

use rmcp::{
    handler::server::wrapper::Parameters,
    model::{CallToolResult, ErrorData},
    tool, tool_router,
};
use std::collections::HashSet;

use serde_json::{Map, Value};

use super::{
    access,
    ids::NodeNames,
    paging::{self, Cursor, Section, SectionItems, PAGE_BUDGET, SECTIONS},
    params::SnapshotOperation,
    result,
    result::attempt,
    ArleshMcp,
};
use crate::{access::model::NodeTable, mindmap::model::MindmapLoad, nodes::id::NodeId};

#[tool_router(router = snapshot_router, vis = "pub(super)")]
impl ArleshMcp {
    /// Arlesh's planning graph inside the MCP roots: domains, goals, tasks, commitments,
    /// expectations (waits), infos, flows and their items, dependencies, block reasons and each
    /// node's derived lifecycle. Start here.
    ///
    /// **Paged:** call again with `next_cursor` until it is null, passing the same `filter` and
    /// `agentic` each time; a section missing from a page is not reached yet, an empty one is `[]`.
    /// Narrow with `sections`. `now` is optional (a local date-time; default the current time).
    ///
    /// Every node carries `id` (a number, or a UUID for a derived row such as a Habit
    /// occurrence), `short_id` and `full_id`; any tool taking a node id takes any of them.
    /// `time_scope` and `plan` are scope keys with the dates inside (`{"kind":"week",
    /// "date":"2026-09-20"}`); `arlesh_scopes` resolves them further. `filter` applies a List View
    /// preset (`plan`, `start`, `do`, `backlog`, `all`); `agentic: {}` (or `{"max_priority":"A"}`)
    /// keeps only the Tasks that read as Agentic, most urgent first. Read-only.
    #[tool(
        name = "arlesh_snapshot",
        annotations(title = "Arlesh snapshot", read_only_hint = true)
    )]
    pub async fn snapshot(
        &self,
        Parameters(operation): Parameters<SnapshotOperation>,
    ) -> Result<CallToolResult, ErrorData> {
        let SnapshotOperation::Load {
            now,
            sections,
            cursor,
            filter,
            agentic,
        } = operation;

        let wanted = sections.unwrap_or_else(|| SECTIONS.to_vec());
        let Some(first) = Cursor::start(&wanted) else {
            return result::refused("`sections` was empty, so there is nothing to return");
        };
        let cursor = match cursor.as_deref().map(Cursor::parse).transpose() {
            Ok(parsed) => parsed.unwrap_or(first),
            Err(error) => return result::refused(error.to_string()),
        };

        // Transactional, matching `commands::mindmap::load_mindmap`, so that one page reads one
        // consistent board. It writes nothing; the commit only closes the transaction.
        //
        // Every page re-derives. Keeping a payload server-side between pages would buy a
        // consistent read at the cost of state to expire and grow; for one local user, seconds
        // apart, re-deriving is the better trade.
        let mut db = match self.factory.begin().await {
            Ok(db) => db,
            Err(error) => return result::failed(error),
        };
        let now = now.unwrap_or_else(|| self.now());

        let mut load = match crate::mindmap::load(&mut db, now).await {
            Ok(load) => load,
            Err(error) => return result::failed(error),
        };
        let map = attempt!(crate::access::access_map(&mut db).await);

        // Short ids are worked out over everything the MCP can see, before any filter or query
        // narrows it: a node goes by one short id however it is asked for.
        let names = {
            let mut whole = load.clone();
            access::restrict_snapshot(&mut whole, &map);
            NodeNames::of(&whole).with_subtypes(&load.domains)
        };

        // The presets are defined in `crate::filters`, and the frontend's own evaluator is held
        // to the same conformance corpus — so an agent asking "what should I start" and a user
        // looking at the board cannot quietly disagree about what is live.
        //
        // Narrowing before paging is what makes a filtered walk cheap: the budget is spent on
        // items the caller asked for rather than on ones it would have skipped.
        if let Some(filter) = &filter {
            crate::filters::facts::narrow(&mut load, filter);
        }

        // Access last, after the filter: the filter reads the whole board the way the user's own
        // view does — a Frozen Project above a root still drops its subtree — and the roots then
        // decide which of what survived the MCP may see. The other order would hand the filter
        // a forest whose rooted subtrees hang from parents it cannot find, and it drops those.
        access::restrict_snapshot(&mut load, &map);

        // After the roots, so a context row above a match is one the MCP could see anyway.
        let matched = match &agentic {
            Some(query) => {
                let candidates =
                    attempt!(super::agentic::agentic_tasks(&mut db, &map, &load, now).await);
                Some(super::agentic::narrow(
                    &mut load,
                    &candidates,
                    query.max_priority,
                ))
            }
            None => None,
        };

        if let Err(error) = db.commit().await {
            return result::failed(error);
        }

        // No answer can be produced at all if the payload will not serialize, so this is a
        // transport error rather than a tool result — the same call `result`'s own serialisation
        // failures make.
        let available =
            split_into_sections(&load, &wanted, &names, matched.as_ref()).map_err(|error| {
                ErrorData::internal_error(format!("failed to serialise tool result: {error}"), None)
            })?;

        let page = match paging::take_page(&available, cursor, PAGE_BUDGET) {
            Ok(page) => page,
            Err(error) => return result::refused(error.to_string()),
        };

        let mut body = Map::new();
        for (section, items) in page.sections {
            body.insert(section.as_str().to_string(), Value::Array(items));
        }
        body.insert(
            "next_cursor".to_string(),
            match page.next {
                Some(next) => Value::String(next.as_token()),
                None => Value::Null,
            },
        );

        result::ok(Value::Object(body))
    }
}

/// Re-reads the payload as the sections a page walks.
///
/// Going through `serde_json` rather than matching on fourteen differently-typed vectors keeps
/// this honest: the names and item shapes are whatever the payload itself serializes to, so they
/// cannot drift from what the unpaged response used to send.
fn split_into_sections(
    load: &MindmapLoad,
    wanted: &[Section],
    names: &NodeNames,
    matched: Option<&HashSet<NodeId>>,
) -> Result<Vec<SectionItems>, serde_json::Error> {
    let mut payload = match serde_json::to_value(load)? {
        Value::Object(payload) => payload,
        // `MindmapLoad` is a struct, so this is unreachable short of a serde attribute that
        // reshapes it — in which case every section name here is wrong too, and saying so beats
        // returning an empty page.
        other => {
            return Err(serde::ser::Error::custom(format!(
                "the snapshot payload serialized as {} rather than an object",
                match other {
                    Value::Array(_) => "an array",
                    Value::Null => "null",
                    _ => "a scalar",
                }
            )))
        }
    };

    Ok(wanted
        .iter()
        .map(|&section| SectionItems {
            section,
            items: match payload.remove(section.as_str()) {
                Some(Value::Array(mut items)) => {
                    if let Some(table) = node_table(section) {
                        for item in &mut items {
                            names.stamp(item, table);
                            if let (NodeTable::Task, Some(matched)) = (table, matched) {
                                mark_match(item, matched);
                            }
                        }
                    }
                    items
                }
                // A section the payload does not carry reads as empty rather than failing the
                // whole call: the drift is already caught at compile time by the test that pins
                // `SECTIONS` against the payload's own fields.
                _ => Vec::new(),
            },
        })
        .collect())
}

/// Marks a task row with whether it matched the agentic query or is there for context.
fn mark_match(item: &mut Value, matched: &HashSet<NodeId>) {
    let Value::Object(fields) = item else {
        return;
    };
    let matches = fields
        .get("id")
        .and_then(|id| serde_json::from_value::<NodeId>(id.clone()).ok())
        .is_some_and(|id| matched.contains(&id));
    fields.insert("reads_agentic".into(), Value::Bool(matches));
}

/// The table a section's nodes are rows of — or would be, for a derived row — when it lists nodes.
fn node_table(section: Section) -> Option<NodeTable> {
    Some(match section {
        Section::Domains => NodeTable::Domain,
        Section::Goals => NodeTable::Goal,
        Section::Tasks => NodeTable::Task,
        Section::Commitments => NodeTable::Commitment,
        Section::Expectations => NodeTable::Expectation,
        Section::Infos => NodeTable::Info,
        Section::Flows => NodeTable::Flow,
        Section::FlowGoals => NodeTable::FlowGoal,
        Section::FlowTasks => NodeTable::FlowTask,
        _ => return None,
    })
}
