import type { View } from "@/stores/use-view-store";
import type { NodeKind } from "@/utils/tree-layout";
import type { TouchLabelKey } from "@/stores/use-command-surface-store";
import { OPEN_EDITOR_IDS, everyView } from "./command-ids";

/** Which row of the action bar's table applies (`docs/spec/touch.md`). */
export type ActionContext =
  | "nothing" | "task" | "commitment" | "wait" | "container" | "flow" | "several" | "planView";

/**
 * One slot of the action bar. A **run** slot runs the first of its commands that can act now — the
 * views name the same action differently (`listView.cycleStatus`, `stepsView.cycleStatus`,
 * `mindmap.enter`), and only one view is mounted. A **menu** slot opens a sheet of its commands.
 */
export interface ActionSlot {
  key: string;
  labelKey: TouchLabelKey;
  /** A one-character glyph drawn above the label. */
  glyph: string;
  kind: "run" | "menu";
  commandIds: readonly string[];
}

function run(key: string, labelKey: TouchLabelKey, glyph: string, commandIds: readonly string[]): ActionSlot {
  return { key, labelKey, glyph, kind: "run", commandIds };
}

const UNDO = run("undo", "actionUndo", "↶", everyView("undo"));
const REDO = run("redo", "actionRedo", "↷", everyView("redo"));
const SEARCH = run("search", "actionSearch", "⌕", ["global.openSearch"]);
const FILTER = run("filter", "actionFilter", "⧩", ["global.openFilterSearch"]);
/** `Open (Ctrl+O)`: the node search that re-roots the tab, as the chord is everywhere. */
const OPEN = run("open", "actionOpen", "↗", ["global.openSearch"]);
const CHILD = run("child", "actionChild", "＋", everyView("createChild"));
const PLAN = run("plan", "actionPlan", "▦", everyView("quickPlan"));
const EDIT = run("edit", "actionEdit", "✎", OPEN_EDITOR_IDS);

/** Plain Enter's cycle, in each view's own name for it (the Mindmap's is `mindmap.enter`). */
const STATUS_CYCLE = ["mindmap.enter", ...everyView("cycleStatus")];

/** The slots of each context, before Undo and Redo fill what room is left. */
const CONTEXT_SLOTS: Readonly<Record<ActionContext, readonly ActionSlot[]>> = {
  nothing: [run("new", "actionNew", "＋", ["touch.newTask"]), UNDO, REDO, SEARCH, FILTER],
  task: [
    run("status", "actionStatus", "✓", STATUS_CYCLE),
    CHILD,
    PLAN,
    run("dependency", "actionDependency", "⇢", everyView("quickDependency")),
    OPEN,
  ],
  commitment: [
    run("verdict", "actionVerdict", "⚖", ["mindmap.enter", "listView.cycleVerdict", "zenView.cycleVerdict", "stepsView.cycleStatus"]),
    CHILD,
    PLAN,
    OPEN,
  ],
  wait: [
    run("release", "actionRelease", "✓", [
      "mindmap.enter", "listView.toggleReleaseEnter", "zenView.toggleReleaseEnter", "stepsView.cycleStatus",
    ]),
    // No binding completes a wait's due check yet; the slot holds its place, drawn disabled.
    run("checkDone", "actionCheckDone", "☑", []),
    CHILD,
    OPEN,
  ],
  container: [CHILD, run("sibling", "actionSibling", "⇣", everyView("createSibling")), EDIT, OPEN],
  flow: [run("startFlow", "actionStartFlow", "▶", ["mindmap.startFlow"]), run("item", "actionItem", "＋", everyView("createChild")), EDIT, OPEN],
  several: [
    run("status", "actionStatus", "✓", STATUS_CYCLE),
    PLAN,
    // No binding archives by hand yet; the slot holds its place, drawn disabled.
    run("archive", "actionArchive", "▣", []),
    UNDO,
  ],
  planView: [
    run("planInto", "actionPlanInto", "⇥", ["planView.moveAcross"]),
    {
      key: "kind", labelKey: "actionKind", glyph: "◫", kind: "menu",
      commandIds: ["planView.kind.season", "planView.kind.month", "planView.kind.week", "planView.kind.day", "planView.kind.part_of_day"],
    },
    run("backlog", "actionBacklog", "◌", ["planView.toggleBacklogCandidates"]),
    FILTER,
  ],
};

/** How many slots the bar holds before More. */
export const ACTION_BAR_CAPACITY = 5;

/** The context the bar shows for a view and the kinds of what is selected in it. */
export function actionContextFor(view: View, selectedKinds: readonly NodeKind[]): ActionContext {
  if (view === "plan") return "planView";
  if (selectedKinds.length > 1) return "several";
  const [kind] = selectedKinds;
  if (kind === undefined) return "nothing";
  return KIND_CONTEXT[kind];
}

const KIND_CONTEXT: Readonly<Record<NodeKind, ActionContext>> = {
  task: "task",
  flow_task: "task",
  commitment: "commitment",
  flow_commitment: "commitment",
  expectation: "wait",
  flow_expectation: "wait",
  flow: "flow",
  aspect: "container",
  domain: "container",
  project: "container",
  goal: "container",
  flow_goal: "container",
  tag: "container",
  info: "container",
  habit_group: "container",
};

/**
 * The slots drawn for a context: its own, then Undo and Redo while there is room — a context with
 * fewer than `ACTION_BAR_CAPACITY` slots gains them before More.
 */
export function actionSlotsFor(context: ActionContext): ActionSlot[] {
  const slots = [...CONTEXT_SLOTS[context]];
  for (const extra of [UNDO, REDO]) {
    if (slots.length >= ACTION_BAR_CAPACITY) break;
    if (!slots.some((slot) => slot.key === extra.key)) slots.push(extra);
  }
  return slots;
}
