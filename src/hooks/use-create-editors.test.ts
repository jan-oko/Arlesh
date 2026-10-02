import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useCreateEditors } from "./use-create-editors";
import type { MindmapNode } from "@/utils/tree-layout";
import type { CommitmentSaveData } from "@/components/CommitmentEditorModal/CommitmentEditorModal";
import type { FlowSaveData } from "@/components/FlowEditorModal/FlowEditorModal";
import { setFlowRecurrence } from "@/api/flows";
import { withAtomicGesture } from "@/api/gesture";

vi.mock("@/api/flows", () => ({ setFlowRecurrence: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/api/gesture", () => ({
  withAtomicGesture: vi.fn((_name: string, run: () => Promise<unknown>) => run()),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const tree: MindmapNode = {
  id: "root", kind: "domain", title: "", position: 0, tagIds: [],
  children: [{ id: "goal-4", rowId: 4, kind: "goal", title: "Ship", position: 0, tagIds: [], children: [] }],
};

function setup() {
  const createFlow = vi.fn().mockResolvedValue({ id: 31 });
  const createCommitment = vi.fn().mockResolvedValue(undefined);
  const reload = vi.fn().mockResolvedValue(undefined);
  const hook = renderHook(() => useCreateEditors({ tree, createFlow, createCommitment, reload }));
  return { hook, createFlow, createCommitment, reload };
}

const PLAIN_FLOW: FlowSaveData = {
  title: "Journal", instanceType: "task", targetType: null, targetId: null,
  durationN: 1, durationKind: "week", windowPart: null, windowTimeStart: null, windowTimeEnd: null,
  rootPlanKind: null, rootPlanStart: null, rootPlanEnd: null, verdictWindowN: null, verdictWindowKind: null,
  isPrivate: false,
};

describe("useCreateEditors", () => {
  it("opens a blank Flow editor under a parent, remembering the parent's kind", () => {
    const { hook } = setup();
    act(() => hook.result.current.onNewFlow("goal-4"));
    expect(hook.result.current.flowParent).toEqual({ id: "goal-4", kind: "goal", asHabit: false });
    expect(hook.result.current.commitmentParent).toBeNull();
  });

  it("opens the same Flow editor as a Habit under a parent — Shift+H", () => {
    const { hook } = setup();
    act(() => hook.result.current.onNewHabit("goal-4"));
    expect(hook.result.current.flowParent).toEqual({ id: "goal-4", kind: "goal", asHabit: true });
  });

  it("saves a new Habit as its Flow and its Recurrence, in one undoable gesture", async () => {
    const { hook, createFlow, reload } = setup();
    act(() => hook.result.current.onNewHabit("goal-4"));
    await act(async () => {
      await hook.result.current.onCreateFlow({
        ...PLAIN_FLOW,
        recurrence: {
          startDate: "2026-09-27", gapN: null, gapKind: null, endDate: null,
          clock: "window", missPolicy: "archive", cooldownN: null, cooldownKind: null,
        },
      });
    });
    expect(withAtomicGesture).toHaveBeenCalledWith("gestures.newHabit", expect.any(Function));
    expect(createFlow).toHaveBeenCalledWith(expect.objectContaining({ title: "Journal", parent_type: "goal" }));
    expect(setFlowRecurrence).toHaveBeenCalledWith(31, {
      start_scope_id: { kind: "week", date: "2026-09-27" }, gap_n: null, gap_kind: null, end_scope_id: null,
      clock: "window", miss_policy: "archive", cooldown_n: null, cooldown_kind: null,
    });
    expect(reload).toHaveBeenCalled();
    expect(hook.result.current.flowParent).toBeNull();
  });

  it("saves a plain Flow with no Recurrence at all", async () => {
    const { hook, createFlow } = setup();
    vi.mocked(setFlowRecurrence).mockClear();
    act(() => hook.result.current.onNewFlow("goal-4"));
    await act(async () => { await hook.result.current.onCreateFlow(PLAIN_FLOW); });
    expect(createFlow).toHaveBeenCalled();
    expect(setFlowRecurrence).not.toHaveBeenCalled();
  });

  // The editor's Private switch never reached the create request, so a Flow — or a Habit — marked
  // Private as it was made was stored public.
  it.each([
    ["Flow", "onNewFlow", {}],
    ["Habit", "onNewHabit", {
      recurrence: {
        startDate: "2026-09-27", gapN: null, gapKind: null, endDate: null,
        clock: "window", missPolicy: "archive", cooldownN: null, cooldownKind: null,
      },
    }],
  ] as const)("creates a new %s marked Private as private", async (_label, open, extra) => {
    const { hook, createFlow } = setup();
    act(() => hook.result.current[open]("goal-4"));
    await act(async () => { await hook.result.current.onCreateFlow({ ...PLAIN_FLOW, ...extra, isPrivate: true }); });
    expect(createFlow).toHaveBeenCalledWith(expect.objectContaining({ is_private: true }));
  });

  it("creates a new Flow left public as public", async () => {
    const { hook, createFlow } = setup();
    act(() => hook.result.current.onNewFlow("goal-4"));
    await act(async () => { await hook.result.current.onCreateFlow(PLAIN_FLOW); });
    expect(createFlow).toHaveBeenCalledWith(expect.objectContaining({ is_private: false }));
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
