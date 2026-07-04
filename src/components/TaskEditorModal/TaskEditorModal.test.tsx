import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import TaskEditorModal from "./TaskEditorModal";
import type { MindmapNode } from "@/utils/tree-layout";
import type { Domain } from "@/api/domains";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { dir: () => "ltr" },
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(invoke).mockImplementation((cmd: string) => {
    if (cmd === "list_task_dependencies") return Promise.resolve([]);
    return Promise.resolve(null);
  });
});

function mkNode(overrides: Partial<MindmapNode> = {}): MindmapNode {
  return {
    id: "task-5",
    kind: "task",
    title: "Write tests",
    status: "todo",
    blockReasons: [],
    position: 0,
    tagIds: [2],
    children: [],
    ...overrides,
  };
}

function mkTag(id: number, title: string): Domain {
  return { id, title, description: null, subtype: "tag", parent_id: null, color: null, status: null, knowledge_base_directory: null, position: 0 };
}

const TAG_A = mkTag(1, "backend");
const TAG_B = mkTag(2, "urgent");

const defaultProps = {
  node: mkNode(),
  allTags: [TAG_A, TAG_B],
  domainNames: new Map<number, string>(),
  availableForDep: [] as MindmapNode[],
  onSave: vi.fn().mockResolvedValue(undefined),
  onClose: vi.fn(),
};

describe("TaskEditorModal — initial state", () => {
  it("pre-fills title from node", async () => {
    render(<TaskEditorModal {...defaultProps} />);
    await waitFor(() => expect(screen.getByDisplayValue("Write tests")).toBeInTheDocument());
  });

  it("shows the node's selected tag as a pill; unselected tags stay in the closed dropdown", async () => {
    render(<TaskEditorModal {...defaultProps} />);
    await waitFor(() => expect(screen.getByText("urgent")).toBeInTheDocument()); // selected (id 2) → pill
    expect(screen.queryByText("backend")).not.toBeInTheDocument(); // unselected, dropdown closed
  });

  it("adds a tag from the search dropdown", async () => {
    render(<TaskEditorModal {...defaultProps} />);
    fireEvent.focus(screen.getByPlaceholderText("placeholderTagSearch"));
    fireEvent.mouseDown(screen.getByText("backend"));
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(defaultProps.onSave).toHaveBeenCalledWith(
        expect.objectContaining({ tagIds: expect.arrayContaining([1, 2]) }),
      ),
    );
  });
});

describe("TaskEditorModal — save", () => {
  it("calls onSave with trimmed title and current tagIds", async () => {
    render(<TaskEditorModal {...defaultProps} />);
    await waitFor(() => expect(screen.getByDisplayValue("Write tests")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(defaultProps.onSave).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Write tests", tagIds: [2], addedDeps: [], removedDeps: [] }),
      ),
    );
  });

  it("does not call onSave when title is blank", async () => {
    render(<TaskEditorModal {...defaultProps} node={mkNode({ title: "   " })} />);
    // Wait for the component to finish mounting (listTaskDependencies effect runs)
    await waitFor(() => expect(screen.getByRole("button", { name: "save" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    expect(defaultProps.onSave).not.toHaveBeenCalled();
  });

  it("saves with updated status after clicking a status pill", async () => {
    render(<TaskEditorModal {...defaultProps} />);
    await waitFor(() => expect(screen.getByDisplayValue("Write tests")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "status:task.in_progress" }));
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(defaultProps.onSave).toHaveBeenCalledWith(
        expect.objectContaining({ status: "in_progress" }),
      ),
    );
  });

  it("removes a tag via its pill and saves the updated tagIds", async () => {
    render(<TaskEditorModal {...defaultProps} />);
    await waitFor(() => expect(screen.getByText("urgent")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "removeTag" }));
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(defaultProps.onSave).toHaveBeenCalledWith(
        expect.objectContaining({ tagIds: [] }),
      ),
    );
  });
});

describe("TaskEditorModal — keyboard shortcuts", () => {
  it("calls onSave when Enter is pressed on the title input", async () => {
    render(<TaskEditorModal {...defaultProps} />);
    const input = await screen.findByDisplayValue("Write tests");
    fireEvent.keyDown(input, { key: "Enter", target: input });
    await waitFor(() => expect(defaultProps.onSave).toHaveBeenCalled());
  });

  it("calls onClose when Escape is pressed", async () => {
    render(<TaskEditorModal {...defaultProps} />);
    const input = await screen.findByDisplayValue("Write tests");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });
});

describe("TaskEditorModal — scope clamp guard", () => {
  it("aborts the save when the clamp prompt is cancelled", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onCheckScopeClamp = vi.fn().mockResolvedValue(false);
    render(
      <TaskEditorModal
        {...defaultProps}
        node={mkNode({ timeScope: { start_id: 1, end_id: 1 } })}
        onSave={onSave}
        onCheckScopeClamp={onCheckScopeClamp}
      />,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "save" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(onCheckScopeClamp).toHaveBeenCalledWith("task", 5, { start_id: 1, end_id: 1 }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("proceeds with the save when the clamp is confirmed", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onCheckScopeClamp = vi.fn().mockResolvedValue(true);
    render(
      <TaskEditorModal
        {...defaultProps}
        node={mkNode({ timeScope: { start_id: 1, end_id: 1 } })}
        onSave={onSave}
        onCheckScopeClamp={onCheckScopeClamp}
      />,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "save" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
  });
});

describe("TaskEditorModal — save error", () => {
  it("displays error message when onSave rejects", async () => {
    const error = new Error("Network error");
    const onSave = vi.fn().mockRejectedValue(error);
    render(<TaskEditorModal {...defaultProps} onSave={onSave} />);
    await waitFor(() => expect(screen.getByDisplayValue("Write tests")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(screen.getByText("Network error")).toBeInTheDocument());
  });
});
