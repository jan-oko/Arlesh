mod helpers;

use arlesh_lib::database;

#[tokio::test]
async fn connect_enables_foreign_keys() {
    let pool = database::connect("sqlite::memory:").await.unwrap();

    let fk_on: i64 = sqlx::query_scalar("PRAGMA foreign_keys")
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(fk_on, 1, "after_connect hook must enable foreign_keys");
}

#[tokio::test]
async fn run_migrations_seeds_aspects() {
    let pool = database::connect("sqlite::memory:").await.unwrap();
    database::run_migrations(&pool).await.unwrap();

    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM domains WHERE subtype = 'aspect'")
            .fetch_one(&pool)
            .await
            .unwrap();

    assert_eq!(count, 6);
}

#[tokio::test]
async fn connect_and_migrate_seeds_aspects() {
    let pool = helpers::test_pool().await;

    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM domains WHERE subtype = 'aspect'")
            .fetch_one(&pool)
            .await
            .unwrap();

    assert_eq!(count, 6, "expected 6 seeded aspects");
}

#[tokio::test]
async fn aspects_have_expected_titles() {
    let pool = helpers::test_pool().await;

    let titles: Vec<String> =
        sqlx::query_scalar("SELECT title FROM domains WHERE subtype = 'aspect' ORDER BY title")
            .fetch_all(&pool)
            .await
            .unwrap();

    assert_eq!(
        titles,
        vec!["Body", "Connections", "Duty", "Flow", "Growth", "Self"]
    );
}
