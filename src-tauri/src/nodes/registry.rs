//! UUID → value key: the lookup a request naming a derived row is resolved through.
//!
//! A derived row's id is a hash of its key, so the key cannot be read back out of it. Every time
//! the virtual tables serve a derived row they record which key its id stands for, and a request
//! naming that id later is answered from here. The map is process-wide because it is the inverse
//! of a pure function: an entry is true for every database, so sharing one between sessions (or
//! between test databases) can never make it wrong — only incomplete, which [`recall`]'s callers
//! answer by deriving the rows again.

use std::{
    collections::HashMap,
    sync::{Mutex, MutexGuard, OnceLock},
};

use super::{id::DerivedId, key::DerivedKey};

/// The process-wide map.
fn registry() -> MutexGuard<'static, HashMap<DerivedId, DerivedKey>> {
    static REGISTRY: OnceLock<Mutex<HashMap<DerivedId, DerivedKey>>> = OnceLock::new();
    let lock = REGISTRY.get_or_init(|| Mutex::new(HashMap::new())).lock();
    // A poisoned lock only means another thread panicked mid-insert; every entry in the map is
    // still a true statement, so reading on is safe.
    lock.unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// Records the key `id` stands for, and returns the id.
pub fn remember(key: &DerivedKey) -> DerivedId {
    let id = key.id();
    registry().insert(id.clone(), key.clone());
    id
}

/// The key a derived id stands for, if a row with it has been served.
pub fn recall(id: &DerivedId) -> Option<DerivedKey> {
    registry().get(id).cloned()
}

#[cfg(test)]
mod tests;
