import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import FlowEditorModal from "./FlowEditorModal";
import type { MindmapNode } from "@/utils/tree-layout";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { dir: () => "ltr" },
  }),
}));

// Coarse target filtering is covered by the hook's own tests; unrestricted (null) here.
vi.mock("@/hooks/use-valid-flow-targets", () => ({ useValidFlowTargets: () => null }));

// The recurrence load runs on mount for edit-mode flows; default to "not a habit".
vi.mock("@/api/flows", () => ({
  getFlowRecurrence: vi.fn().mockResolvedValue(null),
  habitCompletionCount: vi.fn().mockResolvedValue(0),
}));
vi.mock("@/api/scopes", () => ({
  getScope: vi.fn().mockResolvedValue({
    id: 1, kind: "week", label: "", start_date: "2026-01-04", end_date: "2026-01-10",
    week_id: null, month_id: null, season_id: null, day_id: null,
    part: null, start_datetime: null, end_datetime: null,
  }),
}));

import { getFlowRecurrence, habitCompletionCount } from "@/api/flows";

function mkFlow(overrides: Partial<MindmapNode> = {}): MindmapNode {
  return {
    id: "flow-1",
    kind: "flow",
    title: "Ship a feature",
    position: 0,
    tagIds: [],
    children: [],
    flow: { instanceType: "task", targetType: null, targetId: null, durationN: 2, durationKind: "week", windowPart: null, windowTimeStart: null, windowTimeEnd: null },
    ...overrides,
  };
}

function mkGoal(id: number, title: string): MindmapNode {
  return { id: `goal-${id}`, kind: "goal", title, status: "active", position: 0, tagIds: [], children: [] };
}

const TARGETS = [mkGoal(7, "Backend Revamp"), mkGoal(8, "Frontend Polish")];

const defaultProps = {
  node: mkFlow(),
  availableTargets: TARGETS,
  onSave: vi.fn().mockResolvedValue(undefined),
  onClose: vi.fn(),
};

beforeEach(() => { vi.clearAllMocks(); });

