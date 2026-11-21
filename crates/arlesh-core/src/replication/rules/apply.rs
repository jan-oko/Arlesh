//! What a Replica does with a live event: apply it, skip it, or fetch a whole board.
//!
//! Pure: the position the Replica holds and the two positions the event states go in, a decision
//! comes out (`docs/spec/client-mode.md`, *The source rows*).

/// What a Replica holding rows at one position does with an event.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    /// The rows are already held (`upto` is not past the position): nothing to do.
    Held,
    /// Apply the event's rows whose `seq` is past `skip_through`, then move to the event's `upto`.
    Apply {
        /// Rows at or before this position are already held.
        skip_through: i64,
    },
    /// The event's `base` is past the position, so an event was missed: fetch a snapshot.
    Gap,
}

/// Decides what a Replica at `position` does with an event stating `base` and `upto`.
pub fn decide(position: i64, base: i64, upto: i64) -> Decision {
    if upto <= position {
        return Decision::Held;
    }
    if base > position {
        return Decision::Gap;
    }
    Decision::Apply {
        skip_through: position,
    }
}
