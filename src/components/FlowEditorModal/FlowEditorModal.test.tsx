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
