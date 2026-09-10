# Hotkeys Cheat-Sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `Ctrl+Shift+/` cheat-sheet overlay listing every keyboard binding, rendered from the same registry the keyboard handlers dispatch from, so the sheet cannot drift from actual behaviour.

**Architecture:** Bindings become ordered data tables (`chord` + `when` guard + `run` action + i18n label). A generic `useHotkeys` dispatcher walks a table and runs the first entry whose chord and guard match. The two existing keyboard hooks keep their public `Options` interfaces and become thin adapters over the dispatcher, so their existing test suites act as the regression net. The cheat-sheet renders the display half of those same tables.

**Tech Stack:** React 19, TypeScript (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Zustand, CSS Modules, i18next, Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-10-hotkeys-cheat-sheet-design.md`

## Global Constraints

- `any` and `as` type assertions are **banned**. Use `unknown` + type guards, or `satisfies`.
- `exactOptionalPropertyTypes: true` — never pass an explicit `undefined` for an optional property. Read optional modifiers as `chord.ctrl ?? false`.
- `noUncheckedIndexedAccess: true` — indexing an array yields `T | undefined`. Prefer `.find()`.
- Component files `PascalCase.tsx`; all other files `kebab-case.ts`.
- Named exports for everything **except** React components, which use `export default`.
- Imports use the `@/` alias — never `../../`.
- Validate untrusted string keys with `Object.prototype.hasOwnProperty.call(...)`, never the `in` operator.
- CSS Modules for component styles; colors/spacing come from `src/styles/tokens.css` custom properties, never hardcoded hex.
- Match on `event.code` (physical key), never `event.key` — letter shortcuts must work under the Hebrew layout.
- Test commands: `npm test` (all), `npx vitest run <path>` (one file), `npm run lint`, `npm run build` (typecheck).
- Every user-facing string goes through i18next in **both** `en` and `he`.
- Commit at the end of every task. Do not leave the working tree dirty.

---

### Task 1: Chord types and strict matcher

**Files:**
- Create: `src/utils/hotkeys/chord.ts`
- Test: `src/utils/hotkeys/chord.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type Section = "global" | "mindmap" | "listView"`; `interface Chord { code: string; ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean }`; `interface BindingMeta { id: string; section: Section; chord: Chord; labelKey: string; hidden?: boolean }`; `interface Binding<Ctx> extends BindingMeta { when?: (ctx: Ctx) => boolean; run: (ctx: Ctx) => void; allowRepeat?: boolean }`; `function matchesChord(event: KeyboardEvent, chord: Chord): boolean`; `function formatChord(chord: Chord): string`.

- [ ] **Step 1: Write the failing test**

Create `src/utils/hotkeys/chord.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { matchesChord, formatChord } from "./chord";

function keyEvent(code: string, modifiers: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", { code, ...modifiers });
}

describe("matchesChord", () => {
  it("when the code differs, does not match", () => {
    expect(matchesChord(keyEvent("KeyA"), { code: "KeyB" })).toBe(false);
  });

  it("when the code matches and no modifiers are held, matches a bare chord", () => {
    expect(matchesChord(keyEvent("KeyE"), { code: "KeyE" })).toBe(true);
  });

  it("when an unspecified modifier is held, does not match", () => {
    expect(matchesChord(keyEvent("KeyE", { ctrlKey: true }), { code: "KeyE" })).toBe(false);
    expect(matchesChord(keyEvent("KeyE", { shiftKey: true }), { code: "KeyE" })).toBe(false);
    expect(matchesChord(keyEvent("KeyE", { altKey: true }), { code: "KeyE" })).toBe(false);
    expect(matchesChord(keyEvent("KeyE", { metaKey: true }), { code: "KeyE" })).toBe(false);
  });

  it("when a required modifier is absent, does not match", () => {
    expect(matchesChord(keyEvent("KeyO"), { code: "KeyO", ctrl: true })).toBe(false);
  });

  it("when exactly the required modifiers are held, matches", () => {
    expect(matchesChord(keyEvent("KeyO", { ctrlKey: true }), { code: "KeyO", ctrl: true })).toBe(true);
    expect(
      matchesChord(keyEvent("Slash", { ctrlKey: true, shiftKey: true }), { code: "Slash", ctrl: true, shift: true }),
    ).toBe(true);
  });

  it("when Ctrl+Shift+/ is pressed, does not match the bare Ctrl+/ chord", () => {
    expect(matchesChord(keyEvent("Slash", { ctrlKey: true, shiftKey: true }), { code: "Slash", ctrl: true })).toBe(false);
  });
});

describe("formatChord", () => {
  it("when the chord is Ctrl+Shift+Slash, renders it as Ctrl+Shift+/", () => {
    expect(formatChord({ code: "Slash", ctrl: true, shift: true })).toBe("Ctrl+Shift+/");
  });

  it("when the chord is a bare letter, renders just the letter", () => {
    expect(formatChord({ code: "KeyE" })).toBe("E");
  });

  it("when the chord is an arrow or a named key, renders a readable name", () => {
    expect(formatChord({ code: "ArrowUp" })).toBe("↑");
    expect(formatChord({ code: "Escape" })).toBe("Esc");
    expect(formatChord({ code: "Equal", ctrl: true })).toBe("Ctrl+=");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/utils/hotkeys/chord.test.ts`
Expected: FAIL — cannot resolve `./chord`.

- [ ] **Step 3: Write the implementation**

Create `src/utils/hotkeys/chord.ts`:

```ts
/** Which surface a binding belongs to — also the cheat-sheet's grouping. */
export type Section = "global" | "mindmap" | "listView";

/**
 * A physical-key chord. Matching is strict: a modifier left unspecified must be ABSENT for the
 * chord to match, so `Ctrl+Shift+/` never fires a binding declared as `Ctrl+/`.
 */
export interface Chord {
  code: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
}

/** The half of a binding the cheat-sheet needs — free of any context type, so it can list them all. */
export interface BindingMeta {
  id: string;
  section: Section;
  chord: Chord;
  /** Key within the `hotkeys` i18n namespace. */
  labelKey: string;
  /**
   * Dispatchable but not listed on the sheet, for entries that duplicate a listed row:
   * the numpad zoom aliases, and the Shift+Arrow navigate/pan fall-throughs.
   */
  hidden?: boolean;
}

/** A binding plus the behaviour it dispatches, in some context `Ctx`. */
export interface Binding<Ctx> extends BindingMeta {
  when?: (ctx: Ctx) => boolean;
  run: (ctx: Ctx) => void;
  /** Defaults to true. Set false for actions that must not fire on key auto-repeat. */
  allowRepeat?: boolean;
}

export function matchesChord(event: KeyboardEvent, chord: Chord): boolean {
  return event.code === chord.code &&
    event.ctrlKey === (chord.ctrl ?? false) &&
    event.shiftKey === (chord.shift ?? false) &&
    event.altKey === (chord.alt ?? false) &&
    event.metaKey === (chord.meta ?? false);
}

/** Display names for codes whose readable form isn't derivable by trimming a prefix. */
const KEY_LABELS: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Escape: "Esc",
  Slash: "/",
  Equal: "=",
  Minus: "-",
  NumpadAdd: "Numpad +",
  NumpadSubtract: "Numpad -",
};

function keyLabel(code: string): string {
  if (Object.prototype.hasOwnProperty.call(KEY_LABELS, code)) {
    const label = KEY_LABELS[code];
    if (label !== undefined) return label;
  }
  // "KeyE" → "E", "Digit1" → "1"; anything else (Enter, Tab, Delete, F2) reads fine as-is.
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return code;
}

/** Renders a chord for display, e.g. `{ code: "Slash", ctrl: true, shift: true }` → "Ctrl+Shift+/". */
export function formatChord(chord: Chord): string {
  const parts: string[] = [];
  if (chord.ctrl === true) parts.push("Ctrl");
  if (chord.shift === true) parts.push("Shift");
  if (chord.alt === true) parts.push("Alt");
  if (chord.meta === true) parts.push("Meta");
  parts.push(keyLabel(chord.code));
  return parts.join("+");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/utils/hotkeys/chord.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/utils/hotkeys/chord.ts src/utils/hotkeys/chord.test.ts
git commit -m "Add strict chord type and matcher for keyboard bindings"
```

---

### Task 2: The generic dispatcher hook

**Files:**
- Create: `src/hooks/use-hotkeys.ts`
- Test: `src/hooks/use-hotkeys.test.ts`

**Interfaces:**
- Consumes: `Binding`, `matchesChord` from `@/utils/hotkeys/chord`.
- Produces: `function useHotkeys<Ctx>(bindings: readonly Binding<Ctx>[], ctx: Ctx, enabled: boolean): void`.

- [ ] **Step 1: Write the failing test**

Create `src/hooks/use-hotkeys.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useHotkeys } from "./use-hotkeys";
import type { Binding } from "@/utils/hotkeys/chord";

interface TestContext {
  selected: string | null;
  onFirst: () => void;
  onSecond: () => void;
}

function fireKey(code: string, modifiers: Partial<KeyboardEventInit> = {}) {
  window.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true, cancelable: true, ...modifiers }));
}

function makeContext(overrides: Partial<TestContext> = {}): TestContext {
  return { selected: "node-1", onFirst: vi.fn(), onSecond: vi.fn(), ...overrides };
}

const BINDINGS: readonly Binding<TestContext>[] = [
  {
    id: "test.first", section: "global", chord: { code: "ArrowUp" }, labelKey: "first",
    when: (c) => c.selected !== null, run: (c) => c.onFirst(),
  },
  {
    id: "test.second", section: "global", chord: { code: "ArrowUp" }, labelKey: "second",
    run: (c) => c.onSecond(),
  },
];

describe("useHotkeys", () => {
  it("when a guard passes, runs the first matching binding and not the later one", () => {
    const ctx = makeContext();
    renderHook(() => useHotkeys(BINDINGS, ctx, true));
    fireKey("ArrowUp");
    expect(ctx.onFirst).toHaveBeenCalledTimes(1);
    expect(ctx.onSecond).not.toHaveBeenCalled();
  });

  it("when the first binding's guard fails, falls through to the next same-chord binding", () => {
    const ctx = makeContext({ selected: null });
    renderHook(() => useHotkeys(BINDINGS, ctx, true));
    fireKey("ArrowUp");
    expect(ctx.onFirst).not.toHaveBeenCalled();
    expect(ctx.onSecond).toHaveBeenCalledTimes(1);
  });

  it("when disabled, runs nothing", () => {
    const ctx = makeContext();
    renderHook(() => useHotkeys(BINDINGS, ctx, false));
    fireKey("ArrowUp");
    expect(ctx.onFirst).not.toHaveBeenCalled();
  });

  it("when no binding matches the chord, does nothing", () => {
    const ctx = makeContext();
    renderHook(() => useHotkeys(BINDINGS, ctx, true));
    fireKey("ArrowDown");
    expect(ctx.onFirst).not.toHaveBeenCalled();
    expect(ctx.onSecond).not.toHaveBeenCalled();
  });

  it("when a matching binding runs, prevents the browser default", () => {
    const ctx = makeContext();
    renderHook(() => useHotkeys(BINDINGS, ctx, true));
    const event = new KeyboardEvent("keydown", { code: "ArrowUp", bubbles: true, cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("when the key is auto-repeating, skips a binding that opted out of repeat", () => {
    const onRepeatable = vi.fn();
    const ctx = makeContext();
    const bindings: readonly Binding<TestContext>[] = [{
      id: "test.norepeat", section: "global", chord: { code: "ArrowUp", ctrl: true }, labelKey: "norepeat",
      allowRepeat: false, run: () => onRepeatable(),
    }];
    renderHook(() => useHotkeys(bindings, ctx, true));
    fireKey("ArrowUp", { ctrlKey: true, repeat: true });
    expect(onRepeatable).not.toHaveBeenCalled();
    fireKey("ArrowUp", { ctrlKey: true });
    expect(onRepeatable).toHaveBeenCalledTimes(1);
  });

  it("when unmounted, detaches its listener", () => {
    const ctx = makeContext();
    const { unmount } = renderHook(() => useHotkeys(BINDINGS, ctx, true));
    unmount();
    fireKey("ArrowUp");
    expect(ctx.onFirst).not.toHaveBeenCalled();
  });

  it("when the event comes from a focused text input, runs nothing", () => {
    const ctx = makeContext();
    renderHook(() => useHotkeys(BINDINGS, ctx, true));
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowUp", bubbles: true, cancelable: true }));
    expect(ctx.onFirst).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/hooks/use-hotkeys.test.ts`
Expected: FAIL — cannot resolve `./use-hotkeys`.

- [ ] **Step 3: Write the implementation**

Create `src/hooks/use-hotkeys.ts`:

```ts
import { useEffect, useRef } from "react";
import type { Binding } from "@/utils/hotkeys/chord";
import { matchesChord } from "@/utils/hotkeys/chord";

/** Whether a shortcut should be suppressed because the event came from somewhere the user types. */
function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement &&
    (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
}

/**
 * Dispatches a keydown against an ordered binding table: the first entry whose chord matches and
 * whose guard passes wins. Order only matters between entries sharing a chord — strict chord
 * matching keeps everything else independent.
 *
 * Events originating in a text input are always ignored, since no binding should fire mid-typing.
 * Beyond that the hook holds no domain knowledge and no state of its own: gating on an open modal
 * or an active inline edit is the caller's job, expressed through `enabled`.
 */
export function useHotkeys<Ctx>(bindings: readonly Binding<Ctx>[], ctx: Ctx, enabled: boolean): void {
  // The context changes on nearly every render (fresh callbacks); a ref keeps the listener stable
  // instead of detaching and reattaching it each time.
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) return;
      const context = ctxRef.current;
      const binding = bindings.find((candidate) => {
        if (!matchesChord(event, candidate.chord)) return false;
        if (event.repeat && candidate.allowRepeat === false) return false;
        return candidate.when === undefined || candidate.when(context);
      });
      if (binding === undefined) return;
      event.preventDefault();
      binding.run(context);
    }

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [bindings, enabled]);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/hooks/use-hotkeys.test.ts`
Expected: PASS (all 7 cases).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-hotkeys.ts src/hooks/use-hotkeys.test.ts
git commit -m "Add generic ordered-table hotkey dispatcher"
```

---

### Task 3: Global bindings and the App migration

Smallest real migration — proves the pattern end to end on `Alt+L` before the big tables.

**Files:**
- Create: `src/utils/hotkeys/global-bindings.ts`
- Create: `src/stores/use-hotkeys-store.ts`
- Modify: `src/App.tsx` (replace the inline `useEffect` keydown handler)
- Test: `src/utils/hotkeys/global-bindings.test.ts`

**Interfaces:**
- Consumes: `Binding` from `@/utils/hotkeys/chord`; `useHotkeys` from `@/hooks/use-hotkeys`.
- Produces: `interface GlobalContext { onToggleView: () => void; onToggleHotkeys: () => void }`; `const GLOBAL_BINDINGS: readonly Binding<GlobalContext>[]`; `useHotkeysStore` with `{ isOpen: boolean; toggle: () => void; close: () => void }`.

- [ ] **Step 1: Write the failing test**

Create `src/utils/hotkeys/global-bindings.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { GLOBAL_BINDINGS } from "./global-bindings";
import type { GlobalContext } from "./global-bindings";
import { matchesChord } from "./chord";

function makeContext(): GlobalContext {
  return { onToggleView: vi.fn(), onToggleHotkeys: vi.fn() };
}

function runFor(code: string, modifiers: Partial<KeyboardEventInit>, ctx: GlobalContext): boolean {
  const event = new KeyboardEvent("keydown", { code, ...modifiers });
  const binding = GLOBAL_BINDINGS.find((b) => matchesChord(event, b.chord));
  if (binding === undefined) return false;
  binding.run(ctx);
  return true;
}

describe("GLOBAL_BINDINGS", () => {
  it("when Alt+L is pressed, toggles the view", () => {
    const ctx = makeContext();
    expect(runFor("KeyL", { altKey: true }, ctx)).toBe(true);
    expect(ctx.onToggleView).toHaveBeenCalledTimes(1);
  });

  it("when Ctrl+Shift+/ is pressed, toggles the cheat-sheet", () => {
    const ctx = makeContext();
    expect(runFor("Slash", { ctrlKey: true, shiftKey: true }, ctx)).toBe(true);
    expect(ctx.onToggleHotkeys).toHaveBeenCalledTimes(1);
  });

  it("when Alt+Shift+L is pressed, matches nothing", () => {
    const ctx = makeContext();
    expect(runFor("KeyL", { altKey: true, shiftKey: true }, ctx)).toBe(false);
  });

  it("every binding carries a label key in the hotkeys namespace", () => {
    for (const binding of GLOBAL_BINDINGS) {
      expect(binding.labelKey).not.toBe("");
      expect(binding.section).toBe("global");
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/utils/hotkeys/global-bindings.test.ts`
Expected: FAIL — cannot resolve `./global-bindings`.

- [ ] **Step 3: Create the store**

Create `src/stores/use-hotkeys-store.ts`:

```ts
import { create } from "zustand";

interface HotkeysStore {
  isOpen: boolean;
  toggle: () => void;
  close: () => void;
}

/**
 * Whether the keyboard cheat-sheet overlay is showing. Lives in a store rather than component state
 * because both the Ctrl+Shift+/ binding and the settings-popover entry drive it. Ephemeral — there
 * is nothing worth restoring across reloads.
 */
export const useHotkeysStore = create<HotkeysStore>()((set) => ({
  isOpen: false,
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
  close: () => set({ isOpen: false }),
}));
```

- [ ] **Step 4: Create the global bindings table**

Create `src/utils/hotkeys/global-bindings.ts`:

```ts
import type { Binding } from "./chord";

/** What the app-level bindings act on. */
export interface GlobalContext {
  onToggleView: () => void;
  onToggleHotkeys: () => void;
}

/** Bindings that apply everywhere, regardless of which view is showing. */
export const GLOBAL_BINDINGS: readonly Binding<GlobalContext>[] = [
  {
    id: "global.toggleView",
    section: "global",
    chord: { code: "KeyL", alt: true },
    labelKey: "toggleView",
    run: (c) => c.onToggleView(),
  },
  {
    id: "global.toggleHotkeys",
    section: "global",
    chord: { code: "Slash", ctrl: true, shift: true },
    labelKey: "toggleHotkeys",
    run: (c) => c.onToggleHotkeys(),
  },
];
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/utils/hotkeys/global-bindings.test.ts`
Expected: PASS (4 cases).

- [ ] **Step 6: Migrate `App.tsx` to the dispatcher**

In `src/App.tsx`, replace the shortcut `useEffect` (the one containing `handleKeyDown` and `toggleView`) with a `useHotkeys` call, and delete the now-unused local `isTypingTarget` — the dispatcher owns that check.

`HotkeysModal` does not exist until Task 6, so it is **not** referenced here; Task 7 adds the render line. The file becomes exactly:

```tsx
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import "@/styles/tokens.css";
import TopBar from "@/components/TopBar/TopBar";
import MindmapView from "@/components/MindmapView/MindmapView";
import ListView from "@/components/ListView/ListView";
import { useViewStore } from "@/stores/use-view-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useHotkeysStore } from "@/stores/use-hotkeys-store";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { GLOBAL_BINDINGS } from "@/utils/hotkeys/global-bindings";
import styles from "./App.module.css";

export default function App() {
  const { i18n } = useTranslation();
  const view = useViewStore((s) => s.view);
  const toggleView = useViewStore((s) => s.toggleView);
  const theme = useThemeStore((s) => s.theme);
  const toggleHotkeys = useHotkeysStore((s) => s.toggle);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useHotkeys(GLOBAL_BINDINGS, { onToggleView: toggleView, onToggleHotkeys: toggleHotkeys }, true);

  return (
    <div className={styles.shell} dir={i18n.dir()}>
      <TopBar />
      {view === "mindmap" ? <MindmapView /> : <ListView />}
    </div>
  );
}
```

Why `enabled: true` rather than a typing check here: the dispatcher already ignores events whose target is an input, textarea, or contenteditable. `src/App.test.tsx`'s "does not toggle while typing in an input" case dispatches the event **on the input element**, so the dispatcher's target check is what satisfies it. A focus-tracking approach would not — React state would not have updated by the time the synchronous keydown fires.

- [ ] **Step 7: Run the full suite and typecheck**

Run: `npm test && npm run build`
Expected: PASS. `src/App.test.tsx` still passes — `Alt+L` continues to toggle the view.

- [ ] **Step 8: Commit**

```bash
git add src/utils/hotkeys/global-bindings.ts src/utils/hotkeys/global-bindings.test.ts src/stores/use-hotkeys-store.ts src/App.tsx
git commit -m "Move the global Alt+L shortcut onto the hotkey registry"
```

---

### Task 4: List View bindings and hook migration

**Files:**
- Create: `src/utils/hotkeys/list-bindings.ts`
- Modify: `src/components/ListView/use-keyboard-list-view.ts` (replace the body; keep `Options` exactly)
- Test (existing, unchanged): `src/components/ListView/use-keyboard-list-view.test.ts`

**Interfaces:**
- Consumes: `Binding` from `@/utils/hotkeys/chord`; `useHotkeys`; `StatusMode` from `@/utils/filter-tree`.
- Produces: `type ListContext = Omit<Options, "isInputActive">`; `const LIST_BINDINGS: readonly Binding<ListContext>[]`.

- [ ] **Step 1: Create the bindings table**

Create `src/utils/hotkeys/list-bindings.ts`:

```ts
import type { StatusMode } from "@/utils/filter-tree";
import type { Binding } from "./chord";

/** What the List View bindings act on — the hook's options minus its gating flag. */
export interface ListContext {
  selectedTaskId: string | null;
  /** Whether the selected row is currently blocked (and not a Habit instance) — gates Enter. */
  isSelectedBlocked: boolean;
  onNavigate: (direction: 1 | -1) => void;
  onCycleStatus: (id: string) => void;
  onOpenEditor: (id: string) => void;
  onStartRename: (id: string) => void;
  onDeselect: () => void;
  onToggleFilter: () => void;
  onSetStatusMode: (mode: StatusMode) => void;
}

/** Alt+letter → status preset, matched on physical key so it works under any layout. */
const STATUS_PRESETS: ReadonlyArray<{ code: string; mode: StatusMode; labelKey: string }> = [
  { code: "KeyA", mode: "all", labelKey: "statusAll" },
  { code: "KeyP", mode: "plan", labelKey: "statusPlan" },
  { code: "KeyS", mode: "start", labelKey: "statusStart" },
  { code: "KeyD", mode: "do", labelKey: "statusDo" },
];

const statusBindings: readonly Binding<ListContext>[] = STATUS_PRESETS.map(({ code, mode, labelKey }) => ({
  id: `listView.status.${mode}`,
  section: "listView" as const,
  chord: { code, alt: true },
  labelKey,
  run: (c: ListContext) => c.onSetStatusMode(mode),
}));

/**
 * List View's bindings, mirroring the Mindmap's where they translate to a flat list.
 * Order is only significant between entries sharing a chord; none do here.
 */
export const LIST_BINDINGS: readonly Binding<ListContext>[] = [
  {
    id: "listView.toggleFilter", section: "listView", chord: { code: "KeyF", alt: true },
    labelKey: "toggleFilter", run: (c) => c.onToggleFilter(),
  },
  ...statusBindings,
  {
    id: "listView.navigateDown", section: "listView", chord: { code: "ArrowDown" },
    labelKey: "navigateRows", run: (c) => c.onNavigate(1),
  },
  {
    id: "listView.navigateUp", section: "listView", chord: { code: "ArrowUp" },
    labelKey: "navigateRowsUp", hidden: true, run: (c) => c.onNavigate(-1),
  },
  {
    id: "listView.cycleStatus", section: "listView", chord: { code: "Enter" },
    labelKey: "cycleStatus",
    when: (c) => c.selectedTaskId !== null && !c.isSelectedBlocked,
    run: (c) => { if (c.selectedTaskId !== null) c.onCycleStatus(c.selectedTaskId); },
  },
  {
    id: "listView.openEditor", section: "listView", chord: { code: "KeyE" },
    labelKey: "openEditor",
    when: (c) => c.selectedTaskId !== null,
    run: (c) => { if (c.selectedTaskId !== null) c.onOpenEditor(c.selectedTaskId); },
  },
  {
    id: "listView.rename", section: "listView", chord: { code: "KeyR" },
    labelKey: "rename",
    when: (c) => c.selectedTaskId !== null,
    run: (c) => { if (c.selectedTaskId !== null) c.onStartRename(c.selectedTaskId); },
  },
  {
    id: "listView.deselect", section: "listView", chord: { code: "Escape" },
    labelKey: "deselect",
    when: (c) => c.selectedTaskId !== null,
    run: (c) => c.onDeselect(),
  },
];
```

- [ ] **Step 2: Replace the hook body**

Rewrite `src/components/ListView/use-keyboard-list-view.ts` entirely as:

```ts
import { useHotkeys } from "@/hooks/use-hotkeys";
import { LIST_BINDINGS } from "@/utils/hotkeys/list-bindings";
import type { ListContext } from "@/utils/hotkeys/list-bindings";

interface Options extends ListContext {
  isInputActive: boolean;
}

/**
 * List View's keyboard bindings. The bindings themselves live in the shared hotkey registry (so the
 * cheat-sheet renders the same table this dispatches from); this hook only supplies the context and
 * decides when the bindings are live.
 */
export function useKeyboardListView(options: Options): void {
  const { isInputActive, ...context } = options;
  useHotkeys(LIST_BINDINGS, context, !isInputActive);
}
```

- [ ] **Step 3: Run the existing suite as the regression net**

Run: `npx vitest run src/components/ListView/use-keyboard-list-view.test.ts`
Expected: PASS, with **no edits to the test file**. If anything fails, the binding table is wrong — fix the table, not the test.

- [ ] **Step 4: Run the full suite and typecheck**

Run: `npm test && npm run build && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/hotkeys/list-bindings.ts src/components/ListView/use-keyboard-list-view.ts
git commit -m "Move List View keyboard bindings onto the hotkey registry"
```

---

### Task 5: Mindmap bindings and hook migration

The large one. The existing 812-line suite is the contract — it must pass unedited.

**Files:**
- Create: `src/utils/hotkeys/mindmap-bindings.ts`
- Modify: `src/components/MindmapView/use-keyboard-mindmap.ts` (replace the body; keep `Options` exactly)
- Test (existing, unchanged): `src/components/MindmapView/use-keyboard-mindmap.test.ts`

**Interfaces:**
- Consumes: `Binding` from `@/utils/hotkeys/chord`; `useHotkeys`; `MindmapNode`, `Orientation`, `isNodeBlocked` from `@/utils/tree-layout`; `StatusMode` from `@/utils/filter-tree`.
- Produces: `type ArrowKey`; `interface ClipboardEntry`; `interface MindmapContext`; `const MINDMAP_BINDINGS: readonly Binding<MindmapContext>[]`.

- [ ] **Step 1: Create the bindings table**

Create `src/utils/hotkeys/mindmap-bindings.ts`:

```ts
import type { MindmapNode, Orientation } from "@/utils/tree-layout";
import { isNodeBlocked } from "@/utils/tree-layout";
import type { StatusMode } from "@/utils/filter-tree";
import type { Binding } from "./chord";

export type ArrowKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

export interface ClipboardEntry {
  operation: "cut" | "copy";
  nodeIds: string[];
}

/** What the Mindmap bindings act on — the hook's options minus its gating flags, plus Enter state. */
export interface MindmapContext {
  selectedNodeId: string | null;
  selectedNodeIds: ReadonlySet<string>;
  subtreeRootId: string | null;
  clipboard: ClipboardEntry | null;
  /** Which axis branches grow along — decides which Shift+arrows walk the sibling range. */
  orientation: Orientation;
  findNodeById: (id: string) => MindmapNode | undefined;
  /** Timestamp of the last plain Enter, for the double-tap that enters a subtree. */
  lastEnterMs: { current: number };
  onNavigate: (key: ArrowKey) => void;
  onPanCanvas: (key: ArrowKey) => void;
  onCycleType: (id: string, dir: 1 | -1) => void;
  onReorder: (id: string, dir: 1 | -1) => void;
  onStartRename: (id: string) => void;
  onCreateChild: (id: string) => void;
  onCreateSibling: (id: string) => void;
  onInsertParent: (id: string) => void;
  onOpenEditor: (id: string) => void;
  onStartFlow: (id: string) => void;
  onDelete: (ids: string[]) => void;
  onToggleCollapsed: (id: string) => void;
  onCycleStatus: (id: string) => void;
  onDeselect: () => void;
  onExitSubtree: () => void;
  onExitToRoot: () => void;
  onCut: (ids: string[]) => void;
  onCopy: (ids: string[]) => void;
  onPaste: (id: string) => void;
  onEnterSubtree: (id: string) => void;
  onOpenSearch: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onToggleFilter: () => void;
  onSetStatusMode: (mode: StatusMode) => void;
  onFocusRoot: () => void;
  onCenterOnNode: (id: string) => void;
  onConvertToFlow: (id: string) => void;
  onExtendSelection: (key: ArrowKey) => void;
}

const DOUBLE_TAP_MS = 300;

const hasSelection = (c: MindmapContext): boolean => c.selectedNodeId !== null;

function selectedNode(c: MindmapContext): MindmapNode | undefined {
  return c.selectedNodeId === null ? undefined : c.findNodeById(c.selectedNodeId);
}

/** True when the selected node exists and its kind is none of `kinds`. */
function selectedKindIsNot(...kinds: readonly string[]): (c: MindmapContext) => boolean {
  return (c) => {
    const node = selectedNode(c);
    return node !== undefined && !kinds.includes(node.kind);
  };
}

/**
 * Siblings spread across the axis branches *don't* grow along — that is the axis a Shift+arrow walks
 * a selection range over.
 */
function extendsSelection(orientation: Orientation, key: ArrowKey): boolean {
  const siblingAxis: readonly ArrowKey[] =
    orientation === "vertical" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
  return siblingAxis.includes(key);
}

/**
 * The ordered family of behaviours for one arrow key. Shift+arrow has three fall-through outcomes in
 * the original handler — extend the selection on the sibling axis, else navigate, else pan — so all
 * three are modelled explicitly. The navigate/pan Shift variants are hidden from the cheat-sheet
 * because they duplicate the plain arrow rows.
 */
function arrowBindings(key: ArrowKey, labelKey: string): readonly Binding<MindmapContext>[] {
  return [
    {
      id: `mindmap.extendSelection.${key}`, section: "mindmap", chord: { code: key, shift: true },
      labelKey: "extendSelection",
      when: (c) => extendsSelection(c.orientation, key),
      run: (c) => c.onExtendSelection(key),
    },
    {
      id: `mindmap.navigateShift.${key}`, section: "mindmap", chord: { code: key, shift: true },
      labelKey, hidden: true,
      when: hasSelection,
      run: (c) => c.onNavigate(key),
    },
    {
      id: `mindmap.panShift.${key}`, section: "mindmap", chord: { code: key, shift: true },
      labelKey, hidden: true,
      run: (c) => c.onPanCanvas(key),
    },
    {
      id: `mindmap.navigate.${key}`, section: "mindmap", chord: { code: key },
      labelKey,
      when: hasSelection,
      run: (c) => c.onNavigate(key),
    },
    {
      id: `mindmap.pan.${key}`, section: "mindmap", chord: { code: key },
      labelKey: "panCanvas",
      run: (c) => c.onPanCanvas(key),
    },
  ];
}

const STATUS_PRESETS: ReadonlyArray<{ code: string; mode: StatusMode; labelKey: string }> = [
  { code: "KeyA", mode: "all", labelKey: "statusAll" },
  { code: "KeyP", mode: "plan", labelKey: "statusPlan" },
  { code: "KeyS", mode: "start", labelKey: "statusStart" },
  { code: "KeyD", mode: "do", labelKey: "statusDo" },
];

const statusBindings: readonly Binding<MindmapContext>[] = STATUS_PRESETS.map(({ code, mode, labelKey }) => ({
  id: `mindmap.status.${mode}`,
  section: "mindmap" as const,
  chord: { code, alt: true },
  labelKey,
  run: (c: MindmapContext) => c.onSetStatusMode(mode),
}));

export const MINDMAP_BINDINGS: readonly Binding<MindmapContext>[] = [
  // --- Filter and status presets -------------------------------------------------------------
  {
    id: "mindmap.toggleFilter", section: "mindmap", chord: { code: "KeyF", alt: true },
    labelKey: "toggleFilter", run: (c) => c.onToggleFilter(),
  },
  ...statusBindings,

  // --- Type cycling and reordering (must precede the plain arrow families) --------------------
  // Each cross-table retype creates+deletes a node, and held-key repeats race the reload, spawning
  // duplicate siblings — so type-cycling opts out of auto-repeat.
  {
    id: "mindmap.cycleTypeUp", section: "mindmap", chord: { code: "ArrowUp", ctrl: true },
    labelKey: "cycleType", allowRepeat: false,
    when: hasSelection,
    run: (c) => { if (c.selectedNodeId !== null) c.onCycleType(c.selectedNodeId, -1); },
  },
  {
    id: "mindmap.cycleTypeDown", section: "mindmap", chord: { code: "ArrowDown", ctrl: true },
    labelKey: "cycleTypeDown", hidden: true, allowRepeat: false,
    when: hasSelection,
    run: (c) => { if (c.selectedNodeId !== null) c.onCycleType(c.selectedNodeId, 1); },
  },
  {
    id: "mindmap.reorderUp", section: "mindmap", chord: { code: "ArrowUp", alt: true },
    labelKey: "reorder",
    when: hasSelection,
    run: (c) => { if (c.selectedNodeId !== null) c.onReorder(c.selectedNodeId, -1); },
  },
  {
    id: "mindmap.reorderDown", section: "mindmap", chord: { code: "ArrowDown", alt: true },
    labelKey: "reorderDown", hidden: true,
    when: hasSelection,
    run: (c) => { if (c.selectedNodeId !== null) c.onReorder(c.selectedNodeId, 1); },
  },

  // --- Arrow families ------------------------------------------------------------------------
  ...arrowBindings("ArrowLeft", "navigate"),
  ...arrowBindings("ArrowRight", "navigateRight"),
  ...arrowBindings("ArrowUp", "navigateUp"),
  ...arrowBindings("ArrowDown", "navigateDown"),

  // --- Creation and editing ------------------------------------------------------------------
  {
    id: "mindmap.renameF2", section: "mindmap", chord: { code: "F2" },
    labelKey: "rename",
    when: selectedKindIsNot("aspect"),
    run: (c) => { if (c.selectedNodeId !== null) c.onStartRename(c.selectedNodeId); },
  },
  {
    id: "mindmap.createChild", section: "mindmap", chord: { code: "Tab" },
    labelKey: "createChild",
    when: (c) => {
      const node = selectedNode(c);
      return node !== undefined && node.id.includes("-") && node.kind !== "tag";
    },
    run: (c) => { if (c.selectedNodeId !== null) c.onCreateChild(c.selectedNodeId); },
  },
  {
    id: "mindmap.createSibling", section: "mindmap", chord: { code: "Enter", shift: true },
    labelKey: "createSibling",
    when: hasSelection,
    run: (c) => { if (c.selectedNodeId !== null) c.onCreateSibling(c.selectedNodeId); },
  },
  {
    id: "mindmap.insertParent", section: "mindmap", chord: { code: "Enter", ctrl: true },
    labelKey: "insertParent",
    when: hasSelection,
    run: (c) => { if (c.selectedNodeId !== null) c.onInsertParent(c.selectedNodeId); },
  },
  {
    id: "mindmap.focusRoot", section: "mindmap", chord: { code: "Enter" },
    labelKey: "focusRoot",
    when: (c) => c.selectedNodeId === null,
    run: (c) => c.onFocusRoot(),
  },
  {
    // Plain Enter on a selected node: a double tap enters a container as a subtree, otherwise it
    // cycles a task's status / toggles a goal's achieved — but never while the node is blocked.
    id: "mindmap.enter", section: "mindmap", chord: { code: "Enter" },
    labelKey: "cycleStatus",
    when: hasSelection,
    run: (c) => {
      const node = selectedNode(c);
      const now = Date.now();
      const isDoubleTap = now - c.lastEnterMs.current < DOUBLE_TAP_MS;
      const canEnter = node !== undefined &&
        node.kind !== "task" && node.kind !== "goal" && node.kind !== "tag";

      if (isDoubleTap && canEnter) {
        c.lastEnterMs.current = -Infinity;
        if (c.selectedNodeId !== null) c.onEnterSubtree(c.selectedNodeId);
        return;
      }
      c.lastEnterMs.current = now;
      if (node !== undefined && (node.kind === "goal" || node.kind === "task") && !isNodeBlocked(node)) {
        if (c.selectedNodeId !== null) c.onCycleStatus(c.selectedNodeId);
      }
    },
  },
  {
    id: "mindmap.delete", section: "mindmap", chord: { code: "Delete" },
    labelKey: "delete",
    when: hasSelection,
    run: (c) => c.onDelete([...c.selectedNodeIds]),
  },
  {
    id: "mindmap.toggleCollapsed", section: "mindmap", chord: { code: "Slash", ctrl: true },
    labelKey: "toggleCollapsed",
    when: hasSelection,
    run: (c) => { if (c.selectedNodeId !== null) c.onToggleCollapsed(c.selectedNodeId); },
  },

  // --- Zoom ----------------------------------------------------------------------------------
  {
    id: "mindmap.zoomIn", section: "mindmap", chord: { code: "Equal", ctrl: true },
    labelKey: "zoomIn", run: (c) => c.onZoomIn(),
  },
  {
    id: "mindmap.zoomInNumpad", section: "mindmap", chord: { code: "NumpadAdd", ctrl: true },
    labelKey: "zoomIn", hidden: true, run: (c) => c.onZoomIn(),
  },
  {
    id: "mindmap.zoomOut", section: "mindmap", chord: { code: "Minus", ctrl: true },
    labelKey: "zoomOut", run: (c) => c.onZoomOut(),
  },
  {
    id: "mindmap.zoomOutNumpad", section: "mindmap", chord: { code: "NumpadSubtract", ctrl: true },
    labelKey: "zoomOut", hidden: true, run: (c) => c.onZoomOut(),
  },

  // --- Subtree navigation --------------------------------------------------------------------
  {
    id: "mindmap.exitToRoot", section: "mindmap", chord: { code: "Escape", ctrl: true },
    labelKey: "exitToRoot",
    when: (c) => c.subtreeRootId !== null,
    run: (c) => c.onExitToRoot(),
  },
  {
    id: "mindmap.exitSubtree", section: "mindmap", chord: { code: "Escape", shift: true },
    labelKey: "exitSubtree",
    when: (c) => c.subtreeRootId !== null,
    run: (c) => c.onExitSubtree(),
  },
  {
    id: "mindmap.deselect", section: "mindmap", chord: { code: "Escape" },
    labelKey: "deselect",
    when: hasSelection,
    run: (c) => c.onDeselect(),
  },

  // --- Clipboard -----------------------------------------------------------------------------
  {
    id: "mindmap.cut", section: "mindmap", chord: { code: "KeyX", ctrl: true },
    labelKey: "cut",
    when: hasSelection,
    run: (c) => c.onCut([...c.selectedNodeIds]),
  },
  {
    id: "mindmap.copy", section: "mindmap", chord: { code: "KeyC", ctrl: true },
    labelKey: "copy",
    when: hasSelection,
    run: (c) => c.onCopy([...c.selectedNodeIds]),
  },
  {
    id: "mindmap.paste", section: "mindmap", chord: { code: "KeyV", ctrl: true },
    labelKey: "paste",
    when: (c) => c.clipboard !== null && c.selectedNodeId !== null,
    run: (c) => { if (c.selectedNodeId !== null) c.onPaste(c.selectedNodeId); },
  },

  // --- Bare-letter actions -------------------------------------------------------------------
  {
    id: "mindmap.startFlow", section: "mindmap", chord: { code: "KeyS" },
    labelKey: "startFlow",
    when: (c) => {
      const node = selectedNode(c);
      return node !== undefined && node.kind === "flow";
    },
    run: (c) => { if (c.selectedNodeId !== null) c.onStartFlow(c.selectedNodeId); },
  },
  {
    id: "mindmap.centerOnNode", section: "mindmap", chord: { code: "KeyC" },
    labelKey: "centerOnNode",
    when: hasSelection,
    run: (c) => { if (c.selectedNodeId !== null) c.onCenterOnNode(c.selectedNodeId); },
  },
  {
    id: "mindmap.convertToFlow", section: "mindmap", chord: { code: "KeyF" },
    labelKey: "convertToFlow",
    when: hasSelection,
    run: (c) => { if (c.selectedNodeId !== null) c.onConvertToFlow(c.selectedNodeId); },
  },
  {
    id: "mindmap.openEditor", section: "mindmap", chord: { code: "KeyE" },
    labelKey: "openEditor",
    when: selectedKindIsNot("aspect"),
    run: (c) => { if (c.selectedNodeId !== null) c.onOpenEditor(c.selectedNodeId); },
  },
  {
    id: "mindmap.rename", section: "mindmap", chord: { code: "KeyR" },
    labelKey: "rename", hidden: true,
    when: selectedKindIsNot("aspect"),
    run: (c) => { if (c.selectedNodeId !== null) c.onStartRename(c.selectedNodeId); },
  },
  {
    id: "mindmap.openSearch", section: "mindmap", chord: { code: "KeyO", ctrl: true },
    labelKey: "openSearch", run: (c) => c.onOpenSearch(),
  },
];
```

- [ ] **Step 2: Replace the hook body**

Rewrite `src/components/MindmapView/use-keyboard-mindmap.ts` entirely as:

```ts
import { useEffect, useRef } from "react";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { MINDMAP_BINDINGS } from "@/utils/hotkeys/mindmap-bindings";
import type { MindmapContext } from "@/utils/hotkeys/mindmap-bindings";

/**
 * `lastEnterMs` is omitted deliberately: it is internal Enter-double-tap state this hook owns via a
 * ref, not something MindmapView passes in. Including it would break every existing caller.
 */
interface Options extends Omit<MindmapContext, "lastEnterMs"> {
  isInputActive: boolean;
  isWarningActive: boolean;
  onDismissWarning: () => void;
}

/**
 * The Mindmap's keyboard bindings. The bindings themselves live in the shared hotkey registry (so
 * the cheat-sheet renders the same table this dispatches from); this hook supplies the context and
 * owns the gating the registry deliberately doesn't model — a focused input, and the warning modal,
 * which swallows every key but the Escape that dismisses it.
 */
export function useKeyboardMindmap(options: Options): void {
  const { isInputActive, isWarningActive, onDismissWarning, ...rest } = options;
  const lastEnterMs = useRef(-Infinity);
  const context: MindmapContext = { ...rest, lastEnterMs };

  useEffect(() => {
    if (isInputActive || !isWarningActive) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.code !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onDismissWarning();
    }
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [isInputActive, isWarningActive, onDismissWarning]);

  useHotkeys(MINDMAP_BINDINGS, context, !isInputActive && !isWarningActive);
}
```

Note on the warning branch: the original returned early for **every** key while a warning is up, so no other binding could fire. Passing `enabled: false` to the dispatcher reproduces that, and the small effect above handles the Escape that dismisses.

- [ ] **Step 3: Run the existing suite as the regression net**

Run: `npx vitest run src/components/MindmapView/use-keyboard-mindmap.test.ts`
Expected: PASS, **with no edits to the test file**.

If a case fails, the table is wrong — fix the table. Cases most likely to expose an ordering mistake:
- `"horizontal: Shift+Right navigates instead of extending"` — the `navigateShift` entry must sit after `extendSelection` and before `panShift`.
- `Ctrl+Up` / `Alt+Up` type-cycling and reordering — these must be declared **before** the `ArrowUp` family, or the plain-arrow entries will shadow them. (Strict matching means they cannot actually collide, but keep the order for readability.)
- The `Enter` double-tap — `lastEnterMs` must survive across events, which it does via the `useRef` in the hook.

- [ ] **Step 4: Run the full suite, typecheck, and lint**

Run: `npm test && npm run build && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/hotkeys/mindmap-bindings.ts src/components/MindmapView/use-keyboard-mindmap.ts
git commit -m "Move Mindmap keyboard bindings onto the hotkey registry"
```

---

### Task 6: i18n namespace and the cheat-sheet component

**Files:**
- Create: `src/i18n/locales/en/hotkeys.json`
- Create: `src/i18n/locales/he/hotkeys.json`
- Modify: `src/i18n/index.ts`
- Create: `src/components/HotkeysModal/HotkeysModal.tsx`
- Create: `src/components/HotkeysModal/HotkeysModal.module.css`
- Test: `src/components/HotkeysModal/HotkeysModal.test.tsx`
- Test: `src/utils/hotkeys/labels.test.ts`

**Interfaces:**
- Consumes: `GLOBAL_BINDINGS`, `MINDMAP_BINDINGS`, `LIST_BINDINGS`, `BindingMeta`, `formatChord`, `Section`.
- Produces: `HotkeysModal` (default export) taking `{ onClose: () => void }`.

- [ ] **Step 1: Read the translation rules**

The `translating-ui` skill governs user-facing strings here, and its three gates all apply to this task: ESLint's `no-literal-string`, tsc (keys are typed from the English JSON via `src/i18n/types.d.ts`), and `scripts/check-translations.mjs` (every locale must cover every English key).

The Hebrew below is already resolved against `docs/TRANSLATIONS.md`'s glossary and the existing locales — **Flow = סדר**, node = צומת, aspect = היבט, goal = מטרה — with canvas (הלוח) and the title (קיצורי מקלדת) confirmed with the user. Use it as given; do not invent alternatives. If you add a **new** label key beyond this set and it involves a domain term with no established Hebrew, stop and ask rather than inventing one.

- [ ] **Step 2: Write the English locale**

Create `src/i18n/locales/en/hotkeys.json`:

```json
{
  "title": "Keyboard shortcuts",
  "sectionGlobal": "Global",
  "sectionMindmap": "Mindmap",
  "sectionListView": "List View",
  "toggleView": "Switch between Mindmap and List",
  "toggleHotkeys": "Show this cheat-sheet",
  "toggleFilter": "Toggle the filter menu",
  "statusAll": "Status preset: All",
  "statusPlan": "Status preset: Plan",
  "statusStart": "Status preset: Start",
  "statusDo": "Status preset: Do",
  "navigate": "Move between cells",
  "navigateRight": "Move between cells",
  "navigateUp": "Move between cells",
  "navigateDown": "Move between cells",
  "navigateRows": "Move between rows",
  "navigateRowsUp": "Move between rows",
  "panCanvas": "Pan the canvas (nothing selected)",
  "extendSelection": "Extend the selection across siblings",
  "cycleType": "Cycle the cell's type",
  "cycleTypeDown": "Cycle the cell's type",
  "reorder": "Move the cell among its siblings",
  "reorderDown": "Move the cell among its siblings",
  "rename": "Rename",
  "createChild": "Create a child cell",
  "createSibling": "Create a sibling cell",
  "insertParent": "Insert a parent above",
  "focusRoot": "Focus the current root (nothing selected)",
  "cycleStatus": "Cycle status / toggle achieved (double-tap enters a subtree)",
  "delete": "Delete",
  "toggleCollapsed": "Collapse or expand",
  "zoomIn": "Zoom in",
  "zoomOut": "Zoom out",
  "exitToRoot": "Back to the root",
  "exitSubtree": "Up one subtree level",
  "deselect": "Deselect",
  "cut": "Cut",
  "copy": "Copy",
  "paste": "Paste",
  "startFlow": "Start the selected flow",
  "centerOnNode": "Center the view on the selection",
  "convertToFlow": "Convert to a flow",
  "openEditor": "Open the editor",
  "openSearch": "Search for a node"
}
```

- [ ] **Step 3: Write the Hebrew locale**

Create `src/i18n/locales/he/hotkeys.json`. Every term below reuses the Hebrew already fixed in this codebase — **Flow = סדר**, node = צומת, "enter subtree" = פתח עץ מכאן, and the cut/copy/rename/delete/collapse verbs from `he/contextMenu.json` — plus two terms confirmed with the user: canvas = הלוח, and the title קיצורי מקלדת. Do not substitute synonyms; the point is that the sheet reads like the rest of the app.

```json
{
  "title": "קיצורי מקלדת",
  "sectionGlobal": "כללי",
  "sectionMindmap": "מפת חשיבה",
  "sectionListView": "רשימה",
  "toggleView": "מעבר בין מפת חשיבה לרשימה",
  "toggleHotkeys": "הצג את קיצורי המקלדת",
  "toggleFilter": "פתח או סגור את תפריט הסינון",
  "statusAll": "סטטוס מסונן: הכול",
  "statusPlan": "סטטוס מסונן: תכנון",
  "statusStart": "סטטוס מסונן: התחלה",
  "statusDo": "סטטוס מסונן: ביצוע",
  "navigate": "מעבר בין צמתים",
  "navigateRight": "מעבר בין צמתים",
  "navigateUp": "מעבר בין צמתים",
  "navigateDown": "מעבר בין צמתים",
  "navigateRows": "מעבר בין שורות",
  "navigateRowsUp": "מעבר בין שורות",
  "panCanvas": "הזז את הלוח (ללא בחירה)",
  "extendSelection": "הרחב את הבחירה בין אחים",
  "cycleType": "החלף את סוג הצומת",
  "cycleTypeDown": "החלף את סוג הצומת",
  "reorder": "הזז את הצומת בין אחיו",
  "reorderDown": "הזז את הצומת בין אחיו",
  "rename": "שנה שם",
  "createChild": "צור צומת בן",
  "createSibling": "צור צומת אח",
  "insertParent": "הוסף צומת אב מעל",
  "focusRoot": "התמקד בשורש הנוכחי (ללא בחירה)",
  "cycleStatus": "החלף סטטוס / סמן מטרה כהושלמה (הקשה כפולה פותחת עץ מכאן)",
  "delete": "מחק",
  "toggleCollapsed": "קפל או פתח",
  "zoomIn": "הגדל",
  "zoomOut": "הקטן",
  "exitToRoot": "חזור לשורש",
  "exitSubtree": "עלה רמה אחת",
  "deselect": "בטל בחירה",
  "cut": "גזור",
  "copy": "העתק",
  "paste": "הדבק",
  "startFlow": "התחל סדר",
  "centerOnNode": "מרכז את התצוגה על הבחירה",
  "convertToFlow": "המר לסדר",
  "openEditor": "פתח את העורך",
  "openSearch": "חפש צומת"
}
```

- [ ] **Step 4: Register the namespace in both i18n files**

A new namespace must be registered in **two** places — missing the second is a compile error at every `t("hotkeys:…")` call site.

In `src/i18n/index.ts`, add alongside the existing imports:

```ts
import en_hotkeys from "./locales/en/hotkeys.json";
import he_hotkeys from "./locales/he/hotkeys.json";
```

and add `hotkeys: en_hotkeys,` to the `en` resources object and `hotkeys: he_hotkeys,` to the `he` one.

In `src/i18n/types.d.ts`, add the type import:

```ts
import type en_hotkeys from "./locales/en/hotkeys.json";
```

and add `hotkeys: typeof en_hotkeys;` to the `resources` interface. Without this, `t()` cannot resolve any `hotkeys` key and tsc fails.

- [ ] **Step 4b: Run the translation-coverage gate**

Run: `node scripts/check-translations.mjs`
Expected: PASS — it fails if any locale is missing a key English defines. This is the same gate the stop hook runs, so clear it here rather than at commit time.

- [ ] **Step 5: Write the failing label-coverage test**

Create `src/utils/hotkeys/labels.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import en from "@/i18n/locales/en/hotkeys.json";
import he from "@/i18n/locales/he/hotkeys.json";
import { GLOBAL_BINDINGS } from "./global-bindings";
import { MINDMAP_BINDINGS } from "./mindmap-bindings";
import { LIST_BINDINGS } from "./list-bindings";
import type { BindingMeta } from "./chord";

const ALL: readonly BindingMeta[] = [...GLOBAL_BINDINGS, ...MINDMAP_BINDINGS, ...LIST_BINDINGS];

function hasKey(locale: Record<string, string>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(locale, key);
}

describe("hotkey labels", () => {
  it("every binding's label key exists in English", () => {
    const missing = ALL.filter((b) => !hasKey(en, b.labelKey)).map((b) => b.id);
    expect(missing).toEqual([]);
  });

  it("every binding's label key exists in Hebrew", () => {
    const missing = ALL.filter((b) => !hasKey(he, b.labelKey)).map((b) => b.id);
    expect(missing).toEqual([]);
  });

  it("the two locales define exactly the same keys", () => {
    expect(Object.keys(he).sort()).toEqual(Object.keys(en).sort());
  });

  it("every binding id is unique", () => {
    const ids = ALL.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
```

- [ ] **Step 6: Run it to verify it passes**

Run: `npx vitest run src/utils/hotkeys/labels.test.ts`
Expected: PASS. A failure lists exactly which binding ids lack a label — add those keys to both JSON files.

- [ ] **Step 7: Write the component test**

Create `src/components/HotkeysModal/HotkeysModal.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import HotkeysModal from "./HotkeysModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { dir: () => "ltr" },
  }),
}));

describe("HotkeysModal", () => {
  it("renders a section heading for each of the three sections", () => {
    render(<HotkeysModal onClose={vi.fn()} />);
    expect(screen.getByText("hotkeys:sectionGlobal")).toBeInTheDocument();
    expect(screen.getByText("hotkeys:sectionMindmap")).toBeInTheDocument();
    expect(screen.getByText("hotkeys:sectionListView")).toBeInTheDocument();
  });

  it("renders the Ctrl+Shift+/ chord that opens it", () => {
    render(<HotkeysModal onClose={vi.fn()} />);
    expect(screen.getByText("Ctrl+Shift+/")).toBeInTheDocument();
  });

  it("does not render bindings marked hidden", () => {
    render(<HotkeysModal onClose={vi.fn()} />);
    // The numpad zoom alias is hidden; the primary Ctrl+= row is not.
    expect(screen.queryByText("Ctrl+Numpad +")).not.toBeInTheDocument();
    expect(screen.getByText("Ctrl+=")).toBeInTheDocument();
  });

  it("when Escape is pressed, closes", () => {
    const onClose = vi.fn();
    render(<HotkeysModal onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("when the backdrop is clicked, closes", () => {
    const onClose = vi.fn();
    const { container } = render(<HotkeysModal onClose={onClose} />);
    const overlay = container.firstElementChild;
    expect(overlay).not.toBeNull();
    if (overlay !== null) fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 8: Run it to verify it fails**

Run: `npx vitest run src/components/HotkeysModal/HotkeysModal.test.tsx`
Expected: FAIL — cannot resolve `./HotkeysModal`.

- [ ] **Step 9: Write the component**

Create `src/components/HotkeysModal/HotkeysModal.tsx`:

```tsx
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { BindingMeta, Section } from "@/utils/hotkeys/chord";
import { formatChord } from "@/utils/hotkeys/chord";
import { GLOBAL_BINDINGS } from "@/utils/hotkeys/global-bindings";
import { MINDMAP_BINDINGS } from "@/utils/hotkeys/mindmap-bindings";
import { LIST_BINDINGS } from "@/utils/hotkeys/list-bindings";
import styles from "./HotkeysModal.module.css";

interface Props {
  onClose: () => void;
}

const SECTIONS: ReadonlyArray<{ section: Section; titleKey: string }> = [
  { section: "global", titleKey: "hotkeys:sectionGlobal" },
  { section: "mindmap", titleKey: "hotkeys:sectionMindmap" },
  { section: "listView", titleKey: "hotkeys:sectionListView" },
];

/** Every binding in the app, display-side only — the same tables the handlers dispatch from. */
const ALL_BINDINGS: readonly BindingMeta[] = [...GLOBAL_BINDINGS, ...MINDMAP_BINDINGS, ...LIST_BINDINGS];

/** Ctrl+Shift+/ cheat-sheet: every keyboard binding, grouped by the surface it applies to. */
export default function HotkeysModal({ onClose }: Props) {
  const { t } = useTranslation(["hotkeys"]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.code !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    }
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [onClose]);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t("hotkeys:title")}>
        <h2 className={styles.title}>{t("hotkeys:title")}</h2>
        <div className={styles.sections}>
          {SECTIONS.map(({ section, titleKey }) => {
            const rows = ALL_BINDINGS.filter((b) => b.section === section && b.hidden !== true);
            if (rows.length === 0) return null;
            return (
              <section key={section} className={styles.section}>
                <h3 className={styles.sectionTitle}>{t(titleKey)}</h3>
                <dl className={styles.list}>
                  {rows.map((binding) => (
                    <div key={binding.id} className={styles.row}>
                      <dt className={styles.chord}><kbd>{formatChord(binding.chord)}</kbd></dt>
                      <dd className={styles.label}>{t(`hotkeys:${binding.labelKey}`)}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 10: Write the styles**

Create `src/components/HotkeysModal/HotkeysModal.module.css`:

```css
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 200;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 8vh 16px 16px;
  overflow-y: auto;
}

.modal {
  background: var(--surface-raised);
  border: 1px solid var(--node-border);
  border-radius: 8px;
  max-width: 720px;
  width: 100%;
  padding: 20px 24px 24px;
}

.title {
  margin: 0 0 16px;
  font-family: var(--font-sans);
  font-size: var(--text-lg);
  color: var(--text-primary);
}

.sections {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 20px 32px;
}

.sectionTitle {
  margin: 0 0 8px;
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
}

.list {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.row {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.chord {
  flex: 0 0 auto;
  min-width: 96px;
}

.chord kbd {
  font-family: var(--font-mono, monospace);
  font-size: var(--text-sm);
  color: var(--text-primary);
  background: var(--node-bg);
  border: 1px solid var(--node-border);
  border-radius: 4px;
  padding: 1px 6px;
  white-space: nowrap;
}

.label {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  color: var(--text-primary);
}
```

Before committing, confirm every custom property used above (`--surface-raised`, `--node-border`, `--node-bg`, `--text-primary`, `--text-muted`, `--text-lg`, `--text-sm`, `--font-sans`) exists in `src/styles/tokens.css`. If one does not, substitute the nearest existing token rather than inventing a value:

Run: `grep -nE '\-\-(surface-raised|node-border|node-bg|text-primary|text-muted|text-lg|text-sm|font-sans|font-mono)\b' src/styles/tokens.css`

- [ ] **Step 11: Run the component test**

Run: `npx vitest run src/components/HotkeysModal/HotkeysModal.test.tsx`
Expected: PASS (5 cases).

- [ ] **Step 12: Commit**

```bash
git add src/i18n src/components/HotkeysModal src/utils/hotkeys/labels.test.ts
git commit -m "Add the keyboard cheat-sheet overlay and its hotkeys locale"
```

---

### Task 7: Wire the trigger, the gear entry, and background gating

**Files:**
- Modify: `src/App.tsx` (render the modal)
- Modify: `src/components/TopBar/TopBar.tsx` (settings-popover entry)
- Modify: `src/components/MindmapView/MindmapView.tsx` (`isInputActive`)
- Modify: `src/components/ListView/ListView.tsx` (`isInputActive`)
- Modify: `src/i18n/locales/en/common.json`, `src/i18n/locales/he/common.json`

**Interfaces:**
- Consumes: `useHotkeysStore`, `HotkeysModal`.
- Produces: nothing new.

- [ ] **Step 1: Render the modal from App**

In `src/App.tsx`, add the import and the render line deferred in Task 3:

```tsx
import HotkeysModal from "@/components/HotkeysModal/HotkeysModal";
```

Add `const closeHotkeys = useHotkeysStore((s) => s.close);` beside the other store reads, and render it as the last child of the shell:

```tsx
      {view === "mindmap" ? <MindmapView /> : <ListView />}
      {hotkeysOpen && <HotkeysModal onClose={closeHotkeys} />}
```

- [ ] **Step 2: Add the settings-popover entry**

In `src/components/TopBar/TopBar.tsx`, add to the imports:

```tsx
import { useHotkeysStore } from "@/stores/use-hotkeys-store";
```

Add beside the other store reads in the component body:

```tsx
  const toggleHotkeys = useHotkeysStore((s) => s.toggle);
```

Then add a row inside the settings popover, after the vertical-layout block and before the popover's closing `</div>`:

```tsx
                  <div className={styles.settingRow}>
                    <button
                      className={styles.langToggle}
                      type="button"
                      onClick={() => { setSettingsOpen(false); toggleHotkeys(); }}
                    >
                      {t("common:keyboardShortcuts")}
                    </button>
                  </div>
```

- [ ] **Step 3: Add the locale key**

Add to `src/i18n/locales/en/common.json`:

```json
  "keyboardShortcuts": "Keyboard shortcuts",
```

and to `src/i18n/locales/he/common.json`:

```json
  "keyboardShortcuts": "קיצורי מקלדת",
```

Place each beside the existing `"verticalLayout"` entry, so the settings-popover keys stay grouped. Then run `node scripts/check-translations.mjs` — it must pass.

- [ ] **Step 4: Gate the background views**

In `src/components/MindmapView/MindmapView.tsx`, add the import:

```tsx
import { useHotkeysStore } from "@/stores/use-hotkeys-store";
```

Add beside the other store reads:

```tsx
  const hotkeysOpen = useHotkeysStore((s) => s.isOpen);
```

Then add `|| hotkeysOpen` to the `isInputActive` expression in the `useKeyboardMindmap({ ... })` call (currently ending `|| nodeSearchOpen`), so the cheat-sheet suppresses background shortcuts the same way an open modal does.

Do the same in `src/components/ListView/ListView.tsx`: import the store, read `hotkeysOpen`, and OR it into the `isInputActive` value passed to `useKeyboardListView`.

Run `grep -n "isInputActive" src/components/ListView/ListView.tsx` to locate the exact expression before editing.

- [ ] **Step 5: Verify end to end**

Run: `npm test && npm run build && npm run lint`
Expected: PASS.

Then run the app and confirm by hand:

Run: `npm run dev`
- `Ctrl+Shift+/` opens the sheet; it lists Global, Mindmap and List View sections.
- Pressing it while a node is selected does **not** also collapse that node (the bug strict matching fixes).
- `Escape` closes it.
- The gear popover's **Keyboard shortcuts** entry opens it.
- With the sheet open, arrow keys do not move the mindmap selection behind it.
- Switch the app to Hebrew and confirm the sheet reads right-to-left with translated labels.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/components/TopBar/TopBar.tsx src/components/MindmapView/MindmapView.tsx src/components/ListView/ListView.tsx src/i18n/locales/en/common.json src/i18n/locales/he/common.json
git commit -m "Open the cheat-sheet from Ctrl+Shift+/ and the settings popover"
```

---

### Task 8: Documentation

**Files:**
- Create: `docs/adr/0003-registry-driven-hotkeys.md`
- Modify: `SPEC.md` (both "Keyboard interactions" sections, and the top-bar paragraph)
- Modify: `CHANGELOG.md` (under `[Unreleased]`)

- [ ] **Step 1: Write the ADR**

Create `docs/adr/0003-registry-driven-hotkeys.md`, matching the form of `0001`/`0002` (title, prose summary, `## Status`, `## Considered options`, `## Consequences`):

```markdown
# Registry-driven keyboard bindings

Keyboard bindings are declared once, as ordered data tables of `{ chord, when, run, labelKey }`, and
dispatched by a single generic hook that runs the first entry whose chord and guard match. The
cheat-sheet overlay renders the display half of those same tables, so the documented shortcuts and
the dispatched behaviour cannot diverge.

## Status

accepted

## Considered options

- **A static list rendered by the overlay, handlers untouched.** Rejected: this is exactly how
  `SPEC.md`'s keyboard sections drifted — two lists kept in agreement by hand.
- **Shared chord constants, handlers keep their `switch`.** Rejected: only the chords become
  drift-proof; an action added, removed, or re-guarded still needs a manual registry edit.
- **Hybrid — registry dispatch for simple bindings, hand-written arrows and Enter.** Rejected: two
  dispatch mechanisms in one hook is worse for a reader than either alone.

## Consequences

- Chord matching is **strict**: a modifier not named in the chord must be absent. This fixed several
  accidental bindings, notably `Ctrl+Shift+/` also collapsing a node because the old `Slash` case
  checked Ctrl without excluding Shift.
- Order matters only between entries sharing a chord. The arrow keys are the real case: `Shift+Arrow`
  extends the selection on the sibling axis, else navigates, else pans, and all three are explicit
  entries rather than an `else if` chain.
- Gating stayed out of the registry. Whether a binding is live at all — a focused input, an open
  modal, the warning overlay — remains the calling hook's concern, expressed as one `enabled` flag.
- `use-keyboard-mindmap` and `use-keyboard-list-view` kept their `Options` interfaces, so their
  existing event-level test suites carried over unchanged as the migration's regression net.
```

- [ ] **Step 2: Correct SPEC.md's Mindmap keyboard section**

Locate the Mindmap "**Keyboard interactions:**" bullet list (`grep -n "Keyboard interactions" SPEC.md` — it is the first of the two hits). Replace the whole bullet list with:

```markdown
**Keyboard interactions:**
- `Tab` / click — create a child cell
- Arrow keys — move between cells; with **nothing selected**, they pan the canvas instead
- `Shift+arrows` — extend the selection across siblings (on the sibling axis for the current orientation; on the branch axis they navigate as usual)
- `Alt+↑` / `Alt+↓` — move the cell among its siblings
- `Ctrl+↑` / `Ctrl+↓` — cycle the cell's type through: Domain → Project → Goal → Task
- `Enter` — with a node selected: cycle a task's status / toggle a goal's achieved (double-tap enters a container as a subtree); **with nothing selected: focus the current display root**
- `Shift+Enter` — create a sibling cell; `Ctrl+Enter` — insert a parent above
- `F2` / `R` — rename the selected cell
- `E` — open the selected cell's editor; `Double-click` does the same
- `Delete` — delete the selection
- `Ctrl+/` — collapse or expand the selected cell
- `Ctrl+X` / `Ctrl+C` / `Ctrl+V` — cut / copy / paste
- `C` — center the view on the selection; `Ctrl+=` / `Ctrl+-` (and numpad `+`/`-`) — zoom
- `S` — start the selected Flow; `F` — convert the selected cell to a Flow
- `Ctrl+O` — search for a node by title
- `Alt+F` — toggle the filter menu; `Alt+A` / `Alt+P` / `Alt+S` / `Alt+D` — jump to the **All / Plan / Start / Do** status preset (matched by physical key)
- `Escape` — deselect; `Shift+Escape` — go back one level when inside a subtree; `Ctrl+Escape` — go back to the root
- `Alt+L` — switch between Mindmap and List View; `Ctrl+Shift+/` — open the keyboard cheat-sheet
- `Right-click` — context menu (enter subtree, change type, delete, etc.)
- Back button / back-to-top button available in the UI

Every binding above is declared once in the shared hotkey registry (`src/utils/hotkeys/`), which is
also what the cheat-sheet renders — so this list, the overlay, and the handlers cannot disagree.
```

- [ ] **Step 3: Fix the "Entering a subtree" paragraph**

Immediately below that list, the "**Entering a subtree:**" paragraph ends "Navigation back: back button, back-to-top button, or Shift+Escape." That is right about `Shift+Escape` but omits the root case. Replace that final sentence with:

```markdown
Navigation back: back button, back-to-top button, `Shift+Escape` (up one level), or `Ctrl+Escape` (straight back to the root).
```

- [ ] **Step 4: Correct SPEC.md's List View keyboard section**

Locate the List View "**Keyboard interactions**" list (the second `grep` hit) and replace its bullets with:

```markdown
**Keyboard interactions** (mirroring the Mindmap's bindings where they translate to a flat list):
- `Alt+F` — toggle the filter menu; `Alt+A` / `Alt+P` / `Alt+S` / `Alt+D` — jump to the **All / Plan / Start / Do** status preset (matched by physical key), same as the Mindmap
- `↑` / `↓` — move the selection between rows (Goal headers are skipped); from nothing selected, `↓` selects the first row and `↑` the last
- `Enter` — cycle the selected row's status (disabled while it's blocked, except a Habit instance)
- `E` — open the selected row's editor
- `R` — rename the selected row inline (Enter/blur commits, Escape cancels)
- `Escape` — deselect
- `Alt+L` — switch back to the Mindmap; `Ctrl+Shift+/` — open the keyboard cheat-sheet

A shortcut requires exactly the modifiers listed — `Ctrl+E` does not open the editor, only a bare `E` does.
```

- [ ] **Step 5: Document the cheat-sheet in SPEC.md**

In the "**Top bar:**" paragraph, the settings-popover gear is described as holding "the Hebrew/English language toggle and a **Light mode** switch". Extend that parenthetical to also mention a **Keyboard shortcuts** entry, and append this sentence to the end of the paragraph:

```markdown
A **keyboard cheat-sheet** overlay is available from that entry or with `Ctrl+Shift+/`: it lists every binding in the app, grouped into **Global / Mindmap / List View**. The list is rendered from the same binding registry the keyboard handlers dispatch from, so it tracks the handlers automatically rather than being maintained by hand.
```

- [ ] **Step 6: Update the changelog**

Add to `CHANGELOG.md` under `[Unreleased]` (create the `### Added` and `### Fixed` headings under it — the section is currently empty following the 0.3.0 release):

```markdown
### Added
- **A keyboard cheat-sheet**, opened with **Ctrl+Shift+/** or from the settings popover's **Keyboard shortcuts** entry. Lists every binding in the app grouped into Global / Mindmap / List View. The list is generated from the same binding table the keyboard handlers dispatch from, so it can't fall out of date with what the keys actually do.

### Fixed
- **Keyboard shortcuts no longer fire when extra modifiers are held.** A shortcut now requires exactly the modifiers it names: **Ctrl+E** or **Shift+E** no longer open the editor (bare **E** still does), **Ctrl+Shift+C/X/V** no longer cut/copy/paste, and **Shift+Tab** no longer creates a child cell, so it returns to normal focus traversal. Most visibly, **Ctrl+Shift+/** no longer also collapses the selected node while opening the cheat-sheet.
```

Per the changelog convention, the internal registry refactor is deliberately **not** listed — the changelog is user-facing.

- [ ] **Step 7: Verify and commit**

Run: `npm test && npm run build && npm run lint && node scripts/check-translations.mjs`
Expected: PASS.

```bash
git add docs/adr/0003-registry-driven-hotkeys.md SPEC.md CHANGELOG.md
git commit -m "Document the hotkey registry and correct SPEC's keyboard sections"
```

---

## Notes for the executor

- **The two existing keyboard test suites are the contract.** Tasks 4 and 5 must not edit them. A failure there means the binding table is wrong.
- **`npm run build` is the typecheck** (`tsc && vite build`). Run it before every commit — `npm test` alone will not catch a type error.
- **Task 3 deliberately leaves `App.tsx` without the modal.** The render line lands in Task 7, once `HotkeysModal` exists. Do not add it early or Task 3 will not typecheck.
- **`node scripts/check-translations.mjs` is a stop-hook gate.** Run it after any locale edit; it fails if a locale is missing a key English defines.
- **Cosmetic call to make during Task 7's manual check:** each arrow key contributes three visible rows (navigate, pan, extend selection), so the Mindmap section carries twelve arrow rows that read repetitively — "Move between cells" four times, and so on. If it reads as noise in the real overlay, mark the `ArrowRight` / `ArrowUp` / `ArrowDown` variants `hidden: true` and keep the `ArrowLeft` row as the representative for each behaviour. This is display-only; never change a binding's `when` or `run` to tidy the sheet.
- **Binding guards are covered by the migrated suites, not by new unit tests.** The spec's testing table lists unit tests for the arrow and Enter guards; the existing 812-line mindmap suite already exercises those same guards through the hook, more thoroughly than a fresh table-level test would. Adding a parallel unit test would duplicate it — if a guard is wrong, that suite is what tells you.
