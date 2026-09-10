# Hotkeys cheat-sheet on Ctrl+Shift+/ (registry-driven dispatch)

A cheat-sheet overlay, opened with `Ctrl+Shift+/`, listing every keyboard binding in the app grouped
into **Global / Mindmap / List View**. The list is not a hand-maintained table: it is rendered from
the same binding registry the keyboard handlers dispatch from, so the sheet cannot drift from the
behaviour it documents.

## Motivation

The app has roughly forty keyboard bindings spread across three places — `App.tsx` (Alt+L),
`use-keyboard-mindmap.ts` (321 lines), and `use-keyboard-list-view.ts` — with no in-app way to
discover them. `SPEC.md`'s two keyboard sections have already drifted from the code and are missing
more than a dozen bindings, which is the concrete evidence that a separately-maintained list decays.

A cheat-sheet rendered from a static table would inherit exactly that failure mode. So the registry
becomes the single source of truth for **both** dispatch and display.

## Status

accepted

## Considered options

- **Static registry, handlers untouched.** A `hotkeys.ts` data table the overlay renders, with the
  `switch` statements left alone. Smallest change. Rejected: it reproduces the `SPEC.md` drift
  problem — the table and the handlers are two lists that must be kept in agreement by hand.
- **Shared chord constants only.** The registry owns chord definitions and labels; the handlers keep
  their `switch` and match against imported constants. Rejected: only the *chords* become
  drift-proof. An action that is added, removed, or re-guarded still needs a manual registry edit.
- **Hybrid — registry dispatch for simple bindings, hand-written arrows/Enter.** Rejected: leaves two
  dispatch mechanisms inside one hook, which is the worst outcome for the next reader.
- **Ordered binding table + generic dispatcher.** Chosen. See below.

## Design

### 1. Registry module — `src/utils/hotkeys/`

Display metadata is separated from behaviour so that the cheat-sheet can consume the registry
without knowing anything about the contexts the handlers run in.

```ts
// src/utils/hotkeys/chord.ts
export type Section = "global" | "mindmap" | "listView";

/** A physical-key chord. An unspecified modifier must be ABSENT for the chord to match. */
export interface Chord {
  code: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
}

/** What the cheat-sheet needs. Free of any context type, so the sheet can list every section. */
export interface BindingMeta {
  id: string;
  section: Section;
  chord: Chord;
  /** i18n key in the `hotkeys` namespace. */
  labelKey: string;
  /**
   * Dispatchable but not listed on the sheet. Used for the numpad aliases: `Ctrl+NumpadAdd` and
   * `Ctrl+NumpadSubtract` dispatch zoom exactly as `Ctrl+=` / `Ctrl+-` do, but listing them as
   * separate rows would just duplicate the zoom entries.
   */
  hidden?: boolean;
}

/** A binding plus the behaviour it dispatches, in some context `Ctx`. */
export interface Binding<Ctx> extends BindingMeta {
  when?: (ctx: Ctx) => boolean;
  run: (ctx: Ctx) => void;
  /** Defaults to true; set false for actions that must not fire on key auto-repeat. */
  allowRepeat?: boolean;
}

export function matchesChord(event: KeyboardEvent, chord: Chord): boolean;
```

`matchesChord` is **strict**: `chord.ctrl ?? false` must equal `event.ctrlKey`, and likewise for
shift/alt/meta. Matching is on `event.code` (physical key), preserving the existing convention that
letter shortcuts work under a Hebrew layout.

Note for `exactOptionalPropertyTypes: true`: the matcher reads modifiers as `chord.ctrl ?? false`
rather than comparing against `undefined`, and no call site passes an explicit `undefined`.

Three tables, each typed to its own context:

| File | Context | Contents |
|---|---|---|
| `src/utils/hotkeys/global-bindings.ts` | `GlobalContext` | Alt+L, Ctrl+Shift+/ |
| `src/utils/hotkeys/mindmap-bindings.ts` | `MindmapContext` | the mindmap's ~35 bindings |
| `src/utils/hotkeys/list-bindings.ts` | `ListContext` | the list view's 9 bindings |

