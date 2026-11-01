import { describe, it, expect, vi, beforeEach } from "vitest";
import { occurrenceRow } from "@/test/occurrence";
import { renderHook, act, waitFor } from "@testing-library/react";
import { deferred, lane, patchedFields } from "@/test/lane-helpers";
import { usePendingWritesStore } from "@/stores/use-pending-writes-store";
import type { Commitment } from "@/api/commitments";
import { useCommitmentVerdict } from "./use-commitment-verdict";
import { pressCommitmentVerdict } from "@/api/node-gestures";
import type { MindmapNode } from "@/utils/tree-layout";
import { fixtureRowId } from "@/test/node-fixture";

// Which verdict a press leaves is predicted by `utils/task-gestures.ts` and decided by the backend
// (`tasks::rules::gestures::verdict_after`); these pin what the board shows at once, which press
// each control sends, for which row, and what a failure says.
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
  const showToast = vi.fn();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const rendered = renderHook(() =>
    useCommitmentVerdict({ findNode: (id) => byId.get(id), showToast }),
  );
  return { ...rendered, showToast };
}

function row(verdict: Commitment["verdict"]): Commitment {
  return Object.assign(Object.create(null), { verdict });
}

beforeEach(() => {
  vi.clearAllMocks();
  usePendingWritesStore.getState().reset();
  usePendingWritesStore.getState().reportBoard("test", { read: 0, epoch: null, revision: null });
});

describe("useCommitmentVerdict", () => {
  it("records a real commitment's verdict against its own row", async () => {
    vi.mocked(pressCommitmentVerdict).mockResolvedValue(Object.create(null));
    const { result } = setup([commitment("commitment-5")]);

    act(() => { result.current.markKept("commitment-5"); });

    await waitFor(() => expect(pressCommitmentVerdict).toHaveBeenCalledWith(5, "kept"));
  });

  it("shows the verdict at once, before the write resolves, and the returned row's after", async () => {
    const held = deferred<Commitment>();
    vi.mocked(pressCommitmentVerdict).mockReturnValue(held.promise);
    const { result } = setup([commitment("commitment-5")]);

    act(() => { result.current.markKept("commitment-5"); });

    expect(patchedFields()).toEqual([{ verdict: "kept" }]);
    await act(async () => { held.resolve(row("kept")); await held.promise; });
    expect(lane()[0]?.answer?.fields).toEqual({ verdict: "kept" });
  });

  it("predicts each press from the verdict the node reads", () => {
    vi.mocked(pressCommitmentVerdict).mockReturnValue(new Promise(() => undefined));
    const { result } = setup([
      commitment("commitment-1", { verdict: "kept" }),
      commitment("commitment-2", { verdict: "broken" }),
      commitment("commitment-3"),
    ]);

    act(() => { result.current.markKept("commitment-1"); });
    act(() => { result.current.cycleVerdict("commitment-2"); });
    act(() => { result.current.markBroken("commitment-3"); });

    expect(patchedFields()).toEqual([{ verdict: "unresolved" }, { verdict: "unresolved" }, { verdict: "broken" }]);
  });

  describe("on a Habit iteration, which is a Commitment row of its own", () => {
    const rowId = ITERATION.rowId;

    it("records the verdict on the iteration's row", async () => {
      vi.mocked(pressCommitmentVerdict).mockResolvedValue(Object.create(null));
      const { result } = setup([ITERATION]);

      act(() => { result.current.markBroken(ITERATION.id); });

      await waitFor(() => expect(pressCommitmentVerdict).toHaveBeenCalledWith(rowId, "broken"));
    });

    it("takes the same Enter cycle as any other commitment", async () => {
      vi.mocked(pressCommitmentVerdict).mockResolvedValue(Object.create(null));
      const { result } = setup([commitment(ITERATION.id, { ...ITERATION, verdict: "kept" })]);

      act(() => { result.current.cycleVerdict(ITERATION.id); });

      await waitFor(() => expect(pressCommitmentVerdict).toHaveBeenCalledWith(rowId, "cycle"));
    });

    it("rolls back and says so when the write fails instead of leaving the control looking pressed", async () => {
      vi.mocked(pressCommitmentVerdict).mockRejectedValue(new Error("db is locked"));
      const { result, showToast } = setup([ITERATION]);

      act(() => { result.current.markKept(ITERATION.id); });

      await waitFor(() => expect(showToast).toHaveBeenCalledWith(
        expect.objectContaining({ nodeId: ITERATION.id }),
      ));
      expect(lane()).toEqual([]);
    });
  });
});
