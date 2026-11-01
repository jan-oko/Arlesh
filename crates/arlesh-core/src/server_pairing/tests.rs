use super::*;
use crate::database::session::SessionFactory;
use sqlx::sqlite::SqlitePoolOptions;

async fn factory() -> SessionFactory {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("failed to open in-memory SQLite");
    crate::database::run_migrations(&pool)
        .await
        .expect("migrations failed");
    SessionFactory::new(pool)
}

fn request(pin: &str, expires_at: &str) -> PairingPin {
    PairingPin {
        id_sha256: format!("id-{pin}"),
        pin: pin.to_string(),
        name: "phone".to_string(),
        approved_name: None,
        attempts: 0,
        created_at: "2026-11-01T10:00:00".to_string(),
        expires_at: expires_at.to_string(),
    }
}

#[tokio::test]
async fn a_pin_in_use_is_not_recorded_twice() {
    let factory = factory().await;
    let mut db = factory.begin().await.unwrap();

    assert!(db
        .pairing_pins()
        .create(&request("123456", "2026-11-01T10:10:00"))
        .await
        .unwrap());
    let mut again = request("123456", "2026-11-01T10:10:00");
    again.id_sha256 = "another".to_string();

    assert!(!db.pairing_pins().create(&again).await.unwrap());
    assert_eq!(db.pairing_pins().all().await.unwrap().len(), 1);
}

#[tokio::test]
async fn a_request_is_approved_once() {
    let factory = factory().await;
    let mut db = factory.begin().await.unwrap();
    db.pairing_pins()
        .create(&request("123456", "2026-11-01T10:10:00"))
        .await
        .unwrap();

    assert!(db.pairing_pins().approve("123456", "pixel").await.unwrap());
    assert!(!db.pairing_pins().approve("123456", "other").await.unwrap());
    assert!(!db.pairing_pins().approve("000000", "pixel").await.unwrap());

    let rows = db.pairing_pins().all().await.unwrap();
    assert_eq!(rows[0].approved_name.as_deref(), Some("pixel"));
}

#[tokio::test]
async fn wrong_attempts_are_counted_per_request() {
    let factory = factory().await;
    let mut db = factory.begin().await.unwrap();
    db.pairing_pins()
        .create(&request("123456", "2026-11-01T10:10:00"))
        .await
        .unwrap();

    assert_eq!(
        db.pairing_pins().count_attempt("id-123456").await.unwrap(),
        Some(1)
    );
    assert_eq!(
        db.pairing_pins().count_attempt("id-123456").await.unwrap(),
        Some(2)
    );
    assert_eq!(
        db.pairing_pins().count_attempt("nobody").await.unwrap(),
        None
    );
}

#[tokio::test]
async fn expired_requests_are_purged_and_live_ones_kept() {
    let factory = factory().await;
    let mut db = factory.begin().await.unwrap();
    db.pairing_pins()
        .create(&request("111111", "2026-11-01T10:10:00"))
        .await
        .unwrap();
    db.pairing_pins()
        .create(&request("222222", "2026-11-01T10:20:00"))
        .await
        .unwrap();

    let purged = db
        .pairing_pins()
        .purge_expired("2026-11-01T10:10:00")
        .await
        .unwrap();

    assert_eq!(purged, 1);
    let left = db.pairing_pins().all().await.unwrap();
    assert_eq!(left.len(), 1);
    assert_eq!(left[0].pin, "222222");
}

#[tokio::test]
async fn a_deleted_request_is_gone() {
    let factory = factory().await;
    let mut db = factory.begin().await.unwrap();
    db.pairing_pins()
        .create(&request("123456", "2026-11-01T10:10:00"))
        .await
        .unwrap();

    assert!(db.pairing_pins().delete("id-123456").await.unwrap());
    assert!(!db.pairing_pins().delete("id-123456").await.unwrap());
}
