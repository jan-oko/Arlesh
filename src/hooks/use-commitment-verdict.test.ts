import { describe, it, expect, vi, beforeEach } from "vitest";
import { occurrenceRow } from "@/test/occurrence";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useCommitmentVerdict } from "./use-commitment-verdict";
import { pressCommitmentVerdict } from "@/api/node-gestures";
import type { MindmapNode } from "@/utils/tree-layout";
import { fixtureRowId } from "@/test/node-fixture";

// Which verdict a press leaves is the backend's (`tasks::rules::gestures::verdict_after`); these
// pin which press each control sends, for which row, and what a failure says.
vi.mock("@/api/node-gestures", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/node-gestures")>()),
  pressCommitmentVerdict: vi.fn(),
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
    vi.mocked(pressCommitmentVerdict).mockResolvedValue(Object.create(null));
    const { result } = setup([commitment("commitment-5")]);

    act(() => { result.current.markKept("commitment-5"); });

    await waitFor(() => expect(pressCommitmentVerdict).toHaveBeenCalledWith(5, "kept"));
  });

  describe("on a Habit iteration, which is a Commitment row of its own", () => {
    const rowId = ITERATION.rowId;

    it("records the verdict on the iteration's row", async () => {
      vi.mocked(pressCommitmentVerdict).mockResolvedValue(Object.create(null));
      const { result, reload } = setup([ITERATION]);

      act(() => { result.current.markBroken(ITERATION.id); });

      await waitFor(() => expect(pressCommitmentVerdict).toHaveBeenCalledWith(rowId, "broken"));
      await waitFor(() => expect(reload).toHaveBeenCalled());
    });

    it("takes the same Enter cycle as any other commitment", async () => {
      vi.mocked(pressCommitmentVerdict).mockResolvedValue(Object.create(null));
      const { result } = setup([commitment(ITERATION.id, { ...ITERATION, verdict: "kept" })]);

      act(() => { result.current.cycleVerdict(ITERATION.id); });

      await waitFor(() => expect(pressCommitmentVerdict).toHaveBeenCalledWith(rowId, "cycle"));
    });

    it("says so when the write fails instead of leaving the control looking pressed", async () => {
      vi.mocked(pressCommitmentVerdict).mockRejectedValue(new Error("db is locked"));
      const { result, showToast, reload } = setup([ITERATION]);

      act(() => { result.current.markKept(ITERATION.id); });

      await waitFor(() => expect(showToast).toHaveBeenCalledWith(
        expect.objectContaining({ nodeId: ITERATION.id }),
      ));
      expect(reload).not.toHaveBeenCalled();
    });
  });
});
