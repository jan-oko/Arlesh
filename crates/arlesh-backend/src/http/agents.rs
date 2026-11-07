//! [`HttpBackend`]'s agents operations: each one REST call to `arlesh-server`, as
//! `conformance/client-mode.json` lists it.

use arlesh_core::{
    agents::model::{AgentAction, AgentsOverview, IssuedPin},
    error::WireError,
};
use reqwest::Method;

use super::{segment, Call, HttpBackend};
use crate::agents::AgentsPort;

/// The body of the account lock: the label travels in it, not in the path, since a label is free
/// text.
#[derive(serde::Serialize)]
struct AccountLock {
    label: String,
    locked: bool,
}

#[async_trait::async_trait]
impl AgentsPort for HttpBackend {
    async fn list_agents(&self) -> Result<AgentsOverview, WireError> {
        self.read(Call::new(Method::GET, "/agents".to_owned()))
            .await
    }

    async fn issue_agent_pin(&self) -> Result<IssuedPin, WireError> {
        self.write(Call::new(Method::POST, "/agents/pins".to_owned()))
            .await
    }

    async fn apply_agent_action(&self, id: i64, action: AgentAction) -> Result<(), WireError> {
        self.write(
            Call::new(Method::POST, format!("/agents/{}/action", segment(&id))).json(&action),
        )
        .await
    }

    async fn set_agent_account_locked(&self, label: String, locked: bool) -> Result<(), WireError> {
        self.write(
            Call::new(Method::PUT, "/agent-accounts/lock".to_owned())
                .json(&AccountLock { label, locked }),
        )
        .await
    }
}
