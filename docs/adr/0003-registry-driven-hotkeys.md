# Registry-driven keyboard bindings

Keyboard bindings are declared once, as ordered data tables of `{ chord, when, run, labelKey }`, and dispatched by a single generic hook that runs the first entry whose chord and guard match. The cheat-sheet overlay renders the display half of those same tables, so the documented shortcuts and the dispatched behaviour cannot diverge.

## Status

accepted

## Considered options

- **A static list rendered by the overlay, handlers untouched.** Rejected: this is exactly how `SPEC.md`'s keyboard sections drifted — two lists kept in agreement by hand. At the time of writing, that list was missing more than a dozen bindings and described `Escape` incorrectly.
- **Shared chord constants, handlers keep their `switch`.** Rejected: only the chords become drift-proof; an action added, removed, or re-guarded still needs a manual registry edit.
- **Hybrid — registry dispatch for simple bindings, hand-written arrows and Enter.** Rejected: two dispatch mechanisms in one hook is worse for a reader than either alone.

## Consequences

- Chord matching is **strict**: a modifier not named in the chord must be absent. This fixed several accidental bindings, notably `Ctrl+Shift+/` also collapsing a node, because the old `Slash` case checked Ctrl without excluding Shift.
- Order matters only between entries sharing a chord. The arrow keys are the real case: `Shift+Arrow` extends the selection on the sibling axis, else navigates, else pans — three explicit entries rather than an `else if` chain. The navigate and pan variants are marked `hidden` so they don't duplicate the plain arrow row on the sheet.
- Gating stayed out of the registry. Whether a binding is live at all — a focused input, an open modal, the warning overlay — remains the calling hook's concern, expressed as one `enabled` flag. The one exception is that the dispatcher always ignores events originating in a text input, since no binding should fire mid-typing.
- `labelKey` is typed as `keyof typeof en_hotkeys`, so a binding naming a label that doesn't exist is a compile error rather than a raw key rendered on the sheet.
- The cheat-sheet merges bindings that share a `labelKey` into one row, which is why the four arrow keys read as a single `← → ↑ ↓` line. Giving two bindings the same label is therefore a display decision, not just a translation one.
- `use-keyboard-mindmap` and `use-keyboard-list-view` kept their `Options` interfaces, so their existing event-level test suites (88 and 16 cases) carried over unchanged as the migration's regression net.

## Amendment, 2026-09-20 — one module per feature

The tables are still one ordered array per surface and the dispatch rule is unchanged, but they are
now *assembled* rather than written out: each feature owns a module under `src/utils/hotkeys/list/`
or `src/utils/hotkeys/mindmap/` declaring its own bindings and its own slice of the view's context,
and `list-bindings.ts` / `mindmap-bindings.ts` spread those modules into the one ordered table and
extend the slices into the one `ListContext` / `MindmapContext`. Adding a keyboard action stopped
meaning an edit inside an 18- or 37-member interface and a 202-line array that every other feature
in flight was also editing.

What that costs, and what pays for it:

- **Order is still the behaviour.** The modules are spread in an explicit order, not sorted, so the
  table the dispatcher walks is the one a reader can see. The arrow families are the one genuine
  ordered fall-through and live entirely inside `mindmap/navigate.ts`, where nothing can be
  interleaved into them.
- **Two features can now claim the same chord without meeting in a file**, and the loser would
  simply never fire. `chord-sharing.test.ts` declares every chord bound more than once, with the
  order it dispatches in, and fails on any new one — so that collision is a red test instead of a
  silent no-op. It also pins that each complementary pair really is complementary: List View's two
  bare-`Enter` bindings (`cycleStatus` on a Task, `cycleVerdict` on a Commitment) can never both
  pass, because ListView has one selection and looks it up in two collections.
- The `Options` interfaces, `labelKey`'s typing off `hotkeys.json`, strict chord matching and the
  cheat-sheet's label merging are all untouched. The two hooks' test suites still pass unchanged,
  and the cheat-sheet renders the same rows in the same order.

