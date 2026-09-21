import { describe, it, expect } from "vitest";
import { listKeyboardContext, mindmapKeyboardContext } from "@/test/keyboard-context";
import { formatChord } from "./chord";
import type { Binding, BindingMeta } from "./chord";
import { GLOBAL_BINDINGS, isRecursiveExpandArmed } from "./global-bindings";
import type { GlobalContext } from "./global-bindings";
import { TAB_BINDINGS } from "./tab-bindings";
import { LIST_BINDINGS } from "./list-bindings";
import type { ListContext } from "./list-bindings";
import { MINDMAP_BINDINGS } from "./mindmap-bindings";
import type { MindmapContext } from "./mindmap-bindings";

/**
 * Two bindings may share a chord — ADR 0003 dispatches the first whose chord matches *and* whose
 * guard passes, which is what lets `Enter` mean one thing on a Task and another on a Commitment.
 * Now that each feature owns its own module, though, two features can reach for the same chord
 * without ever touching the same file, and the loser would simply never fire. Nothing would be red.
 *
 * So every shared chord is declared here, with the exact order it dispatches in. A new one fails
 * this test, which is the point: the ~80% of merge conflicts that were pure adjacency are gone, and
 * this is what is left standing in the way of the ~20% that carry meaning. If you land here:
 *
 *   - Your chord is already taken. Decide whether your guard and the existing one are genuinely
 *     complementary (at most one can ever pass). If they are not, one of you needs a different key.
 *   - If they are, add the group below, in the order the two must dispatch in, and say why.
 */
const SHARED_CHORDS: Readonly<Record<string, readonly string[]>> = {
  // Each arrow key is an ordered fall-through, NOT a complementary pair: extend the selection on
  // the sibling axis, else navigate, else pan the canvas. That ordering is the behaviour, which is
  // why all four families live inside mindmap/navigate.ts where nothing can be interleaved.
  "mindmap Shift+←": ["mindmap.extendSelection.ArrowLeft", "mindmap.navigateShift.ArrowLeft", "mindmap.panShift.ArrowLeft"],
  "mindmap ←": ["mindmap.navigate.ArrowLeft", "mindmap.pan.ArrowLeft"],
  "mindmap Shift+→": ["mindmap.extendSelection.ArrowRight", "mindmap.navigateShift.ArrowRight", "mindmap.panShift.ArrowRight"],
  "mindmap →": ["mindmap.navigate.ArrowRight", "mindmap.pan.ArrowRight"],
  "mindmap Shift+↑": ["mindmap.extendSelection.ArrowUp", "mindmap.navigateShift.ArrowUp", "mindmap.panShift.ArrowUp"],
  "mindmap ↑": ["mindmap.navigate.ArrowUp", "mindmap.pan.ArrowUp"],
  "mindmap Shift+↓": ["mindmap.extendSelection.ArrowDown", "mindmap.navigateShift.ArrowDown", "mindmap.panShift.ArrowDown"],
  "mindmap ↓": ["mindmap.navigate.ArrowDown", "mindmap.pan.ArrowDown"],
  // Complementary: nothing selected against something selected.
  "mindmap Enter": ["mindmap.focusRoot", "mindmap.enter"],
  // Complementary: F converts the selection to a Flow, and with nothing selected there is nothing
  // to convert, so it shows the board alone instead.
  "mindmap F": ["mindmap.convertToFlow", "mindmap.toggleFullscreen"],
  // Complementary: a List View selection is a Task or a Commitment, never both.
  "listView Enter": ["listView.cycleStatus", "listView.cycleVerdict"],
};

const ALL: readonly BindingMeta[] = [...GLOBAL_BINDINGS, ...TAB_BINDINGS, ...MINDMAP_BINDINGS, ...LIST_BINDINGS];

/**
 * The chords a view's table shares with an always-live one.
 *
 * `SHARED_CHORDS` above cannot see these: it groups by section, and two sections are two *tables*,
 * dispatched by two listeners from two `useHotkeys` calls. So ADR 0003's first-match rule does not
 * order them — nothing does — and a pair declared here has to be strictly complementary, with at
 * most one guard passing in any state the app can be in. That is what the suite below proves for
 * the one such pair there is.
 */
