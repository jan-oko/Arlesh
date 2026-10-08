-- Block reasons become an ordered **list** per task/goal (previously a single `blocked_reason` column).
-- A task is additionally *virtually* blocked by any unmet dependency; those are derived at read time,
-- not stored here. The owner link is polymorphic (task or goal), so there is no foreign key — deletes
-- are cleaned up by the repository, mirroring the info-node parent link.
CREATE TABLE block_reasons (
    id          INTEGER PRIMARY KEY,
    owner_type  TEXT NOT NULL CHECK (owner_type IN ('task', 'goal')),
    owner_id    INTEGER NOT NULL,
    reason      TEXT NOT NULL,
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_block_reasons_owner ON block_reasons (owner_type, owner_id);

-- Carry each existing single reason across as the first (position 0) reason of its owner.
INSERT INTO block_reasons (owner_type, owner_id, reason, position)
    SELECT 'task', id, blocked_reason, 0 FROM tasks WHERE blocked_reason IS NOT NULL AND blocked_reason != '';
INSERT INTO block_reasons (owner_type, owner_id, reason, position)
    SELECT 'goal', id, blocked_reason, 0 FROM goals WHERE blocked_reason IS NOT NULL AND blocked_reason != '';

ALTER TABLE tasks DROP COLUMN blocked_reason;
ALTER TABLE goals DROP COLUMN blocked_reason;
