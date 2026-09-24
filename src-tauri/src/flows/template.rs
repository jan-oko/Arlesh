//! What a template row says about the rows it draws, beyond its title and its place.
//!
//! A template carries its kind's full schema (ADR 0008, decision 5; migration 0061): a flow task
//! item — and the root of a task-instance flow, which is the flow row — the columns a Task has, a
//! flow goal item and any other root a beads id; and every template its tags and block reasons.
//! A Habit's occurrence reads each of these from its template until its own overlay says
//! otherwise, and a plain Flow's `start` copies them onto the rows it makes. Only what is
//! inherently per occurrence is not here: status, the window, and a Task's Plan (the Cycle Plan).

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::error::FlowError;
use crate::tasks::model::{AgenticBrief, Delegate, TaskAgentic, TaskArchival};

/// Which template table a row lives in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TemplateTable {
    /// The flow itself: an iteration's root.
    Flow,
    /// A flow goal item.
    FlowGoal,
    /// A flow task item.
    FlowTask,
}

impl TemplateTable {
    /// The spelling `template_tags` and `template_block_reasons` store in `item_type`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Flow => "flow",
            Self::FlowGoal => "flow_goal",
            Self::FlowTask => "flow_task",
        }
    }

    /// The table the row itself lives in.
    fn table(self) -> &'static str {
        match self {
            Self::Flow => "flows",
            Self::FlowGoal => "flow_goals",
            Self::FlowTask => "flow_tasks",
        }
    }
}

/// A template row's own columns and relations, as its occurrences inherit them.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct TemplateFields {
    /// Who every occurrence is delegated to, unless it says otherwise. Task templates only.
    #[serde(default)]
    pub delegate_to: Option<Delegate>,
    /// Every occurrence's own Agentic flag; `None` inherits from its ancestors. Task templates only.
    #[serde(default)]
    pub agentic: Option<bool>,
    /// Whether doing an occurrence starts a wait. Task templates only.
    #[serde(default)]
    pub asynchronous: bool,
    /// Whether every occurrence is set aside in the Backlog. Task templates only.
    #[serde(default)]
    pub archival: TaskArchival,
    /// The `bd` issue every occurrence is tracked as.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub beads_id: Option<String>,
    /// Tags every occurrence carries.
    #[serde(default)]
    pub tag_ids: Vec<i64>,
    /// Block reasons every occurrence carries until it has its own.
    #[serde(default)]
    pub block_reasons: Vec<String>,
    /// The agentic brief every occurrence reads, field by field, until it says otherwise. Task
    /// templates only.
    #[serde(default)]
    pub agentic_brief: Option<AgenticBrief>,
}

/// A change to a template row's own columns and relations. Each field left `None` stays as it is.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct TemplateUpdate {
    /// Delegate to set (`None` leaves it, `Some(None)` clears it). Task templates only.
    #[serde(default, deserialize_with = "crate::wire::null_clears")]
    pub delegate_to: Option<Option<Delegate>>,
    /// Agentic state to set. Task templates only.
    #[serde(default)]
    pub agentic: Option<TaskAgentic>,
    /// Asynchronous flag to set. Task templates only.
    #[serde(default)]
    pub asynchronous: Option<bool>,
    /// Backlog state to set. Task templates only.
    #[serde(default)]
    pub archival: Option<TaskArchival>,
    /// The whole tag list to set.
    #[serde(default)]
    pub tag_ids: Option<Vec<i64>>,
    /// The whole block-reason list to set, in order.
    #[serde(default)]
    pub block_reasons: Option<Vec<String>>,
    /// The agentic brief to set (`None` leaves it, `Some(None)` removes it). Task templates only.
    #[serde(default, deserialize_with = "crate::wire::null_clears")]
    pub agentic_brief: Option<Option<AgenticBrief>>,
}

impl TemplateUpdate {
    /// Whether the update touches a column only a Task template has.
    fn touches_task_columns(&self) -> bool {
        self.delegate_to.is_some()
            || self.agentic.is_some()
            || self.asynchronous.is_some()
            || self.archival.is_some()
            || self.agentic_brief.is_some()
    }
}

/// One template row's columns, as read.
#[derive(sqlx::FromRow)]
struct TemplateColumns {
    id: i64,
    delegate_kind: Option<String>,
    delegate_id: Option<i64>,
    agentic: Option<bool>,
    asynchronous: bool,
    archival: String,
    beads_id: Option<String>,
}

