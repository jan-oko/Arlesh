//! The rules a Flow template's items answer to as items: where each kind may sit, which may wait
//! on which, and — for a wait item — when each occurrence's first check falls.
//!
//! Placement is the parenting table for stored nodes ([`crate::nodes::rules::parenting`]), applied
//! to the items as the kinds they draw, with no template-only exception (ruled by the user,
//! 2026-10-03: "follow the table"). The one rule the table cannot say is the Flow's own: a
//! **commitment** Flow's root is a Commitment, which holds no Goal, so it takes no Goal item.
//!
//! Pure (ADR 0010).

use chrono::NaiveDateTime;

use crate::{
    flows::{
        error::FlowError,
        model::{FirstCheck, FlowItemType},
        rules::schedule::offset_scope,
    },
    nodes::rules::parenting::{kind_of, may_parent},
    scopes::{key::ScopeKey, model::PartOfDay},
    tasks::rules::waits::day_of,
};

/// The parenting table's kind for an item kind.
fn node_kind(kind: FlowItemType) -> crate::filters::model::NodeKind {
    use crate::filters::model::NodeKind;
    match kind {
        FlowItemType::FlowGoal => NodeKind::FlowGoal,
        FlowItemType::FlowTask => NodeKind::FlowTask,
        FlowItemType::FlowCommitment => NodeKind::FlowCommitment,
        FlowItemType::FlowExpectation => NodeKind::FlowExpectation,
    }
}

/// Whether an item of `kind` may sit under a template parent spelled `parent_type` (`flow` or an
/// item kind), in a Flow whose Instance Type is `instance_type`.
pub fn may_hold(kind: FlowItemType, parent_type: &str, instance_type: &str) -> bool {
    if kind == FlowItemType::FlowGoal && parent_type == "flow" && instance_type == "commitment" {
        return false;
    }
    kind_of(parent_type).is_some_and(|parent| may_parent(node_kind(kind), parent))
}

/// [`may_hold`], refused by name: what may hold `kind`, said in the words the editor uses.
pub fn require_placement(
    kind: FlowItemType,
    parent_type: &str,
    instance_type: &str,
) -> Result<(), FlowError> {
    if may_hold(kind, parent_type, instance_type) {
        return Ok(());
    }
    let what = match kind {
        FlowItemType::FlowGoal => "a goal item sits under a goal Flow's root or a goal item",
        FlowItemType::FlowTask => "a task item",
        FlowItemType::FlowCommitment => "a commitment item",
        FlowItemType::FlowExpectation => "a wait item",
    };
    if kind == FlowItemType::FlowGoal {
        return Err(FlowError::Invalid(format!(
            "{what} — not a {parent_type}; a Commitment or a Task holds no Goal"
        )));
    }
    Err(FlowError::Invalid(format!(
        "{what} sits under the Flow or a goal, task or commitment item — not a {parent_type}"
    )))
}

/// Whether a template edge may run from `dependent` to `depends_on`: only a Task waits on
/// anything, and it waits on a Task, a Goal or a wait — never a Commitment, which nothing waits
/// on, stored or templated.
pub fn may_depend(dependent: FlowItemType, depends_on: FlowItemType) -> bool {
    dependent == FlowItemType::FlowTask && depends_on != FlowItemType::FlowCommitment
}

/// The kinds a first check may be counted in, finest last.
pub const FIRST_CHECK_KINDS: [&str; 5] = ["season", "month", "week", "day", "part_of_day"];

/// Refuses a first check that names no countable unit, or no unit at all.
pub fn require_first_check(first: &FirstCheck) -> Result<(), FlowError> {
    if !FIRST_CHECK_KINDS.contains(&first.kind.as_str()) {
        return Err(FlowError::Invalid(format!(
            "a first check is counted in seasons, months, weeks, days or parts of the day — not {}",
            first.kind
        )));
    }
    if first.index < 1 {
        return Err(FlowError::Invalid(
            "a first check is counted from 1, the window's first unit".to_string(),
        ));
    }
    Ok(())
}

/// When one wait occurrence's first check falls: the start of the `index`-th unit of its first
/// check's kind, counted from its window's start — or the window's start itself when the item
/// names none. Never before the window starts: a unit the window begins part-way through is
/// counted from the window's start.
///
/// A part of the day is counted from the part the window starts in, so the first Noon of a
/// window opening at Noon is that Noon.
pub fn first_check_at(
    window_start: NaiveDateTime,
    first: Option<&FirstCheck>,
) -> Result<NaiveDateTime, FlowError> {
    let Some(first) = first else {
        return Ok(window_start);
    };
    require_first_check(first)?;
    let day = day_of(window_start);
    let unit = if first.kind == "part_of_day" {
        part_from(window_start, first.index)?
    } else {
        offset_scope(day, first.index, &first.kind)?
    };
    Ok(unit.bounds().0.max(window_start))
}

/// The six parts in the order a Day runs through them, from its 02:00 start.
const DAY_ORDER: [PartOfDay; 6] = [
    PartOfDay::Premorning,
    PartOfDay::Morning,
    PartOfDay::Noon,
    PartOfDay::Afternoon,
    PartOfDay::Evening,
    PartOfDay::Night,
];

/// The `index`-th part of the day (1-based), counting the part `start` falls in as the first.
fn part_from(start: NaiveDateTime, index: i64) -> Result<ScopeKey, FlowError> {
    let part = PartOfDay::containing(chrono::Timelike::hour(&start));
    let from = DAY_ORDER
        .iter()
        .position(|candidate| *candidate == part)
        .and_then(|position| i64::try_from(position).ok())
        .unwrap_or(0);
    let step = from + index - 1;
    let date = day_of(start)
        .checked_add_signed(chrono::Duration::days(step / 6))
        .ok_or_else(|| FlowError::Invalid("a first check falls outside the calendar".to_string()))?;
    let part = DAY_ORDER[usize::try_from(step % 6).unwrap_or(0)];
    Ok(ScopeKey::part(date, part))
}

#[cfg(test)]
mod tests;
