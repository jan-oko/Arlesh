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
    /// Arlesh's planning graph: domains, goals, tasks, commitments, expectations, infos, flows, flow items,
    /// cycles, dependencies, block reasons, materialised instance nodes, each item's derived
    /// lifecycle, and each Habit's derivation outcome.
    ///
    /// A Habit's occurrences are ordinary rows of their kinds, in `tasks`, `goals` and
    /// `commitments`: every node carries an `origin`, `{"kind": "manual"}` for a stored one and
    /// `{"kind": "habit", "habit_id": …, "iteration_scope": …}` for a Habit's, whose `id` is then a
    /// UUID string rather than a number. Its `parent_id` may be one too — a node hung on an
    /// occurrence names the occurrence as its parent.
    ///
    /// Start here. Tasks, goals and commitments carry `time_scope` and `plan` as boundary scope
    /// ids, and a scope id is its value key, a JSON object — `{"kind":"week","date":"2026-09-20"}`
    /// is the week whose Sunday is the 20th, `{"kind":"day","date":"2026-09-23"}`,
    /// `{"kind":"part_of_day","date":"2026-09-23","part":"morning"}`,
    /// `{"kind":"exact","start":"2026-09-23T14:00:00","end":"2026-09-23T15:30:00"}` — so the dates
    /// are right there. A Habit occurrence's `origin.iteration_scope.scope_id` is one too.
    /// `arlesh_scopes` adds labels, end dates and datetime windows if you need them.
    ///
    /// A commitment is a rule held over a window rather than a piece of work: it carries a
    /// `verdict` of `unresolved`/`kept`/`broken` that is recorded, never inferred. `unresolved`
    /// means the user has not said, and is not a synonym for "not done".
    ///
    /// An expectation is a wait rather than an action: something outside the user's own action
    /// that tasks can depend on. Its `status` is `pending` until the wait is over and `released`
    /// after; a task depending on a pending one is blocked. Its optional `check_every` (a Duration)
    /// is how often the user means to look in on it: each check is a task beneath it, `origin`
    /// `{"kind": "check", ...}`, done once made. An `asynchronous` task may carry an
    /// `async_template`; while such a task is done, the wait it spawned is an expectation beneath
    /// it with `origin` `{"kind": "spawned_wait", "task_id": N}`, and a delegated task that is not
    /// done has one with `{"kind": "delegation_wait", ...}`. Read-only here.
    ///
    /// A task's `delegate_to` says who holds it: `null`, `{"kind": "person", "id": N}` (resolve
    /// the Person with `arlesh_kb`), or `{"kind": "agent"}` — handed to the Agent. It is
    /// independent of `agentic`, which says only that the work suits an agent.
    ///
    /// **Paged.** A board of any size outgrows one tool result, so a response carries as much as
    /// fits and a `next_cursor`. Pass that cursor back for the next page, and keep going until it
    /// is null. Items are never split across pages, so nothing has to be reassembled — but a
    /// section missing from a page is one you have not reached yet, which is why an empty section
    /// is sent as `[]` rather than left out. Narrow with `sections` when you know what you need.
    ///
    /// **Filterable.** `filter` reads the board under one of the List View's status presets —
    /// `all`, `plan`, `start`, `do` or `backlog` — using the same rules the user's own view
    /// applies, so "what should I start" has one answer rather than two. Omit it for everything
    /// you can see, unfiltered; `{"preset": "all"}` is the app's neutral filter instead. Pass the
    /// **same** filter on every page of a walk: pages are derived
    /// independently, so changing it partway is no different from the board changing underfoot.
    ///
    /// **Short ids.** Every node carries a `short_id` beside its `id`: the shortest prefix, 3 hex
    /// digits or more, of its full id that no other node you can see shares right now. Any tool
    /// taking a node id takes it (or any longer prefix, or the full id) as well as a row id. One
    /// you saw earlier can become ambiguous as nodes are added; it is then refused as
    /// `ambiguous_id` with the candidates listed, never read as the wrong node.
    ///
    /// **Agentic.** `agentic` narrows the board to the Tasks that read as Agentic — `{}` for all,
    /// `{"max_priority": "A"}` for MW and A — with the rows above them for context and their waits and
    /// notes, most urgent first; each task row then carries `reads_agentic`. Its brief is on the
    /// row as `agentic_brief`.
    ///
    /// **Rooted.** Only the subtrees the user made MCP roots are here — the server's instructions
    /// name them. Nodes outside every root, and private nodes anywhere, are left out together
    /// with every entry that names them.
    ///
    /// Read-only: it writes nothing.
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
        let map = attempt!(crate::access::access_map(&mut db).await);
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
        let names = NodeNames::of(&load);
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
                            name_item(item, table, names);
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

/// Adds a node's `short_id` beside its `id`.
fn name_item(item: &mut Value, table: NodeTable, names: &NodeNames) {
    let Value::Object(fields) = item else {
        return;
    };
    let Some(id) = fields
        .get("id")
        .and_then(|id| serde_json::from_value::<NodeId>(id.clone()).ok())
    else {
        return;
    };
    if let Some(short) = names.short_id(table, &id) {
        fields.insert("short_id".into(), Value::String(short.to_string()));
    }
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