describe("FlowEditorModal — initial state", () => {
  it("pre-fills title, instance type, and flow scope from the node", () => {
    render(<FlowEditorModal {...defaultProps} />);
    expect(screen.getByDisplayValue("Ship a feature")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2")).toBeInTheDocument();
    // Instance type "task" pill is active.
    expect(screen.getByRole("button", { name: "nodeKinds:task" })).toHaveClass(/statusPillActive/);
  });

  it("shows the existing target as a chip", () => {
    render(<FlowEditorModal {...defaultProps} node={mkFlow({ flow: { instanceType: "task", targetType: "goal", targetId: 7, durationN: 1, durationKind: "week", windowPart: null, windowTimeStart: null, windowTimeEnd: null } })} />);
    expect(screen.getByText("Backend Revamp")).toBeInTheDocument();
  });
});

describe("FlowEditorModal — save", () => {
  it("saves the trimmed title, instance type, and flow scope", async () => {
    render(<FlowEditorModal {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(defaultProps.onSave).toHaveBeenCalledWith({
        title: "Ship a feature",
        instanceType: "task",
        targetType: null,
        targetId: null,
        durationN: 2,
        durationKind: "week",
        windowPart: null,
        windowTimeStart: null,
        windowTimeEnd: null,
        recurrence: null,
      }),
    );
  });

  it("saves with goal instance type after clicking the goal pill", async () => {
    render(<FlowEditorModal {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: "nodeKinds:goal" }));
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(defaultProps.onSave).toHaveBeenCalledWith(expect.objectContaining({ instanceType: "goal" })),
    );
  });

  it("selects a target from the search and saves its type and id", async () => {
    render(<FlowEditorModal {...defaultProps} />);
    fireEvent.change(screen.getByPlaceholderText("placeholderTargetSearch"), { target: { value: "front" } });
    fireEvent.mouseDown(screen.getByText("Frontend Polish"));
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(defaultProps.onSave).toHaveBeenCalledWith(expect.objectContaining({ targetType: "goal", targetId: 8 })),
    );
  });

  it("saves a null flow scope when instances are made unscoped", async () => {
    render(<FlowEditorModal {...defaultProps} />);
    // Unticking the "scoped instances" checkbox clears the flow scope.
    fireEvent.click(screen.getByRole("checkbox", { name: "flowScoped" }));
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(defaultProps.onSave).toHaveBeenCalledWith(expect.objectContaining({ durationN: null, durationKind: null, windowPart: null, windowTimeStart: null, windowTimeEnd: null })),
    );
  });

  it("saves an exact Phase window with its time range", async () => {
    render(<FlowEditorModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText("scopeDuration"), { target: { value: "exact" } });
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(defaultProps.onSave).toHaveBeenCalledWith(
        expect.objectContaining({ durationKind: "exact", durationN: 1, windowTimeStart: "10:00", windowTimeEnd: "12:00", windowPart: null }),
      ),
    );
  });

  it("saves a part-of-day Phase window with its band", async () => {
    render(<FlowEditorModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText("scopeDuration"), { target: { value: "part" } });
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(defaultProps.onSave).toHaveBeenCalledWith(
        expect.objectContaining({ durationKind: "part", durationN: 1, windowPart: "evening", windowTimeStart: null }),
      ),
    );
  });

  it("saves a Recurrence when the habit toggle is enabled", async () => {
    render(<FlowEditorModal {...defaultProps} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "makeHabit" }));
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(defaultProps.onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          recurrence: expect.objectContaining({ consumptionKind: "destructive", startDate: expect.any(String) }),
        }),
      ),
    );
  });

  it("prompts to reconcile when a schedule change collides with completed iterations", async () => {
    vi.mocked(getFlowRecurrence).mockResolvedValueOnce({
      flow_id: 1, start_scope_id: 1, gap_n: null, gap_kind: null, end_scope_id: null,
      consumption_kind: "destructive", blocking_mode: null, catchup_policy: null,
    });
    vi.mocked(habitCompletionCount).mockResolvedValueOnce(2);
    render(<FlowEditorModal {...defaultProps} />);
    await waitFor(() => expect(habitCompletionCount).toHaveBeenCalled());

    // Change the flow window's N (2 → 3) — a schedule change.
    fireEvent.change(screen.getByLabelText("fieldFlowScope"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "save" }));

    // The reconcile prompt appears instead of saving directly.
    const forkBtn = await screen.findByRole("button", { name: "reconcileFork" });
    expect(defaultProps.onSave).not.toHaveBeenCalled();
    fireEvent.click(forkBtn);
    await waitFor(() =>
      expect(defaultProps.onSave).toHaveBeenCalledWith(expect.objectContaining({ reconcile: "fork" })),
    );
  });

  it("treats a flow with no stored scope as unscoped", () => {
    render(<FlowEditorModal {...defaultProps} node={mkFlow({ flow: { instanceType: "task", targetType: null, targetId: null, durationN: null, durationKind: null, windowPart: null, windowTimeStart: null, windowTimeEnd: null } })} />);
    expect(screen.getByRole("checkbox", { name: "flowScoped" })).not.toBeChecked();
  });

  it("does not save when the title is blank", () => {
    render(<FlowEditorModal {...defaultProps} node={mkFlow({ title: "   " })} />);
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    expect(defaultProps.onSave).not.toHaveBeenCalled();
  });
});

describe("FlowEditorModal — keyboard", () => {
  it("closes on Escape", () => {
    render(<FlowEditorModal {...defaultProps} />);
    fireEvent.keyDown(screen.getByDisplayValue("Ship a feature"), { key: "Escape" });
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });
});

describe("FlowEditorModal — target display", () => {
  const flowWith = (targetType: string, targetId: number) => ({
    instanceType: "task" as const, targetType, targetId,
    durationN: 2, durationKind: "week", windowPart: null, windowTimeStart: null, windowTimeEnd: null,
  });

  it("resolves a domain-table target (project) to its title, not #id", () => {
    const project: MindmapNode = {
      id: "domain-9", kind: "project", title: "Platform", position: 0, tagIds: [], children: [],
    };
    render(
      <FlowEditorModal
        {...defaultProps}
        node={mkFlow({ flow: flowWith("project", 9) })}
        availableTargets={[...TARGETS, project]}
      />,
    );
    expect(screen.getByText("Platform")).toBeInTheDocument();
    expect(screen.queryByText("#9")).not.toBeInTheDocument();
  });

  it("hides the target search once a target is selected", () => {
    render(<FlowEditorModal {...defaultProps} node={mkFlow({ flow: flowWith("goal", 7) })} />);
    expect(screen.getByText("Backend Revamp")).toBeInTheDocument(); // the chip
    expect(screen.queryByPlaceholderText("placeholderTargetSearch")).not.toBeInTheDocument();
  });
});
