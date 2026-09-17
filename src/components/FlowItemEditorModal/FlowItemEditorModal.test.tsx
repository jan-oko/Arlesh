import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import FlowItemEditorModal from "./FlowItemEditorModal";
import { expectFocusTrapped, dialogIn } from "@/test/focus-trap";
import type { MindmapNode } from "@/utils/tree-layout";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { dir: () => "ltr" },
  }),
}));

function mkItem(overrides: Partial<MindmapNode> = {}): MindmapNode {
  return {
    id: "flowtask-2",
    kind: "flow_task",
    title: "Implement",
    position: 1,
    tagIds: [],
    children: [],
    flowItem: { itemType: "flow_task", flowId: 5, flowScopeN: 2, flowScopeKind: "week", cycles: [], dependsOn: [] },
    ...overrides,
  };
}

const SPECIFY: MindmapNode = {
  id: "flowtask-1", kind: "flow_task", title: "Specify", position: 0, tagIds: [], children: [],
  flowItem: { itemType: "flow_task", flowId: 5, flowScopeN: 2, flowScopeKind: "week", cycles: [], dependsOn: [] },
};

const defaultProps = {
  node: mkItem(),
  availableDeps: [SPECIFY],
  onSave: vi.fn().mockResolvedValue(undefined),
  onClose: vi.fn(),
};

beforeEach(() => { vi.clearAllMocks(); });

describe("FlowItemEditorModal", () => {
  it("pre-fills the title", () => {
    render(<FlowItemEditorModal {...defaultProps} />);
    expect(screen.getByDisplayValue("Implement")).toBeInTheDocument();
  });

  it("saves the trimmed title", async () => {
    render(<FlowItemEditorModal {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(defaultProps.onSave).toHaveBeenCalledWith(expect.objectContaining({ title: "Implement" })),
    );
  });

  it("adds an intra-flow dependency from the search", async () => {
    render(<FlowItemEditorModal {...defaultProps} />);
    fireEvent.change(screen.getByPlaceholderText("placeholderDepSearch"), { target: { value: "spec" } });
    fireEvent.mouseDown(screen.getByText("Specify"));
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(defaultProps.onSave).toHaveBeenCalledWith(
        expect.objectContaining({ addedDeps: [{ type: "flow_task", id: 1 }] }),
      ),
    );
  });

  it("adds a whole-scope cycle pair", async () => {
    render(<FlowItemEditorModal {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: "editor:cycleAddWhole" }));
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(defaultProps.onSave).toHaveBeenCalledWith(
        expect.objectContaining({ cycles: [{ scopeKind: null, scopeIndex: null, planKind: null, planStart: null, planEnd: null }] }),
      ),
    );
  });

  it("adds a specific cycle by clicking a leaf cell — no separate confirm step", async () => {
    render(<FlowItemEditorModal {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: "editor:kindWeek 1" }));
    fireEvent.click(screen.getByRole("button", { name: "editor:kindDay 3" }));
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(defaultProps.onSave).toHaveBeenCalledWith(
        expect.objectContaining({ cycles: [{ scopeKind: "day", scopeIndex: 3, planKind: null, planStart: null, planEnd: null }] }),
      ),
    );
  });

  it("hides the cycle grid for an unscoped flow", () => {
    render(<FlowItemEditorModal {...defaultProps} node={mkItem({ flowItem: { itemType: "flow_task", flowId: 5, flowScopeN: null, flowScopeKind: null, cycles: [], dependsOn: [] } })} />);
    expect(screen.queryByRole("button", { name: "editor:cycleAddWhole" })).not.toBeInTheDocument();
  });
});

describe("FlowItemEditorModal — focus trap", () => {
  it("keeps Tab and Shift+Tab inside the dialog, wrapping at both ends", async () => {
    render(<button data-testid="behind-the-modal" />);
    const { container } = render(<FlowItemEditorModal {...defaultProps} />);
    await expectFocusTrapped(dialogIn(container));
  });
});
