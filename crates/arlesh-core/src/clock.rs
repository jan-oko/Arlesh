//! The wall clock the server reads, in the time zone it was told to use.
//!
//! "Today", a Part of Day, Overdue and Missed are all judged on a naive local time, so which local
//! time the host reads decides what the board says. A desktop reads its device's zone (nothing sets
//! one). A server may be told a zone by name ([`set_time_zone`]), and every instant it derives the
//! board at, stamps a write with or schedules a tick by comes from [`now`], so a container running
//! in UTC can still keep the user's day. With none set, [`now`] is the machine's local time, as
//! it always was.

use std::sync::RwLock;

use chrono::{DateTime, NaiveDateTime, Utc};
use chrono_tz::Tz;

/// The zone the server was told, if it was.
static ZONE: RwLock<Option<Tz>> = RwLock::new(None);

/// A zone name no one recognises.
#[derive(Debug, thiserror::Error)]
#[error("`{0}` is not a time zone name (use an IANA name such as `Europe/Berlin` or `UTC`)")]
pub struct UnknownTimeZone(pub String);

/// Makes `name`, an IANA zone name, the zone every [`now`] is read in. Refuses a name it does not
/// know and changes nothing then.
pub fn set_time_zone(name: &str) -> Result<(), UnknownTimeZone> {
    let zone: Tz = name.parse().map_err(|_| UnknownTimeZone(name.to_owned()))?;
    *ZONE
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(zone);
    Ok(())
}

/// Goes back to the machine's local zone.
pub fn clear_time_zone() {
    *ZONE
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
}

/// The zone the server was told, if it was.
pub fn time_zone() -> Option<Tz> {
    *ZONE.read().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// The wall-clock time at `instant` in `zone`, or in the machine's local zone when there is none.
pub fn wall_clock_at(instant: DateTime<Utc>, zone: Option<Tz>) -> NaiveDateTime {
    match zone {
        Some(zone) => instant.with_timezone(&zone).naive_local(),
        None => instant.with_timezone(&chrono::Local).naive_local(),
    }
}

/// The wall-clock time now, in the configured zone, else the machine's local zone.
pub fn now() -> NaiveDateTime {
    wall_clock_at(Utc::now(), time_zone())
}

#[cfg(test)]
mod tests;
