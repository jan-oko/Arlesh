//! What a stored or derived row may be done to: deleted, copied, dragged, switched to Compound, or
//! given a prerequisite.
//!
//! Decided by where the row came from ([`Origin`]). A row made by hand may be done anything to.
//! A Habit occurrence is a row of its own (ADR 0008) — deleting one archives it, and it may be
//! dragged, made Compound or given a prerequisite — but it is a repetition, not a thing to copy. A
//! **derived wait** — a wait's check task, the wait an Asynchronous Task spawned, a delegated Task's
//! wait — is drawn from its owner and goes with it: it may not be deleted, copied or dragged, and a
//! check task's status is the check itself, so it takes neither Compound nor a prerequisite.

use serde::Serialize;

use crate::nodes::origin::Origin;

/// What a row may be done to. Every capability is on unless the row's origin turns it off.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, schemars::JsonSchema)]
pub struct Capabilities {
    /// Whether it may be deleted (an occurrence is archived instead, which counts).
    pub delete: bool,
    /// Whether it may be copied, to be pasted somewhere else.
    pub copy: bool,
    /// Whether it may be dragged to another parent.
    pub drag: bool,
    /// Whether a Task may be switched to Compound.
    pub compound: bool,
    /// Whether a Task may be given a prerequisite.
    pub dependencies: bool,
}

impl Capabilities {
    /// Everything allowed — a row made by hand.
    pub const FULL: Self = Self {
        delete: true,
        copy: true,
        drag: true,
        compound: true,
        dependencies: true,
    };

    /// Whether nothing is turned off.
    pub fn is_full(&self) -> bool {
        *self == Self::FULL
    }
}

/// What a row of `origin` may be done to.
pub fn of(origin: &Origin) -> Capabilities {
    match origin {
        Origin::Manual => Capabilities::FULL,
        Origin::Habit(_) => Capabilities {
            copy: false,
            ..Capabilities::FULL
        },
        Origin::Check(_) | Origin::SpawnedWait(_) | Origin::DelegationWait(_) => Capabilities {
            delete: false,
            copy: false,
            drag: false,
            compound: false,
            dependencies: false,
        },
    }
}

#[cfg(test)]
mod tests;
