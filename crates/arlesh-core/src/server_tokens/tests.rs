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

#[tokio::test]
async fn a_token_is_unseen_until_it_is_used() {
    let factory = factory().await;
    let mut db = factory.begin().await.unwrap();
    db.server_tokens()
        .add("phone", "digest", "2026-11-01T09:00:00")
        .await
        .unwrap();
    assert_eq!(
        db.server_tokens().issued().await.unwrap()[0].last_seen_at,
        None
    );

    assert!(db
        .server_tokens()
        .touch("phone", "2026-11-01T10:00:00")
        .await
        .unwrap());

    let issued = db.server_tokens().issued().await.unwrap();
    assert_eq!(
        issued[0].last_seen_at.as_deref(),
        Some("2026-11-01T10:00:00")
    );
}

#[tokio::test]
async fn touching_a_client_without_a_token_changes_nothing() {
    let factory = factory().await;
    let mut db = factory.begin().await.unwrap();

    assert!(!db
        .server_tokens()
        .touch("ghost", "2026-11-01T10:00:00")
        .await
        .unwrap());
}
