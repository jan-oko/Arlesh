//! Tauri commands for commitment operations.
//!
//! Thin, like every other command module: open a session, delegate, commit. Note that there is
//! no `set_verdict` command — recording, changing and clearing a verdict are all one ordinary
//! [`update_commitment`] write, so a misclick is undone by the same call that made it.

use tauri::State;

use crate::{
    database::session::SessionFactory,
    error::WireError,
    nodes::{id::NodeId, write},
    tasks::model::{Commitment, CommitmentId, CreateCommitmentRequest, UpdateCommitmentRequest},
};

/// Creates a new commitment.
///
/// Refused when the commitment would have no effective Time Scope — neither its own nor a scoped
/// ancestor's. That is the one write rule unique to this kind: a rule held over no window has
/// nothing to be kept or broken over.
#[tauri::command]
pub async fn create_commitment(
    factory: State<'_, SessionFactory>,
    request: CreateCommitmentRequest,
) -> Result<Commitment, WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    let commitment = crate::tasks::create_commitment(&mut db, request)
        .await
        .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)?;
    Ok(commitment)
}

/// Fetches a commitment by id.
#[tauri::command]
pub async fn get_commitment(
    factory: State<'_, SessionFactory>,
    id: i64,
) -> Result<Commitment, WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.commitments()
        .get(CommitmentId(id))
        .await
        .map_err(WireError::from_error)
}

/// Lists every commitment — the Commitment virtual table: stored rows and every commitment
/// Habit's iterations.
#[tauri::command]
pub async fn list_commitments(
    factory: State<'_, SessionFactory>,
    now: chrono::NaiveDateTime,
) -> Result<Vec<Commitment>, WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    let load = crate::mindmap::load(&mut db, now)
        .await
        .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)?;
    Ok(load.commitments)
}

/// Updates a commitment, stored or derived — including recording, changing or clearing its
/// Verdict.
#[tauri::command]
pub async fn update_commitment(
    factory: State<'_, SessionFactory>,
    id: NodeId,
    request: UpdateCommitmentRequest,
) -> Result<Commitment, WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    let commitment =
        write::update_commitment(&mut db, &id, request, chrono::Local::now().naive_local())
            .await
            .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)?;
    Ok(commitment)
}

/// Deletes a commitment and everything beneath it — or archives a commitment Habit's iteration,
/// which is never deleted.
#[tauri::command]
pub async fn delete_commitment(
    factory: State<'_, SessionFactory>,
    id: NodeId,
) -> Result<(), WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    write::delete(
        &mut db,
        "commitment",
        &id,
        chrono::Local::now().naive_local(),
    )
    .await
    .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)
}

/// Adds a tag to a commitment.
#[tauri::command]
pub async fn add_tag_to_commitment(
    factory: State<'_, SessionFactory>,
    commitment_id: i64,
    tag_id: i64,
) -> Result<(), WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.commitments()
        .add_tag(CommitmentId(commitment_id), tag_id)
        .await
        .map_err(WireError::from_error)
}

/// Removes a tag from a commitment.
#[tauri::command]
pub async fn remove_tag_from_commitment(
    factory: State<'_, SessionFactory>,
    commitment_id: i64,
    tag_id: i64,
) -> Result<(), WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.commitments()
        .remove_tag(CommitmentId(commitment_id), tag_id)
        .await
        .map_err(WireError::from_error)
}
