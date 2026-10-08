//! Which views read the board under a preset of their own.
//!
//! The Plan View is always Plan and the Zen View always Do. Both *read* the board under their
//! preset rather than writing it into the tab's filter, so the tab's own preset is back the moment
//! you leave. Mirrors `src/utils/view-preset.ts`; the `views` list in
//! `conformance/zen-contents.json` holds the two together.

use serde::Deserialize;

use super::{model::Preset, zen::ZEN_PRESET};

/// The preset the Plan View reads under.
pub const PLAN_VIEW_PRESET: Preset = Preset::Plan;

/// One of the app's views, as a tab names it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum View {
    /// The Mindmap.
    Mindmap,
    /// The List View.
    List,
    /// The Plan View.
    Plan,
    /// The Steps View.
    Steps,
    /// The Zen View.
    Zen,
}

/// The preset `view` always reads under, or `None` for a view that reads the tab's own.
pub fn locked_preset(view: View) -> Option<Preset> {
    match view {
        View::Plan => Some(PLAN_VIEW_PRESET),
        View::Zen => Some(ZEN_PRESET),
        View::Mindmap | View::List | View::Steps => None,
    }
}
