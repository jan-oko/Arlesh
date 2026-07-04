-- An NSFW flag on every node kind. When the "Work" filter is on, a marked node and its whole subtree
-- are hidden. Flow-item NSFW propagates to the item's materialized instances (copied on start).
ALTER TABLE domains ADD COLUMN nsfw BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE goals ADD COLUMN nsfw BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN nsfw BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE infos ADD COLUMN nsfw BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE flows ADD COLUMN nsfw BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE flow_goals ADD COLUMN nsfw BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE flow_tasks ADD COLUMN nsfw BOOLEAN NOT NULL DEFAULT 0;
