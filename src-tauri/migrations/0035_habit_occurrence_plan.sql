-- One Habit occurrence planned on its own, overriding the Cycle Plan for that iteration alone.
--
-- A Habit's occurrences take their Plan from the flow item's Cycle Plan, resolved per iteration,
-- so every occurrence was scheduled identically forever. The exception is the normal case — this
-- week's run moves to the morning, tonight's grocery trip slips to Saturday — and the only ways to
-- say so were to edit the template (moving every future occurrence with it) or to leave the plan
-- wrong. The override is one more divergence in the overlay that already records status: the
-- instance stays virtual (ADR 0002) and storage stays proportional to the occurrences that differ.
--
-- It is a true three-state, which is why it takes a flag and not just the scope columns:
--
--   plan_overridden  plan_start_id / plan_end_id  effective plan
--         0                  NULL / NULL          inherit the Cycle Plan
--         1                 scope / scope         that window
--         1                  NULL / NULL          deliberately unplanned
--
-- The overlay's other columns use NULL for "no divergence", which works because each always has a
-- template value to fall back on. A Plan is optional, so NULL alone could not tell "inherit" from
-- "none", and the second would silently put back a plan the user removed. A sentinel scope id
-- was rejected: it would put a magic number in a column that is otherwise a foreign key.
--
-- The window is a start/end pair, as a Task's Plan and a Cycle Plan both are, so the Plan control
-- works on an occurrence exactly as it does on a Task — one scope or a range.
ALTER TABLE habit_instance_modifications
    ADD COLUMN plan_overridden INTEGER NOT NULL DEFAULT 0 CHECK (plan_overridden IN (0, 1));
ALTER TABLE habit_instance_modifications
    ADD COLUMN plan_start_id INTEGER REFERENCES scopes(id);
ALTER TABLE habit_instance_modifications
    ADD COLUMN plan_end_id INTEGER REFERENCES scopes(id);