const CROSS_TABLE_CHORDS: Readonly<Record<string, readonly string[]>> = {
  // The cheat-sheet's chord, which the Mindmap borrows for the recursive expand whenever there is
  // a cell to expand. `isRecursiveExpandArmed` is the one place the split is decided.
  "mindmap Ctrl+Shift+/": ["global.toggleHotkeys", "mindmap.expandRecursively"],
};

/** Every chord an always-live table shares with `view`'s own, keyed the way the view's section is. */
function crossTableGroups(section: string, view: readonly BindingMeta[]): Record<string, string[]> {
  const alwaysLive = [...GLOBAL_BINDINGS, ...TAB_BINDINGS];
  const groups: Record<string, string[]> = {};
  for (const outer of alwaysLive) {
    for (const inner of view) {
      if (formatChord(outer.chord) !== formatChord(inner.chord)) continue;
      const key = `${section} ${formatChord(outer.chord)}`;
      (groups[key] ??= []).push(outer.id, inner.id);
    }
  }
  return groups;
}

/** Every chord bound more than once within its section, mapped to its bindings in dispatch order. */
function sharedChordGroups(bindings: readonly BindingMeta[]): Record<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const binding of bindings) {
    const key = `${binding.section} ${formatChord(binding.chord)}`;
    const existing = groups.get(key);
    if (existing === undefined) groups.set(key, [binding.id]);
    else existing.push(binding.id);
  }
  return Object.fromEntries([...groups].filter(([, ids]) => ids.length > 1));
}

/** A binding's guard by id, defaulting to "always passes" for the bindings that carry none. */
function guardOf<Ctx>(bindings: readonly Binding<Ctx>[], id: string): (ctx: Ctx) => boolean {
  const binding = bindings.find((candidate) => candidate.id === id);
  if (binding === undefined) throw new Error(`no binding with id ${id}`);
  const guard = binding.when;
  return guard === undefined ? () => true : guard;
}

describe("chords bound more than once", () => {
  it("are exactly the ones declared here, in the order they dispatch in", () => {
    expect(sharedChordGroups(ALL)).toEqual(SHARED_CHORDS);
  });

  it("only ever appear inside one section's own table", () => {
    for (const key of Object.keys(SHARED_CHORDS)) {
      const section = key.split(" ")[0];
      const ids = SHARED_CHORDS[key] ?? [];
      expect(ids.every((id) => id.startsWith(`${section}.`))).toBe(true);
    }
  });
});

describe("bare Enter in List View is complementary, not ordered", () => {
  const cycleStatus = guardOf(LIST_BINDINGS, "listView.cycleStatus");
  const cycleVerdict = guardOf(LIST_BINDINGS, "listView.cycleVerdict");

  // ListView has ONE selection and looks it up in two collections, so at most one id is ever set.
  // These are the four states that produces.
  const states: ReadonlyArray<{ name: string; context: ListContext; status: boolean; verdict: boolean }> = [
    {
      name: "a Task is selected",
      context: listKeyboardContext({ selectedTaskId: "task-1", selectedCommitmentId: null }),
      status: true,
      verdict: false,
    },
    {
      name: "a blocked Task is selected",
      context: listKeyboardContext({ selectedTaskId: "task-1", selectedCommitmentId: null, isSelectedBlocked: true }),
      status: false,
      verdict: false,
    },
    {
      name: "a Commitment is selected",
      context: listKeyboardContext({ selectedTaskId: null, selectedCommitmentId: "commitment-1" }),
      status: false,
      verdict: true,
    },
    {
      name: "nothing is selected",
      context: listKeyboardContext({ selectedTaskId: null, selectedCommitmentId: null, selectedRowId: null }),
      status: false,
      verdict: false,
    },
  ];

  it.each(states)("when $name, cycleStatus and cycleVerdict cannot both fire", ({ context, status, verdict }) => {
    expect(cycleStatus(context)).toBe(status);
    expect(cycleVerdict(context)).toBe(verdict);
    expect(Number(cycleStatus(context)) + Number(cycleVerdict(context))).toBeLessThanOrEqual(1);
  });
});

