//! Virtual node tables (ADR 0008): every node of a kind, stored or derived, as one row shape.
//!
//! A derived node — today a Habit's occurrence — is an **ordinary row of its kind**: a [`Task`],
//! [`Goal`] or [`Commitment`] carrying a [`NodeId`](id::NodeId) and an
//! [`Origin`](origin::Origin). Each kind is read through its virtual table ([`table`]): the kind's
//! stored rows merged with the rows its templates derive, each derived row being its template
//! with that kind's overlay applied ([`overlay`]). A write naming a derived row goes into its
//! overlay; a write naming a stored row goes where it always went.
//!
//! Here live the pieces every kind shares: the id ([`id`]), the value key it is the hash of
//! ([`key`]), the lookup from one to the other ([`registry`]), the provenance field ([`origin`]),
//! the overlays, and the tables themselves. The derivation of a Habit's occurrences, which needs
//! the recurrence machinery, lives beside it in [`crate::flows::occurrences`].
//!
//! [`Task`]: crate::tasks::model::Task
//! [`Goal`]: crate::tasks::model::Goal
//! [`Commitment`]: crate::tasks::model::Commitment

pub mod id;
pub mod key;
pub mod origin;
pub mod overlay;
pub mod registry;
pub mod relations;
pub mod table;
pub mod wait_edit;
pub mod waits;
pub mod write;
