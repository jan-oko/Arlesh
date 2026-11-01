# Task to file: compile the business rules to wasm for the frontend

- **Project:** ARLESH, Agentic Task
- **Priority:** none (backlogged). Approved by the user on 2026-11-01: "We'll do it after the current round."
- **Do after:** the current round (Tasks 201, 289, 9298, 288)

## Title
Compile the business rules to wasm for the frontend

## Brief
Run a spike and write an ADR (Opus) first, then implement (Sonnet).

**What.** Split the pure rules layer out of `arlesh-core` into its own crate, e.g. `arlesh-rules`. These are the `*/rules` modules, and `scripts/check-rules-purity.sh` already keeps them pure. Their only dependencies are `std`, `chrono`, `serde` and the domain models, about 12.7k lines. The new crate has no `sqlx`, `tokio`, `axum` or `rmcp`. Build it with `wasm-bindgen` for the webview, on desktop and Android. The DB, MCP and HTTP stay native; this is not the whole of arlesh-core.

**Why.** The frontend would call the real Rust rules instead of TS copies pinned by `conformance/*.json`. There are 10 corpora today, and an 11th, `task-gestures.json`, arrives with Task 288 PR 2. A corpus pins only what someone wrote into it, so drift stays a risk. This also lifts ADR 0012's "only pinned rules may run locally" limit on optimistic UI.

**The spike settles:**
- Bundle size and startup cost (the async init before the first rule call).
- The boundary types: `serde-wasm-bindgen`, plus `tsify` or similar for generated TS types.
- How the Vite, CI (`lint · tsc · vitest`) and Android (`bundles.yml` build-android) builds pick it up.
- The crate split: every rules module's `crate::…` model imports move, and the old paths are kept as re-exports (as ADR 0010 did).
- Whether to retire the TS copies one corpus at a time, keeping the corpora as tests.

**Acceptance (spike):** an ADR with measured numbers and a staged migration plan the user approves before any implementation PR.
