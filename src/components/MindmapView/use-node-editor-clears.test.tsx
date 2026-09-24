import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, renderHook, act } from "@testing-library/react";
import { useNodeEditor } from "./use-node-editor";
import TaskEditorModal from "@/components/TaskEditorModal/TaskEditorModal";
import type { TaskSaveData } from "@/components/TaskEditorModal/TaskEditorModal";
import type { CommitmentSaveData } from "@/components/CommitmentEditorModal/CommitmentEditorModal";
import type { MindmapNode } from "@/utils/tree-layout";
import { TASK_AGENTIC } from "@/api/tasks";
import { BEADS_NODE_TYPE, clearBeadsId } from "@/api/beads";
import { testKey } from "@/test/scope-key";

// Nothing under `@/api` is mocked here, on purpose. The question these tests answer is what the
// editor actually puts *on the wire* when a field is emptied: `Option<Option<T>>` on the Rust side
// can only tell "clear" from "leave unchanged" if the key arrives carrying an explicit `null`, and
// `exactOptionalPropertyTypes` would make a conditionally-built request object omit it instead.
// So the seam stubbed is Tauri's IPC entry point itself — the function `invoke` hands the command
// to — with every hop above it (editor, hook, `src/api`) real.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { dir: () => "ltr" } }),
}));

declare global {
  interface Window {
    __TAURI_INTERNALS__?: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
  }
}

const ipc = vi.fn((cmd: string, _args?: unknown): Promise<unknown> => {
  if (cmd === "list_domains" || cmd === "list_task_dependencies") return Promise.resolve([]);
  return Promise.resolve(null);
});

beforeEach(() => {
  ipc.mockClear();
  window.__TAURI_INTERNALS__ = { invoke: ipc };
});

afterEach(() => {
  delete window.__TAURI_INTERNALS__;
});

const scope = { start_id: testKey(1), end_id: testKey(1) };

const taskNode: MindmapNode = {
  id: "task-5", rowId: 5, kind: "task", title: "Task", tagIds: [], position: 0, children: [],
  timeScope: scope, onScopeExit: "keep", status: "todo", blockReasons: [],
};
const commitmentNode: MindmapNode = {
  id: "commitment-7", rowId: 7, kind: "commitment", title: "Asleep by 23:00", tagIds: [], position: 0,
  children: [], timeScope: scope, verdictWindow: { n: 2, kind: "day" },
};
const root: MindmapNode = {
  id: "root", kind: "domain", title: "Arlesh", tagIds: [], position: 0,
  children: [taskNode, commitmentNode],
};

/** The request body `command` reached the IPC boundary with, as JSON round-tripped it. */
function wireRequest(command: string): Record<string, unknown> {
  const call = ipc.mock.calls.find(([cmd]) => cmd === command);
  if (call === undefined) throw new Error(`${command} never reached the IPC boundary`);
  const sent: unknown = JSON.parse(JSON.stringify(call[1]));
  if (sent === null || typeof sent !== "object" || !("request" in sent)) {
    throw new Error(`${command} was sent without a request`);
  }
  const { request } = sent;
  if (request === null || typeof request !== "object") {
    throw new Error(`${command}'s request is not an object`);
  }
  return { ...request };
}

/** Every argument `command` reached the IPC boundary with, as JSON round-tripped it. */
function wireArgs(command: string): Record<string, unknown> {
  const call = ipc.mock.calls.find(([cmd]) => cmd === command);
  if (call === undefined) throw new Error(`${command} never reached the IPC boundary`);
  const sent: unknown = JSON.parse(JSON.stringify(call[1]));
  if (sent === null || typeof sent !== "object") {
    throw new Error(`${command} was sent without arguments`);
  }
  return { ...sent };
}

function editor() {
  const reload = vi.fn().mockResolvedValue(undefined);
  const { result } = renderHook(() =>
    useNodeEditor({ tree: root, allTasksAndGoals: [taskNode], reload }),
  );
  return result;
}

const taskSave: TaskSaveData = {
  title: "Task", status: "todo", blockReasons: [], tagIds: [], addedDeps: [], removedDeps: [],
  timeScope: null, onScopeExit: null, plan: null, archival: "live", isPrivate: false,
  // Master added this field while this branch was open. "Inherit" is where every Task starts, and
  // these tests are about the nullable scope fields, not about the Agentic flag.
  agentic: TASK_AGENTIC.INHERIT,
  asynchronous: false,
  asyncTemplate: null,
};
const commitmentSave: CommitmentSaveData = {
  title: "Asleep by 23:00", verdict: "unresolved", tagIds: [],
  timeScope: null, verdictWindow: null, isPrivate: false,
};

