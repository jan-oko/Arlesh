#!/usr/bin/env python3
"""Checks migration 0107 on a copy of a real database: BEFORE is the integer-id database,
AFTER the same file migrated. It recomputes every new id with its own UUID-v5 and compares row by row.

Usage: scripts/verify-uuid-migration.py BEFORE.db AFTER.db

Reads both read-only. The hash is hashlib's SHA-1, not the Rust one, so the two implementations
check each other. Exits 1 on any difference.
"""
import hashlib
import json
import re
import sqlite3
import sys
import uuid

NAMESPACE = bytes([0x0d, 0x75, 0xff, 0x4b, 0x96, 0x52, 0x45, 0x96, 0x9d, 0x2f, 0x19, 0x09, 0x23, 0x0b, 0x66, 0x2b])
NIL = "00000000-0000-0000-0000-000000000000"

KINDS = {
    "domains": "domain", "people": "person", "threads": "thread", "events": "event",
    "tasks": "task", "goals": "goal", "commitments": "commitment", "expectations": "expectation",
    "infos": "info", "flows": "flow", "flow_goals": "flow_goal", "flow_tasks": "flow_task",
    "flow_commitments": "flow_commitment", "flow_expectations": "flow_expectation",
    "flow_instances": "flow_instance", "flow_instance_nodes": "flow_instance_node",
    "block_reasons": "block_reason", "goal_overlays": "goal_overlay", "derived_tags": "derived_tag",
    "derived_block_reasons": "derived_block_reason", "derived_dependencies": "derived_dependency",
    "template_block_reasons": "template_block_reason", "wait_checks": "wait_check",
    "mcp_roots": "mcp_root", "template_agentic_briefs": "template_agentic_brief",
    "task_overlays": "task_overlay", "flow_item_cycles": "flow_item_cycle",
    "flow_dependencies": "flow_dependency", "template_tags": "template_tag",
    "commitment_overlays": "commitment_overlay", "derived_children": "derived_child",
}
NODE_TABLES = ["domains", "goals", "tasks", "commitments", "expectations", "infos", "flows",
               "flow_goals", "flow_tasks", "flow_commitments", "flow_expectations"]
WORD_KIND = {
    "aspect": "domain", "project": "domain", "domain": "domain", "tag": "domain", "goal": "goal",
    "task": "task", "commitment": "commitment", "expectation": "expectation", "info": "info",
    "flow": "flow", "flow_root": "flow", "flow_goal": "flow_goal", "flow_task": "flow_task",
    "flow_commitment": "flow_commitment", "flow_expectation": "flow_expectation",
    "person": "person", "event": "event", "thread": "thread",
}


def v5(name):
    digest = bytearray(hashlib.sha1(NAMESPACE + name.encode()).digest()[:16])
    digest[6] = (digest[6] & 0x0F) | 0x50
    digest[8] = (digest[8] & 0x3F) | 0x80
    return str(uuid.UUID(bytes=bytes(digest)))


def short_ids(full_ids, row_ids):
    """The shortest prefix of the hex digits, 3 at least, no other node shares; with `row_ids`, also
    not equal to any row id written in decimal (the rule the integer schema had)."""
    hexes = sorted(f.replace("-", "") for f in full_ids)
    out = {}
    for index, digits in enumerate(hexes):
        length = 3
        while True:
            prefix = digits[:length]
            clash = any(
                other != digits and other.startswith(prefix) for other in hexes
            ) or prefix in row_ids
            if not clash or length >= len(digits):
                break
            length += 1
        out[digits] = digits[:length]
    return out


before = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
after = sqlite3.connect(f"file:{sys.argv[2]}?mode=ro", uri=True)
problems = []

# ---- 1. every node keeps its id; counts match ----
expected_ids = {}
for table in NODE_TABLES:
    kind = KINDS[table]
    old = [r[0] for r in before.execute(f"SELECT id FROM {table}")]
    new = {r[0] for r in after.execute(f"SELECT id FROM {table}")}
    want = {v5(f"{kind}:{i}") for i in old}
    expected_ids[table] = {i: v5(f"{kind}:{i}") for i in old}
    if new != want:
        problems.append(f"{table}: ids differ ({len(want ^ new)} of {len(want)})")
    print(f"{table:20} rows {len(old):5}  ids kept {len(want & new):5}")

# ---- 2. every column of every rebuilt table, row by row ----
REVERSE = {}  # new id -> {(kind, old id)}
for table, kind in KINDS.items():
    for (old_id,) in before.execute(f"SELECT id FROM {table}"):
        REVERSE.setdefault(v5(f"{kind}:{old_id}"), set()).add((kind, old_id))


def orphan(old_value):
    return "00000000-0000-4000-8000-%012x" % old_value


def column_names(db, table):
    return [r[1] for r in db.execute(f"PRAGMA table_info('{table}')")]


def type_column(column, columns):
    stem = column[:-3] if column.endswith("_id") else column
    for suffix in ("_type", "_kind"):
        if stem + suffix in columns:
            return stem + suffix
    return None


def id_matches(column, columns, old_row, old_value, new_value):
    """Whether `new_value` is the new spelling of the integer `old_value` in this column."""
    if old_value is None or new_value is None:
        return old_value is None and new_value is None
    if column == "cycle_id" and old_value == 0:
        return new_value == NIL
    if new_value == orphan(old_value) and not any(
        (k, old_value) in REVERSE.get(new_value, ()) for k in KINDS.values()
    ):
        return True
    found = {k for (k, o) in REVERSE.get(new_value, ()) if o == old_value}
    if not found:
        return False
    typed = type_column(column, columns)
    if typed is not None and old_row.get(typed) in WORD_KIND:
        return WORD_KIND[old_row[typed]] in found
    return True


