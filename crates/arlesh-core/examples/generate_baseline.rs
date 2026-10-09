//! Writes `baseline/schema.sql`: the schema and seed data that migrations `1..=BASELINE_VERSION`
//! leave behind, so a fresh database can be created in one pass instead of by running them.
//!
//! ```text
//! cargo run -p arlesh-core --example generate_baseline            # rewrite the file
//! cargo run -p arlesh-core --example generate_baseline -- --check # fail if it is out of date
//! ```
//!
//! The same check runs as a unit test in CI. See `src/database/baseline/generate.rs`.

use std::path::PathBuf;
use std::process::ExitCode;

#[tokio::main(flavor = "current_thread")]
async fn main() -> anyhow::Result<ExitCode> {
    let generated = arlesh_core::database::baseline::generate::render().await?;
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("baseline/schema.sql");
    if std::env::args().any(|argument| argument == "--check") {
        if std::fs::read_to_string(&path)? == generated {
            return Ok(ExitCode::SUCCESS);
        }
        eprintln!(
            "{} is out of date with the migrations. Regenerate it:\n  cargo run -p arlesh-core --example generate_baseline",
            path.display()
        );
        return Ok(ExitCode::FAILURE);
    }
    std::fs::write(&path, generated)?;
    Ok(ExitCode::SUCCESS)
}
