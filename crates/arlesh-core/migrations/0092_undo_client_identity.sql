-- Client identity: every journal entry records which client wrote it.
--
-- A client is the program a write came through: the desktop app is `desktop`, and anything else
-- that opens the database for writing — a Python session through the bindings, later a phone or a
-- web client — names itself. It is a second axis beside `source`, not a replacement for it:
--
--   source  WHO acted: `user` (a person) or `mcp` (an agent). The MCP endpoint is served by the
--           desktop app, so an agent's write is source `mcp` from client `desktop`.
--   client  WHICH program carried the write: `desktop`, or the name a writer opened with.
--
-- The app's Ctrl+Z reverts only entries that are source `user` AND client `desktop`, so a script's
-- write — or one from another device — never lands on the desktop user's Undo Stack, even when it
-- happened while one of the app's Gestures was open and so carries that Gesture's id.
--
-- The ambient context's `client` is `desktop` whenever no transaction is open: a writer under any
-- other name sets it as the first statement of its own transaction and puts it back as the last
-- (`SessionFactory::begin` and `Db::commit`), under SQLite's single writer lock, so no other
-- connection ever sees it changed. A rollback restores it on its own.
ALTER TABLE undo_context ADD COLUMN client TEXT NOT NULL DEFAULT 'desktop';

ALTER TABLE undo_journal ADD COLUMN client TEXT NOT NULL DEFAULT 'desktop';

-- The journal triggers on the board tables name their columns explicitly and do not copy
-- `client`; one trigger here stamps every new entry from the context instead. That keeps the ~45
-- generated triggers as they are, and a table added later is stamped without anyone regenerating
-- anything — the same "cannot be forgotten" property the journal itself rests on (ADR 0006).
-- Named outside the `undo_journal_<table>_<operation>` pattern on purpose: that pattern is the
-- per-table journal triggers, which `tests/undo_journal.rs` counts against the journaled tables.
CREATE TRIGGER stamp_undo_journal_client AFTER INSERT ON undo_journal BEGIN
    UPDATE undo_journal
       SET client = (SELECT client FROM undo_context WHERE id = 1)
     WHERE seq = new.seq;
END;
