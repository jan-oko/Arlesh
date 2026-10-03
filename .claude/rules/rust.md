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

### Business rules
- Every business rule lives in a **`rules` module inside its domain**: `tasks/rules.rs` with its
  submodules in `tasks/rules/`, and likewise for `flows/`, `scopes/`, `capacity/` and the rest.
  `filters/` is the presets' rules layer as a whole. See ADR 0010.
- A rules module holds **pure functions over values**. It imports no session (`Db`,
  `SessionMode`), no `sqlx`, no `tauri`, no `tokio` and no `std::fs`, and it is told `now`
  rather than reading a clock. `scripts/check-rules-purity.sh` enforces this in CI. To use a
  rule, gather what it needs in the domain's `mod.rs` (persistence and composite operations) and
  pass it in.
- A new rule goes in its domain's `rules`, not inline in `mod.rs` beside the SQL. A frontend copy
  of a rule is allowed only for UX or speed, and only pinned to the Rust rule by a corpus under
  `conformance/`.
- Modules moved into `rules` keep their old path as a re-export in the parent
  (`pub use rules::lifecycle;`), so callers and the integration tests did not change when they
  moved.

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
