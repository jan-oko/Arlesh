-- Habit instance generation (Phase 8.2): virtual instances are derived purely from the recurrence,
-- today, and the persisted Modifications. Blocking catch-up ('latest'/'all_pending') must know WHEN
-- an iteration was completed to compute its jump target, so record the completion time.
ALTER TABLE habit_instance_modifications ADD COLUMN resolved_at INTEGER;
