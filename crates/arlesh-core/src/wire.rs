//! Decoding helpers shared by the request bodies that cross the IPC boundary.

use serde::{Deserialize, Deserializer};

/// Deserialises an explicitly-null JSON field into `Some(None)` rather than `None`.
///
/// `Option<Option<T>>` is how an update request spells *absent = unchanged, null = clear*, but
/// serde collapses both spellings to `None` on its own — so a clear sent from the UI would be read
/// as "leave it alone" and swallowed without a word. Pair with `#[serde(default)]`, which restores
/// the absent case:
///
/// ```ignore
/// #[serde(default, deserialize_with = "crate::wire::null_clears")]
/// pub plan: Option<Option<TimeScope>>,
/// ```
pub fn null_clears<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: Deserializer<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}
