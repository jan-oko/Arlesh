//! Names: an agent's name and its account's label are short, visible text, and an agent's name is
//! unique among agents so it points at one of them.

#[cfg(test)]
mod tests;

/// The longest an agent's name or an account's label may be, in characters.
pub const MAX_LENGTH: usize = 48;

/// `raw` tidied into a name or label: whitespace runs become one space, control characters go, and
/// the result is cut to [`MAX_LENGTH`]. `None` when nothing is left.
pub fn tidy(raw: &str) -> Option<String> {
    let cleaned: String = raw.chars().filter(|c| !c.is_control()).collect();
    let words: Vec<&str> = cleaned.split_whitespace().collect();
    let joined = words.join(" ");
    let cut: String = joined.chars().take(MAX_LENGTH).collect();
    let cut = cut.trim().to_owned();
    (!cut.is_empty()).then_some(cut)
}

/// `wanted`, or `wanted-2`, `wanted-3` … — the first not in `taken`.
pub fn unique(wanted: &str, taken: &[String]) -> String {
    if !taken.iter().any(|name| name == wanted) {
        return wanted.to_owned();
    }
    let room = MAX_LENGTH.saturating_sub(4);
    let stem: String = wanted.chars().take(room).collect();
    (2..)
        .map(|n| format!("{stem}-{n}"))
        .find(|candidate| !taken.contains(candidate))
        .unwrap_or_else(|| wanted.to_owned())
}
