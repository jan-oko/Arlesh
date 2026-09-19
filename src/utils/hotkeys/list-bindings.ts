import type { StatusMode } from "@/utils/filter-tree";
import type { Binding, HotkeyLabelKey } from "./chord";

/** What the List View bindings act on — the hook's options minus its gating flag. */
export interface ListContext {
  /** The selected row when it is a Task; null when a Commitment is selected, or nothing is. */
  selectedTaskId: string | null;
  /** The selected row when it is a Commitment. Never set at the same time as `selectedTaskId`:
   * List View has one selection, and which kind it is decides what Enter means. */
  selectedCommitmentId: string | null;
  /** Whichever of the two is set — for the bindings that do not care which kind it is. */
  selectedRowId: string | null;
  /** Whether the selected row is currently blocked (and not a Habit instance) — gates Enter. */
  isSelectedBlocked: boolean;
  onNavigate: (direction: 1 | -1) => void;
  onCycleStatus: (id: string) => void;
  onOpenEditor: (id: string) => void;
  onStartRename: (id: string) => void;
  onDeselect: () => void;
  onToggleFilter: () => void;
  onSetStatusMode: (mode: StatusMode) => void;
  /** Opens the node search; picking a result enters that node's subtree. */
  onOpenSearch: () => void;
  /** Whether the view is currently re-rooted at a subtree — gates the two exit chords. */
  subtreeRootId: string | null;
  /** Up one subtree level. */
  onExitSubtree: () => void;
  /** Straight back out to the true root. */
  onExitToRoot: () => void;
  /** Puts the selected Task in the backlog, or takes it out. */
  onToggleBacklog: (id: string) => void;
  /** Records that the selected Commitment was held to, or clears an existing Kept. */
  onMarkKept: (id: string) => void;
  /** Records that it was not, or clears an existing Broken. */
  onMarkBroken: (id: string) => void;
  /** Reverses the last thing the user did to the board, anywhere in the app. */
  onUndo: () => void;
  /** Reapplies the most recently undone thing. */
  onRedo: () => void;
}

/** Alt+letter → status preset, matched on physical key so it works under any layout. */
const STATUS_PRESETS: ReadonlyArray<{ code: string; mode: StatusMode; labelKey: HotkeyLabelKey }> = [
  { code: "KeyA", mode: "all", labelKey: "statusAll" },
  { code: "KeyP", mode: "plan", labelKey: "statusPlan" },
  { code: "KeyS", mode: "start", labelKey: "statusStart" },
  { code: "KeyD", mode: "do", labelKey: "statusDo" },
  { code: "KeyB", mode: "backlog", labelKey: "statusBacklog" },
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
    id: "listView.navigateUp", section: "listView", chord: { code: "ArrowUp" },
    labelKey: "navigateRows", run: (c) => c.onNavigate(-1),
  },
  {
    id: "listView.navigateDown", section: "listView", chord: { code: "ArrowDown" },
    labelKey: "navigateRows", run: (c) => c.onNavigate(1),
  },
  {
    id: "listView.cycleStatus", section: "listView", chord: { code: "Enter" },
    labelKey: "cycleRowStatus",
    when: (c) => c.selectedTaskId !== null && !c.isSelectedBlocked,
    run: (c) => { if (c.selectedTaskId !== null) c.onCycleStatus(c.selectedTaskId); },
  },
  {
    // Shares Enter with `listView.cycleStatus`, and the two cannot both fire: a selection is a
    // Task or a Commitment, never both. The same key means "advance the work" on one and
    // "I kept this" on the other, which is the same gesture read in each kind's own terms.
    id: "listView.markKept", section: "listView", chord: { code: "Enter" },
    labelKey: "markKept",
    when: (c) => c.selectedCommitmentId !== null,
    run: (c) => { if (c.selectedCommitmentId !== null) c.onMarkKept(c.selectedCommitmentId); },
  },
  {
    // A separate key rather than a second press of Enter: the two outcomes are equal, and
    // Broken must never be one keystroke past Kept on a cycle.
    id: "listView.markBroken", section: "listView", chord: { code: "KeyX" },
    labelKey: "markBroken",
    when: (c) => c.selectedCommitmentId !== null,
    run: (c) => { if (c.selectedCommitmentId !== null) c.onMarkBroken(c.selectedCommitmentId); },
  },
  {
    id: "listView.openEditor", section: "listView", chord: { code: "KeyE" },
    labelKey: "openEditor",
    when: (c) => c.selectedRowId !== null,
    run: (c) => { if (c.selectedRowId !== null) c.onOpenEditor(c.selectedRowId); },
  },
  {
    id: "listView.rename", section: "listView", chord: { code: "KeyR" },
    labelKey: "rename",
    when: (c) => c.selectedTaskId !== null,
    run: (c) => { if (c.selectedTaskId !== null) c.onStartRename(c.selectedTaskId); },
  },
  {
    id: "listView.openSearch", section: "listView", chord: { code: "KeyO", ctrl: true },
    labelKey: "enterBySearch", run: (c) => c.onOpenSearch(),
  },

  // --- Subtree navigation, matching the Mindmap's exactly (the subtree root is shared state, so
  // the two views have to agree on how you get back out of one). Listed before the bare-Escape
  // deselect because all three share the Escape key and the most specific chord must win.
  {
    id: "listView.exitToRoot", section: "listView", chord: { code: "Escape", ctrl: true },
    labelKey: "exitToRoot",
    when: (c) => c.subtreeRootId !== null,
    run: (c) => c.onExitToRoot(),
  },
  {
    id: "listView.exitSubtree", section: "listView", chord: { code: "Escape", shift: true },
    labelKey: "exitSubtree",
    when: (c) => c.subtreeRootId !== null,
    run: (c) => c.onExitSubtree(),
  },
  {
    id: "listView.toggleBacklog", section: "listView", chord: { code: "KeyB" },
    labelKey: "toggleBacklog",
    when: (c) => c.selectedTaskId !== null,
    run: (c) => { if (c.selectedTaskId !== null) c.onToggleBacklog(c.selectedTaskId); },
  },
  {
    id: "listView.deselect", section: "listView", chord: { code: "Escape" },
    labelKey: "deselect",
    when: (c) => c.selectedRowId !== null,
    run: (c) => c.onDeselect(),
  },
  {
    id: "listView.undo", section: "listView", chord: { code: "KeyZ", ctrl: true },
    labelKey: "undo", allowRepeat: false, run: (c) => c.onUndo(),
  },
  {
    id: "listView.redo", section: "listView", chord: { code: "KeyZ", ctrl: true, shift: true },
    labelKey: "redo", allowRepeat: false, run: (c) => c.onRedo(),
  },
  {
    // The other redo the world uses. Hidden because the sheet already lists Ctrl+Shift+Z.
    id: "listView.redoAlias", section: "listView", chord: { code: "KeyY", ctrl: true },
    labelKey: "redo", hidden: true, allowRepeat: false, run: (c) => c.onRedo(),
  },
];
