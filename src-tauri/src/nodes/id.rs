//! The one opaque id every node row travels under.
//!
//! A stored row keeps its integer primary key; a derived row — a Habit occurrence, a wait's check
//! task — has no row to number, so its id is a **UUID-v5** of its value key (ADR 0008, decision 2).
//! Both travel as one [`NodeId`]: a JSON number for a stored row, a string for a derived one, so a
//! request naming a node accepts either without a second field to say which.
//!
//! The UUID is computed here, in Rust. SQLite has no SHA-1 of its own, and registering one from
//! Rust would make the database unreadable to any other client that opened it.

use std::fmt;

use serde::{Deserialize, Serialize};

/// The namespace every derived node's UUID is hashed under.
///
/// The same namespace the frontend mints its display keys under (`ARLESH_NODE_NAMESPACE` in
/// `src/utils/node-uuid.ts`). Fixed for good: changing it changes every derived node's id.
pub const NODE_NAMESPACE: [u8; 16] = [
    0x0d, 0x75, 0xff, 0x4b, 0x96, 0x52, 0x45, 0x96, 0x9d, 0x2f, 0x19, 0x09, 0x23, 0x0b, 0x66, 0x2b,
];

/// A derived node's id: the canonical `8-4-4-4-12` spelling of a UUID-v5.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct DerivedId(String);

impl DerivedId {
    /// The id of the derived node whose canonical key is `node_key`.
    pub fn of_key(node_key: &str) -> Self {
        Self(uuid_v5(&NODE_NAMESPACE, node_key))
    }

    /// The id as its hyphenated string.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for DerivedId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

/// Which row a node is: a stored one by its primary key, or a derived one by its UUID.
///
/// Untagged on the wire, because the two spellings cannot be confused: a number is a stored row,
/// a string a derived one.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(untagged)]
pub enum NodeId {
    /// A row of the kind's own table.
    Stored(i64),
    /// A row derived from a template, overlaid with what makes it differ.
    Derived(DerivedId),
}

impl NodeId {
    /// The stored primary key, when this names a stored row.
    pub fn stored(&self) -> Option<i64> {
        match self {
            Self::Stored(id) => Some(*id),
            Self::Derived(_) => None,
        }
    }

    /// The UUID, when this names a derived row.
    pub fn derived(&self) -> Option<&DerivedId> {
        match self {
            Self::Stored(_) => None,
            Self::Derived(id) => Some(id),
        }
    }

    /// Whether this names a derived row.
    pub fn is_derived(&self) -> bool {
        matches!(self, Self::Derived(_))
    }

    /// The stored primary key, or [`NotStored`] when this names a derived row — for a path that
    /// can only act on a row of the kind's own table, such as one it has just created.
    pub fn require_stored(&self) -> Result<i64, NotStored> {
        match self {
            Self::Stored(id) => Ok(*id),
            Self::Derived(id) => Err(NotStored(id.clone())),
        }
    }
}

/// A derived node was named where only a stored row will do.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("node {0} is derived from a template and has no stored row")]
pub struct NotStored(pub DerivedId);

impl From<i64> for NodeId {
    fn from(id: i64) -> Self {
        Self::Stored(id)
    }
}

impl From<DerivedId> for NodeId {
    fn from(id: DerivedId) -> Self {
        Self::Derived(id)
    }
}

impl PartialEq<i64> for NodeId {
    fn eq(&self, other: &i64) -> bool {
        self.stored() == Some(*other)
    }
}

impl fmt::Display for NodeId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Stored(id) => write!(formatter, "{id}"),
            Self::Derived(id) => write!(formatter, "{id}"),
        }
    }
}

/// A name-based (version 5) UUID of `name` under `namespace`, per RFC 9562.
pub fn uuid_v5(namespace: &[u8; 16], name: &str) -> String {
    let mut message = Vec::with_capacity(16 + name.len());
    message.extend_from_slice(namespace);
    message.extend_from_slice(name.as_bytes());
    let digest = sha1(&message);
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&digest[..16]);
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

/// SHA-1 of `message` (FIPS 180-4).
///
/// Used for what RFC 9562 uses it for — spreading a name deterministically over 122 bits — and
/// nothing secret, which is why a small local implementation stands in for a dependency. The
/// frontend carries the same one (`src/utils/uuid-v5.ts`).
fn sha1(message: &[u8]) -> [u8; 20] {
    let mut padded = message.to_vec();
    let bit_length = (message.len() as u64).wrapping_mul(8);
    padded.push(0x80);
    while padded.len() % 64 != 56 {
        padded.push(0);
    }
    padded.extend_from_slice(&bit_length.to_be_bytes());

    let mut state: [u32; 5] = [
        0x6745_2301,
        0xefcd_ab89,
        0x98ba_dcfe,
        0x1032_5476,
        0xc3d2_e1f0,
    ];
    for block in padded.chunks(64) {
        let mut words = [0u32; 80];
        for (index, chunk) in block.chunks(4).enumerate().take(16) {
            words[index] = u32::from_be_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
        }
        for index in 16..80 {
            words[index] =
                (words[index - 3] ^ words[index - 8] ^ words[index - 14] ^ words[index - 16])
                    .rotate_left(1);
        }
        let [mut a, mut b, mut c, mut d, mut e] = state;
        for (index, word) in words.iter().enumerate() {
            let (mixed, constant) = match index {
                0..=19 => ((b & c) | (!b & d), 0x5a82_7999),
                20..=39 => (b ^ c ^ d, 0x6ed9_eba1),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8f1b_bcdc),
                _ => (b ^ c ^ d, 0xca62_c1d6),
            };
            let next = a
                .rotate_left(5)
                .wrapping_add(mixed)
                .wrapping_add(e)
                .wrapping_add(constant)
                .wrapping_add(*word);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = next;
        }
        state[0] = state[0].wrapping_add(a);
        state[1] = state[1].wrapping_add(b);
        state[2] = state[2].wrapping_add(c);
        state[3] = state[3].wrapping_add(d);
        state[4] = state[4].wrapping_add(e);
    }

    let mut digest = [0u8; 20];
    for (index, word) in state.iter().enumerate() {
        digest[index * 4..index * 4 + 4].copy_from_slice(&word.to_be_bytes());
    }
    digest
}

#[cfg(test)]
mod tests;
