-- Backlog: a Task's own stored Archival state.
--
-- A Task has always had a status (`todo`/`in_progress`/`done`) saying *where the work stands*, and
-- no way at all to say *this is not in play right now*. Goals and Projects have had that since the
-- beginning, as their **Frozen** status. This column is the Task-side answer.
--
-- It is deliberately NOT a fourth `status` value. Status and Archival are separate axes — "where is
-- this in its work" against "is this in play at all" — and a backlogged Task keeps whatever status
-- it had, so pulling it back into the week does not lose the fact that it was already in progress.
-- A fourth status value would conflate the two and would collide with the Enter status cycle.
--
-- Two values only. `frozen` and `archived` are Goal/Project vocabulary and are never valid here: a
-- Task is never manually Archived (a Task's effective Archival is forced by its scope Resolution),
-- and Frozen and Backlog are deliberately kept as separate concepts, with no mapping between them
-- on retype. The CHECK is what keeps the other two out.
--
-- `live` is the default, so every existing Task keeps behaving exactly as it did.
ALTER TABLE tasks ADD COLUMN archival TEXT NOT NULL DEFAULT 'live'
    CHECK (archival IN ('live', 'backlog'));
