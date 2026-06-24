# Arlesh — Domain Glossary

Canonical terms used throughout Arlesh. Code, translation keys, and documentation must use these names consistently.

---

## Entities

**Aspect** — One of six built-in, color-coded top-level life-area containers (Red, Purple, Green, Blue, Gray, Steel). Fixed roots of the domain tree; not user-managed. Hebrew: _היבט_.

**Project** — A large organizational domain (hobby, habit, workplace, etc.) parented under an Aspect or another Project. May link to an Obsidian knowledge-base directory. Hebrew: _פרויקט_.

**Domain** — A general-purpose organizational container. Can parent Goals, Tasks, Tags, or other Domains. Hebrew: _גזרה_.

**Tag** — A flat leaf node used as a resource marker. Each Tag belongs to a Domain parent. Tags cannot parent other Tags. Hebrew: _תג_ (singular), _תגיות_ (plural).

**Goal** — A desired state. Parented under a Project, Domain, or another Goal. Can have sub-goals. Hebrew: _מטרה_.

**Task** — An action item. Parented under a Project, Domain, Goal, or another Task. Hebrew: _משימה_.

**Blocker** — A condition that prevents a Task from being acted on. Either an explicit string reason or a virtual block from an unmet dependency. Hebrew: _חסם_.

**Dependency** — A prerequisite relationship from a Task to another Task or Goal. Circular dependencies are rejected at write time. Hebrew: _תלות_ (singular), _תלויות_ (plural).

---

## Status values

**Task status:** `todo` (To Do / פתוח) · `in_progress` (In Progress / בתהליך) · `done` (Done / בוצע)

**Goal status:** `active` (Active / פעיל) · `achieved` (Achieved / הושלם) · `frozen` (Frozen / מוקפא) · `archived` (Archived / בוידעם)

**Project status:** `active` (Active / פעיל) · `paused` (Paused / מושהה) · `completed` (Completed / הושלם) · `archived` (Archived / בוידעם)

---

## Knowledge Base

**Knowledge Base** — The external Obsidian vault integrated with Arlesh. Hebrew: _בסיס ידע_.

**Scope** — A time-range entity (Season / Month / Week / Day) lazily instantiated on first reference. Hebrew: _מסגרת_.

**Season** — A three-month period. Hebrew: _עונה_.

**Person** — A knowledge-base entity representing a person. Hebrew: _אדם_ (singular), _אנשים_ (plural).

**Event** — A knowledge-base entity representing an event. Hebrew: _אירוע_.

**Thread** — A knowledge-base entity representing a concretized train of thought. Hebrew: _שרשור_.

---

## Invariants

- An Aspect cannot be reparented, renamed, or deleted.
- A Tag cannot parent other Tags.
- A Goal cannot be the parent of a Task that already has another Goal parent elsewhere in the tree.
- Circular Task/Goal dependencies are always rejected.
- Type cycling (Ctrl+Up/Down) follows the valid-type sequence for the node's parent context.
