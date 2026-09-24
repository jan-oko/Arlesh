import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import NodeEditorModals from "./NodeEditorModals";
import { buildTree } from "@/components/MindmapView/use-mindmap-data";
import type { NodeEditorHandles } from "@/components/MindmapView/use-node-editor";
import type { Domain } from "@/api/domains";
import type { Flow, FlowItemCycle, FlowTask } from "@/api/flows";
import type { MindmapNode } from "@/utils/tree-layout";
import { findNode } from "@/utils/mindmap-tree";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { dir: () => "ltr" } }),
}));
vi.mock("@/hooks/use-valid-flow-targets", () => ({ useValidFlowTargets: () => null }));
vi.mock("@/api/flows", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/flows")>()),
  getFlowRecurrence: vi.fn().mockResolvedValue(null),
  habitCompletionCount: vi.fn().mockResolvedValue(0),
}));

const ASPECT: Domain = {
  id: 1, title: "Health", description: null, subtype: "aspect", parent_id: null, position: 0, is_private: false,
  status: null, knowledge_base_directory: null, color: null,
} satisfies Domain;

// A task-instance weekly flow whose root is planned into Day 1, with one item on Day 3 planned
// into its second part of day — the rows exactly as `load_mindmap` sends them.
const FLOW: Flow = {
  id: 5, title: "Sample", instance_type: "task", parent_type: "aspect", parent_id: 1,
  target_type: null, target_id: null, flow_duration_n: 1, flow_duration_kind: "week",
  flow_window_part: null, flow_window_time_start: null, flow_window_time_end: null,
  root_plan_kind: "day", root_plan_start: 1, root_plan_end: 1,
  verdict_window_n: null, verdict_window_kind: null, is_habit: true, position: 0, is_private: false,
};
const ITEM: FlowTask = {
  id: 9, flow_id: 5, title: "Prepare", parent_type: "flow", parent_id: 5, position: 0, is_private: false,
};
const PAIR: FlowItemCycle = {
  id: 3, flow_id: 5, item_type: "flow_task", item_id: 9, scope_kind: "day", scope_index: 3,
  plan_kind: "part_of_day", plan_start: 2, plan_end: 2, position: 0,
};

// A goal-instance daily flow whose items fall on parts of the day — the shape of a meals Habit.
const MEALS: Flow = {
  ...FLOW, id: 4, title: "Meals", instance_type: "goal", flow_duration_kind: "day",
  root_plan_kind: null, root_plan_start: null, root_plan_end: null,
};
const BREAKFAST: FlowTask = { ...ITEM, id: 4, flow_id: 4, title: "Breakfast", parent_id: 4 };
const MORNING: FlowItemCycle = {
  ...PAIR, id: 1, flow_id: 4, item_id: 4, scope_kind: "part_of_day", scope_index: 1,
  plan_kind: null, plan_start: null, plan_end: null,
};

function loadedTree(): MindmapNode {
  return buildTree([ASPECT], [], [], [], [], [FLOW, MEALS], [], [ITEM, BREAKFAST], [PAIR, MORNING]);
}

function editorOn(node: MindmapNode): NodeEditorHandles {
  const resolved = Promise.resolve();
  return {
    editorModal: { nodeId: node.id, node },
    setEditorModal: vi.fn(),
    allTags: [],
    domainNames: new Map(),
    availableForDep: [],
    onDoubleClick: vi.fn(),
    onTaskSave: vi.fn(() => resolved),
    onGoalSave: vi.fn(() => resolved),
    onCommitmentSave: vi.fn(() => resolved),
    onExpectationSave: vi.fn(() => resolved),
    onSimpleSave: vi.fn(() => resolved),
    onProjectSave: vi.fn(() => resolved),
    onInfoSave: vi.fn(() => resolved),
    onClearBeadsId: vi.fn(() => resolved),
    onFlowSave: vi.fn(() => resolved),
    onFlowItemSave: vi.fn(() => resolved),
    checkScopeClamp: vi.fn(() => Promise.resolve(true)),
    confirmScopeClamp: vi.fn(() => Promise.resolve(true)),
    scopeClampRequest: null,
    resolveScopeClamp: vi.fn(),
  };
}

function openEditorOn(nodeId: string): void {
  const tree = loadedTree();
  const node = findNode(tree, nodeId);
  if (node === undefined) throw new Error(`no ${nodeId} in the loaded tree`);
  render(<NodeEditorModals tree={tree} editor={editorOn(node)} />);
}

describe("NodeEditorModals — Cycle Plans as loaded", () => {
  it("opens the Flow editor on a task-instance flow with its root Cycle Plan, Day 1, chosen", () => {
    openEditorOn("flow-5");
    expect(screen.getByRole("combobox", { name: "cyclePlanKind" })).toHaveValue("day");
    expect(screen.getByRole("button", { name: "kindDay 1" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "kindDay 2" })).toHaveAttribute("aria-pressed", "false");
  });

  it("opens the item editor on a flow item with its pair's Cycle Plan in the pair's row", () => {
    openEditorOn("flowtask-9");
    expect(screen.getByText("editor:kindDay 3 · editor:kindPart 2")).toBeInTheDocument();
  });

  // Neither is offered here, as on master: Plan is task-only, and a part of day has no finer kind
  // to plan within (docs/spec/flows.md).
  it("offers no root Cycle Plan on a goal-instance flow", () => {
    openEditorOn("flow-4");
    expect(screen.queryByRole("combobox", { name: "cyclePlanKind" })).not.toBeInTheDocument();
  });

  it("offers no Cycle Plan on an item whose Cycle Scope is a part of the day", () => {
    openEditorOn("flowtask-4");
    expect(screen.getByText("scopes:part.morning")).toBeInTheDocument();
    expect(screen.queryByText("editor:cyclePlanKind")).not.toBeInTheDocument();
  });
});
