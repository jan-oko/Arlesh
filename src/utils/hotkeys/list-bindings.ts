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
  onToggleFullscreen: () => void;
  /** Whether the selected row is currently blocked (and not a Habit instance) — gates Enter. */
  isSelectedBlocked: boolean;
  onNavigate: (direction: 1 | -1) => void;
  /** Scrolls the list a fixed step down (1) or up (-1), leaving the selection where it is. */
  onScrollList: (direction: 1 | -1) => void;
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
  /** Flips the selected Task between Agentic and Not agentic, whichever it currently reads as. */
  onToggleAgentic: (id: string) => void;
  /** Advances the selected Commitment's verdict: Unresolved → Kept → Broken → Unresolved. */
  onCycleVerdict: (id: string) => void;
  /** Records that it was not held to, or clears an existing Broken. */
  onMarkBroken: (id: string) => void;
  /** Reverses the last thing the user did to the board, anywhere in the app. */
  onUndo: () => void;
  /** Reapplies the most recently undone thing. */
  onRedo: () => void;
}

/**
 * The physical keys that scroll the list. Exported because the viewport has to watch for their
 * *release* as well: the scroll runs while the key is held, so the binding table and the hook that
 * moves the viewport must name the same two keys rather than each spelling them out.
 */
export const SCROLL_DOWN_CODE = "KeyJ";
/** See {@link SCROLL_DOWN_CODE}. */
export const SCROLL_UP_CODE = "KeyK";

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
  {
    // Bare F shows the board alone, on the same rule as the Mindmap's: only with nothing selected.
    // Nothing else claims F here, but matching the Mindmap matters more than the free key does —
    // one gesture should not mean two things depending on which view you happen to be in.
    id: "listView.toggleFullscreen", section: "listView", chord: { code: "KeyF" },
    labelKey: "toggleFullscreen",
    when: (c) => c.selectedRowId === null,
    run: (c) => c.onToggleFullscreen(),
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
  // Reading ahead without giving up your place: these move the viewport and nothing else, so the
  // selection stays put even once it has scrolled out of sight. `allowRepeat: false` because the
  // press only *starts* the motion — holding the key is then carried by an animation loop at a
  // fixed speed (see use-list-scroll), and letting auto-repeat through as well would have the
  // repeats restarting a scroll that is already running.
  {
    id: "listView.scrollDown", section: "listView", chord: { code: SCROLL_DOWN_CODE },
    labelKey: "scrollList", allowRepeat: false, run: (c) => c.onScrollList(1),
  },
  {
    id: "listView.scrollUp", section: "listView", chord: { code: SCROLL_UP_CODE },
    labelKey: "scrollList", allowRepeat: false, run: (c) => c.onScrollList(-1),
  },
  {
    id: "listView.cycleStatus", section: "listView", chord: { code: "Enter" },
    labelKey: "cycleRowStatus",
    when: (c) => c.selectedTaskId !== null && !c.isSelectedBlocked,
    run: (c) => { if (c.selectedTaskId !== null) c.onCycleStatus(c.selectedTaskId); },
  },
  {
    // Shares Enter with `listView.cycleStatus`, and the two cannot both fire: a selection is a
    // Task or a Commitment, never both. The same key means "advance the status" on one and
    // "advance the verdict" on the other, which is the same gesture read in each kind's own terms.
    id: "listView.cycleVerdict", section: "listView", chord: { code: "Enter" },
    labelKey: "cycleVerdict",
    when: (c) => c.selectedCommitmentId !== null,
    run: (c) => { if (c.selectedCommitmentId !== null) c.onCycleVerdict(c.selectedCommitmentId); },
  },
  {
    // Kept in its own right even though Enter now cycles past Broken: this is the one-press route
    // to Broken, so recording a broken commitment never has to pass through saying you kept it.
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
    // Bare A beside bare B, matching the Mindmap: a flag on the selected Task is a bare letter,
    // Alt+letter is a status preset, and strict chord matching keeps A and Alt+A apart.
    // Habit instances are turned away in the hook, exactly as Backlog turns them away.
    id: "listView.toggleAgentic", section: "listView", chord: { code: "KeyA" },
    labelKey: "toggleAgentic",
    when: (c) => c.selectedTaskId !== null,
    run: (c) => { if (c.selectedTaskId !== null) c.onToggleAgentic(c.selectedTaskId); },
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
