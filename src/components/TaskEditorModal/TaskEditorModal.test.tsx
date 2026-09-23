import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
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
import { testKey } from "@/test/scope-key";

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
    rowId: 5,
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
  const GOAL_DEP: MindmapNode = { id: "goal-9", rowId: 9, kind: "goal", title: "Milestone", status: "active", position: 0, tagIds: [], children: [] };

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
        node={mkNode({ timeScope: { start_id: testKey(1), end_id: testKey(1) } })}
        onSave={onSave}
        onCheckScopeClamp={onCheckScopeClamp}
      />,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "save" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(onCheckScopeClamp).toHaveBeenCalledWith("task", 5, { start_id: testKey(1), end_id: testKey(1) }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("proceeds with the save when the clamp is confirmed", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onCheckScopeClamp = vi.fn().mockResolvedValue(true);
    render(
      <TaskEditorModal
        {...defaultProps}
        node={mkNode({ timeScope: { start_id: testKey(1), end_id: testKey(1) } })}
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
  const PLAN = { start_id: testKey(4), end_id: testKey(4) };

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

  it("turns the switch off in front of the user when the task is set In Progress", async () => {
    // One pair the two axes cannot hold at once: you are not actively doing what you have put
    // down. The backend does this to a bare status change; here the switch moves where it is seen.
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<TaskEditorModal {...defaultProps} node={mkNode({ backlogged: true })} onSave={onSave} />);
    await waitFor(() => expect(screen.getByDisplayValue("Write tests")).toBeInTheDocument());
    expect(screen.getByRole("checkbox", { name: "backlogOn" })).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "status:task.in_progress" }));
    expect(screen.getByRole("checkbox", { name: "backlogOff" })).not.toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ status: "in_progress", archival: "live" });
  });

  it("still lets a task already In Progress be set aside", async () => {
    // The rule is one-directional: a task under way may be put down, and keeps its status so it
    // says where the work stood when it is picked back up.
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<TaskEditorModal {...defaultProps} node={mkNode({ status: "in_progress" })} onSave={onSave} />);
    await waitFor(() => expect(screen.getByDisplayValue("Write tests")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("checkbox", { name: "backlogOff" }));
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ status: "in_progress", archival: "backlog" });
  });
});

describe("TaskEditorModal — Asynchronous", () => {
  const TEMPLATE = { title: "Waiting on the reviewer", tag_ids: [], check_every: { n: 2, kind: "day" } };
  const save = () => fireEvent.click(screen.getByRole("button", { name: "save" }));

  it("saves an unflagged task as unflagged, with no template, when nothing is touched", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<TaskEditorModal {...defaultProps} onSave={onSave} />);
    await waitFor(() => expect(screen.getByDisplayValue("Write tests")).toBeInTheDocument());

    expect(screen.queryByRole("group", { name: "expectation:templateSection" })).toBeNull();
    save();
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ asynchronous: false, asyncTemplate: null });
  });

  it("flags the task from the switch, and an empty Expectation section is no template", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<TaskEditorModal {...defaultProps} onSave={onSave} />);
    await waitFor(() => expect(screen.getByDisplayValue("Write tests")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("checkbox", { name: "asynchronousOff" }));
    expect(screen.getByRole("group", { name: "expectation:templateSection" })).toBeInTheDocument();
    save();
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ asynchronous: true, asyncTemplate: null });
  });

  it("saves what the Expectation section says, a blank title taking the default", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<TaskEditorModal {...defaultProps} onSave={onSave} />);
    await waitFor(() => expect(screen.getByDisplayValue("Write tests")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("checkbox", { name: "asynchronousOff" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "expectation:fieldCheckEvery" }), { target: { value: "3" } });
    save();
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({
      asynchronous: true,
      asyncTemplate: { title: "expectation:templateDefaultTitle", tag_ids: [], check_every: { n: 3, kind: "day" } },
    });
  });

  it("opens a task's template, and turning the flag off drops it", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<TaskEditorModal {...defaultProps} node={mkNode({ asynchronous: true, asyncTemplate: TEMPLATE })} onSave={onSave} />);
    await waitFor(() => expect(screen.getByDisplayValue("Write tests")).toBeInTheDocument());

    expect(screen.getByDisplayValue("Waiting on the reviewer")).toBeInTheDocument();
    const control = screen.getByRole("checkbox", { name: "asynchronousOn" });
    expect(control).toBeChecked();
    fireEvent.click(control);
    expect(screen.queryByDisplayValue("Waiting on the reviewer")).toBeNull();
    save();
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ asynchronous: false, asyncTemplate: null });
  });

  it("clears the template's Check every, and the saved template has none", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<TaskEditorModal {...defaultProps} node={mkNode({ asynchronous: true, asyncTemplate: TEMPLATE })} onSave={onSave} />);
    await waitFor(() => expect(screen.getByDisplayValue("Write tests")).toBeInTheDocument());

    const section = screen.getByRole("group", { name: "expectation:templateSection" });
    fireEvent.click(within(section).getByRole("button", { name: "scopeClear" }));
    save();
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = onSave.mock.calls[0]?.[0].asyncTemplate;
    expect(saved).toMatchObject({ title: "Waiting on the reviewer" });
    expect(saved).not.toHaveProperty("check_every");
  });

  it("opens at the Expectation section with the flag on when asked to (Shift+W), and Cancel writes nothing", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<TaskEditorModal {...defaultProps} onSave={onSave} onClose={onClose} openAtTemplate />);
    await waitFor(() => expect(screen.getByDisplayValue("Write tests")).toBeInTheDocument());

    expect(screen.getByRole("checkbox", { name: "asynchronousOn" })).toBeChecked();
    const section = screen.getByRole("group", { name: "expectation:templateSection" });
    expect(section.contains(document.activeElement)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "cancel" }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("leaves the Backlog switch alone — the two are separate answers", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<TaskEditorModal {...defaultProps} node={mkNode({ backlogged: true })} onSave={onSave} />);
    await waitFor(() => expect(screen.getByDisplayValue("Write tests")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("checkbox", { name: "asynchronousOff" }));
    save();
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ asynchronous: true, archival: "backlog" });
  });
});

