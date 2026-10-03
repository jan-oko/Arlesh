CREATE TABLE IF NOT EXISTS infos (
    id          INTEGER PRIMARY KEY,
    body        TEXT NOT NULL,
    parent_type TEXT NOT NULL CHECK (parent_type IN ('aspect', 'project', 'domain', 'goal', 'task', 'tag', 'info')),
    parent_id   INTEGER NOT NULL,
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
