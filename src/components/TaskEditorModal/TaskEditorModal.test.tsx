import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  return { id, title, description: null, subtype: "tag", parent_id: null, color: null, status: null, knowledge_base_directory: null, position: 0, is_private: false };
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

describe("TaskEditorModal — virtual blockers from dependencies", () => {
  const GOAL_DEP: MindmapNode = { id: "goal-9", kind: "goal", title: "Milestone", status: "active", position: 0, tagIds: [], children: [] };

  function withDep() {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "list_task_dependencies") return Promise.resolve([{ type: "goal", id: 9 }]);
      return Promise.resolve(null);
    });
    return render(<TaskEditorModal {...defaultProps} availableForDep={[GOAL_DEP]} />);
  }

  it("shows an unmet dependency as a virtual block reason", async () => {
    withDep();
    await waitFor(() => expect(screen.getByText("Blocked by goal 9 (Milestone)")).toBeInTheDocument());
  });

  it("drops the virtual block reason when its dependency is removed", async () => {
    withDep();
    await waitFor(() => expect(screen.getByText("Blocked by goal 9 (Milestone)")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "removeDependency" }));
    expect(screen.queryByText("Blocked by goal 9 (Milestone)")).not.toBeInTheDocument();
  });

  it("does not show a virtual blocker for a met (achieved) dependency", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) =>
      Promise.resolve(cmd === "list_task_dependencies" ? [{ type: "goal", id: 9 }] : null),
    );
    render(<TaskEditorModal {...defaultProps} availableForDep={[{ ...GOAL_DEP, status: "achieved" }]} />);
    await waitFor(() => expect(screen.getByDisplayValue("Write tests")).toBeInTheDocument());
    expect(screen.queryByText(/Blocked by goal 9/)).not.toBeInTheDocument();
  });
});

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

describe("TaskEditorModal — bd issue link", () => {
  it("shows the issue a linked task is tracked as", () => {
    render(<TaskEditorModal {...defaultProps} node={mkNode({ beadsId: "Arlesh-5fs" })} />);
    expect(screen.getByText("Arlesh-5fs")).toBeInTheDocument();
  });

  it("shows no issue row at all for an unlinked task", () => {
    render(<TaskEditorModal {...defaultProps} node={mkNode()} />);
    expect(screen.queryByText("fieldBeadsId")).not.toBeInTheDocument();
  });
});

describe("TaskEditorModal — Backlog control", () => {
  const PLAN = { start_id: 4, end_id: 4 };

  it("is off for an ordinary task and saves it as in play", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<TaskEditorModal {...defaultProps} onSave={onSave} />);
    await waitFor(() => expect(screen.getByDisplayValue("Write tests")).toBeInTheDocument());

    expect(screen.getByRole("checkbox", { name: "backlogOff" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ archival: "live" });
  });

  it("reads as on for a task already in the backlog", async () => {
    render(<TaskEditorModal {...defaultProps} node={mkNode({ backlogged: true })} />);
    await waitFor(() => expect(screen.getByDisplayValue("Write tests")).toBeInTheDocument());
    expect(screen.getByRole("checkbox", { name: "backlogOn" })).toBeChecked();
  });

  it("saves a task the switch was turned on for as backlogged", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<TaskEditorModal {...defaultProps} onSave={onSave} />);
    await waitFor(() => expect(screen.getByDisplayValue("Write tests")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("checkbox", { name: "backlogOff" }));
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ archival: "backlog" });
  });

  it("takes a task back out of the backlog", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<TaskEditorModal {...defaultProps} node={mkNode({ backlogged: true })} onSave={onSave} />);
    await waitFor(() => expect(screen.getByDisplayValue("Write tests")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("checkbox", { name: "backlogOn" }));
    expect(screen.getByRole("checkbox", { name: "backlogOff" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ archival: "live" });
  });

  it("puts a task in the backlog and takes it out again in one editing session", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<TaskEditorModal {...defaultProps} onSave={onSave} />);
    await waitFor(() => expect(screen.getByDisplayValue("Write tests")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("checkbox", { name: "backlogOff" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "backlogOn" }));
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ archival: "live" });
  });

  it("clears the Plan in front of the user rather than letting the save be refused", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<TaskEditorModal {...defaultProps} node={mkNode({ plan: PLAN })} onSave={onSave} />);
    await waitFor(() => expect(screen.getByDisplayValue("Write tests")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("checkbox", { name: "backlogOff" }));
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ archival: "backlog", plan: null });
  });

  it("leaves the status control usable on a backlogged task", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<TaskEditorModal {...defaultProps} node={mkNode({ backlogged: true })} onSave={onSave} />);
    await waitFor(() => expect(screen.getByDisplayValue("Write tests")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "status:task.done" }));
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    // Both axes independent: finished, and still set aside.
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ status: "done", archival: "backlog" });
  });
});

/*
 * Escape is handled by a React `onKeyDown` on the dialog element, so it only fires while focus is
 * already inside the dialog. These press it with no Tab and no click first — the state the modal is
 * actually in the instant it opens — which is the one case a `fireEvent.keyDown` aimed at the input
 * cannot show.
 */
describe("TaskEditorModal — focus on open", () => {
  it("puts focus inside the dialog when it opens", () => {
    render(<TaskEditorModal {...defaultProps} />);
    expect(screen.getByLabelText("fieldTitle")).toHaveFocus();
  });

  it("closes on an Escape pressed the moment it opens, with no Tab or click first", async () => {
    const user = userEvent.setup();
    render(<TaskEditorModal {...defaultProps} />);
    await user.keyboard("{Escape}");
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });
});
