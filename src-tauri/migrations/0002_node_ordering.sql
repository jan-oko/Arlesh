-- Add position column to preserve user-defined order in domains, goals, and tasks.
-- Initial values are set to rowid so existing data keeps its insertion order.

ALTER TABLE domains ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
ALTER TABLE goals   ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks   ADD COLUMN position INTEGER NOT NULL DEFAULT 0;

UPDATE domains SET position = id;
UPDATE goals   SET position = id;
UPDATE tasks   SET position = id;
