import type { TypedChildKind } from "@/utils/node-meta";
import type { Binding, HotkeyLabelKey } from "@/utils/hotkeys/chord";
import type { MindmapSelectionContext } from "./selection";
import { hasSelection, selectedNode } from "./selection";

/** What the creation chords act on. */
export interface MindmapCreateContext extends MindmapSelectionContext {
  onCreateChild: (id: string) => void;
  /**
   * Creates a child of a *named* kind under `id` — the Shift+initial chords — instead of the kind
   * Tab would inherit from the parent. A parent that cannot hold that kind is refused out loud,
   * which is why this fires on any selection and decides inside rather than being guarded here.
   */
  onCreateTypedChild: (id: string, kind: TypedChildKind) => void;
  onCreateSibling: (id: string) => void;
  onInsertParent: (id: string) => void;
}

/**
 * Shift+initial, one per named kind. Shift is free for letters — every other Shift chord in the
 * app sits on a non-letter key (Shift+arrows, Shift+Enter, Shift+Escape, Ctrl+Shift+/) — so these
 * six take nothing away. Bare `F` still converts the selection to a Flow; Shift+F creates one
 * under it.
 */
const TYPED_CHILD_CHORDS: ReadonlyArray<{ code: string; kind: TypedChildKind; labelKey: HotkeyLabelKey }> = [
  { code: "KeyD", kind: "domain", labelKey: "createDomainChild" },
  { code: "KeyP", kind: "project", labelKey: "createProjectChild" },
  { code: "KeyG", kind: "goal", labelKey: "createGoalChild" },
  { code: "KeyT", kind: "task", labelKey: "createTaskChild" },
  // Shift+C is free: bare C centres on the selection and Ctrl+C copies, and strict chord
  // matching keeps all three apart.
  { code: "KeyC", kind: "commitment", labelKey: "createCommitmentChild" },
  // E for Expectation (ruled by the user). Bare E opens the editor; Shift+E was free in every view.
  { code: "KeyE", kind: "expectation", labelKey: "createExpectationChild" },
  { code: "KeyI", kind: "info", labelKey: "createInfoChild" },
  { code: "KeyF", kind: "flow", labelKey: "createFlowChild" },
];

const typedChildBindings: readonly Binding<MindmapCreateContext>[] = TYPED_CHILD_CHORDS.map(
  ({ code, kind, labelKey }) => ({
    id: `mindmap.createTypedChild.${kind}`,
    section: "mindmap" as const,
    chord: { code, shift: true },
    labelKey,
    // Creation is a round-trip to the database, and a held key repeats faster than the new node's
    // inline editor mounts to swallow the rest — so a repeat would spawn duplicate siblings.
    allowRepeat: false,
    // Selection-scoped like every other Mindmap binding: with nothing selected these do nothing at
    // all, not even a toast. A parent that can't hold the kind is a different matter — the binding
    // still fires there, and the handler refuses it by name, because an inert key reads as broken.
    when: hasSelection,
    run: (c: MindmapCreateContext) => {
      if (c.selectedNodeId !== null) c.onCreateTypedChild(c.selectedNodeId, kind);
    },
  }),
);

export const MINDMAP_CREATE_BINDINGS: readonly Binding<MindmapCreateContext>[] = [
  {
    id: "mindmap.createChild", section: "mindmap", chord: { code: "Tab" },
    labelKey: "createChild",
    when: (c) => {
      const node = selectedNode(c);
      return node !== undefined && node.id.includes("-") && node.kind !== "tag";
    },
    run: (c) => { if (c.selectedNodeId !== null) c.onCreateChild(c.selectedNodeId); },
  },
  ...typedChildBindings,
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
];
