import type { StatusMode } from "@/utils/filter-tree";
import type { Binding, HotkeyLabelKey } from "./chord";

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
const STATUS_PRESETS: ReadonlyArray<{ code: string; mode: StatusMode; labelKey: HotkeyLabelKey }> = [
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
