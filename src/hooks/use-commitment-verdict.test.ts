import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useCommitmentVerdict } from "./use-commitment-verdict";
import { updateCommitment } from "@/api/commitments";
import { setHabitItemStatus } from "@/api/flows";
import type { MindmapNode } from "@/utils/tree-layout";
import { fixtureRowId } from "@/test/node-fixture";
import { testKey } from "@/test/scope-key";

vi.mock("@/api/commitments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/commitments")>()),
  updateCommitment: vi.fn(),
}));

vi.mock("@/api/flows", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/flows")>()),
  setHabitItemStatus: vi.fn(),
}));

function commitment(id: string, extra: Partial<MindmapNode> = {}): MindmapNode {
  return { id, ...fixtureRowId(id), kind: "commitment", title: id, position: 0, tagIds: [], children: [], ...extra };
}

/** One iteration of a nightly commitment Habit: virtual, keyed by (flow root, iteration scope). */
const ITERATION = commitment("habit-3-0-virtual", {
  virtual: true,
  habitItem: { flowId: 3, itemType: "flow_root", itemId: 3, scopeId: testKey(100), cycleId: 0 },
});

function setup(nodes: MindmapNode[]) {
  const reload = vi.fn().mockResolvedValue(undefined);
  const showToast = vi.fn();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const rendered = renderHook(() =>
    useCommitmentVerdict({ findNode: (id) => byId.get(id), reload, showToast }),
  );
  return { ...rendered, reload, showToast };
}

beforeEach(() => vi.clearAllMocks());

describe("useCommitmentVerdict", () => {
  it("records a real commitment's verdict against its own row", async () => {
    vi.mocked(updateCommitment).mockResolvedValue({} as never);
    const { result } = setup([commitment("commitment-5")]);

    act(() => { result.current.markKept("commitment-5"); });

    await waitFor(() => expect(updateCommitment).toHaveBeenCalledWith(5, { verdict: "kept" }));
    expect(setHabitItemStatus).not.toHaveBeenCalled();
  });

  describe("on a virtual Habit iteration, which has no row of its own", () => {
    it("records the verdict as that iteration's Modification", async () => {
      vi.mocked(setHabitItemStatus).mockResolvedValue(undefined);
      const { result, reload } = setup([ITERATION]);

      act(() => { result.current.markBroken(ITERATION.id); });

      await waitFor(() =>
        expect(setHabitItemStatus).toHaveBeenCalledWith(3, "flow_root", 3, testKey(100), 0, "broken", expect.any(Number)),
      );
      // Never the commitments table: there is no commitment id to write to, and parsing one out
      // of the virtual node id is how this used to send NaN.
      expect(updateCommitment).not.toHaveBeenCalled();
      await waitFor(() => expect(reload).toHaveBeenCalled());
    });

    it("clears the iteration's verdict by removing the Modification, not by storing 'unresolved'", async () => {
      vi.mocked(setHabitItemStatus).mockResolvedValue(undefined);
      const { result } = setup([commitment(ITERATION.id, { ...ITERATION, verdict: "kept" })]);

      act(() => { result.current.markKept(ITERATION.id); });

      await waitFor(() =>
        expect(setHabitItemStatus).toHaveBeenCalledWith(3, "flow_root", 3, testKey(100), 0, null, expect.any(Number)),
      );
    });

    it("takes the same Enter cycle as any other commitment, one Modification at a time", async () => {
      // An iteration is selectable in exactly the same list, so Enter has to mean the same thing
      // on it; only where the verdict is stored differs.
      vi.mocked(setHabitItemStatus).mockResolvedValue(undefined);
      const { result } = setup([commitment(ITERATION.id, { ...ITERATION, verdict: "kept" })]);

      act(() => { result.current.cycleVerdict(ITERATION.id); });

      await waitFor(() =>
        expect(setHabitItemStatus).toHaveBeenCalledWith(3, "flow_root", 3, testKey(100), 0, "broken", expect.any(Number)),
      );
    });

    it("clears the iteration's verdict when the cycle comes back round to Unresolved", async () => {
      vi.mocked(setHabitItemStatus).mockResolvedValue(undefined);
      const { result } = setup([commitment(ITERATION.id, { ...ITERATION, verdict: "broken" })]);

      act(() => { result.current.cycleVerdict(ITERATION.id); });

      await waitFor(() =>
        expect(setHabitItemStatus).toHaveBeenCalledWith(3, "flow_root", 3, testKey(100), 0, null, expect.any(Number)),
      );
    });

    it("says so when the write fails instead of leaving the control looking pressed", async () => {
      vi.mocked(setHabitItemStatus).mockRejectedValue(new Error("db is locked"));
      const { result, showToast, reload } = setup([ITERATION]);

      act(() => { result.current.markKept(ITERATION.id); });

      await waitFor(() => expect(showToast).toHaveBeenCalledWith(
        expect.objectContaining({ nodeId: ITERATION.id }),
      ));
      expect(reload).not.toHaveBeenCalled();
    });
  });
});
