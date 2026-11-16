use std::borrow::Cow;
use std::str::FromStr;
#[tokio::main(flavor = "current_thread")]
async fn main() -> anyhow::Result<()> {
    let path = std::env::args().nth(1).expect("path");
    let upto: i64 = std::env::args()
        .nth(2)
        .map(|s| s.parse().unwrap())
        .unwrap_or(i64::MAX);
    let options = sqlx::sqlite::SqliteConnectOptions::from_str(&format!("sqlite://{path}"))?;
    let pool = arlesh_core::database::connect_with(options, false).await?;
    let all: Vec<_> = arlesh_core::database::MIGRATOR
        .iter()
        .filter(|m| m.version <= upto)
        .cloned()
        .collect();
    let chain = sqlx::migrate::Migrator {
        migrations: Cow::Owned(all),
        ..sqlx::migrate::Migrator::DEFAULT
    };
    if upto == i64::MAX {
        arlesh_core::database::migrate(&pool).await?;
    } else {
        chain.run(&pool).await?;
    }
    Ok(())
}
