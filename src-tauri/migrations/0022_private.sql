-- Renames the NSFW flag to `is_private`. Same mechanic, honest name: a marked node and its whole
-- subtree are hidden unless Private Mode is on. Flow-item privacy still propagates to the item's
-- materialized instances (copied on start).
ALTER TABLE domains RENAME COLUMN nsfw TO is_private;
ALTER TABLE goals RENAME COLUMN nsfw TO is_private;
ALTER TABLE tasks RENAME COLUMN nsfw TO is_private;
ALTER TABLE infos RENAME COLUMN nsfw TO is_private;
ALTER TABLE flows RENAME COLUMN nsfw TO is_private;
ALTER TABLE flow_goals RENAME COLUMN nsfw TO is_private;
ALTER TABLE flow_tasks RENAME COLUMN nsfw TO is_private;
