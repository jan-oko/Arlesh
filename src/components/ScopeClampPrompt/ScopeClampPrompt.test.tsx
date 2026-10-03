import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import ScopeClampPrompt from "./ScopeClampPrompt";
import { useNodeEditor } from "@/components/MindmapView/use-node-editor";
import { useScopeClampStore } from "@/stores/use-scope-clamp-store";
import { scopeContainmentConflicts } from "@/api/tasks";
import type { MindmapNode } from "@/utils/tree-layout";
import { testKey } from "@/test/scope-key";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { dir: () => "ltr" } }),
}));
vi.mock("@/api/domains", () => ({
  listDomains: vi.fn().mockResolvedValue([]),
  updateDomain: vi.fn(),
  DOMAIN_SUBTYPE: { TAG: "tag" },
}));
vi.mock("@/api/tasks", () => ({
  updateTask: vi.fn().mockResolvedValue(undefined),
  scopeContainmentConflicts: vi.fn(),
}));
vi.mock("@/api/flows", () => ({ flowOrigins: vi.fn().mockResolvedValue([]) }));

const task: MindmapNode = { id: "task-5", rowId: 5, kind: "task", title: "Task", tagIds: [], position: 0, children: [] };
const root: MindmapNode = { id: "root", kind: "aspect", title: "root", tagIds: [], position: 0, children: [task] };
const narrower = { start_id: testKey(1), end_id: testKey(1) };

/**
 * The List View and the Plan View hand their Task editor `useNodeEditor`'s `checkScopeClamp`, and
 * neither draws a prompt of its own. With the prompt mounted at the root, as `App` mounts it, a
 * narrowing there asks and is answered — no Mindmap on screen.
 */
function listViewSave() {
  render(<ScopeClampPrompt />);
  const { result } = renderHook(() => useNodeEditor({ tree: root, allTasksAndGoals: [task], reload: vi.fn() }));
  vi.mocked(scopeContainmentConflicts).mockResolvedValue([{ node_type: "task", node_id: 9 }]);
  let decision: Promise<boolean> = Promise.resolve(false);
  act(() => { decision = result.current.checkScopeClamp("task", 5, narrower); });
  return () => decision;
}

beforeEach(() => {
  vi.clearAllMocks();
  act(() => useScopeClampStore.getState().answer(false));
});

describe("ScopeClampPrompt — a Time Scope narrowed outside the Mindmap", () => {
  it("asks, and clamping lets the save go on", async () => {
    const decision = listViewSave();
    expect(await screen.findByText("warnings:scopeClampAction")).toBeInTheDocument();
    fireEvent.click(screen.getByText("warnings:scopeClampAction"));
    await expect(decision()).resolves.toBe(true);
    await waitFor(() => expect(screen.queryByText("warnings:scopeClampAction")).not.toBeInTheDocument());
  });

  it("cancelling stops the save, and nothing is left hanging", async () => {
    const decision = listViewSave();
    fireEvent.click(await screen.findByText("cancel"));
    await expect(decision()).resolves.toBe(false);
    expect(useScopeClampStore.getState().request).toBeNull();
  });
});
