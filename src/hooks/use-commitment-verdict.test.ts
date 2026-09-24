import { describe, it, expect, vi, beforeEach } from "vitest";
import { occurrenceRow } from "@/test/occurrence";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useCommitmentVerdict } from "./use-commitment-verdict";
import { updateCommitment } from "@/api/commitments";
import type { MindmapNode } from "@/utils/tree-layout";
import { fixtureRowId } from "@/test/node-fixture";

vi.mock("@/api/commitments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/commitments")>()),
  updateCommitment: vi.fn(),
}));

function commitment(id: string, extra: Partial<MindmapNode> = {}): MindmapNode {
  return { id, ...fixtureRowId(id), kind: "commitment", title: id, position: 0, tagIds: [], children: [], ...extra };
}

/** One iteration of a nightly commitment Habit: a Commitment row with a UUID id. */
const ITERATION = commitment("habit-3-0", {
  ...occurrenceRow({ habitId: 3, itemType: "flow_root", itemId: 3, cycleId: 0 }),
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
  });

  describe("on a Habit iteration, which is a Commitment row of its own", () => {
    const rowId = ITERATION.rowId;

    it("records the verdict on the iteration's row", async () => {
      vi.mocked(updateCommitment).mockResolvedValue({} as never);
      const { result, reload } = setup([ITERATION]);

      act(() => { result.current.markBroken(ITERATION.id); });

      await waitFor(() => expect(updateCommitment).toHaveBeenCalledWith(rowId, { verdict: "broken" }));
      await waitFor(() => expect(reload).toHaveBeenCalled());
    });

    it("clears the iteration's verdict back to Unresolved like any commitment's", async () => {
      vi.mocked(updateCommitment).mockResolvedValue({} as never);
      const { result } = setup([commitment(ITERATION.id, { ...ITERATION, verdict: "kept" })]);

      act(() => { result.current.markKept(ITERATION.id); });

      await waitFor(() => expect(updateCommitment).toHaveBeenCalledWith(rowId, { verdict: "unresolved" }));
    });

    it("takes the same Enter cycle as any other commitment", async () => {
      vi.mocked(updateCommitment).mockResolvedValue({} as never);
      const { result } = setup([commitment(ITERATION.id, { ...ITERATION, verdict: "kept" })]);

      act(() => { result.current.cycleVerdict(ITERATION.id); });

      await waitFor(() => expect(updateCommitment).toHaveBeenCalledWith(rowId, { verdict: "broken" }));
    });

    it("says so when the write fails instead of leaving the control looking pressed", async () => {
      vi.mocked(updateCommitment).mockRejectedValue(new Error("db is locked"));
      const { result, showToast, reload } = setup([ITERATION]);

      act(() => { result.current.markKept(ITERATION.id); });

      await waitFor(() => expect(showToast).toHaveBeenCalledWith(
        expect.objectContaining({ nodeId: ITERATION.id }),
      ));
      expect(reload).not.toHaveBeenCalled();
    });
  });
});
