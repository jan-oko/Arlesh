//! SPIKE (ADR 0015): the real `tasks::rules::{gestures, plan}` compiled to wasm32.
//!
//! The module tree below mirrors arlesh-core's, so the mounted files' `crate::` paths resolve
//! unchanged. Every `#[path]` points at the real file; the only code written here is
//! `tasks::waits` (the pure items that today live in an impure module — the split moves them) and
//! the boundary in `boundary`. What had to be stubbed is the list of blockers ADR 0015 names.
#![allow(dead_code, unused_imports, missing_docs, clippy::all)]

pub mod scopes {
    #[path = "../../../../crates/arlesh-core/src/scopes/error.rs"]
    pub mod error;
    #[path = "../../../../crates/arlesh-core/src/scopes/key.rs"]
    pub mod key;
    #[path = "../../../../crates/arlesh-core/src/scopes/model.rs"]
    pub mod model;
    #[path = "../../../../crates/arlesh-core/src/scopes/resolve.rs"]
    pub mod resolve;
    pub mod rules {
        #[path = "../../../../../crates/arlesh-core/src/scopes/rules/derive.rs"]
        pub mod derive;
    }
    pub use rules::derive;
}

pub mod nodes {
    #[path = "../../../../crates/arlesh-core/src/nodes/id.rs"]
    pub mod id;
    #[path = "../../../../crates/arlesh-core/src/nodes/key.rs"]
    pub mod key;
    #[path = "../../../../crates/arlesh-core/src/nodes/origin.rs"]
    pub mod origin;
}

pub mod flows {
    #[path = "../../../../crates/arlesh-core/src/flows/model.rs"]
    pub mod model;
    /// BLOCKER: `flows/model.rs` (a domain model) flattens `TemplateFields`, which lives in
    /// `flows/template.rs` beside `sqlx::FromRow` rows. The split moves it to the model; here it
    /// is copied verbatim (docs elided).
    pub mod template {
        use serde::{Deserialize, Serialize};
        use crate::tasks::model::{AgenticBrief, AsyncTemplate, Delegate, TaskAgentic, TaskArchival};
        #[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
        pub struct TemplateFields {
            #[serde(default)]
            pub delegate_to: Option<Delegate>,
            #[serde(default)]
            pub agentic: Option<bool>,
            #[serde(default)]
            pub asynchronous: bool,
            #[serde(default)]
            pub archival: TaskArchival,
            #[serde(default)]
            pub tag_ids: Vec<i64>,
            #[serde(default)]
            pub block_reasons: Vec<String>,
            #[serde(default)]
            pub agentic_brief: Option<AgenticBrief>,
            #[serde(default)]
            pub compound: bool,
            #[serde(default, skip_serializing_if = "Option::is_none")]
            pub async_template: Option<AsyncTemplate>,
        }
        #[derive(Debug, Clone, Default, Deserialize, schemars::JsonSchema, serde::Serialize)]
        pub struct TemplateUpdate {
            #[serde(default, deserialize_with = "crate::wire::null_clears", skip_serializing_if = "Option::is_none")]
            pub delegate_to: Option<Option<Delegate>>,
            #[serde(default)]
            pub agentic: Option<TaskAgentic>,
            #[serde(default)]
            pub asynchronous: Option<bool>,
            #[serde(default)]
            pub archival: Option<TaskArchival>,
            #[serde(default)]
            pub tag_ids: Option<Vec<i64>>,
            #[serde(default)]
            pub block_reasons: Option<Vec<String>>,
            #[serde(default, deserialize_with = "crate::wire::null_clears", skip_serializing_if = "Option::is_none")]
            pub agentic_brief: Option<Option<AgenticBrief>>,
            #[serde(default)]
            pub compound: Option<bool>,
            #[serde(default, deserialize_with = "crate::wire::null_clears", skip_serializing_if = "Option::is_none")]
            pub async_template: Option<Option<AsyncTemplate>>,
        }
    }
}

#[path = "../../../crates/arlesh-core/src/wire.rs"]
pub mod wire;

pub mod tasks {
    #[path = "../../../../crates/arlesh-core/src/tasks/model.rs"]
    pub mod model;
    pub mod rules {
        #[path = "../../../../../crates/arlesh-core/src/tasks/rules/gestures.rs"]
        pub mod gestures;
        #[path = "../../../../../crates/arlesh-core/src/tasks/rules/plan.rs"]
        pub mod plan;
    }
    /// BLOCKER: `tasks/waits.rs` holds `Db` and `sqlx` rows, yet `nodes::key` and
    /// `nodes::origin` (domain models) import its pure items. The split moves these into the
    /// rules crate; here they are copied verbatim.
    pub mod waits {
        use chrono::NaiveDateTime;
        use serde::Serialize;
        const INSTANT_FORMAT: &str = "%Y-%m-%dT%H:%M:%S";
        pub(crate) fn instant_column(at: NaiveDateTime) -> String {
            at.format(INSTANT_FORMAT).to_string()
        }
        #[derive(
            Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, serde::Deserialize, schemars::JsonSchema,
        )]
        #[serde(rename_all = "snake_case")]
        pub enum WaitKind {
            Stored,
            Spawned,
            Occurrence,
        }
        impl WaitKind {
            pub fn as_str(self) -> &'static str {
                match self {
                    Self::Stored => "stored",
                    Self::Spawned => "spawned",
                    Self::Occurrence => "occurrence",
                }
            }
        }
        #[derive(Debug, Clone, PartialEq, Eq, Hash)]
        pub enum WaitRef {
            Stored(i64),
            Spawned(i64),
            Occurrence(String),
        }
        impl WaitRef {
            pub fn kind(&self) -> WaitKind {
                match self {
                    Self::Stored(_) => WaitKind::Stored,
                    Self::Spawned(_) => WaitKind::Spawned,
                    Self::Occurrence(_) => WaitKind::Occurrence,
                }
            }
            pub fn parse(spelling: &str) -> Option<Self> {
                let (kind, rest) = spelling.split_once(':')?;
                match kind {
                    "stored" => rest.parse().ok().map(Self::Stored),
                    "spawned" => rest.parse().ok().map(Self::Spawned),
                    "occurrence" => Some(Self::Occurrence(rest.to_string())),
                    _ => None,
                }
            }
            pub fn spelling(&self) -> String {
                match self {
                    Self::Stored(id) | Self::Spawned(id) => format!("{}:{id}", self.kind().as_str()),
                    Self::Occurrence(key) => format!("occurrence:{key}"),
                }
            }
        }
    }
}

pub mod boundary;
