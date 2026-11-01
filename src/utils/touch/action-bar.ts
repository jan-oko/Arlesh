import type { View } from "@/stores/use-view-store";
import type { NodeKind } from "@/utils/tree-layout";
import type { TouchLabelKey } from "@/stores/use-command-surface-store";
import type { ActionIconName } from "@/components/ActionIcon/ActionIcon";
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
  /** The icon drawn above the label, from the touch chrome's one icon set. */
  icon: ActionIconName;
  kind: "run" | "menu";
  commandIds: readonly string[];
}

function run(key: string, labelKey: TouchLabelKey, icon: ActionIconName, commandIds: readonly string[]): ActionSlot {
  return { key, labelKey, icon, kind: "run", commandIds };
}

const UNDO = run("undo", "actionUndo", "undo", everyView("undo"));
const REDO = run("redo", "actionRedo", "redo", everyView("redo"));
/** `Ctrl+F`: the filter search. The one name for the bar's filter, the palette and the cheat sheet. */
const FILTER = run("filter", "actionFilter", "filter", ["global.openFilterSearch"]);
/** `Ctrl+O`: the node search that re-roots the tab. "Search" names a text box, never this action. */
const OPEN = run("open", "actionOpen", "open", ["global.openSearch"]);
/** A new Task or item under the selection (a Flow's item is its child). */
const CHILD = run("child", "actionChild", "child", everyView("createChild"));
const PLAN = run("plan", "actionPlan", "plan", everyView("quickPlan"));
/** Edit is on every view's bar: the editor is the one thing every node has. */
const EDIT = run("edit", "actionEdit", "edit", OPEN_EDITOR_IDS);

/** Plain Enter's cycle, in each view's own name for it (the Mindmap's is `mindmap.enter`). */
const STATUS_CYCLE = ["mindmap.enter", ...everyView("cycleStatus")];

/** The slots of each context, before Undo and Redo fill what room is left. */
const CONTEXT_SLOTS: Readonly<Record<ActionContext, readonly ActionSlot[]>> = {
  // With nothing selected a Child is a Task under the subtree you are in.
  nothing: [run("child", "actionChild", "child", ["touch.newTask"]), UNDO, REDO, OPEN, FILTER],
  task: [
    run("status", "actionStatus", "status", STATUS_CYCLE),
    CHILD,
    PLAN,
    run("dependency", "actionDependency", "dependency", everyView("quickDependency")),
    EDIT,
  ],
  commitment: [
    run("verdict", "actionVerdict", "verdict", ["mindmap.enter", "listView.cycleVerdict", "zenView.cycleVerdict", "stepsView.cycleStatus"]),
    CHILD,
    PLAN,
    EDIT,
  ],
  wait: [
    run("release", "actionRelease", "release", [
      "mindmap.enter", "listView.toggleReleaseEnter", "zenView.toggleReleaseEnter", "stepsView.cycleStatus",
    ]),
    run("checkDone", "actionCheckDone", "checkDone", ["touch.checkDone"]),
    CHILD,
    EDIT,
  ],
  container: [CHILD, run("sibling", "actionSibling", "sibling", everyView("createSibling")), EDIT],
  flow: [run("startFlow", "actionStartFlow", "startFlow", ["mindmap.startFlow"]), CHILD, EDIT],
  several: [
    run("status", "actionStatus", "status", STATUS_CYCLE),
    PLAN,
    run("archive", "actionArchive", "archive", ["touch.archiveSelection"]),
    UNDO,
  ],
  planView: [
    run("planInto", "actionPlanInto", "planInto", ["planView.moveAcross"]),
    {
      key: "kind", labelKey: "actionKind", icon: "kind", kind: "menu",
      commandIds: ["planView.kind.season", "planView.kind.month", "planView.kind.week", "planView.kind.day", "planView.kind.part_of_day"],
    },
    run("backlog", "actionBacklog", "backlog", ["planView.toggleBacklogCandidates"]),
    FILTER,
    EDIT,
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

/** Every slot the bar can draw, once each — the palette reads its icons off them. */
function allSlots(): ActionSlot[] {
  return [...Object.values(CONTEXT_SLOTS).flat(), UNDO, REDO];
}

/**
 * The icon of the bar slot that runs a binding, so the palette wears the bar's icons: one icon per
 * action, wherever it is offered. A binding no slot runs has none.
 */
export function iconForCommand(commandId: string): ActionIconName | null {
  return allSlots().find((slot) => slot.commandIds.includes(commandId))?.icon ?? null;
}
