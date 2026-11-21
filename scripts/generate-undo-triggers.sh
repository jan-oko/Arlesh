#!/usr/bin/env bash
# Generates the trigger families that are written from the live schema: the undo-journal triggers
# for every journaled table (the default), and the change-log triggers for every replicated one.
#
# The undo journal is written by SQL triggers rather than by the 83 mutating commands, so that a
# command cannot fail to be covered (docs/adr/0006-undo-via-a-trigger-written-row-journal.md).
# Three triggers per table, each naming every column, is mechanical and long — this script writes
# them from the live schema so nobody has to.
#
# The change log (docs/adr/0017-client-board-replica.md, decision 5) is written the same way, for the
# same reason: a command that has to remember to say what it changed will forget.
#
# `ARLESH_CARGO` replaces `cargo` (for a shared target: `ARLESH_CARGO="npm run cargo --"`).
#
# Usage:
#   scripts/generate-undo-triggers.sh [undo] > /tmp/triggers.sql
#   scripts/generate-undo-triggers.sh change > /tmp/triggers.sql
#
# It builds a throwaway database the way the application does (`migrate_copy`, which runs the Rust
# step migration 0107 needs before its SQL, so the CLI's sqlite3 alone cannot apply the chain), then
# prints one INSERT/UPDATE/DELETE trigger per table. Paste the output into a **new** migration that
# first drops the triggers it replaces; never edit a migration that has already run.
#
# EXCLUDED below must agree with `arlesh_core::undo::EXCLUDED_TABLES`, and `change` mode skips the
# same tables (`arlesh_core::replication::UNREPLICATED_TABLES` is that list). Both are checked from the
# other side by tests that enumerate sqlite_master (`undo_journal.rs::every_journaled_table_has_its_three_triggers`,
# `replication::tests`) and fail when a non-excluded table has no triggers, so a divergence here
# shows up as a failing test rather than as silently unjournaled or unreplicated rows.
set -euo pipefail

mode="${1:-undo}"
case "$mode" in undo|change) ;; *) echo "usage: $0 [undo|change]" >&2; exit 2 ;; esac

EXCLUDED="undo_context undo_journal server_tokens pairing_pins agent_pins agent_pin_failures agent_account_usage connect_tokens push_devices push_sent change_log change_capture"
# Columns a change image leaves out: `table.column`. A credential never travels to a device.
OMITTED_COLUMNS="agents.token_sha256"

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
migrations="$repository_root/crates/arlesh-core/migrations"

schema="$(mktemp -d)/schema.db"
trap 'rm -rf "$(dirname "$schema")"' EXIT
# Not `sqlite3 < each migration`: since migration 0107 the chain needs the Rust step that computes the
# old-to-new id map first, and without it the seed rows are rebuilt with a NULL id ("NOT NULL
# constraint failed: domains.id"). The example opens the file the way the application does.
touch "$schema"
(cd "$repository_root" && ${ARLESH_CARGO:-cargo} run --quiet -p arlesh-core --example migrate_copy -- "$schema")

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
    local table="$1" row="$2" omitted=""
    # Only a change image leaves a column out: an undo image must hold the whole row to restore it.
    if [ "$mode" = change ]; then
        for entry in $OMITTED_COLUMNS; do
            [ "${entry%%.*}" = "$table" ] && omitted="$omitted,'${entry#*.}'"
        done
    fi
    sqlite3 "$schema" \
        "SELECT 'json_object(' || group_concat(char(39) || name || char(39) || ', $row.' || name, ', ') || ')'
           FROM pragma_table_info('$table') WHERE name NOT IN ('' $omitted);"
}

# The change log's three triggers for one table: each reports the row it touched, as the row it
# became (`set`, with the image) or as gone (`del`). Written only while `change_capture.enabled`.
change_triggers() {
    local table="$1" new_image="$2"
    cat <<TRIGGERS

CREATE TRIGGER change_log_${table}_insert AFTER INSERT ON ${table} BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT '${table}', new.rowid, 'set', ${new_image}
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_${table}_update AFTER UPDATE ON ${table} BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT '${table}', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1 AND old.rowid <> new.rowid;
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT '${table}', new.rowid, 'set', ${new_image}
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;

CREATE TRIGGER change_log_${table}_delete AFTER DELETE ON ${table} BEGIN
    INSERT INTO change_log (table_name, row_id, operation, image)
    SELECT '${table}', old.rowid, 'del', NULL
      FROM change_capture WHERE id = 1 AND enabled = 1;
END;
TRIGGERS
}

for table in $(sqlite3 "$schema" "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;"); do
    is_excluded "$table" && continue
    new_image="$(image "$table" new)"
    if [ "$mode" = change ]; then
        change_triggers "$table" "$new_image"
        continue
    fi
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
