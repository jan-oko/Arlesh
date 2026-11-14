//! Which Agent an MCP session is: the binding an attach makes, and the registry of sessions a host
//! that issues session ids itself keeps.
//!
//! A session is bound once, by [`arlesh_agents.attach`](super::agents), and every call over it is
//! then that Agent's — so the subagents of a client, which share its connection, need nothing
//! further. The binding lives in memory only: when the server restarts it is gone, the client
//! starts a new session, and the agent attaches again with the token it was given.

use std::{
    collections::{HashMap, VecDeque},
    sync::{Arc, Mutex, MutexGuard},
};

use crate::agents::{error::AgentError, model::AgentId, secret};

/// How many sessions a registry keeps before the oldest is forgotten (its client attaches again).
const MAX_SESSIONS: usize = 4096;

/// What one session is bound to: nothing, until it attaches.
#[derive(Debug, Clone, Default)]
pub struct Binding {
    agent: Arc<Mutex<Option<AgentId>>>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    // A panic while holding the lock cannot leave the plain value inside it half-written.
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

impl Binding {
    /// The Agent this session is, once it has attached.
    pub fn agent(&self) -> Option<AgentId> {
        *lock(&self.agent)
    }

    /// Binds the session to `agent`. Binding again replaces the Agent.
    pub fn bind(&self, agent: AgentId) {
        *lock(&self.agent) = Some(agent);
    }

    /// Unbinds the session: it is unattached again.
    pub fn unbind(&self) {
        *lock(&self.agent) = None;
    }
}

/// The sessions a host has opened, by the id it issued: the Python server's, whose `/mcp` is a
/// plain HTTP route. (The connected endpoint has `rmcp`'s own sessions and needs none of this.)
#[derive(Debug, Clone, Default)]
pub struct Sessions {
    inner: Arc<Mutex<Registry>>,
}

#[derive(Debug, Default)]
struct Registry {
    bindings: HashMap<String, Binding>,
    order: VecDeque<String>,
}

impl Sessions {
    /// Opens a session and answers its id, which the client sends with every later request.
    pub fn open(&self) -> Result<String, AgentError> {
        let id = secret::random_token()?.chars().take(32).collect::<String>();
        let mut registry = lock(&self.inner);
        while registry.order.len() >= MAX_SESSIONS {
            if let Some(oldest) = registry.order.pop_front() {
                registry.bindings.remove(&oldest);
            }
        }
        registry.order.push_back(id.clone());
        registry.bindings.insert(id.clone(), Binding::default());
        Ok(id)
    }

    /// The binding of the session `id`, if the host issued it and has not forgotten it.
    pub fn get(&self, id: &str) -> Option<Binding> {
        lock(&self.inner).bindings.get(id).cloned()
    }

    /// Forgets the session `id`. Answers whether there was one.
    pub fn close(&self, id: &str) -> bool {
        let mut registry = lock(&self.inner);
        registry.order.retain(|other| other != id);
        registry.bindings.remove(id).is_some()
    }
}

#[cfg(test)]
mod tests;
