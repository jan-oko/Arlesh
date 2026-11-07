//! The secrets of the agents' doors: tokens, PINs and their digests.
//!
//! Impure on purpose — it reads the operating system's entropy — so it lives beside the rules
//! rather than in them. A token is 256 random bits, so a plain SHA-256 digest is all that is kept.

use sha2::{Digest, Sha256};

use super::{error::AgentError, rules::pins};

/// 256 random bits as 64 hex digits: an agent token or a connect token.
pub fn random_token() -> Result<String, AgentError> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|error| AgentError::Entropy(error.to_string()))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

/// A random PIN of [`pins::LENGTH`] digits.
pub fn random_pin() -> Result<String, AgentError> {
    let mut bytes = [0u8; 8];
    getrandom::fill(&mut bytes).map_err(|error| AgentError::Entropy(error.to_string()))?;
    // The modulo bias over 2^64 values is a few parts in 10^11: not worth a rejection loop.
    let modulus = 10u64.pow(u32::try_from(pins::LENGTH).unwrap_or(8));
    Ok(format!(
        "{:0width$}",
        u64::from_le_bytes(bytes) % modulus,
        width = pins::LENGTH
    ))
}

/// The SHA-256 digest of `secret`, as 64 hex digits.
pub fn digest(secret: &str) -> String {
    Sha256::digest(secret.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[cfg(test)]
mod tests;
