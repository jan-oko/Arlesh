//! The old-to-new map migration 0107 reads: which UUID each integer row id becomes.
//!
//! Stored identity moved from `INTEGER PRIMARY KEY` to a UUID (ADR 0017, decision 9). An existing
//! row keeps the id it has always been shown under: its `full_id`, the UUID-v5 of `{kind}:{row id}`.
//! SQLite has no SHA-1 and a function registered from Rust would make the database unreadable to any
//! other client, so the hash is computed here, once, before the migration runs, and left in two
//! scratch tables the migration reads and then drops:
//!
//! * `uuid_map (kind, old_id, new_id)`: one row per stored row.
//! * `key_map (old_key, new_key)`: every node key that spells a row id inside it, rewritten. A Habit
//!   occurrence's key is `flow_task:12:{scope}:3`; its id is the hash of that text, so it moves with
//!   the ids inside it (the one id this migration does change).
//!
//! Both tables are written only when the database still holds the integer schema; on any other
//! database [`prepare`] does nothing.

use std::collections::HashMap;

use arlesh_rules::nodes::id::{uuid_v5, NODE_NAMESPACE};

use super::DatabasePool;

/// The nil UUID, the id of "no cycle pair" where a node key once held `0`.
pub const NO_CYCLE_ID: &str = "00000000-0000-0000-0000-000000000000";

/// The tables whose `id` becomes a UUID, with the kind their rows hash under. A node table's kind
/// is `NodeTable::as_str`, so an existing row's new id is its `full_id`.
const KINDS: [(&str, &str); 31] = [
    ("domains", "domain"),
    ("people", "person"),
    ("threads", "thread"),
    ("events", "event"),
    ("tasks", "task"),
    ("goals", "goal"),
    ("commitments", "commitment"),
    ("expectations", "expectation"),
    ("infos", "info"),
    ("flows", "flow"),
    ("flow_goals", "flow_goal"),
    ("flow_tasks", "flow_task"),
    ("flow_commitments", "flow_commitment"),
    ("flow_expectations", "flow_expectation"),
    ("flow_instances", "flow_instance"),
    ("flow_instance_nodes", "flow_instance_node"),
    ("block_reasons", "block_reason"),
    ("goal_overlays", "goal_overlay"),
    ("derived_tags", "derived_tag"),
    ("derived_block_reasons", "derived_block_reason"),
    ("derived_dependencies", "derived_dependency"),
    ("template_block_reasons", "template_block_reason"),
    ("wait_checks", "wait_check"),
    ("mcp_roots", "mcp_root"),
    ("template_agentic_briefs", "template_agentic_brief"),
    ("task_overlays", "task_overlay"),
    ("flow_item_cycles", "flow_item_cycle"),
    ("flow_dependencies", "flow_dependency"),
    ("template_tags", "template_tag"),
    ("commitment_overlays", "commitment_overlay"),
    ("derived_children", "derived_child"),
];

/// Every column that holds a node key, with the table it is in.
const KEY_COLUMNS: [(&str, &str); 15] = [
    ("goal_overlays", "node_key"),
    ("task_overlays", "node_key"),
    ("task_overlays", "wait_key"),
    ("commitment_overlays", "node_key"),
    ("expectation_overlays", "node_key"),
    ("expectation_overlays", "occurrence_key"),
    ("derived_tags", "node_key"),
    ("derived_block_reasons", "node_key"),
    ("derived_children", "parent_key"),
    ("derived_dependencies", "dependent_key"),
    ("derived_dependencies", "target_key"),
    ("occurrence_async_templates", "node_key"),
    ("tags_on_occurrence_async_templates", "node_key"),
    ("occurrence_spawned_waits", "node_key"),
    ("wait_checks", "wait_key"),
];

/// The UUID an existing row of `kind` and integer id `old` becomes.
pub fn new_id(kind: &str, old: i64) -> String {
    uuid_v5(&NODE_NAMESPACE, &format!("{kind}:{old}"))
}

/// The old ids' new spellings, as keys need them.
#[derive(Default)]
pub struct IdMap {
    rows: HashMap<(String, i64), String>,
    derived: HashMap<String, String>,
}

impl IdMap {
    /// Records that the row of `kind` with integer id `old` becomes `new`.
    pub fn insert(&mut self, kind: &str, old: i64, new: String) {
        self.rows.insert((kind.to_string(), old), new);
    }

    fn row(&self, kind: &str, old: &str) -> Option<String> {
        let old: i64 = old.parse().ok()?;
        self.rows.get(&(kind.to_string(), old)).cloned()
    }

    fn cycle(&self, old: &str) -> Option<String> {
        if old == "0" {
            return Some(NO_CYCLE_ID.to_string());
        }
        self.row("flow_item_cycle", old)
    }
}

/// The kind an occurrence's `item_id` hashes under.
fn item_kind(item_type: &str) -> Option<&'static str> {
    match item_type {
        "flow_root" => Some("flow"),
        "flow_goal" => Some("flow_goal"),
        "flow_task" => Some("flow_task"),
        "flow_commitment" => Some("flow_commitment"),
        "flow_expectation" => Some("flow_expectation"),
        _ => None,
    }
}

/// An occurrence key, `flow_task:12:{scope}:3`, spelled with UUIDs. `None` when it is not one.
fn rewrite_occurrence(key: &str, ids: &IdMap) -> Option<String> {
    let mut front = key.splitn(3, ':');
    let item_type = front.next()?;
    let item = ids.row(item_kind(item_type)?, front.next()?)?;
    let (scope, cycle) = front.next()?.rsplit_once(':')?;
    let cycle = ids.cycle(cycle)?;
    Some(format!("{item_type}:{item}:{scope}:{cycle}"))
}

