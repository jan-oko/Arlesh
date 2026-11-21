use super::*;
use crate::nodes::id::parse_row_id;

async fn mint(seed: RowId, count: usize) -> Vec<RowId> {
    with_seed(seed, async { (0..count).map(|_| new_row_id()).collect() }).await
}

#[tokio::test]
async fn the_same_seed_mints_the_same_ids() {
    let seed = Uuid::now_v7().hyphenated();

    assert_eq!(mint(seed, 5).await, mint(seed, 5).await);
}

#[tokio::test]
async fn one_seed_mints_distinct_ids_and_another_seed_other_ids() {
    let ids = mint(Uuid::now_v7().hyphenated(), 5).await;

    let distinct: std::collections::HashSet<_> = ids.iter().collect();
    assert_eq!(distinct.len(), 5);
    assert_ne!(ids, mint(Uuid::now_v7().hyphenated(), 5).await);
}

#[tokio::test]
async fn a_seeded_id_is_a_valid_uuid_v7_stamped_with_the_seeds_time() {
    let seed = Uuid::now_v7().hyphenated();

    for id in mint(seed, 3).await {
        let parsed = parse_row_id(&id.to_string()).unwrap().into_uuid();
        assert_eq!(parsed.get_version_num(), 7);
        assert_eq!(parsed.get_timestamp(), seed.as_uuid().get_timestamp());
    }
}

#[tokio::test]
async fn without_a_seed_ids_are_random_and_no_seed_is_current() {
    assert_eq!(current_seed(), None);
    assert_ne!(new_row_id(), new_row_id());
}

#[tokio::test]
async fn the_current_seed_is_the_one_the_write_runs_under() {
    let seed = Uuid::now_v7().hyphenated();

    let seen = with_seed(seed, async { current_seed() }).await;

    assert_eq!(seen, Some(seed));
}
