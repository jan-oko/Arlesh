# Versioning Rule

## On every meaningful change

Update `CHANGELOG.md` under `[Unreleased]` with a brief entry describing what changed.
Use Keep a Changelog section headings: `Added`, `Changed`, `Fixed`, `Removed`.

Update `README.md` if the change affects the project overview, stack, or phase status.

Update `SPEC.md` if the change reflects a design decision.

## On version bumps

Do NOT update `VERSION.txt` automatically. Instead, ask the user:
> "This feels like it warrants a version bump — want me to bump to X.Y.Z?"

Suggest a version based on semver:
- **Patch** (0.1.x) — fixes, doc corrections, minor spec clarifications
- **Minor** (0.x.0) — new features, completed implementation phases, significant spec additions
- **Major** (x.0.0) — breaking architectural changes, complete redesigns

When the user confirms, update `VERSION.txt` and move `[Unreleased]` entries in `CHANGELOG.md`
to a new `[X.Y.Z] — YYYY-MM-DD` section.
