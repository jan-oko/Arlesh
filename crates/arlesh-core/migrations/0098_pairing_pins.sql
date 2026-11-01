-- Device pairing for `arlesh-server` (Task 289; settled with the user 2026-11-01).
--
-- A new device asks `POST /pair` for a six-digit PIN, shows it, and polls; someone signed in
-- approves the PIN (on the server's command line or in Settings -> Devices), and the device's next
-- poll receives its own token, once. This table holds a request from its creation until it is
-- claimed, expires or is invalidated; a claimed, expired or invalidated row is deleted, so it
-- holds only live requests.
--
-- **Server-only**, like `server_tokens` (0097): the desktop app never reads or writes it, and it
-- is created in every database only because there is one migration chain. Not journaled
-- (`undo::EXCLUDED_TABLES`): pairing is not a board edit.
--
-- The poll's secret is kept as a SHA-256 digest, as a token is. No token text is ever stored here:
-- the token is made, and recorded in `server_tokens`, at the poll that claims it.
CREATE TABLE pairing_pins (
    id_sha256     TEXT PRIMARY KEY NOT NULL,
    pin           TEXT NOT NULL UNIQUE,
    -- The name the device suggested, already reduced to a client name.
    name          TEXT NOT NULL,
    -- The name the approver settled on; NULL until the PIN is approved.
    approved_name TEXT,
    -- Wrong PINs presented with this request's id.
    attempts      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL,
    expires_at    TEXT NOT NULL
);

-- When each device last used its token, for Settings -> Devices. NULL: never seen since this
-- column existed.
ALTER TABLE server_tokens ADD COLUMN last_seen_at TEXT;
