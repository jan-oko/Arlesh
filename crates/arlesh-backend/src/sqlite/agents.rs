//! [`SqliteBackend`]'s agents operations: the in-process core over the local file.

use arlesh_core::{
    agents::{
        model::{AgentAction, AgentId, AgentsOverview, IssuedPin},
        service,
    },
    error::WireError,
};

use super::SqliteBackend;
use crate::agents::AgentsPort;

fn now() -> chrono::NaiveDateTime {
    chrono::Local::now().naive_local()
}

#[async_trait::async_trait]
impl AgentsPort for SqliteBackend {
    async fn list_agents(&self) -> Result<AgentsOverview, WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        service::overview(&mut db, now())
            .await
            .map_err(WireError::from_error)
    }

    async fn issue_agent_pin(&self) -> Result<IssuedPin, WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        let pin = service::issue_pin(&mut db, now())
            .await
            .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)?;
        Ok(pin)
    }

    async fn apply_agent_action(&self, id: i64, action: AgentAction) -> Result<(), WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        service::act(&mut db, AgentId(id), action)
            .await
            .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)?;
        Ok(())
    }

    async fn set_agent_account_locked(
        &self,
        label: String,
        locked: bool,
    ) -> Result<(), WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        service::set_account_locked(&mut db, &label, locked)
            .await
            .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)?;
        Ok(())
    }
}
