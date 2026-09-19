import type { MindmapNode, Orientation } from "@/utils/tree-layout";
import { isNodeBlocked } from "@/utils/tree-layout";
import type { StatusMode } from "@/utils/filter-tree";
import type { Binding, HotkeyLabelKey } from "./chord";

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
  /** Puts the anchor Task in the backlog, or takes it out. Acts on the anchor, never the whole
   * multi-selection — setting work aside is a judgement about one thing at a time. */
  onToggleBacklog: (id: string) => void;
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
function arrowBindings(key: ArrowKey, labelKey: HotkeyLabelKey): readonly Binding<MindmapContext>[] {
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

const STATUS_PRESETS: ReadonlyArray<{ code: string; mode: StatusMode; labelKey: HotkeyLabelKey }> = [
  { code: "KeyA", mode: "all", labelKey: "statusAll" },
  { code: "KeyP", mode: "plan", labelKey: "statusPlan" },
  { code: "KeyS", mode: "start", labelKey: "statusStart" },
  { code: "KeyD", mode: "do", labelKey: "statusDo" },
  { code: "KeyB", mode: "backlog", labelKey: "statusBacklog" },
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

  // --- Type cycling and reordering -----------------------------------------------------------
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
    labelKey: "cycleType", allowRepeat: false,
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
    labelKey: "reorder",
    when: hasSelection,
    run: (c) => { if (c.selectedNodeId !== null) c.onReorder(c.selectedNodeId, 1); },
  },

  // --- Arrow families ------------------------------------------------------------------------
  // All four share one label so the cheat-sheet merges them into a single "← → ↑ ↓" row.
  ...arrowBindings("ArrowLeft", "navigate"),
  ...arrowBindings("ArrowRight", "navigate"),
  ...arrowBindings("ArrowUp", "navigate"),
  ...arrowBindings("ArrowDown", "navigate"),

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
    labelKey: "zoomIn", run: (c) => c.onZoomIn(),
  },
  {
    id: "mindmap.zoomOut", section: "mindmap", chord: { code: "Minus", ctrl: true },
    labelKey: "zoomOut", run: (c) => c.onZoomOut(),
  },
  {
    id: "mindmap.zoomOutNumpad", section: "mindmap", chord: { code: "NumpadSubtract", ctrl: true },
    labelKey: "zoomOut", run: (c) => c.onZoomOut(),
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
    labelKey: "rename",
    when: selectedKindIsNot("aspect"),
    run: (c) => { if (c.selectedNodeId !== null) c.onStartRename(c.selectedNodeId); },
  },
  {
    // Only a real Task has a backlog column. A virtual Habit instance is rendered from a template
    // and has no row of its own to set aside, so it is excluded rather than silently no-oping.
    id: "mindmap.toggleBacklog", section: "mindmap", chord: { code: "KeyB" },
    labelKey: "toggleBacklog",
    when: (c) => {
      const node = selectedNode(c);
      return node !== undefined && node.kind === "task" && node.habitItem === undefined;
    },
    run: (c) => { if (c.selectedNodeId !== null) c.onToggleBacklog(c.selectedNodeId); },
  },
  {
    id: "mindmap.openSearch", section: "mindmap", chord: { code: "KeyO", ctrl: true },
    labelKey: "openSearch", run: (c) => c.onOpenSearch(),
  },
];
