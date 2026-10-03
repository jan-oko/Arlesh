-- Backfill the Project status that the app has always implied.
--
-- `domains.status` is nullable and Projects were created with NULL unless one was chosen. Every
-- status-aware surface already reads an unset container status as Active (`UNSET_STATUS` in
-- `filter-tree.ts`), so those Projects behaved as active in the Mindmap and in every preset.
--
-- List View's Project-status filter was the exception: it matches a row's stored value, and a
-- NULL produces no value to match, so filtering by "active" excluded every unset Project — and
-- with it every task underneath. Storing the value the app already assumes makes the filter
-- agree with the rest of the app.
--
-- Only Projects are touched. A Domain, Aspect or Tag cannot be given a status (the editors offer
-- none, and the filters read them through their own container rules), so their NULL is correct
-- and is left alone.
UPDATE domains
SET status = 'active'
WHERE subtype = 'project'
  AND status IS NULL;
