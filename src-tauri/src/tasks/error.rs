//! Task and Goal operation errors.

/// Errors that can occur during task or goal operations.
#[derive(Debug, thiserror::Error)]
pub enum TaskError {
    /// The requested task does not exist.
    #[error("task {0} not found")]
    TaskNotFound(i64),
    /// The requested goal does not exist.
    #[error("goal {0} not found")]
    GoalNotFound(i64),
    /// Adding this dependency would create a circular dependency chain.
    #[error("adding this dependency would create a cycle")]
    CircularDependency,
    /// The parent chain above an item loops back on itself, so no containment rule above it can
    /// be evaluated. Corrupt persisted data rather than a bad request: nothing in the schema or
    /// the write path currently prevents reparenting a node under its own descendant, and the
    /// ancestry climb reports the loop instead of following it forever.
    #[error("ancestor chain above node {node_id} contains a cycle")]
    AncestorCycle {
        /// The node the chain closed back onto.
        node_id: i64,
    },
    /// A write would leave a Task both backlogged and planned — the one state the two axes cannot
    /// hold at once, since a Plan says "this week" and the backlog says "not now".
    ///
    /// Not a failure: the request is well-formed and the backend could carry it out, but doing so
    /// would throw away a scheduling decision the caller may not have remembered making. It
    /// surfaces as a **needs-confirmation** refusal, and the answer is the same request again with
    /// the Plan explicitly cleared. (The opposite order needs no question — scheduling a
    /// backlogged Task simply takes it out of the backlog.)
    #[error("a backlogged task cannot also be planned")]
    BacklogWithPlan,
    /// A write would break a scope-containment invariant (e.g. a Plan wider than its Time Scope).
    #[error("scope containment violation: {0}")]
    ScopeContainment(String),
    /// A referenced scope could not be resolved.
    #[error("scope error: {0}")]
    Scope(#[from] crate::scopes::error::ScopeError),
    /// A database error occurred.
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
}