/// One template row's agentic brief, as stored.
#[derive(sqlx::FromRow)]
struct TemplateBriefRow {
    item_id: i64,
    priority: Option<i64>,
    spec: String,
    design: String,
    acceptance: String,
    notes: String,
}

impl TemplateBriefRow {
    fn into_brief(self) -> AgenticBrief {
        AgenticBrief {
            priority: self
                .priority
                .and_then(|priority| u8::try_from(priority).ok()),
            spec: self.spec,
            design: self.design,
            acceptance: self.acceptance,
            notes: self.notes,
        }
    }
}

/// Reads and writes template fields on one connection.
pub struct TemplateOperator<'session> {
    connection: &'session mut sqlx::SqliteConnection,
}

impl<'session> TemplateOperator<'session> {
    /// Wraps a connection.
    pub(crate) fn new(connection: &'session mut sqlx::SqliteConnection) -> Self {
        Self { connection }
    }

    /// Every row of one template table's fields, by row id.
    pub async fn all(
        &mut self,
        table: TemplateTable,
    ) -> Result<HashMap<i64, TemplateFields>, FlowError> {
        let select = match table {
            TemplateTable::FlowGoal => {
                "SELECT id, NULL AS delegate_kind, NULL AS delegate_id, NULL AS agentic,
                        0 AS asynchronous, 'live' AS archival, beads_id FROM flow_goals"
            }
            TemplateTable::Flow => {
                "SELECT id, delegate_kind, delegate_id, agentic, asynchronous, archival, beads_id
                 FROM flows"
            }
            TemplateTable::FlowTask => {
                "SELECT id, delegate_kind, delegate_id, agentic, asynchronous, archival, beads_id
                 FROM flow_tasks"
            }
        };
        let rows: Vec<TemplateColumns> = sqlx::query_as(select)
            .fetch_all(&mut *self.connection)
            .await?;
        let tags: Vec<(i64, i64)> = sqlx::query_as(
            "SELECT item_id, tag_id FROM template_tags WHERE item_type = ? ORDER BY tag_id",
        )
        .bind(table.as_str())
        .fetch_all(&mut *self.connection)
        .await?;
        let reasons: Vec<(i64, String)> = sqlx::query_as(
            "SELECT item_id, reason FROM template_block_reasons WHERE item_type = ?
             ORDER BY item_id, position, id",
        )
        .bind(table.as_str())
        .fetch_all(&mut *self.connection)
        .await?;

        let mut fields: HashMap<i64, TemplateFields> = rows
            .into_iter()
            .map(|row| {
                (
                    row.id,
                    TemplateFields {
                        delegate_to: Delegate::from_columns(
                            row.delegate_kind.as_deref(),
                            row.delegate_id,
                        ),
                        agentic: row.agentic,
                        asynchronous: row.asynchronous,
                        archival: TaskArchival::from_db(&row.archival).unwrap_or_default(),
                        beads_id: row.beads_id,
                        tag_ids: Vec::new(),
                        block_reasons: Vec::new(),
                        agentic_brief: None,
                    },
                )
            })
            .collect();
        for (item_id, tag_id) in tags {
            if let Some(row) = fields.get_mut(&item_id) {
                row.tag_ids.push(tag_id);
            }
        }
        for (item_id, reason) in reasons {
            if let Some(row) = fields.get_mut(&item_id) {
                row.block_reasons.push(reason);
            }
        }
        let briefs: Vec<TemplateBriefRow> = sqlx::query_as(
            "SELECT item_id, priority, spec, design, acceptance, notes
             FROM template_agentic_briefs WHERE item_type = ?",
        )
        .bind(table.as_str())
        .fetch_all(&mut *self.connection)
        .await?;
        for brief in briefs {
            if let Some(row) = fields.get_mut(&brief.item_id) {
                row.agentic_brief = Some(brief.into_brief());
            }
        }
        Ok(fields)
    }

    /// One template row's fields.
    pub async fn one(
        &mut self,
        table: TemplateTable,
        id: i64,
    ) -> Result<TemplateFields, FlowError> {
        Ok(self.all(table).await?.remove(&id).unwrap_or_default())
    }

