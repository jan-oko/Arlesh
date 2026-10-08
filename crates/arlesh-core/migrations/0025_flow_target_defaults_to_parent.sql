-- A Flow's Target Node now defaults to its parent, derived on read, rather than being snapshotted
-- into the row when the Flow is created.
--
-- Every Flow used to be created with `target_type`/`target_id` copied from its parent as a
-- "scope-valid default". Because that default was frozen into a column, moving a Flow rewrote the
-- parent and left the target behind, so the instances stayed at the old location. A NULL target now
-- means "my parent" and is resolved wherever the target is read, which carries the instances along
-- by construction and makes a non-NULL target deliberate by definition.
--
-- This migration performs that inference **once**, here, where the result can be inspected, instead
-- of leaving a heuristic in the move path forever: every Flow whose stored target already resolves
-- to its own parent has that target cleared. A Flow deliberately pointed elsewhere is untouched.
--
-- The comparison is on the **normalised node id**, not on the stored `(type, id)` pair. Aspects,
-- Projects, Domains and Tags all live in the single `domains` table and share one `domain-<id>`
-- namespace, so a Flow can carry `parent_type = 'project'` against `target_type = 'domain'` for the
-- very same row — 8 of the 15 Flows on the author's board do. Comparing the stored type strings
-- would call those different nodes and strand exactly those Flows. `entityNodeId` in
-- `src/utils/tree-layout.ts` is the frontend's spelling of the same rule; the CASE below is this
-- side's, and the two must agree.
UPDATE flows
SET target_type = NULL,
    target_id = NULL
WHERE target_type IS NOT NULL
  AND target_id IS NOT NULL
  AND target_id = parent_id
  AND CASE WHEN target_type IN ('aspect', 'project', 'domain', 'tag') THEN 'domain' ELSE target_type END
    = CASE WHEN parent_type IN ('aspect', 'project', 'domain', 'tag') THEN 'domain' ELSE parent_type END;
