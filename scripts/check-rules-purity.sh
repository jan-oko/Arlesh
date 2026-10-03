#!/usr/bin/env bash
# Refuses anything impure in a rules module (ADR 0010, `.claude/rules/rust.md`).
#
# A rules module holds pure functions over values. It cannot reach a session (`Db`,
# `SessionMode`), the database driver (`sqlx`), the desktop shell (`tauri`), the runtime (`tokio`)
# or the file system (`std::fs`). Purity is then structural: a rule that cannot see `Db` cannot
# query, and a change that breaks this fails here, in seconds, instead of passing review because
# nobody read the imports.
#
# What counts as a rules module:
#   - every `rules.rs` under crates/arlesh-core/src, and everything under a `rules/` directory beside one;
#   - all of `filters/`, which was written pure and is the presets' rules layer as a whole.
# And the domain models the rules read, which hold to the same line (ADR 0010, decision 8: domain
# and database models are separate, so a row type and its codec live in persistence):
#   - every `model.rs`, `scopes/key.rs`, and `nodes/{id,key,origin}.rs`.
# Unit-test files (`tests.rs`, `*_tests.rs`) are exempt: a test may build a database to check a
# rule against it.
#
# Comments are stripped before matching, so a doc comment that names what a module does *not* do
# ("no `tokio`") is not a violation. A string literal naming one of the words would be; none does,
# and a rule has no reason to.
#
# Usage: scripts/check-rules-purity.sh [ROOT]   (ROOT defaults to crates/arlesh-core/src)

set -euo pipefail

root="${1:-crates/arlesh-core/src}"
forbidden='\b(Db|SessionMode)\b|\bsqlx\b|\btauri\b|\btokio\b|\bstd::fs\b'

files=$(
  {
    find "$root" -name 'rules.rs'
    find "$root" -path '*/rules/*' -name '*.rs'
    find "$root/filters" -name '*.rs'
    find "$root" -name 'model.rs'
    for model in scopes/key.rs nodes/id.rs nodes/key.rs nodes/origin.rs; do
      [ -f "$root/$model" ] && echo "$root/$model"
    done
  } | grep -v -E '/tests\.rs$|_tests\.rs$' | sort -u
)

if [ -z "$files" ]; then
  echo "No rules modules found under $root." >&2
  exit 1
fi

found=$(
  for file in $files; do
    # Strip `//` comments (line, doc and inner doc), then report what is left that matches.
    sed -E 's#//.*$##' "$file" | grep -n -E "$forbidden" | sed "s#^#  $file:#" || true
  done
)

if [ -n "$found" ]; then
  echo "Impure code in a rules module or a domain model:"
  echo "$found"
  echo
  echo "A rules module holds pure functions over values: no Db or SessionMode, no sqlx, no tauri,"
  echo "no tokio and no std::fs, and it is told \`now\` rather than reading a clock. Gather what"
  echo "the rule needs in the domain's mod.rs and pass it in. See ADR 0010 and .claude/rules/rust.md."
  exit 1
fi

echo "Rules modules and domain models are pure ($(echo "$files" | wc -l) files checked)."
