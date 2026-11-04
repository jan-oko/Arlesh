//! A template row's inheritable fields and the update that changes them.

use serde::{Deserialize, Serialize};

use crate::tasks::model::{
    AgenticBrief, AsyncTemplate, Delegate, TaskAgentic, TaskArchival,
};

/// A template row's own columns and relations, as its occurrences inherit them.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
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
    /// Whether every instance **consists of its sub-items**. Flow Task items only.
    #[serde(default)]
    pub compound: bool,
    /// The wait template every instance's completion spawns its wait from, kept only while the
    /// item is Asynchronous. Flow Task items only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub async_template: Option<AsyncTemplate>,
}

/// A change to a template row's own columns and relations. Each field left `None` stays as it is.
#[derive(Debug, Clone, Default, Deserialize, schemars::JsonSchema, serde::Serialize)]
pub struct TemplateUpdate {
    /// Delegate to set (`None` leaves it, `Some(None)` clears it). Task templates only.
    #[serde(
        default,
        deserialize_with = "crate::wire::null_clears",
        skip_serializing_if = "Option::is_none"
    )]
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
    #[serde(
        default,
        deserialize_with = "crate::wire::null_clears",
        skip_serializing_if = "Option::is_none"
    )]
    pub agentic_brief: Option<Option<AgenticBrief>>,
    /// Compound flag to set. Flow Task items only.
    #[serde(default)]
    pub compound: Option<bool>,
    /// The wait template to set (`None` leaves it, `Some(None)` removes it). Dropped when the item
    /// ends up not Asynchronous. Flow Task items only.
    #[serde(
        default,
        deserialize_with = "crate::wire::null_clears",
        skip_serializing_if = "Option::is_none"
    )]
    pub async_template: Option<Option<AsyncTemplate>>,
}

impl TemplateUpdate {
    /// Whether the update touches a column only a Task template has.
    pub fn touches_task_columns(&self) -> bool {
        self.delegate_to.is_some()
            || self.agentic.is_some()
            || self.asynchronous.is_some()
            || self.archival.is_some()
            || self.agentic_brief.is_some()
            || self.compound.is_some()
            || self.async_template.is_some()
    }
}
