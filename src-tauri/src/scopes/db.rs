//! How a scope key is stored: its canonical text in a TEXT column (ADR 0009).
//!
//! [`ScopeKey`] is a domain value and knows nothing of the database (ADR 0010, decision 8). A
//! column that holds one is read and written through [`DbScopeKey`], a zero-cost wrapper with the
//! key's layout, which is where the `sqlx` codec lives — and where a malformed column fails, as a
//! decode error, before any rule sees it.

use sqlx::encode::IsNull;
use sqlx::error::BoxDynError;
use sqlx::sqlite::{Sqlite, SqliteArgumentValue, SqliteTypeInfo, SqliteValueRef};
use sqlx::{Decode, Encode, Type};

use super::key::ScopeKey;

/// A [`ScopeKey`] as a column holds it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[repr(transparent)]
pub struct DbScopeKey(pub ScopeKey);

impl From<DbScopeKey> for ScopeKey {
    fn from(key: DbScopeKey) -> Self {
        key.0
    }
}

impl From<ScopeKey> for DbScopeKey {
    fn from(key: ScopeKey) -> Self {
        Self(key)
    }
}

impl Type<Sqlite> for DbScopeKey {
    fn type_info() -> SqliteTypeInfo {
        <String as Type<Sqlite>>::type_info()
    }

    fn compatible(ty: &SqliteTypeInfo) -> bool {
        <String as Type<Sqlite>>::compatible(ty)
    }
}

/// Writes the canonical text — after checking the key names its own start, since a variant built
/// by hand has not been checked yet.
impl<'q> Encode<'q, Sqlite> for DbScopeKey {
    fn encode_by_ref(&self, buf: &mut Vec<SqliteArgumentValue<'q>>) -> Result<IsNull, BoxDynError> {
        let key = self.0.validated()?;
        <String as Encode<'q, Sqlite>>::encode(key.canonical(), buf)
    }
}

impl<'r> Decode<'r, Sqlite> for DbScopeKey {
    fn decode(value: SqliteValueRef<'r>) -> Result<Self, BoxDynError> {
        let raw = <&str as Decode<'r, Sqlite>>::decode(value)?;
        Ok(Self(raw.parse::<ScopeKey>()?))
    }
}

/// The column value of an optional key.
pub fn column(key: Option<ScopeKey>) -> Option<DbScopeKey> {
    key.map(DbScopeKey)
}

/// The key an optional column holds.
pub fn key(column: Option<DbScopeKey>) -> Option<ScopeKey> {
    column.map(ScopeKey::from)
}
