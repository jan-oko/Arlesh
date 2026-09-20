import { isNodeBlocked } from "@/utils/tree-layout";
import type { Binding } from "@/utils/hotkeys/chord";
import type { MindmapSelectionContext } from "./selection";
import { hasSelection, selectedNode } from "./selection";

/** What plain Enter acts on. */
export interface MindmapEnterContext extends MindmapSelectionContext {
  /** Timestamp of the last plain Enter, for the double-tap that enters a subtree. */
  lastEnterMs: { current: number };
  onCycleStatus: (id: string) => void;
  /** Advances the selected Commitment's verdict: Unresolved → Kept → Broken → Unresolved.
   *
   * The same press may turn out to be the first half of the double tap that enters the
   * commitment's subtree, so `useKeyboardMindmap` holds this until the double-tap window closes
   * and drops it if a subtree entry claimed the pair. Nothing but the user may decide a verdict,
   * and that includes not deciding one on the way past. */
  onCycleVerdict: (id: string) => void;
  onEnterSubtree: (id: string) => void;
  onFocusRoot: () => void;
}

/** How close two plain Enters must be to read as the double tap that enters a subtree. */
export const DOUBLE_TAP_MS = 300;

export const MINDMAP_ENTER_BINDINGS: readonly Binding<MindmapEnterContext>[] = [
  {
    id: "mindmap.focusRoot", section: "mindmap", chord: { code: "Enter" },
    labelKey: "focusRoot",
    when: (c) => c.selectedNodeId === null,
    run: (c) => c.onFocusRoot(),
  },
  {
    // Plain Enter on a selected node: a double tap enters a container as a subtree, otherwise it
    // cycles a task's status / toggles a goal's achieved / cycles a commitment's verdict — but
    // never while the node is blocked.
    //
    // A Commitment is both: it holds Tasks and other Commitments, so the double tap still enters
    // it, and its verdict still cycles on a single press. The two coexist because the cycle is
    // deferred (see `onCycleVerdict`) rather than written on a press that may yet turn out to be
    // half of a double tap — navigating into a commitment must never record a verdict.
    //
    // Shares bare Enter with `mindmap.focusRoot` above, on the complementary guard: that one
    // fires only with nothing selected, this one only with something selected.
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
      if (node === undefined || c.selectedNodeId === null) return;
      // The blocked rule below is deliberately not extended to a Commitment: one is kept or
      // broken, never worked on, and it takes no part in the dependency graph — so there is no
      // blocked state to refuse in the first place. Matches List View, where Enter on a
      // commitment is ungated too.
      if (node.kind === "commitment") {
        c.onCycleVerdict(c.selectedNodeId);
        return;
      }
      if ((node.kind === "goal" || node.kind === "task") && !isNodeBlocked(node)) {
        c.onCycleStatus(c.selectedNodeId);
      }
    },
  },
];
