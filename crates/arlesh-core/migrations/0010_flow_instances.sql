-- Flow instances: the record of starting a Flow (Phase 7.4).
--
-- Starting a plain flow materialises a real, independent Goal/Task subtree under the target and
-- records it here so flow-originated nodes stay distinguishable from later additions and moves
-- are detectable. flow_id is nullable (ON DELETE SET NULL) — the copy outlives its template.
--
-- flow_instance_nodes carries one row per materialised node: which real node it is, which flow
-- item it came from (source 'flow' for the root), and the parent it was created under.

CREATE TABLE flow_instances (
    id         INTEGER PRIMARY KEY,
    flow_id    INTEGER REFERENCES flows(id) ON DELETE SET NULL,
    root_type  TEXT NOT NULL CHECK (root_type IN ('goal', 'task')),
    root_id    INTEGER NOT NULL,
    started_at INTEGER NOT NULL
);

CREATE TABLE flow_instance_nodes (
    id                   INTEGER PRIMARY KEY,
    flow_instance_id     INTEGER NOT NULL REFERENCES flow_instances(id) ON DELETE CASCADE,
    node_type            TEXT NOT NULL CHECK (node_type IN ('goal', 'task')),
    node_id              INTEGER NOT NULL,
    source_item_type     TEXT NOT NULL CHECK (source_item_type IN ('flow', 'flow_goal', 'flow_task')),
    source_item_id       INTEGER NOT NULL,
    original_parent_type TEXT NOT NULL,
    original_parent_id   INTEGER NOT NULL
);

CREATE INDEX idx_flow_instance_nodes_instance ON flow_instance_nodes (flow_instance_id);
CREATE INDEX idx_flow_instance_nodes_node ON flow_instance_nodes (node_type, node_id);