KEY_COLUMNS = {"node_key", "wait_key", "parent_key", "dependent_key", "target_key", "occurrence_key"}
OLD_KEY = re.compile(r"^(flow_(root|goal|task|commitment|expectation):\d+:|stored:\d+$|spawned:\d+$)")
rebuilt = [t for t in (r[0] for r in after.execute("SELECT name FROM sqlite_master WHERE type='table'"))
           if t in {r[0] for r in before.execute("SELECT name FROM sqlite_master WHERE type='table'")}]
for table in sorted(rebuilt):
    if table.startswith("_sqlx") or table.startswith("sqlite_"):
        continue
    if table == "undo_journal":
        # emptied on purpose: its rowids point at renumbered rows (migration 0107)
        n_after = after.execute("SELECT COUNT(*) FROM undo_journal").fetchone()[0]
        if n_after != 0:
            problems.append("undo_journal not emptied")
        print(f"{table:38} emptied on purpose, {n_after} rows after")
        continue
    old_cols = column_names(before, table)
    new_cols = column_names(after, table)
    if old_cols != new_cols:
        problems.append(f"{table}: columns changed")
        continue
    integer_ids = {
        r[1] for r in before.execute(f"PRAGMA table_info('{table}')")
        if (r[1] == "id" or r[1].endswith("_id")) and r[2].upper() == "INTEGER"
        and not (table == "agents" and r[1] in ("id", "parent_id"))
        and not (table == "undo_journal")
        and not (table in ("undo_context", "connect_tokens"))
        and not (table == "retired_beads_ids" and False)
    }
    if table == "retired_beads_ids":
        integer_ids = {"row_id"}
    old_rows = [dict(zip(old_cols, r)) for r in before.execute(f"SELECT {', '.join(old_cols)} FROM {table}")]
    new_rows = [dict(zip(new_cols, r)) for r in after.execute(f"SELECT {', '.join(new_cols)} FROM {table}")]
    if len(old_rows) != len(new_rows):
        problems.append(f"{table}: {len(old_rows)} rows before, {len(new_rows)} after")
        continue
    # pair up rows by their own id where there is one, else by the normalized tuple
    def normalized_old(row):
        return tuple((c, row[c]) for c in old_cols)

    unmatched = 0
    if "id" in integer_ids:
        kind = KINDS[table]
        by_id = {r["id"]: r for r in new_rows}
        for old in old_rows:
            new = by_id.get(v5(f"{kind}:{old['id']}"))
            if new is None:
                unmatched += 1
                continue
            for c in old_cols:
                if c in integer_ids:
                    if c == "id":
                        continue
                    if not id_matches(c, old_cols, old, old[c], new[c]):
                        unmatched += 1
                        problems.append(f"{table}.{c}: {old[c]!r} became {new[c]!r}")
                        break
                elif c in KEY_COLUMNS:
                    if isinstance(new[c], str) and OLD_KEY.match(new[c]):
                        problems.append(f"{table}.{c}: key kept an integer id: {new[c]}")
                elif old[c] != new[c]:
                    unmatched += 1
                    problems.append(f"{table}.{c}: {old[c]!r} became {new[c]!r}")
                    break
    else:
        remaining = list(new_rows)
        for old in old_rows:
            hit = None
            for index, new in enumerate(remaining):
                ok = True
                for c in old_cols:
                    if c in integer_ids:
                        ok = id_matches(c, old_cols, old, old[c], new[c])
                    elif c in KEY_COLUMNS:
                        ok = not (isinstance(new[c], str) and OLD_KEY.match(new[c]))
                    else:
                        ok = old[c] == new[c]
                    if not ok:
                        break
                if ok:
                    hit = index
                    break
            if hit is None:
                unmatched += 1
            else:
                remaining.pop(hit)
    if unmatched:
        problems.append(f"{table}: {unmatched} of {len(old_rows)} rows do not match")
    print(f"{table:38} rows {len(old_rows):5}  matched {len(old_rows) - unmatched:5}")

# ---- 3. dangling references stay as many as they were ----
for label, db in (("before", before), ("after", after)):
    db.execute("PRAGMA foreign_keys = OFF")
    violations = db.execute("PRAGMA foreign_key_check").fetchall()
    print(f"foreign_key_check {label}: {len(violations)} violations")
    if label == "after" and violations:
        problems.append(f"foreign_key_check after: {len(violations)} violations")

# ---- 4. short ids, as the MCP would spell them ----
all_full = [v for t in NODE_TABLES for v in expected_ids[t].values()]
row_ids = {str(i) for t in NODE_TABLES for i in expected_ids[t]}
with_rows = short_ids(all_full, row_ids)
without = short_ids(all_full, set())
changed = [h for h in with_rows if with_rows[h] != without[h]]
print(f"short ids: {len(all_full)} nodes, {len(changed)} would read shorter with no row ids to avoid")

if problems:
    print("\nPROBLEMS")
    for line in problems[:40]:
        print(" ", line[:200])
    print(f"({len(problems)} in all)")
    sys.exit(1)
print("OK: every node keeps its full_id; every link and column matches")
