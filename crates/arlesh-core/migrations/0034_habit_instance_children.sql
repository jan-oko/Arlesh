-- An occurrence's own children: real rows attached to one virtual Habit instance and no other.
--
-- A habit occurrence had nowhere to put anything. Tonight's grocery run needs "buy milk" and the
-- only two places to write it were the flow template — where it recurs every week forever — and a
-- loose sibling Task with no link to the occurrence it belongs to. This table is the third place.
--
-- The child is a **real** row in `tasks`, `goals`, `commitments` or `infos`: fully editable,
-- scopable, taggable, and able to hold children of its own in the ordinary way. What this table
-- adds is which occurrence it hangs on, keyed by the very same
-- `(item_type, item_id, iteration_scope_id, cycle_id)` quadruple `habit_instance_modifications`
-- uses. The instance stays **virtual** — ADR 0002's materialize-on-first-touch stays rejected —
-- and storage stays proportional to divergences rather than to iterations.
--
-- The child is not parented to the occurrence through the ordinary `parent_type`/`parent_id`
-- columns, because a virtual instance has no row id for them to point at. Those columns hold the
-- occurrence's **host** instead — the flow's Target Node, the very node the occurrence renders
-- under — so a child whose attachment ever went missing would surface one level up, beside the
-- occurrence it belonged to, rather than nowhere at all.
--
-- `window_end_scope_id` is the occurrence window's closing boundary, resolved once here rather
-- than re-derived on every read. The ancestry climb that enforces containment and derives Archival
-- is generic over a read-only session, and resolving a Flow Window mints scope rows — a write. So
-- the window is settled at attach time, inside the attaching transaction, and read back as a plain
-- Time Scope `(iteration_scope_id, window_end_scope_id)` afterwards. Editing the Habit's scope or
-- repetition would leave that pair stale, which is exactly why an attached child makes its
-- occurrence divergent and raises the archive-and-new vs delete-and-regenerate prompt.
--
-- `UNIQUE (child_type, child_id)`: a child belongs to one occurrence. It is also what makes the
-- climb's lookup a point query, and what keeps a rowid SQLite has recycled from inheriting the
-- attachment of the row that used to hold it — the delete paths clear the row, and this constraint
-- is the backstop if one ever fails to.
CREATE TABLE habit_instance_children (
    id                  INTEGER PRIMARY KEY,
    flow_id             INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    -- Which instance of the iteration: a flow item, or the `flow_root` sentinel for the root.
    item_type           TEXT NOT NULL CHECK (item_type IN ('flow_goal', 'flow_task', 'flow_root')),
    item_id             INTEGER NOT NULL,
    iteration_scope_id  INTEGER NOT NULL REFERENCES scopes(id),
    -- The cycle pair the occurrence came from; 0 when the item declares none, and for the root.
    cycle_id            INTEGER NOT NULL DEFAULT 0,
    -- The occurrence window's closing boundary, resolved at attach time.
    window_end_scope_id INTEGER NOT NULL REFERENCES scopes(id),
    -- The attached row, by table. Anything a Task can parent.
    child_type          TEXT NOT NULL CHECK (child_type IN ('task', 'goal', 'commitment', 'info')),
    child_id            INTEGER NOT NULL,
    UNIQUE (child_type, child_id)
);

CREATE INDEX idx_habit_children_instance
    ON habit_instance_children (item_type, item_id, iteration_scope_id, cycle_id);
CREATE INDEX idx_habit_children_flow ON habit_instance_children (flow_id);

-- The undo journal's three triggers for the new table, in the shape
-- `scripts/generate-undo-triggers.sh` writes them. They are created here rather than in a
-- migration of their own because the table is new: a trigger can only name columns that exist when
-- its migration runs, and every column it names is created immediately above.

CREATE TRIGGER undo_journal_habit_instance_children_insert AFTER INSERT ON habit_instance_children BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'habit_instance_children', new.rowid, 'insert', NULL, json_object('id', new.id, 'flow_id', new.flow_id, 'item_type', new.item_type, 'item_id', new.item_id, 'iteration_scope_id', new.iteration_scope_id, 'cycle_id', new.cycle_id, 'window_end_scope_id', new.window_end_scope_id, 'child_type', new.child_type, 'child_id', new.child_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_habit_instance_children_update AFTER UPDATE ON habit_instance_children BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'habit_instance_children', new.rowid, 'update', json_object('id', old.id, 'flow_id', old.flow_id, 'item_type', old.item_type, 'item_id', old.item_id, 'iteration_scope_id', old.iteration_scope_id, 'cycle_id', old.cycle_id, 'window_end_scope_id', old.window_end_scope_id, 'child_type', old.child_type, 'child_id', old.child_id), json_object('id', new.id, 'flow_id', new.flow_id, 'item_type', new.item_type, 'item_id', new.item_id, 'iteration_scope_id', new.iteration_scope_id, 'cycle_id', new.cycle_id, 'window_end_scope_id', new.window_end_scope_id, 'child_type', new.child_type, 'child_id', new.child_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_habit_instance_children_delete AFTER DELETE ON habit_instance_children BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, 'habit_instance_children', old.rowid, 'delete', json_object('id', old.id, 'flow_id', old.flow_id, 'item_type', old.item_type, 'item_id', old.item_id, 'iteration_scope_id', old.iteration_scope_id, 'cycle_id', old.cycle_id, 'window_end_scope_id', old.window_end_scope_id, 'child_type', old.child_type, 'child_id', old.child_id), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;