describe("emptying a field in the editor", () => {
  it("sends a Task's cleared fields as explicit nulls, not as absent keys", async () => {
    const result = editor();
    act(() => result.current.setEditorModal({ nodeId: "task-5", node: taskNode }));
    await act(async () => {
      await result.current.onTaskSave(taskSave);
    });

    const request = wireRequest("update_task");
    expect(Object.keys(request)).toContain("time_scope");
    expect(request["time_scope"]).toBeNull();
    expect(request["on_scope_exit"]).toBeNull();
    expect(request["plan"]).toBeNull();
  });

  it("sends a Commitment's cleared fields as explicit nulls, not as absent keys", async () => {
    const result = editor();
    act(() => result.current.setEditorModal({ nodeId: "commitment-7", node: commitmentNode }));
    await act(async () => {
      await result.current.onCommitmentSave(commitmentSave);
    });

    const request = wireRequest("update_commitment");
    expect(Object.keys(request)).toContain("time_scope");
    expect(request["time_scope"]).toBeNull();
    expect(request["verdict_window"]).toBeNull();
  });

  it("hands the save a null Time Scope once the clear button is pressed", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <TaskEditorModal
        node={taskNode}
        allTags={[]}
        domainNames={new Map()}
        availableForDep={[]}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("scopeClear"));
    fireEvent.click(screen.getByText("save"));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ timeScope: null, onScopeExit: null });
  });
});

const linkedTaskNode: MindmapNode = { ...taskNode, beadsId: "Arlesh-5fs" };

describe("clearing a beads id from the editor", () => {
  it("sends the node's own kind and id to clear_beads_id, and grows no update field for it", async () => {
    const result = editor();
    act(() => result.current.setEditorModal({ nodeId: "task-5", node: linkedTaskNode }));
    await act(async () => {
      await result.current.onClearBeadsId(BEADS_NODE_TYPE.TASK);
    });

    expect(wireArgs("clear_beads_id")).toEqual({ nodeType: "task", nodeId: 5 });
    expect(
      ipc.mock.calls.some(([cmd]) => cmd === "update_task"),
      "no update request carries a beads field, and none is sent alongside",
    ).toBe(false);
  });

  it("reloads the board, so the next open of this editor shows no Issue row", async () => {
    const reload = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useNodeEditor({ tree: root, allTasksAndGoals: [taskNode], reload }),
    );
    act(() => result.current.setEditorModal({ nodeId: "task-5", node: linkedTaskNode }));
    await act(async () => {
      await result.current.onClearBeadsId(BEADS_NODE_TYPE.TASK);
    });

    expect(reload).toHaveBeenCalled();
  });

  it("writes nothing when no editor is open", async () => {
    const result = editor();
    await act(async () => {
      await result.current.onClearBeadsId(BEADS_NODE_TYPE.TASK);
    });

    expect(ipc.mock.calls.some(([cmd]) => cmd === "clear_beads_id")).toBe(false);
  });
});

/** Lets every pending IPC round trip finish, so "nothing was written" means nothing ever will be. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

// The same node, opened in a real editor, with `clearBeadsId` reaching the real IPC boundary. What
// is under test here is *when* the write leaves: staged on the ×, sent by Save, and never sent at
// all if the editor is dismissed instead.
function linkedTaskEditor(onSave: () => Promise<void>, onClose: () => void) {
  return render(
    <TaskEditorModal
      node={linkedTaskNode}
      allTags={[]}
      domainNames={new Map()}
      availableForDep={[]}
      onSave={onSave}
      onClearBeadsId={() => clearBeadsId(BEADS_NODE_TYPE.TASK, 5)}
      onClose={onClose}
    />,
  );
}

describe("a beads clear staged in the editor", () => {
  it("writes nothing when the editor is cancelled after the ×", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    linkedTaskEditor(onSave, onClose);

    fireEvent.click(screen.getByRole("button", { name: "clearBeadsId" }));
    fireEvent.click(screen.getByText("cancel"));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    await settle();

    expect(ipc.mock.calls.some(([cmd]) => cmd === "clear_beads_id")).toBe(false);
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Arlesh-5fs")).toBeInTheDocument();
  });

  it("writes nothing when the editor is dismissed with Escape after the ×", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    linkedTaskEditor(onSave, onClose);

    fireEvent.click(screen.getByRole("button", { name: "clearBeadsId" }));
    fireEvent.keyDown(screen.getByText("Arlesh-5fs"), { key: "Escape" });

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    await settle();

    expect(ipc.mock.calls.some(([cmd]) => cmd === "clear_beads_id")).toBe(false);
  });

  it("sends the clear on Save, before the update it is saved with", async () => {
    let clearedBeforeSave = false;
    const onSave = vi.fn(() => {
      clearedBeforeSave = ipc.mock.calls.some(([cmd]) => cmd === "clear_beads_id");
      return Promise.resolve();
    });
    linkedTaskEditor(onSave, vi.fn());

    fireEvent.click(screen.getByRole("button", { name: "clearBeadsId" }));
    fireEvent.click(screen.getByText("save"));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    await settle();

    expect(wireArgs("clear_beads_id")).toEqual({ nodeType: "task", nodeId: 5 });
    expect(
      clearedBeforeSave,
      "the clear goes first, so a refusal leaves the rest of the node untouched",
    ).toBe(true);
  });

  it("sends no clear on Save when the × was never pressed", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    linkedTaskEditor(onSave, vi.fn());

    fireEvent.click(screen.getByText("save"));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    await settle();

    expect(ipc.mock.calls.some(([cmd]) => cmd === "clear_beads_id")).toBe(false);
  });
});