/// A wait's spelling, `stored:5`, `spawned:5` or `occurrence:{key}`, with UUIDs.
fn rewrite_wait(spelling: &str, ids: &IdMap) -> Option<String> {
    let (kind, rest) = spelling.split_once(':')?;
    match kind {
        "stored" => Some(format!("stored:{}", ids.row("expectation", rest)?)),
        "spawned" => Some(format!("spawned:{}", ids.row("task", rest)?)),
        "occurrence" => Some(format!("occurrence:{}", rewrite_key(rest, ids)?)),
        _ => None,
    }
}

/// A row named by a derived key: a stored Task's integer id, or a derived node's UUID.
fn rewrite_reference(reference: &str, ids: &IdMap) -> Option<String> {
    match reference.parse::<i64>() {
        Ok(_) => ids.row("task", reference),
        Err(_) => ids.derived.get(reference).cloned(),
    }
}

/// Any node key spelled with integer ids, or a wait's spelling, rewritten with UUIDs. `None` when
/// `key` holds no row id to rewrite (or names one the map does not know).
pub fn rewrite_key(key: &str, ids: &IdMap) -> Option<String> {
    if let Some(rest) = key.strip_prefix("check:") {
        let (wait, due_at) = rest.rsplit_once('@')?;
        return Some(format!("check:{}@{due_at}", rewrite_wait(wait, ids)?));
    }
    if let Some(rest) = key.strip_prefix("spawned_wait:") {
        return Some(format!("spawned_wait:{}", rewrite_reference(rest, ids)?));
    }
    if let Some(rest) = key.strip_prefix("delegation_wait:") {
        return Some(format!("delegation_wait:{}", rewrite_reference(rest, ids)?));
    }
    rewrite_wait(key, ids).or_else(|| rewrite_occurrence(key, ids))
}

/// Rewrites every key in `keys`, returning each old spelling with its new one.
///
/// Occurrence and check keys name only stored rows, so they go first. The derived nodes they make
/// have the hash of the old text for an id, which a `spawned_wait:` or `delegation_wait:` key may
/// hold in place of a Task's integer; the passes after learn those, until nothing new is found.
pub fn rewrite_keys(keys: &[String], ids: &mut IdMap) -> Vec<(String, String)> {
    let mut done: HashMap<String, String> = HashMap::new();
    loop {
        let before = done.len();
        for key in keys {
            if done.contains_key(key) {
                continue;
            }
            if let Some(new) = rewrite_key(key, ids) {
                ids.derived
                    .insert(uuid_v5(&NODE_NAMESPACE, key), uuid_v5(&NODE_NAMESPACE, &new));
                done.insert(key.clone(), new);
            }
        }
        if done.len() == before {
            break;
        }
    }
    let mut pairs: Vec<(String, String)> = done.into_iter().collect();
    pairs.sort();
    pairs
}

/// Whether `pool` still holds the integer schema, so migration 0107 has yet to run.
async fn holds_integer_ids(pool: &DatabasePool) -> Result<bool, sqlx::Error> {
    let declared: Option<String> =
        sqlx::query_scalar("SELECT type FROM pragma_table_info('tasks') WHERE name = 'id'")
            .fetch_optional(pool)
            .await?;
    Ok(declared.is_some_and(|declared| declared.eq_ignore_ascii_case("INTEGER")))
}

/// Fills `uuid_map` and `key_map` for migration 0107, when the database has yet to run it.
pub(super) async fn prepare(pool: &DatabasePool) -> Result<(), sqlx::Error> {
    if !holds_integer_ids(pool).await? {
        return Ok(());
    }
    let mut transaction = pool.begin().await?;
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS uuid_map (kind TEXT NOT NULL, old_id INTEGER NOT NULL, \
         new_id TEXT NOT NULL, PRIMARY KEY (kind, old_id)) WITHOUT ROWID",
    )
    .execute(&mut *transaction)
    .await?;
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS key_map (old_key TEXT PRIMARY KEY NOT NULL, \
         new_key TEXT NOT NULL) WITHOUT ROWID",
    )
    .execute(&mut *transaction)
    .await?;
    sqlx::query("DELETE FROM uuid_map")
        .execute(&mut *transaction)
        .await?;
    sqlx::query("DELETE FROM key_map")
        .execute(&mut *transaction)
        .await?;

    let mut ids = IdMap::default();
    for (table, kind) in KINDS {
        let rows: Vec<i64> = sqlx::query_scalar(&format!("SELECT id FROM {table}"))
            .fetch_all(&mut *transaction)
            .await?;
        for old in rows {
            let new = new_id(kind, old);
            sqlx::query("INSERT INTO uuid_map (kind, old_id, new_id) VALUES (?, ?, ?)")
                .bind(kind)
                .bind(old)
                .bind(&new)
                .execute(&mut *transaction)
                .await?;
            ids.insert(kind, old, new);
        }
    }

    let mut keys: Vec<String> = Vec::new();
    for (table, column) in KEY_COLUMNS {
        let found: Vec<Option<String>> =
            sqlx::query_scalar(&format!("SELECT DISTINCT {column} FROM {table}"))
                .fetch_all(&mut *transaction)
                .await?;
        keys.extend(found.into_iter().flatten());
    }
    keys.sort();
    keys.dedup();
    for (old, new) in rewrite_keys(&keys, &mut ids) {
        sqlx::query("INSERT INTO key_map (old_key, new_key) VALUES (?, ?)")
            .bind(old)
            .bind(new)
            .execute(&mut *transaction)
            .await?;
    }
    transaction.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests;
