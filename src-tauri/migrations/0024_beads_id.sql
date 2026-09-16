-- A link from a Task, Goal or Project to the issue that tracks it in `bd` (beads), e.g.
-- "Arlesh-5fs". Nullable: most nodes are not tracked as issues, and an untracked node stores
-- nothing rather than an empty string.
--
-- The column lives on `domains` because Projects are the `project` subtype of that table; only
-- Projects are given one, and only Projects surface it in the UI. An Aspect, Domain or Tag keeps
-- NULL, like the `status` column above it.
--
-- Write access is deliberately narrow: no Tauri command and no editor writes this. The MCP server
-- is the only writer, through the `set_beads_id` method on each resource operator.
ALTER TABLE tasks ADD COLUMN beads_id TEXT;
ALTER TABLE goals ADD COLUMN beads_id TEXT;
ALTER TABLE domains ADD COLUMN beads_id TEXT;
