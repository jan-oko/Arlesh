//! What the token table holds, as the server reads it.

use serde::Serialize;

/// A client a token has been issued to. The token itself is never kept, only its digest, and the
/// digest is never read back out.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, schemars::JsonSchema)]
pub struct IssuedToken {
    /// The client the token names.
    pub client: String,
    /// When it was issued: an ISO 8601 local date and time, as the caller recorded it.
    pub created_at: String,
    /// When the client last used its token, as the server recorded it, or `None` before its
    /// first use since the column existed (migration 0098).
    pub last_seen_at: Option<String>,
}
