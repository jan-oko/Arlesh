# Rust Conventions

### Error handling
- Domain/library errors: `thiserror` derived enums
- Application-level propagation: `anyhow::Result` with `?`
- `.unwrap()` and `.expect()` are **banned** in non-test code — always propagate with `?`

### Async
- Runtime: **Tokio** (matches Tauri's internal runtime)

### Logging
- Library: **`tracing`** — structured, async-aware
- Use `tracing::instrument` on non-trivial async functions

### Documentation
- **Required** on all `pub` items (functions, structs, enums, modules, traits)
- Enforce with `#![deny(missing_docs)]`

### Lints
- `#![deny(clippy::all)]` in all crates

### Module structure
- **Domain-first**: top-level modules mirror the resource model in `docs/spec/resources.md`
  ```
  src/
    tasks/      — tasks, goals, blockers, dependencies
    domains/    — aspects, projects, domains, tags
    kb/         — people, events, threads
    scopes/     — seasons, months, weeks, days
    db/         — connection, migrations
    commands/   — Tauri command entry points (thin — delegate to domain modules)
  ```

### Tests
- Unit tests: `#[cfg(test)] mod tests;` in the file under test, with the body in a
  sibling — `foo.rs` declares it and `foo/tests.rs` holds it; `mod.rs` uses
  `<module>/tests.rs`. A second suite in one file takes a `*_tests` name
  (`commitment_tests` -> `foo/commitment_tests.rs`).
- Integration tests: `tests/` directory

Unit tests were inline until 2026-09-19. They moved because the coverage gate
measures with `cargo llvm-cov`, which excludes `tests.rs` and `*_tests.rs` by
filename but cannot see an inline module — inline, test bodies were 2790 of 8715
counted lines and 7735 of 13577 regions, all ~99% covered by construction, so a
third of the line metric and over half the region metric could not regress. The
alternative was `#[coverage(off)]`, which is still unstable with no target
version, so it would have meant a permanent nightly toolchain. Tests still reach
private items through `use super::*`.