    /// Applies `update` to one template row. A Task-only column named for any other template is
    /// refused, rather than dropped without a word.
    pub async fn write(
        &mut self,
        table: TemplateTable,
        is_task_template: bool,
        id: i64,
        update: &TemplateUpdate,
    ) -> Result<(), FlowError> {
        if update.touches_task_columns() && !is_task_template {
            return Err(FlowError::Invalid(
                "only a task template has a delegate, an Agentic or Asynchronous flag, or a \
                 backlog"
                    .to_string(),
            ));
        }
        let name = table.table();
        if let Some(delegate) = update.delegate_to {
            let (kind, person) = Delegate::columns(delegate);
            sqlx::query(&format!(
                "UPDATE {name} SET delegate_kind = ?, delegate_id = ? WHERE id = ?"
            ))
            .bind(kind)
            .bind(person)
            .bind(id)
            .execute(&mut *self.connection)
            .await?;
        }
        if let Some(agentic) = update.agentic {
            sqlx::query(&format!("UPDATE {name} SET agentic = ? WHERE id = ?"))
                .bind(agentic.as_column())
                .bind(id)
                .execute(&mut *self.connection)
                .await?;
        }
        if let Some(asynchronous) = update.asynchronous {
            sqlx::query(&format!("UPDATE {name} SET asynchronous = ? WHERE id = ?"))
                .bind(asynchronous)
                .bind(id)
                .execute(&mut *self.connection)
                .await?;
        }
        if let Some(archival) = update.archival {
            sqlx::query(&format!("UPDATE {name} SET archival = ? WHERE id = ?"))
                .bind(archival.as_str())
                .bind(id)
                .execute(&mut *self.connection)
                .await?;
        }
        if let Some(tags) = &update.tag_ids {
            self.set_tags(table, id, tags).await?;
        }
        if let Some(reasons) = &update.block_reasons {
            self.set_block_reasons(table, id, reasons).await?;
        }
        if let Some(brief) = &update.agentic_brief {
            crate::tasks::agentic::validate_brief(brief)?;
            self.set_brief(table, id, brief.as_ref()).await?;
        }
        Ok(())
    }