These are pure data and pure predicates — no React — so they unit-test directly, per the react rule's
"pure TS logic → unit tests".

### 2. Generic dispatcher — `src/hooks/use-hotkeys.ts`

```ts
export function useHotkeys<Ctx>(
  bindings: readonly Binding<Ctx>[],
  ctx: Ctx,
  enabled: boolean,
): void;
```

A capture-phase `window` `keydown` listener, matching today's registration. On each event it finds
the **first** binding whose `chord` matches and whose `when(ctx)` passes, then calls
`event.preventDefault()` and `run(ctx)`. A binding with `allowRepeat: false` is skipped while
`event.repeat` is true.

Order encodes precedence. The three `ArrowLeft` behaviours become three ordered entries —
extend-selection, navigate, pan-canvas — with mutually exclusive guards, replacing the current
if/else chain. Because the registry is consulted in order and stops at the first match, the existing
"Alt-group is checked before the main switch" special case disappears: `Alt+S` is simply a distinct
chord from bare `S`, so the fall-through hazard the current comment warns about cannot arise.

The dispatcher holds no domain knowledge and no state.

### 3. Migrating the two existing hooks

`use-keyboard-mindmap.ts` and `use-keyboard-list-view.ts` **keep their exact `Options` interfaces**.
Each body reduces to: build a context object from its options, then delegate to `useHotkeys`.
`MindmapView.tsx` and `ListView.tsx` are not touched.

This is the central risk control: the existing `use-keyboard-mindmap.test.ts` (812 lines) and
`use-keyboard-list-view.test.ts` (150 lines) fire real `window` keydown events and assert on
callbacks, so **they run unchanged as the regression net for the refactor**.

A survey of every `fireKey(...)` combination in both suites confirms each one is an exact chord that
strict matching preserves. The two negative tests — `Ctrl+S` and a bare `=` — assert that *no* action
fires today, and strict matching also produces no match. No existing test encodes the lenient
modifier behaviour, so the suites are expected to pass with no edits.

**Gating stays in the wrapper; dispatch moves to the registry.** The `isInputActive` early-out and
the `isWarningActive` branch (Escape dismisses the warning with `stopImmediatePropagation`, and every
other key is swallowed) are modal-gating concerns rather than bindings, and remain as a few
hand-written lines in the wrapper hook. The stateful `lastEnterMs` ref backing the Enter double-tap
moves into the mindmap context object.

### 4. The cheat-sheet overlay

- `src/components/HotkeysModal/HotkeysModal.tsx` + `HotkeysModal.module.css`, following the existing
  `NodeSearchModal` shell and the app's design tokens.
- Renders `[...GLOBAL_BINDINGS, ...MINDMAP_BINDINGS, ...LIST_BINDINGS]` as `BindingMeta[]`, grouped
  by `section` into Global / Mindmap / List View, omitting `hidden` entries. Each row is a formatted
  chord plus its translated label.
- Chord formatting is derived from the `Chord` itself (`{ code: "Slash", ctrl: true, shift: true }` →
  `Ctrl+Shift+/`), so the sheet cannot misreport a key.
- Where two entries share a chord and differ by guard, both are listed. Their labels carry the
  distinction ("move between cells" vs. "pan the canvas — nothing selected"), which is information
  the reader wants rather than noise.
- Open state lives in a new `src/stores/use-hotkeys-store.ts` (`isOpen`, `toggle`, `close`), matching
  the reasoning behind `useFilterStore.popoverOpen`: both a shortcut and a click must drive it. Not
  persisted.
- `Escape` closes it.
- A **Keyboard shortcuts** entry is added to the TopBar gear popover, beside the language toggle and
  the Light mode switch.
- While the sheet is open, `MindmapView` and `ListView` fold `isOpen` into their `isInputActive`
  expressions so background shortcuts do not fire behind the overlay.

### 5. Behaviour changes from strict matching

All of the following are cases where the current `switch` fails to exclude a modifier it never
intended to accept. They are treated as fixes:

