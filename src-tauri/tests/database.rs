mod helpers;

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
        vec!["Blue", "Gray", "Green", "Purple", "Red", "Steel"]
    );
}
