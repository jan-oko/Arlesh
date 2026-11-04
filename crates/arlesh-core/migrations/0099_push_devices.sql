-- Phone push notifications (docs/spec/notifications.md; settled with the user 2026-10-31 and
-- 2026-11-04).
--
-- `arlesh-server` tells a registered device when something on the board needs the user, through
-- Firebase Cloud Messaging. A device registers its FCM token under its own client name (the name
-- its bearer token carries), and the server records, per device, what it has already sent, so a
-- restart never sends the same notification twice.
--
-- **Server-only**, like `server_tokens` (0097): the desktop app never reads or writes these
-- tables; they exist in every database only because there is one migration chain. Not journaled
-- (`undo::EXCLUDED_TABLES`): a registration is not a board edit.
CREATE TABLE push_devices (
    client        TEXT PRIMARY KEY NOT NULL,
    -- The device's FCM registration token. One token belongs to one device.
    fcm_token     TEXT NOT NULL,
    registered_at TEXT NOT NULL
);

-- What the server has notified each device of. A key names one fact on the board
-- (`question:<wait>`, `overdue:<task>`, `generated:<task>`) and is deleted when the fact stops
-- holding; the single key `capacity` holds the lock state last notified in `value`.
CREATE TABLE push_sent (
    client  TEXT NOT NULL,
    key     TEXT NOT NULL,
    value   TEXT NOT NULL DEFAULT '',
    sent_at TEXT NOT NULL,
    PRIMARY KEY (client, key)
);
