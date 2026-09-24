import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FlowItemEditorModal from "./FlowItemEditorModal";
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
    rowId: 2,
    kind: "flow_task",
    title: "Implement",
    position: 1,
    tagIds: [],
    children: [],
    flowItem: { itemType: "flow_task", flowId: 5, flowInstanceType: "task" as const, flowScopeN: 2, flowScopeKind: "week", cycles: [], dependsOn: [], template: {} },
    ...overrides,
  };
}

const SPECIFY: MindmapNode = {
  id: "flowtask-1", rowId: 1, kind: "flow_task", title: "Specify", position: 0, tagIds: [], children: [],
  flowItem: { itemType: "flow_task", flowId: 5, flowInstanceType: "task" as const, flowScopeN: 2, flowScopeKind: "week", cycles: [], dependsOn: [], template: {} },
};

const defaultProps = {
  node: mkItem(),
  availableDeps: [SPECIFY],
  allTags: [],
  domainNames: new Map<number, string>(),
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

  it("asks the Habit editor's question when a cycle change would orphan recorded edits", async () => {
    const orphaning = {
      kind: "needs_confirmation",
      message: "changing these cycles would orphan what 2 iteration(s) recorded",
      details: { reason: "orphaned_edits", iterations: 2 },
    };
    const onSave = vi.fn().mockRejectedValueOnce(orphaning).mockResolvedValue(undefined);
    render(<FlowItemEditorModal {...defaultProps} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(screen.getByText("reconcilePromptCycles")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "reconcileFork" }));
    await waitFor(() =>
      expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ reconcile: "fork" })),
    );
  });

  it("saves nothing more when the question is cancelled", async () => {
    const onSave = vi.fn().mockRejectedValueOnce({
      kind: "needs_confirmation", message: "x", details: { reason: "orphaned_edits", iterations: 1 },
    });
    render(<FlowItemEditorModal {...defaultProps} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(screen.getByText("reconcilePromptCycles")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "reconcileCancel" }));
    expect(screen.queryByText("reconcilePromptCycles")).toBeNull();
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("saves the template's own fields, which its occurrences read unless they say otherwise", async () => {
    const node = mkItem({
      flowItem: {
        itemType: "flow_task", flowId: 5, flowInstanceType: "task", flowScopeN: 2, flowScopeKind: "week",
        cycles: [], dependsOn: [],
        template: { tag_ids: [4], block_reasons: ["waiting on parts"], archival: "backlog", asynchronous: true, agentic: true },
      },
    });
    render(<FlowItemEditorModal {...defaultProps} node={node} />);
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(defaultProps.onSave).toHaveBeenCalledWith(expect.objectContaining({
        template: {
          tag_ids: [4], block_reasons: ["waiting on parts"], archival: "backlog", asynchronous: true, agentic: "yes",
        },
      })),
    );
  });

  it("saves a pair planned with its row's toggle, plan and all", async () => {
    const morning = { scopeKind: "part_of_day", scopeIndex: 1, planKind: null, planStart: null, planEnd: null };
    const node = mkItem({
      flowItem: {
        itemType: "flow_task", flowId: 5, flowInstanceType: "task", flowScopeN: 1, flowScopeKind: "day",
        cycles: [morning], dependsOn: [], template: {},
      },
    });
    render(<FlowItemEditorModal {...defaultProps} node={node} />);
    fireEvent.click(screen.getByRole("button", { name: "editor:cyclePlanned" }));
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(defaultProps.onSave).toHaveBeenCalledWith(expect.objectContaining({
        cycles: [{ ...morning, planKind: "part_of_day", planStart: 1, planEnd: 1 }],
      })),
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
    render(<FlowItemEditorModal {...defaultProps} node={mkItem({ flowItem: { itemType: "flow_task", flowId: 5, flowInstanceType: "task" as const, flowScopeN: null, flowScopeKind: null, cycles: [], dependsOn: [], template: {} } })} />);
    expect(screen.queryByRole("button", { name: "editor:cycleAddWhole" })).not.toBeInTheDocument();
  });
});

/*
 * Escape is handled by a React `onKeyDown` on the dialog element, so it only fires while focus is
 * already inside the dialog. These press it with no Tab and no click first — the state the modal is
 * actually in the instant it opens — which is the one case a `fireEvent.keyDown` aimed at the input
 * cannot show.
 */
describe("FlowItemEditorModal — focus on open", () => {
  it("puts focus inside the dialog when it opens", () => {
    render(<FlowItemEditorModal {...defaultProps} />);
    expect(screen.getByLabelText("fieldTitle")).toHaveFocus();
  });

  it("closes on an Escape pressed the moment it opens, with no Tab or click first", async () => {
    const user = userEvent.setup();
    render(<FlowItemEditorModal {...defaultProps} />);
    await user.keyboard("{Escape}");
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });
});
