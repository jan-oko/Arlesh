import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useHandArchive } from "./use-hand-archive";
import { updateTask } from "@/api/tasks";
import { updateCommitment } from "@/api/commitments";
import { updateDomain } from "@/api/domains";
import type { MindmapNode } from "@/utils/tree-layout";
import { fixtureRowId } from "@/test/node-fixture";
import { occurrenceRow } from "@/test/occurrence";

vi.mock("@/api/tasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/tasks")>()),
  updateTask: vi.fn(),
}));
vi.mock("@/api/commitments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/commitments")>()),
  updateCommitment: vi.fn(),
}));
vi.mock("@/api/domains", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/domains")>()),
  updateDomain: vi.fn(),
}));

function node(id: string, extra: Partial<MindmapNode> = {}): MindmapNode {
  return { id, ...fixtureRowId(id), kind: "task", title: id, position: 0, tagIds: [], children: [], ...extra };
}

function setup(nodes: MindmapNode[]) {
  const reload = vi.fn().mockResolvedValue(undefined);
  const showToast = vi.fn();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const rendered = renderHook(() => useHandArchive({ findNode: (id) => byId.get(id), reload, showToast }));
  return { ...rendered, reload, showToast };
}

beforeEach(() => vi.clearAllMocks());

describe("useHandArchive", () => {
  it("archives a live stored Task by hand, then reloads", async () => {
    vi.mocked(updateTask).mockResolvedValue(Object.create(null));
    const { result, reload } = setup([node("task-5")]);

    act(() => { result.current.toggleArchive("task-5"); });

    await waitFor(() => expect(updateTask).toHaveBeenCalledWith(5, { archival: "archived" }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
  });

  it("unarchives the Task archived by hand back to live", async () => {
    vi.mocked(updateTask).mockResolvedValue(Object.create(null));
    const { result } = setup([node("task-5", { archivedByHand: true })]);

    act(() => { result.current.toggleArchive("task-5"); });

    await waitFor(() => expect(updateTask).toHaveBeenCalledWith(5, { archival: "live" }));
  });

  it("archives a stored Commitment through its own update", async () => {
    vi.mocked(updateCommitment).mockResolvedValue(Object.create(null));
    const { result } = setup([node("commitment-7", { kind: "commitment" })]);

    act(() => { result.current.toggleArchive("commitment-7"); });

    await waitFor(() => expect(updateCommitment).toHaveBeenCalledWith(7, { archival: "archived" }));
  });

  it("archives a Domain through its status, and unarchives an archived one back to Active", async () => {
    vi.mocked(updateDomain).mockResolvedValue(Object.create(null));
    const { result } = setup([node("domain-8", { kind: "domain" }), node("domain-9", { kind: "domain", status: "archived" })]);

    act(() => {
      result.current.toggleArchive("domain-8");
      result.current.toggleArchive("domain-9");
    });

    await waitFor(() => expect(updateDomain).toHaveBeenCalledWith(8, { status: "archived" }));
    await waitFor(() => expect(updateDomain).toHaveBeenCalledWith(9, { status: "active" }));
  });

  it("leaves a Habit occurrence and a Goal alone", () => {
    const occurrence = node("task-4", { ...occurrenceRow({ habitId: 3, itemType: "flow_task", itemId: 4 }) });
    const { result } = setup([occurrence, node("goal-1", { kind: "goal" })]);

    act(() => {
      result.current.toggleArchive("task-4");
      result.current.toggleArchive("goal-1");
    });

    expect(updateTask).not.toHaveBeenCalled();
    expect(updateCommitment).not.toHaveBeenCalled();
  });

  it("says a refusal out loud", async () => {
    vi.mocked(updateTask).mockRejectedValue(new Error("nope"));
    const { result, showToast } = setup([node("task-5")]);

    act(() => { result.current.toggleArchive("task-5"); });

    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ nodeId: "task-5" })));
  });
});
