//! Registering a device, planning for it, and what a restart keeps.

use super::*;
use crate::access::model::{NodeKey, NodeTable};
use crate::database::session::SessionFactory;
use chrono::NaiveDate;
use sqlx::sqlite::SqlitePoolOptions;

async fn factory() -> SessionFactory {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    crate::database::run_migrations(&pool).await.unwrap();
    SessionFactory::new(pool)
}

/// Puts an agent holding the root Aspect at capacity (`true`) or back in room (`false`): the one
/// fact a device is told about capacity.
async fn set_capacity(db: &mut Db<Transactional>, locked: bool) {
    let root = NodeKey::new(NodeTable::Domain, 1);
    db.access().add_root(root).await.unwrap();
    let existing = db.agents().all().await.unwrap();
    let agent = match existing.first() {
        Some(agent) => agent.id,
        None => {
            let id = db
                .agents()
                .insert("agent", "work", "session", "digest", "2026-11-04T09:00:00")
                .await
                .unwrap();
            db.agents()
                .set_claim(id, root, "2026-11-04T09:00:00")
                .await
                .unwrap();
            id
        }
    };
    db.agents().set_locked(agent, locked).await.unwrap();
}

fn noon() -> NaiveDateTime {
    NaiveDate::from_ymd_opt(2026, 11, 4)
        .and_then(|day| day.and_hms_opt(12, 0, 0))
        .unwrap()
}

#[tokio::test]
async fn a_new_device_is_baselined_and_a_known_one_keeps_its_record() {
    let factory = factory().await;
    let mut db = factory.begin().await.unwrap();

    assert!({
        set_capacity(&mut db, true).await;
        register_device(&mut db, "phone", "token-1", noon())
    }
    .await
    .unwrap());
    let sent = db.push().sent("phone").await.unwrap();
    assert_eq!(sent.len(), 1, "the lock it found is already told");
    assert_eq!(sent[0].value, "locked");

    // The lock clears while the app is away, and the app comes back with a new token.
    assert!(!{
        set_capacity(&mut db, false).await;
        register_device(&mut db, "phone", "token-2", noon())
    }
    .await
    .unwrap());
    let plans = {
        set_capacity(&mut db, false).await;
        plan_all(&mut db, noon())
    }
    .await
    .unwrap();
    assert_eq!(plans.len(), 1, "the change is still owed");
    assert_eq!(plans[0].device.fcm_token, "token-2");
}

#[tokio::test]
async fn what_is_recorded_is_not_planned_again() {
    let factory = factory().await;
    let mut db = factory.begin().await.unwrap();
    {
        set_capacity(&mut db, false).await;
        register_device(&mut db, "phone", "t", noon())
    }
    .await
    .unwrap();

    let plans = {
        set_capacity(&mut db, true).await;
        plan_all(&mut db, noon())
    }
    .await
    .unwrap();
    assert_eq!(plans[0].events.len(), 1);
    let sent: Vec<_> = plans[0]
        .events
        .iter()
        .map(|event| SentEntry {
            key: event.key.clone(),
            value: event.value.clone(),
        })
        .collect();
    db.push().record("phone", &sent, "now").await.unwrap();

    assert!({
        set_capacity(&mut db, true).await;
        plan_all(&mut db, noon())
    }
    .await
    .unwrap()
    .is_empty());
}

#[tokio::test]
async fn a_token_belongs_to_one_device() {
    let factory = factory().await;
    let mut db = factory.begin().await.unwrap();
    {
        set_capacity(&mut db, false).await;
        register_device(&mut db, "old-name", "shared", noon())
    }
    .await
    .unwrap();
    {
        set_capacity(&mut db, false).await;
        register_device(&mut db, "new-name", "shared", noon())
    }
    .await
    .unwrap();

    let devices = db.push().devices().await.unwrap();
    assert_eq!(devices.len(), 1);
    assert_eq!(devices[0].client, "new-name");
    assert!(db.push().sent("old-name").await.unwrap().is_empty());
}

#[tokio::test]
async fn revoking_a_device_takes_its_registration_with_it() {
    let factory = factory().await;
    let mut db = factory.begin().await.unwrap();
    db.server_tokens()
        .add("phone", "digest", "2026-11-04T09:00:00")
        .await
        .unwrap();
    {
        set_capacity(&mut db, true).await;
        register_device(&mut db, "phone", "t", noon())
    }
    .await
    .unwrap();

    db.server_tokens().revoke("phone").await.unwrap();

    assert!(db.push().devices().await.unwrap().is_empty());
    assert!(db.push().sent("phone").await.unwrap().is_empty());
}
