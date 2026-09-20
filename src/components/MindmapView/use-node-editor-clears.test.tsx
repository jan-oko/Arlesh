import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, renderHook, act } from "@testing-library/react";
import { useNodeEditor } from "./use-node-editor";
import TaskEditorModal from "@/components/TaskEditorModal/TaskEditorModal";
import type { TaskSaveData } from "@/components/TaskEditorModal/TaskEditorModal";
import type { CommitmentSaveData } from "@/components/CommitmentEditorModal/CommitmentEditorModal";
import type { MindmapNode } from "@/utils/tree-layout";
import { TASK_AGENTIC } from "@/api/tasks";

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

const scope = { start_id: 1, end_id: 1 };

const taskNode: MindmapNode = {
  id: "task-5", kind: "task", title: "Task", tagIds: [], position: 0, children: [],
  timeScope: scope, onScopeExit: "keep", status: "todo", blockReasons: [],
};
const commitmentNode: MindmapNode = {
  id: "commitment-7", kind: "commitment", title: "Asleep by 23:00", tagIds: [], position: 0,
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