describe("TaskEditorModal — Agentic", () => {
  function openAdvanced() {
    fireEvent.click(screen.getByRole("button", { name: "advanced" }));
  }

  it("saves an inheriting task as still inheriting when nothing is touched", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<TaskEditorModal {...defaultProps} onSave={onSave} />);
    await waitFor(() => expect(screen.getByDisplayValue("Write tests")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ agentic: "inherit" });
  });

  it("flags the task from the Advanced section", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<TaskEditorModal {...defaultProps} onSave={onSave} />);
    await waitFor(() => expect(screen.getByDisplayValue("Write tests")).toBeInTheDocument());

    openAdvanced();
    fireEvent.click(screen.getByRole("button", { name: "agenticYes" }));
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ agentic: "yes" });
  });

  it("takes one task back out of an agentic branch without touching the branch", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <TaskEditorModal
        {...defaultProps}
        node={mkNode({ inheritedAgentic: true })}
        onSave={onSave}
      />,
    );
    await waitFor(() => expect(screen.getByDisplayValue("Write tests")).toBeInTheDocument());

    openAdvanced();
    fireEvent.click(screen.getByRole("button", { name: "agenticNo" }));
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ agentic: "no" });
  });

  it("puts an explicitly flagged task back to inheriting", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<TaskEditorModal {...defaultProps} node={mkNode({ agentic: true })} onSave={onSave} />);
    await waitFor(() => expect(screen.getByDisplayValue("Write tests")).toBeInTheDocument());

    // Already flagged, so the section is open on arrival — an engaged setting is never hidden.
    fireEvent.click(screen.getByRole("button", { name: "agenticInherit" }));
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ agentic: "inherit" });
  });

  it("says what Inherit currently resolves to, since Inherit and Not agentic look alike", async () => {
    render(<TaskEditorModal {...defaultProps} node={mkNode({ inheritedAgentic: true })} />);
    await waitFor(() => expect(screen.getByDisplayValue("Write tests")).toBeInTheDocument());

    openAdvanced();
    expect(screen.getByText("agenticInheritedOn")).toBeInTheDocument();
  });

  it("keeps the flag and the delegate independent — setting one leaves the other alone", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<TaskEditorModal {...defaultProps} onSave={onSave} />);
    await waitFor(() => expect(screen.getByDisplayValue("Write tests")).toBeInTheDocument());

    openAdvanced();
    fireEvent.click(screen.getByRole("button", { name: "agenticYes" }));
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    // The save carries the flag and says nothing about delegation at all.
    expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty("delegate");
  });
});

