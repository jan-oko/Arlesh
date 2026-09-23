import type { TypedChildKind } from "@/utils/node-meta";
import type { Binding, HotkeyLabelKey } from "@/utils/hotkeys/chord";
import type { StepsSelectionContext } from "./selection";
import { hasSelection, withNode } from "./selection";

/**
 * What the creation chords act on. The chords, and the actions behind them, are the Mindmap's —
 * the handlers the view passes in are `useNodeActions`' own, so the type rules, the parent rules
 * and the refusals come with them. What the view adds is only **where you end up**: a child of a
 * card is shown by stepping into that card.
 */
export interface StepsCreateContext extends StepsSelectionContext {
  onCreateChild: (id: string) => void;
  onCreateTypedChild: (id: string, kind: TypedChildKind) => void;
  onCreateSibling: (id: string) => void;
  onInsertParent: (id: string) => void;
  /**
   * A typed chord with **nothing selected**: that kind, created on the current Step — as a child of
   * the node the Step stands on, exactly as with its header card selected. At the true root, where
   * the Step is the board, the view refuses it out loud.
   */
  onCreateTypedChildOnStep: (kind: TypedChildKind) => void;
}

/**
 * The Mindmap's Shift+initial chords, one per named kind, with the Mindmap's labels. Exported so the
 * Step's "+" menu can show each kind's chord beside it — one table, so the two cannot disagree.
 */
export const STEPS_TYPED_CHILD_CHORDS: ReadonlyArray<{ code: string; kind: TypedChildKind; labelKey: HotkeyLabelKey }> = [
  { code: "KeyD", kind: "domain", labelKey: "createDomainChild" },
  { code: "KeyP", kind: "project", labelKey: "createProjectChild" },
  { code: "KeyG", kind: "goal", labelKey: "createGoalChild" },
  { code: "KeyT", kind: "task", labelKey: "createTaskChild" },
  { code: "KeyC", kind: "commitment", labelKey: "createCommitmentChild" },
  { code: "KeyW", kind: "expectation", labelKey: "createExpectationChild" },
  { code: "KeyI", kind: "info", labelKey: "createInfoChild" },
  { code: "KeyF", kind: "flow", labelKey: "createFlowChild" },
];

// `allowRepeat: false` throughout: creation is a round-trip to the database, and a held key would
// post a node per repeat faster than the first one reaches the screen.
const typedChildBindings: readonly Binding<StepsCreateContext>[] = STEPS_TYPED_CHILD_CHORDS.map(
  ({ code, kind, labelKey }) => ({
    id: `stepsView.createTypedChild.${kind}`,
    section: "stepsView" as const,
    chord: { code, shift: true },
    labelKey,
    allowRepeat: false,
    // Live with nothing selected too, unlike the other creation chords: naming a kind is enough to
    // say where it goes — onto the Step you are looking at.
    run: (c: StepsCreateContext) => {
      if (c.target.kind === "none") { c.onCreateTypedChildOnStep(kind); return; }
      withNode(c, (id) => c.onCreateTypedChild(id, kind));
    },
  }),
);

export const STEPS_CREATE_BINDINGS: readonly Binding<StepsCreateContext>[] = [
  {
    id: "stepsView.createChild", section: "stepsView", chord: { code: "Tab" },
    labelKey: "stepsCreateChild", allowRepeat: false,
    when: hasSelection,
    run: (c) => withNode(c, c.onCreateChild),
  },
  ...typedChildBindings,
  {
    id: "stepsView.createSibling", section: "stepsView", chord: { code: "Enter", shift: true },
    labelKey: "stepsCreateSibling", allowRepeat: false,
    when: hasSelection,
    run: (c) => withNode(c, c.onCreateSibling),
  },
  {
    id: "stepsView.insertParent", section: "stepsView", chord: { code: "Enter", ctrl: true },
    labelKey: "insertParent", allowRepeat: false,
    when: hasSelection,
    run: (c) => withNode(c, c.onInsertParent),
  },
];
