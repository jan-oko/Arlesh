//! The whole-graph snapshot tool.

use rmcp::{
    handler::server::wrapper::Parameters,
    model::{CallToolResult, ErrorData},
    tool, tool_router,
};
use serde_json::{Map, Value};

use super::{
    paging::{self, Cursor, Section, SectionItems, PAGE_BUDGET, SECTIONS},
    params::SnapshotOperation,
    result, ArleshMcp,
};
use crate::mindmap::model::MindmapLoad;

#[tool_router(router = snapshot_router, vis = "pub(super)")]
impl ArleshMcp {
    /// Arlesh's planning graph: domains, goals, tasks, commitments, expectations, infos, flows, flow items,
    /// cycles, dependencies, block reasons, materialised instance nodes, each item's derived
    /// lifecycle, and each flow's habit iterations and statuses.
    ///
    /// Start here. Tasks, goals and commitments carry `time_scope` and `plan` as boundary scope
    /// IDs rather than dates — resolve them with `arlesh_scopes.resolve_many`.
    ///
    /// A commitment is a rule held over a window rather than a piece of work: it carries a
    /// `verdict` of `unresolved`/`kept`/`broken` that is recorded, never inferred. `unresolved`
    /// means the user has not said, and is not a synonym for "not done".
    ///
    /// An expectation is a wait rather than an action: something outside the user's own action
    /// that tasks can depend on. Its `status` is `pending` until the wait is over and `released`
    /// after; a task depending on a pending one is blocked. Its optional `check_every` (a Duration;
    /// its next check is in `expectation_checks`) is how often the user means to look in on it.
    /// A task's `async_template` makes it asynchronous; completing it spawns a wait, listed in
    /// `spawned_waits` by task. Read-only here.
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
    /// applies, so "what should I start" has one answer rather than two. Omit it for the whole
    /// board, private nodes included; `{"preset": "all"}` is the app's neutral filter instead, and
    /// hides those. Pass the **same** filter on every page of a walk: pages are derived
    /// independently, so changing it partway is no different from the board changing underfoot.
    ///
    /// Not read-only: deriving habit iterations materialises the scope rows their windows land on.
    /// It creates no tasks, goals or flows.
    #[tool(
        name = "arlesh_snapshot",
        annotations(
            title = "Arlesh snapshot",
            read_only_hint = false,
            destructive_hint = false
        )
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
        } = operation;

        let wanted = sections.unwrap_or_else(|| SECTIONS.to_vec());
        let Some(first) = Cursor::start(&wanted) else {
            return result::refused("`sections` was empty, so there is nothing to return");
        };
        let cursor = match cursor.as_deref().map(Cursor::parse).transpose() {
            Ok(parsed) => parsed.unwrap_or(first),
            Err(error) => return result::refused(error.to_string()),
        };

        // Transactional and committed, matching `commands::mindmap::load_mindmap`: without the
        // commit sqlx discards the derived scopes on drop and still returns a correct-looking
        // payload, whose habit iterations then name scope ids that no longer exist.
        //
        // Every page re-derives. Keeping a payload server-side between pages would buy a
        // consistent read at the cost of state to expire and grow; for one local user, seconds
        // apart, re-deriving is the better trade, and materialising a scope twice is a no-op.
        let mut db = match self.factory.begin().await {
            Ok(db) => db,
            Err(error) => return result::failed(error),
        };

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

        if let Err(error) = db.commit().await {
            return result::failed(error);
        }

        // No answer can be produced at all if the payload will not serialize, so this is a
        // transport error rather than a tool result — the same call `result`'s own serialisation
        // failures make.
        let available = split_into_sections(&load, &wanted).map_err(|error| {
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
                Some(Value::Array(items)) => items,
                // A section the payload does not carry reads as empty rather than failing the
                // whole call: the drift is already caught at compile time by the test that pins
                // `SECTIONS` against the payload's own fields.
                _ => Vec::new(),
            },
        })
        .collect())
}
