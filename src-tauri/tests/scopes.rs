mod helpers;

use chrono::{NaiveDate, NaiveDateTime};

use arlesh_lib::scopes::{
    model::{PartOfDay, ScopeKind},
    ScopeRepository,
};

#[tokio::test]
async fn get_or_create_day_populates_containment() {
    let pool = helpers::test_pool().await;
    let repo = ScopeRepository::new(&pool);
    let date = NaiveDate::from_ymd_opt(2026, 6, 20).unwrap();

    let day = repo.get_or_create(ScopeKind::Day, date).await.unwrap();

    assert_eq!(day.kind, "day");
    assert_eq!(day.start_date, "2026-06-20");
    assert!(day.week_id.is_some(), "day should have week_id");
    assert!(day.month_id.is_some(), "day should have month_id");
    assert!(day.season_id.is_some(), "day should have season_id");
}

#[tokio::test]
async fn week_scope_has_correct_sunday_to_saturday_bounds() {
    let pool = helpers::test_pool().await;
    let repo = ScopeRepository::new(&pool);
    // 2026-06-20 is a Saturday; week should start 2026-06-14 (Sunday)
    let date = NaiveDate::from_ymd_opt(2026, 6, 20).unwrap();

    let week = repo.get_or_create(ScopeKind::Week, date).await.unwrap();

    assert_eq!(week.start_date, "2026-06-14");
    assert_eq!(week.end_date, "2026-06-20");
}

#[tokio::test]
async fn month_scope_has_correct_bounds() {
    let pool = helpers::test_pool().await;
    let repo = ScopeRepository::new(&pool);
    let date = NaiveDate::from_ymd_opt(2026, 6, 15).unwrap();

    let month = repo.get_or_create(ScopeKind::Month, date).await.unwrap();

    assert_eq!(month.start_date, "2026-06-01");
    assert_eq!(month.end_date, "2026-06-30");
    assert_eq!(month.label, "June 2026");
}

#[tokio::test]
async fn season_is_summer_for_june() {
    let pool = helpers::test_pool().await;
    let repo = ScopeRepository::new(&pool);
    let date = NaiveDate::from_ymd_opt(2026, 6, 20).unwrap();

    let season = repo.get_or_create(ScopeKind::Season, date).await.unwrap();

    assert_eq!(season.label, "Summer 2026");
    assert_eq!(season.start_date, "2026-06-01");
    assert_eq!(season.end_date, "2026-08-31");
}

#[tokio::test]
async fn get_or_create_is_idempotent() {
    let pool = helpers::test_pool().await;
    let repo = ScopeRepository::new(&pool);
    let date = NaiveDate::from_ymd_opt(2026, 6, 20).unwrap();

    let first = repo.get_or_create(ScopeKind::Day, date).await.unwrap();
    let second = repo.get_or_create(ScopeKind::Day, date).await.unwrap();

    assert_eq!(first.id, second.id);
}

#[tokio::test]
async fn winter_season_spans_dec_to_feb() {
    let pool = helpers::test_pool().await;
    let repo = ScopeRepository::new(&pool);
    // Dec 2026 → Winter 2026 (starts Dec 1 2026, ends Feb 28 2027)
    let date = NaiveDate::from_ymd_opt(2026, 12, 1).unwrap();

    let season = repo.get_or_create(ScopeKind::Season, date).await.unwrap();

    assert_eq!(season.label, "Winter 2026");
    assert_eq!(season.start_date, "2026-12-01");
    assert_eq!(season.end_date, "2027-02-28");
}

#[tokio::test]
async fn december_month_scope_spans_into_next_year() {
    let pool = helpers::test_pool().await;
    let repo = ScopeRepository::new(&pool);
    let date = NaiveDate::from_ymd_opt(2026, 12, 15).unwrap();

    let month = repo.get_or_create(ScopeKind::Month, date).await.unwrap();

    assert_eq!(month.start_date, "2026-12-01");
    assert_eq!(month.end_date, "2026-12-31");
    assert_eq!(month.label, "December 2026");
}

#[tokio::test]
async fn get_or_create_part_populates_day_and_containment() {
    let pool = helpers::test_pool().await;
    let repo = ScopeRepository::new(&pool);
    let date = NaiveDate::from_ymd_opt(2026, 6, 20).unwrap();

    let morning = repo.get_or_create_part(date, PartOfDay::Morning).await.unwrap();

    assert_eq!(morning.kind, "part_of_day");
    assert_eq!(morning.start_date, "2026-06-20");
    assert_eq!(morning.end_date, "2026-06-20");
    assert_eq!(morning.part.as_deref(), Some("morning"));
    assert!(morning.day_id.is_some(), "part should have day_id");
    assert!(morning.week_id.is_some(), "part should inherit week_id");
    assert!(morning.season_id.is_some(), "part should inherit season_id");
}

#[tokio::test]
async fn night_part_ends_on_the_following_day() {
    let pool = helpers::test_pool().await;
    let repo = ScopeRepository::new(&pool);
    let date = NaiveDate::from_ymd_opt(2026, 6, 20).unwrap();

    let night = repo.get_or_create_part(date, PartOfDay::Night).await.unwrap();

    assert_eq!(night.start_date, "2026-06-20");
    assert_eq!(night.end_date, "2026-06-21");
}

#[tokio::test]
async fn get_or_create_part_is_idempotent_per_part() {
    let pool = helpers::test_pool().await;
    let repo = ScopeRepository::new(&pool);
    let date = NaiveDate::from_ymd_opt(2026, 6, 20).unwrap();

    let first = repo.get_or_create_part(date, PartOfDay::Noon).await.unwrap();
    let second = repo.get_or_create_part(date, PartOfDay::Noon).await.unwrap();
    let other = repo.get_or_create_part(date, PartOfDay::Evening).await.unwrap();

    assert_eq!(first.id, second.id);
    assert_ne!(first.id, other.id, "different parts of the same day are distinct scopes");
}

#[tokio::test]
async fn get_or_create_exact_stores_datetimes_and_is_idempotent() {
    let pool = helpers::test_pool().await;
    let repo = ScopeRepository::new(&pool);
    let start = "2026-06-20T09:30:00".parse::<NaiveDateTime>().unwrap();
    let end = "2026-06-22T14:00:00".parse::<NaiveDateTime>().unwrap();

    let first = repo.get_or_create_exact(start, end).await.unwrap();
    let second = repo.get_or_create_exact(start, end).await.unwrap();

    assert_eq!(first.kind, "exact");
    assert_eq!(first.start_datetime.as_deref(), Some("2026-06-20T09:30:00"));
    assert_eq!(first.end_datetime.as_deref(), Some("2026-06-22T14:00:00"));
    assert_eq!(first.start_date, "2026-06-20");
    assert_eq!(first.end_date, "2026-06-22");
    assert_eq!(first.id, second.id, "identical exact windows dedupe");
}
