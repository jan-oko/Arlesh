//! What a **compound Habit occurrence** reads as, where it touches the database: [`readings`]
//! reads the stored board only when a Habit has compound occurrences to work out, and works them
//! out with [`crate::flows::rules::compound_readings::readings_in`] (ADR 0010).

use chrono::NaiveDateTime;

use super::{error::FlowError, model::Flow, occurrences::LoadedHabit};
use crate::{
    database::session::{Db, SessionMode},
    nodes::board::StoredBoard,
};

pub use super::rules::compound_readings::Readings;
use super::rules::compound_readings::{provisional_compounds, readings_in};

/// Each compound occurrence's [`Reading`] in the iterations of `habit` something was done in.
#[tracing::instrument(skip(db, flow, habit), fields(flow_id = flow.id))]
pub(super) async fn readings<M: SessionMode>(
    db: &mut Db<M>,
    flow: &Flow,
    habit: &LoadedHabit,
    now: NaiveDateTime,
) -> Result<Readings, FlowError> {
    let Some((provisional, compound)) = provisional_compounds(flow, habit, now)? else {
        return Ok(Readings::new());
    };
    let board = StoredBoard::read(db)
        .await
        .map_err(super::rules::compound_readings::flow_error)?;
    readings_in(provisional, &compound, habit, &board, now)
}
