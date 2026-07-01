import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import GoalEditorModal from "./GoalEditorModal";
import type { MindmapNode } from "@/utils/tree-layout";
import type { Domain } from "@/api/domains";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { dir: () => "ltr" },
  }),
}));

function mkNode(overrides: Partial<MindmapNode> = {}): MindmapNode {
  return {
    id: "goal-1",
    kind: "goal",
    title: "Ship it",
    status: "active",
    blockedReason: "",
    position: 0,
    tagIds: [2],
    children: [],
    ...overrides,
  };
}

function mkTag(id: number, title: string): Domain {
  return { id, title, description: null, subtype: "tag", parent_id: null, color: null, status: null, knowledge_base_directory: null, position: 0 };
}

const TAG_A = mkTag(1, "frontend");
const TAG_B = mkTag(2, "urgent");

const defaultProps = {
  node: mkNode(),
  allTags: [TAG_A, TAG_B],
  onSave: vi.fn().mockResolvedValue(undefined),
  onClose: vi.fn(),
};

beforeEach(() => { vi.clearAllMocks(); });

describe("GoalEditorModal — initial state", () => {
  it("pre-fills title from node", () => {
    render(<GoalEditorModal {...defaultProps} />);
    expect(screen.getByDisplayValue("Ship it")).toBeInTheDocument();
  });

  it("marks the node's tag as checked", () => {
    render(<GoalEditorModal {...defaultProps} />);
    const urgentCheckbox = screen.getByRole("checkbox", { name: "urgent" });
    expect(urgentCheckbox).toBeChecked();
    const frontendCheckbox = screen.getByRole("checkbox", { name: "frontend" });
    expect(frontendCheckbox).not.toBeChecked();
  });
});

describe("GoalEditorModal — save", () => {
  it("calls onSave with trimmed title and current tagIds", async () => {
    render(<GoalEditorModal {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(defaultProps.onSave).toHaveBeenCalledWith({
        title: "Ship it",
        status: "active",
        blockedReason: "",
        tagIds: [2],
        timeScope: null,
      }),
    );
  });

  it("does not call onSave when title is blank", () => {
    render(<GoalEditorModal {...defaultProps} node={mkNode({ title: "   " })} />);
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    expect(defaultProps.onSave).not.toHaveBeenCalled();
  });

  it("toggles a tag on and saves the updated tagIds", async () => {
    render(<GoalEditorModal {...defaultProps} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "frontend" }));
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(defaultProps.onSave).toHaveBeenCalledWith(
        expect.objectContaining({ tagIds: expect.arrayContaining([1, 2]) }),
      ),
    );
  });

  it("saves with updated status after clicking a status pill", async () => {
    render(<GoalEditorModal {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: "status:goal.achieved" }));
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(defaultProps.onSave).toHaveBeenCalledWith(
        expect.objectContaining({ status: "achieved" }),
      ),
    );
  });
});

describe("GoalEditorModal — keyboard shortcuts", () => {
  it("calls onSave when Enter is pressed on the title input", async () => {
    render(<GoalEditorModal {...defaultProps} />);
    const input = screen.getByDisplayValue("Ship it");
    fireEvent.keyDown(input, { key: "Enter", target: input });
    await waitFor(() => expect(defaultProps.onSave).toHaveBeenCalled());
  });

  it("calls onClose when Escape is pressed", () => {
    render(<GoalEditorModal {...defaultProps} />);
    fireEvent.keyDown(screen.getByDisplayValue("Ship it"), { key: "Escape" });
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });
});