describe("the Mindmap's two complementary pairs", () => {
  function canvas(selectedNodeId: string | null): MindmapContext {
    const selection = selectedNodeId === null ? [] : [selectedNodeId];
    return {
      ...mindmapKeyboardContext({ selectedNodeId, selectedNodeIds: new Set(selection) }),
      lastEnterMs: { current: -Infinity },
    };
  }

  it.each([null, "task-1"])("exactly one bare-Enter binding passes with selection %s", (selectedNodeId) => {
    const context = canvas(selectedNodeId);
    const focusRoot = guardOf(MINDMAP_BINDINGS, "mindmap.focusRoot")(context);
    const enter = guardOf(MINDMAP_BINDINGS, "mindmap.enter")(context);
    expect(Number(focusRoot) + Number(enter)).toBe(1);
  });

  it.each([null, "task-1"])("exactly one bare-F binding passes with selection %s", (selectedNodeId) => {
    const context = canvas(selectedNodeId);
    const convert = guardOf(MINDMAP_BINDINGS, "mindmap.convertToFlow")(context);
    const fullscreen = guardOf(MINDMAP_BINDINGS, "mindmap.toggleFullscreen")(context);
    expect(Number(convert) + Number(fullscreen)).toBe(1);
  });
});

describe("chords a view shares with an always-live table", () => {
  it("are exactly the ones declared here", () => {
    expect({
      ...crossTableGroups("mindmap", MINDMAP_BINDINGS),
      ...crossTableGroups("listView", LIST_BINDINGS),
    }).toEqual(CROSS_TABLE_CHORDS);
  });
});

describe("Ctrl+Shift+/ across the cheat-sheet and the Mindmap", () => {
  const toggleHotkeys = guardOf(GLOBAL_BINDINGS, "global.toggleHotkeys");
  const expandRecursively = guardOf(MINDMAP_BINDINGS, "mindmap.expandRecursively");

  function mindmapContext(selectedNodeId: string | null): MindmapContext {
    const selection = selectedNodeId === null ? [] : [selectedNodeId];
    return {
      ...mindmapKeyboardContext({ selectedNodeId, selectedNodeIds: new Set(selection) }),
      lastEnterMs: { current: -Infinity },
    };
  }

  function globalContext(armed: boolean): GlobalContext {
    return {
      onToggleView: () => {},
      onToggleHotkeys: () => {},
      onToggleFullscreen: () => {},
      isRecursiveExpandArmed: armed,
    };
  }

  // Every state the two guards can be in together, written as the app decides them: which view is
  // on screen, what the Mindmap has selected, and whether something has taken the keyboard. The
  // Mindmap's table is only dispatched at all while its view is mounted and nothing is capturing.
  const states: ReadonlyArray<{ name: string; isMindmapOnScreen: boolean; selectedNodeId: string | null; isInputCaptured: boolean }> = [
    { name: "the Mindmap has a cell selected", isMindmapOnScreen: true, selectedNodeId: "task-1", isInputCaptured: false },
    { name: "the Mindmap has nothing selected", isMindmapOnScreen: true, selectedNodeId: null, isInputCaptured: false },
    { name: "the cheat-sheet is open over a selection", isMindmapOnScreen: true, selectedNodeId: "task-1", isInputCaptured: true },
    { name: "the List View is on screen", isMindmapOnScreen: false, selectedNodeId: "task-1", isInputCaptured: false },
  ];

  it.each(states)("when $name, exactly one of the two fires", (state) => {
    const armed = isRecursiveExpandArmed(state);
    const sheet = toggleHotkeys(globalContext(armed));
    // The Mindmap's table is not dispatched at all unless its view is mounted and live.
    const isMindmapLive = state.isMindmapOnScreen && !state.isInputCaptured;
    const expand = isMindmapLive && expandRecursively(mindmapContext(state.selectedNodeId));
    expect(Number(sheet) + Number(expand)).toBe(1);
  });

  it("leaves the cheat-sheet its chord back the moment the selection is dropped", () => {
    expect(toggleHotkeys(globalContext(isRecursiveExpandArmed({ isMindmapOnScreen: true, selectedNodeId: "task-1", isInputCaptured: false })))).toBe(false);
    expect(toggleHotkeys(globalContext(isRecursiveExpandArmed({ isMindmapOnScreen: true, selectedNodeId: null, isInputCaptured: false })))).toBe(true);
  });
});
