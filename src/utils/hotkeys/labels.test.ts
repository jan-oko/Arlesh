import { describe, it, expect } from "vitest";
import en from "@/i18n/locales/en/hotkeys.json";
import { GLOBAL_BINDINGS } from "./global-bindings";
import { TAB_BINDINGS } from "./tab-bindings";
import { MINDMAP_BINDINGS } from "./mindmap-bindings";
import { LIST_BINDINGS } from "./list-bindings";
import { PLAN_BINDINGS } from "./plan-bindings";
import type { BindingMeta } from "./chord";

const ALL: readonly BindingMeta[] = [
  ...GLOBAL_BINDINGS, ...TAB_BINDINGS, ...MINDMAP_BINDINGS, ...LIST_BINDINGS, ...PLAN_BINDINGS,
];

function hasKey(locale: Record<string, string>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(locale, key);
}

describe("hotkey labels", () => {
  it("every binding's label key exists in English", () => {
    const missing = ALL.filter((b) => !hasKey(en, b.labelKey)).map((b) => b.id);
    expect(missing).toEqual([]);
  });

  it("every binding id is unique", () => {
    const ids = ALL.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

/**
 * A cheat-sheet row is keyed by `labelKey` **within a section**, so a label declared in more than
 * one section prints once per section. That is the duplication the promotion set out to remove,
 * and what is left has to be left on purpose.
 *
 * Every entry below is an action that genuinely differs per view or cannot be promoted, with the
 * reason. A *new* entry means a chord that should probably have gone global instead.
 */
const LABELS_SPANNING_SECTIONS: Readonly<Record<string, readonly string[]>> = {
  // Acts on the view's own selection, which no global table can see.
  deselect: ["mindmap", "listView", "planView"],
  openEditor: ["mindmap", "listView", "planView"],
  rename: ["mindmap", "listView"],
  delete: ["mindmap", "listView"],
  markBroken: ["mindmap", "listView"],
  toggleBacklog: ["mindmap", "listView"],
  toggleAgentic: ["mindmap", "listView"],
  toggleAsynchronous: ["mindmap", "listView"],
  bindWait: ["mindmap", "listView"],
  // The List View creates Tasks alone except for a wait, which it opens the editor for.
  createExpectationChild: ["mindmap", "listView"],
  // Same key, different movement: cells on a canvas against rows in a list against two panes.
  navigateRows: ["listView", "planView"],
  // F11 is global; bare F is declared per view because eligibility depends on the view's selection
  // — and on the Mindmap the same key also converts a node to a Flow.
  toggleFullscreen: ["global", "mindmap", "listView", "planView"],
  // Identical chords and identical run bodies, but the List View's handler writes its own preset
  // as well as the shared one — which is how any of them takes the list back out of Unblock. A
  // single global handler would silently drop that half.
  statusAll: ["mindmap", "listView"],
  statusPlan: ["mindmap", "listView"],
  statusStart: ["mindmap", "listView"],
  statusDo: ["mindmap", "listView"],
  statusBacklog: ["mindmap", "listView"],
  // Identical everywhere, and the one group that is blocked on architecture rather than on
  // meaning: `useUndo` needs the board reload, which each view owns its own copy of.
  undo: ["mindmap", "listView", "planView"],
  redo: ["mindmap", "listView", "planView"],
};

describe("cheat-sheet rows", () => {
  it("print each shared chord once, except for the labels declared here", () => {
    const sections = new Map<string, string[]>();
    for (const binding of ALL) {
      if (binding.hidden === true) continue;
      const seen = sections.get(binding.labelKey) ?? [];
      if (!seen.includes(binding.section)) seen.push(binding.section);
      sections.set(binding.labelKey, seen);
    }
    const spanning = Object.fromEntries([...sections].filter(([, list]) => list.length > 1));
    expect(spanning).toEqual(LABELS_SPANNING_SECTIONS);
  });
});
