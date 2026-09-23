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
}

/** The Mindmap's Shift+initial chords, one per named kind, with the Mindmap's labels. */
const TYPED_CHILD_CHORDS: ReadonlyArray<{ code: string; kind: TypedChildKind; labelKey: HotkeyLabelKey }> = [
  { code: "KeyD", kind: "domain", labelKey: "createDomainChild" },
  { code: "KeyP", kind: "project", labelKey: "createProjectChild" },
  { code: "KeyG", kind: "goal", labelKey: "createGoalChild" },
  { code: "KeyT", kind: "task", labelKey: "createTaskChild" },
  { code: "KeyC", kind: "commitment", labelKey: "createCommitmentChild" },
  { code: "KeyI", kind: "info", labelKey: "createInfoChild" },
  { code: "KeyF", kind: "flow", labelKey: "createFlowChild" },
];

// `allowRepeat: false` throughout: creation is a round-trip to the database, and a held key would
// post a node per repeat faster than the first one reaches the screen.
const typedChildBindings: readonly Binding<StepsCreateContext>[] = TYPED_CHILD_CHORDS.map(
  ({ code, kind, labelKey }) => ({
    id: `stepsView.createTypedChild.${kind}`,
    section: "stepsView" as const,
    chord: { code, shift: true },
    labelKey,
    allowRepeat: false,
    when: hasSelection,
    run: (c: StepsCreateContext) => withNode(c, (id) => c.onCreateTypedChild(id, kind)),
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
