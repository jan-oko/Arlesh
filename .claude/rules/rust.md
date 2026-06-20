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
- **Domain-first**: top-level modules mirror the SPEC resource model
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
- Unit tests: inline `#[cfg(test)] mod tests { ... }` in the same file
- Integration tests: `tests/` directory
