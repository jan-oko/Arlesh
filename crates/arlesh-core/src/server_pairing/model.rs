//! What the pairing table holds, as the server reads it.

use serde::Serialize;

/// A device's request to be paired, from its creation until it is claimed or lapses.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, schemars::JsonSchema)]
pub struct PairingPin {
    /// The SHA-256 digest of the request's secret id, which the device polls with.
    pub id_sha256: String,
    /// The six digits the device shows and the approver types.
    pub pin: String,
    /// The name the device suggested, already a client name.
    pub name: String,
    /// The name the approver settled on, once the PIN is approved.
    pub approved_name: Option<String>,
    /// How many wrong PINs have been presented with this request's id.
    pub attempts: i64,
    /// When it was made: an ISO 8601 local date and time, as the caller recorded it.
    pub created_at: String,
    /// When it lapses, in the same form.
    pub expires_at: String,
}