- **`Ctrl+Shift+/` no longer also collapses the selected node.** The current `case "Slash"` checks
  `event.ctrlKey` without excluding Shift, so the new chord would otherwise fire the collapse toggle
  at the same time as opening the sheet. This is what makes the requested chord usable.
- `Ctrl+E`, `Alt+E`, `Shift+E` no longer open the editor; bare `E` is required. Likewise `R`, `C`,
  `F`, and `Delete` in the mindmap, and `E` / `R` / `Enter` / `Escape` / arrows in the list view.
- `Ctrl+Shift+C` / `Ctrl+Shift+X` / `Ctrl+Shift+V` no longer copy/cut/paste; the bare `Ctrl` chords
  are required.
- `Shift+Tab` no longer creates a child, so it returns to normal focus traversal.

### 6. i18n

A new `hotkeys` namespace in **both** `en` and `he` (the Hebrew locale is currently complete at 11
files and stays that way), registered in `src/i18n/index.ts`. Strings are authored via the
`translating-ui` skill.

A unit test asserts that every non-`hidden` binding's `labelKey` resolves in both locales — the drift
guard for labels, complementing the structural guard the shared registry gives the bindings
themselves.

### 7. Documentation

- **`SPEC.md`** — the Mindmap and List View "Keyboard interactions" sections are rewritten from the
  registry. They currently omit `Ctrl+C`/`Ctrl+X`/`Ctrl+V`, `Ctrl+O`, `F2`, `Ctrl+±`, `S`, `F`, `C`,
  `Shift+Enter`, `Ctrl+Enter`, `Delete`, `Shift+arrows`, `Alt+arrows`, and `Ctrl+Escape`, and they
  describe Escape/Shift+Escape incorrectly: the code binds **Shift+Escape** to "up one level" and
  **Ctrl+Escape** to "back to root", while `SPEC.md` claims plain Escape goes up a level and
  Shift+Escape goes to root. The cheat-sheet is also documented as a top-bar/keyboard feature.
- **`docs/adr/0003-registry-driven-hotkeys.md`** — a short ADR recording the dispatch decision, in
  the project's existing ADR form.
- **`CHANGELOG.md`** — under `[Unreleased]`: `Added` the cheat-sheet, `Fixed` the modifier
  behaviours. The internal refactor is deliberately omitted, since the changelog is user-facing.

## Testing strategy

| Layer | Test |
|---|---|
| `matchesChord` | Unit: exact-modifier matching, including that an unspecified modifier must be absent |
| Binding tables | Unit: guards (`when`) for the context-dependent arrow and Enter entries |
| Dispatcher | `renderHook` unit: first-match-wins ordering, `allowRepeat: false` skips on `event.repeat`, `enabled: false` detaches |
| Regression | Existing `use-keyboard-mindmap.test.ts` and `use-keyboard-list-view.test.ts`, unchanged |
| Labels | Unit: every non-hidden `labelKey` resolves in `en` and `he` |
| Overlay | RTL integration: `Ctrl+Shift+/` opens it, `Escape` closes it, all three sections render, the gear-popover entry opens it |

## Decisions

- **Version.** Confirmed by the user. `VERSION.txt` is at `0.3.0`, and the accumulated `[Unreleased]`
  work (vertical layout, Light mode, List View, the filter redesign) was cut as
  `[0.3.0] — 2026-09-10`. The cheat-sheet's own changelog entries therefore land in the **new**
  `[Unreleased]` section. If 0.3.0 should instead *be* the cheat-sheet release, the entries move up
  into that section — it carries today's date, so nothing else changes.
- **Non-US layouts.** No alias; confirmed by the user. `Ctrl+Shift+/` resolves to the physical
  `Slash` key, consistent with the codebase's `event.code` convention.

## Out of scope

- Rebindable / user-configurable shortcuts.
- Moving `use-keyboard-mindmap.ts` and `use-keyboard-list-view.ts` into `src/hooks/` to satisfy the
  react rule's hook-location convention. They stay where they are; only the new `use-hotkeys.ts`
  follows it. Relocating them is unrelated churn that would obscure the diff.