    /// Replaces a template row's agentic brief, or removes it for `None`.
    async fn set_brief(
        &mut self,
        table: TemplateTable,
        id: i64,
        brief: Option<&AgenticBrief>,
    ) -> Result<(), FlowError> {
        sqlx::query("DELETE FROM template_agentic_briefs WHERE item_type = ? AND item_id = ?")
            .bind(table.as_str())
            .bind(id)
            .execute(&mut *self.connection)
            .await?;
        let Some(brief) = brief else {
            return Ok(());
        };
        sqlx::query(
            "INSERT INTO template_agentic_briefs
                (item_type, item_id, priority, spec, design, acceptance, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(table.as_str())
        .bind(id)
        .bind(brief.priority.map(i64::from))
        .bind(&brief.spec)
        .bind(&brief.design)
        .bind(&brief.acceptance)
        .bind(&brief.notes)
        .execute(&mut *self.connection)
        .await?;
        Ok(())
    }

    /// Replaces a template row's tags, writing only the difference.
    async fn set_tags(
        &mut self,
        table: TemplateTable,
        id: i64,
        tags: &[i64],
    ) -> Result<(), FlowError> {
        let current: Vec<i64> = sqlx::query_scalar(
            "SELECT tag_id FROM template_tags WHERE item_type = ? AND item_id = ?",
        )
        .bind(table.as_str())
        .bind(id)
        .fetch_all(&mut *self.connection)
        .await?;
        for gone in current.iter().filter(|tag| !tags.contains(tag)) {
            sqlx::query(
                "DELETE FROM template_tags WHERE item_type = ? AND item_id = ? AND tag_id = ?",
            )
            .bind(table.as_str())
            .bind(id)
            .bind(gone)
            .execute(&mut *self.connection)
            .await?;
        }
        for added in tags.iter().filter(|tag| !current.contains(tag)) {
            sqlx::query("INSERT INTO template_tags (item_type, item_id, tag_id) VALUES (?, ?, ?)")
                .bind(table.as_str())
                .bind(id)
                .bind(added)
                .execute(&mut *self.connection)
                .await?;
        }
        Ok(())
    }

    /// Replaces a template row's block reasons, in order.
    async fn set_block_reasons(
        &mut self,
        table: TemplateTable,
        id: i64,
        reasons: &[String],
    ) -> Result<(), FlowError> {
        sqlx::query("DELETE FROM template_block_reasons WHERE item_type = ? AND item_id = ?")
            .bind(table.as_str())
            .bind(id)
            .execute(&mut *self.connection)
            .await?;
        for (position, reason) in reasons.iter().enumerate() {
            sqlx::query(
                "INSERT INTO template_block_reasons (item_type, item_id, reason, position)
                 VALUES (?, ?, ?, ?)",
            )
            .bind(table.as_str())
            .bind(id)
            .bind(reason)
            .bind(i64::try_from(position).unwrap_or(i64::MAX))
            .execute(&mut *self.connection)
            .await?;
        }
        Ok(())
    }

    /// Copies one template row's tags and block reasons onto another — a fork or a paste.
    pub async fn copy_relations(
        &mut self,
        table: TemplateTable,
        from: i64,
        to: i64,
    ) -> Result<(), FlowError> {
        sqlx::query(
            "INSERT INTO template_tags (item_type, item_id, tag_id)
             SELECT item_type, ?, tag_id FROM template_tags WHERE item_type = ? AND item_id = ?",
        )
        .bind(to)
        .bind(table.as_str())
        .bind(from)
        .execute(&mut *self.connection)
        .await?;
        sqlx::query(
            "INSERT INTO template_block_reasons (item_type, item_id, reason, position)
             SELECT item_type, ?, reason, position FROM template_block_reasons
             WHERE item_type = ? AND item_id = ?",
        )
        .bind(to)
        .bind(table.as_str())
        .bind(from)
        .execute(&mut *self.connection)
        .await?;
        Ok(())
    }

    /// Copies one template row's own columns and relations onto another of the same table — a
    /// fork, a paste, or the clone a copied Habit is made of.
    pub async fn copy(
        &mut self,
        table: TemplateTable,
        from: i64,
        to: i64,
    ) -> Result<(), FlowError> {
        let columns = match table {
            TemplateTable::FlowGoal => "beads_id",
            _ => "delegate_kind, delegate_id, agentic, asynchronous, archival, beads_id",
        };
        let name = table.table();
        sqlx::query(&format!(
            "UPDATE {name} SET ({columns}) = (SELECT {columns} FROM {name} WHERE id = ?)
             WHERE id = ?"
        ))
        .bind(from)
        .bind(to)
        .execute(&mut *self.connection)
        .await?;
        if table != TemplateTable::FlowGoal {
            let brief = self.one(table, from).await?.agentic_brief;
            self.set_brief(table, to, brief.as_ref()).await?;
        }
        self.copy_relations(table, from, to).await
    }

    /// Copies one template row's tags and block reasons onto a row of another template table — a
    /// flow item retyped between goal and task.
    pub async fn copy_relations_across(
        &mut self,
        from_table: TemplateTable,
        from: i64,
        to_table: TemplateTable,
        to: i64,
    ) -> Result<(), FlowError> {
        sqlx::query(
            "INSERT INTO template_tags (item_type, item_id, tag_id)
             SELECT ?, ?, tag_id FROM template_tags WHERE item_type = ? AND item_id = ?",
        )
        .bind(to_table.as_str())
        .bind(to)
        .bind(from_table.as_str())
        .bind(from)
        .execute(&mut *self.connection)
        .await?;
        sqlx::query(
            "INSERT INTO template_block_reasons (item_type, item_id, reason, position)
             SELECT ?, ?, reason, position FROM template_block_reasons
             WHERE item_type = ? AND item_id = ?",
        )
        .bind(to_table.as_str())
        .bind(to)
        .bind(from_table.as_str())
        .bind(from)
        .execute(&mut *self.connection)
        .await?;
        Ok(())
    }

    /// Writes a template row's beads id — carried by a copy, never authored here.
    pub async fn set_beads_id(
        &mut self,
        table: TemplateTable,
        id: i64,
        beads_id: Option<&str>,
    ) -> Result<(), FlowError> {
        let name = table.table();
        sqlx::query(&format!("UPDATE {name} SET beads_id = ? WHERE id = ?"))
            .bind(beads_id)
            .bind(id)
            .execute(&mut *self.connection)
            .await?;
        Ok(())
    }

    /// Forgets a template row's relations — the row itself is going.
    pub async fn forget(&mut self, table: TemplateTable, id: i64) -> Result<(), FlowError> {
        for relation in ["template_tags", "template_block_reasons"] {
            sqlx::query(&format!(
                "DELETE FROM {relation} WHERE item_type = ? AND item_id = ?"
            ))
            .bind(table.as_str())
            .bind(id)
            .execute(&mut *self.connection)
            .await?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests;