describe("TaskEditorModal — the one-click delegate button", () => {
  async function renderAndOpen(node: MindmapNode, onSave = vi.fn().mockResolvedValue(undefined)) {
    render(<TaskEditorModal {...defaultProps} node={node} onSave={onSave} />);
    await waitFor(() => expect(screen.getByDisplayValue("Write tests")).toBeInTheDocument());
    return onSave;
  }

  function openAdvanced() {
    fireEvent.click(screen.getByRole("button", { name: "advanced" }));
  }

  function delegateButton(): HTMLElement {
    return screen.getByRole("button", { name: "delegateToAgent" });
  }

  it("is not offered on a task that is not agentic", async () => {
    await renderAndOpen(mkNode());
    openAdvanced();
    expect(screen.queryByRole("button", { name: "delegateToAgent" })).not.toBeInTheDocument();
  });

  it("appears as soon as the task is flagged agentic", async () => {
    await renderAndOpen(mkNode());
    openAdvanced();
    fireEvent.click(screen.getByRole("button", { name: "agenticYes" }));
    expect(delegateButton()).toHaveAttribute("aria-pressed", "false");
  });

  it("is offered on a task that inherits Agentic", async () => {
    await renderAndOpen(mkNode({ inheritedAgentic: true }));
    openAdvanced();
    expect(delegateButton()).toBeInTheDocument();
  });

  it("delegates an agentic task to the Agent in one click", async () => {
    const onSave = await renderAndOpen(mkNode({ agentic: true }));
    fireEvent.click(delegateButton());
    expect(delegateButton()).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ delegate: { kind: "agent" } });
  });

  it("takes the Agent back with a second click, saving an explicit null", async () => {
    const onSave = await renderAndOpen(mkNode({ agentic: true, delegate: { kind: "agent" } }));
    expect(delegateButton()).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(delegateButton());
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ delegate: null });
  });

  it("stays offered on an Agent-delegated task that is no longer agentic, so it can be taken back", async () => {
    await renderAndOpen(mkNode({ agentic: false, delegate: { kind: "agent" } }));
    expect(delegateButton()).toHaveAttribute("aria-pressed", "true");
  });

  it("says nothing about delegation when the button was pressed twice", async () => {
    const onSave = await renderAndOpen(mkNode({ agentic: true }));
    fireEvent.click(delegateButton());
    fireEvent.click(delegateButton());
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty("delegate");
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

describe("TaskEditorModal — the Issue row", () => {
  it("offers no row at all for a task with no issue link", () => {
    render(<TaskEditorModal {...defaultProps} onClearBeadsId={vi.fn()} />);
    expect(screen.queryByText("fieldBeadsId")).not.toBeInTheDocument();
  });

  it("stages the clear on the ×: nothing is written until Save", () => {
    const onClearBeadsId = vi.fn().mockResolvedValue(undefined);
    render(
      <TaskEditorModal
        {...defaultProps}
        node={mkNode({ beadsId: "Arlesh-5fs" })}
        onClearBeadsId={onClearBeadsId}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "clearBeadsId" }));

    expect(onClearBeadsId).not.toHaveBeenCalled();
    expect(defaultProps.onSave).not.toHaveBeenCalled();
    expect(defaultProps.onClose).not.toHaveBeenCalled();
    // The row reads as dropped and offers no second press, but the id is still there to come back.
    expect(screen.queryByRole("button", { name: "clearBeadsId" })).not.toBeInTheDocument();
    expect(screen.getByText("Arlesh-5fs")).toBeInTheDocument();
  });

  it("discards the staged clear when the editor is cancelled", async () => {
    const onClearBeadsId = vi.fn().mockResolvedValue(undefined);
    render(
      <TaskEditorModal
        {...defaultProps}
        node={mkNode({ beadsId: "Arlesh-5fs" })}
        onClearBeadsId={onClearBeadsId}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "clearBeadsId" }));
    fireEvent.click(screen.getByText("cancel"));

    await waitFor(() => expect(defaultProps.onClose).toHaveBeenCalledTimes(1));
    expect(onClearBeadsId).not.toHaveBeenCalled();
  });

  it("performs the staged clear on Save", async () => {
    const onClearBeadsId = vi.fn().mockResolvedValue(undefined);
    render(
      <TaskEditorModal
        {...defaultProps}
        node={mkNode({ beadsId: "Arlesh-5fs" })}
        onClearBeadsId={onClearBeadsId}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "clearBeadsId" }));
    fireEvent.click(screen.getByText("save"));

    await waitFor(() => expect(onClearBeadsId).toHaveBeenCalledTimes(1));
    expect(defaultProps.onSave).toHaveBeenCalledTimes(1);
  });

  it("saves without a clear when the × was never pressed", async () => {
    const onClearBeadsId = vi.fn().mockResolvedValue(undefined);
    render(
      <TaskEditorModal
        {...defaultProps}
        node={mkNode({ beadsId: "Arlesh-5fs" })}
        onClearBeadsId={onClearBeadsId}
      />,
    );

    fireEvent.click(screen.getByText("save"));

    await waitFor(() => expect(defaultProps.onSave).toHaveBeenCalledTimes(1));
    expect(onClearBeadsId).not.toHaveBeenCalled();
  });
});
