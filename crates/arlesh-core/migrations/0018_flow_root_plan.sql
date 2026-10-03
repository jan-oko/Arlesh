-- A flow whose Instance Type is `task` materializes its ROOT as a normal Task, which is plannable.
-- Give the flow root its own relative Cycle Plan (a plan window kind + start/end offsets within the
-- flow window), resolved to a concrete Plan on the root task at start — mirroring a flow item's Cycle
-- Plan. All three are set together, or all null (root unplanned). Ignored for goal-instance flows.
ALTER TABLE flows ADD COLUMN root_plan_kind  TEXT;
ALTER TABLE flows ADD COLUMN root_plan_start INTEGER;
ALTER TABLE flows ADD COLUMN root_plan_end   INTEGER;
