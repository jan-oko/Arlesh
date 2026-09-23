import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useCreateEditors } from "./use-create-editors";
import type { MindmapNode } from "@/utils/tree-layout";
import type { CommitmentSaveData } from "@/components/CommitmentEditorModal/CommitmentEditorModal";

const tree: MindmapNode = {
  id: "root", kind: "domain", title: "", position: 0, tagIds: [],
  children: [{ id: "goal-4", kind: "goal", title: "Ship", position: 0, tagIds: [], children: [] }],
};

function setup() {
  const createFlow = vi.fn();
  const createCommitment = vi.fn().mockResolvedValue(undefined);
  const hook = renderHook(() => useCreateEditors({ tree, createFlow, createCommitment }));
  return { hook, createFlow, createCommitment };
}

describe("useCreateEditors", () => {
  it("opens a blank Flow editor under a parent, remembering the parent's kind", () => {
    const { hook } = setup();
    act(() => hook.result.current.onNewFlow("goal-4"));
    expect(hook.result.current.flowParent).toEqual({ id: "goal-4", kind: "goal" });
    expect(hook.result.current.commitmentParent).toBeNull();
  });

  it("opens nothing for a parent that is not on the board", () => {
    const { hook } = setup();
    act(() => hook.result.current.onNewCommitment("goal-99"));
    expect(hook.result.current.commitmentParent).toBeNull();
  });

  it("saves a Commitment under the pending parent, then closes its editor", async () => {
    const { hook, createCommitment } = setup();
    act(() => hook.result.current.onNewCommitment("goal-4"));
    const data: CommitmentSaveData = {
      title: "Daily walk", verdict: "unresolved", tagIds: [], timeScope: null, verdictWindow: null, isPrivate: false,
    };
    await act(async () => { await hook.result.current.onCreateCommitment(data); });
    expect(createCommitment).toHaveBeenCalledWith("goal-4", "goal", data);
    expect(hook.result.current.commitmentParent).toBeNull();
  });

  it("closes an editor without saving anything", () => {
    const { hook, createFlow } = setup();
    act(() => hook.result.current.onNewFlow("goal-4"));
    act(() => hook.result.current.closeFlow());
    expect(hook.result.current.flowParent).toBeNull();
    expect(createFlow).not.toHaveBeenCalled();
  });
});
