#!/usr/bin/env bash
# Generates the undo-journal triggers for every journaled table.
#
# The undo journal is written by SQL triggers rather than by the 83 mutating commands, so that a
# command cannot fail to be covered (docs/adr/0006-undo-via-a-trigger-written-row-journal.md).
# Three triggers per table, each naming every column, is mechanical and long — this script writes
# them from the live schema so nobody has to.
#
# Usage:
#   scripts/generate-undo-triggers.sh > /tmp/triggers.sql
#
# It builds a throwaway database by applying every migration in src-tauri/migrations in order, then
# prints one INSERT/UPDATE/DELETE trigger per journaled table. Paste the output into a **new**
# migration that first drops the triggers it replaces; never edit a migration that has already run.
#
# EXCLUDED below must agree with `arlesh_lib::undo::EXCLUDED_TABLES`. It is checked from the other
# side by `undo_journal.rs::every_journaled_table_has_its_three_triggers`, which enumerates
# sqlite_master and fails when a non-excluded table has no triggers — so a divergence here shows up
# as a failing test rather than as silently unjournaled rows.
set -euo pipefail

EXCLUDED="exact_scopes undo_context undo_journal"

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
migrations="$repository_root/src-tauri/migrations"

schema="$(mktemp -d)/schema.db"
trap 'rm -rf "$(dirname "$schema")"' EXIT
for migration in "$migrations"/*.sql; do
    sqlite3 "$schema" < "$migration"
done

is_excluded() {
    local table="$1"
    case "$table" in sqlite_*|_sqlx_migrations) return 0 ;; esac
    for excluded in $EXCLUDED; do
        [ "$table" = "$excluded" ] && return 0
    done
    return 1
}

# `json_object('col', <row>.col, …)` for one table, over `new` or `old`.
image() {
    local table="$1" row="$2"
    sqlite3 "$schema" \
        "SELECT 'json_object(' || group_concat(char(39) || name || char(39) || ', $row.' || name, ', ') || ')'
           FROM pragma_table_info('$table');"
}

for table in $(sqlite3 "$schema" "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;"); do
    is_excluded "$table" && continue
    new_image="$(image "$table" new)"
    old_image="$(image "$table" old)"
    cat <<TRIGGERS

CREATE TRIGGER undo_journal_${table}_insert AFTER INSERT ON ${table} BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, '${table}', new.rowid, 'insert', NULL, ${new_image}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_${table}_update AFTER UPDATE ON ${table} BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, '${table}', new.rowid, 'update', ${old_image}, ${new_image}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;

CREATE TRIGGER undo_journal_${table}_delete AFTER DELETE ON ${table} BEGIN
    INSERT INTO undo_journal (gesture_id, source, table_name, row_id, operation, before_image, after_image, written_at)
    SELECT gesture_id, source, '${table}', old.rowid, 'delete', ${old_image}, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM undo_context WHERE id = 1 AND suppressed = 0;
END;
TRIGGERS
done
