import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { setHabitInstanceArchived } from "@/api/flows";
import { withAtomicGesture } from "@/api/gesture";
import { useOccurrenceArchive } from "@/hooks/use-occurrence-archive";
import type { MindmapNode } from "@/utils/tree-layout";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/api/flows", () => ({ setHabitInstanceArchived: vi.fn() }));
vi.mock("@/api/gesture", () => ({
  withAtomicGesture: vi.fn((_name: string, run: () => Promise<unknown>) => run()),
}));

const key = { flowId: 3, itemType: "flow_task" as const, itemId: 7, scopeId: 100, cycleId: 0 };
const rootKey = { ...key, itemType: "flow_root" as const, itemId: 3 };

function node(extra: Partial<MindmapNode>): MindmapNode {
  return { id: "n", kind: "task", title: "Shop", position: 0, tagIds: [], children: [], ...extra };
}

const occurrence = node({ id: "occ", virtual: true, habitItem: key });
const iterationRoot = node({ id: "root", virtual: true, habitItem: rootKey });
const foldedRun = node({ id: "run", kind: "habit_group", virtual: true });
const realTask = node({ id: "task-1" });

function setup() {
  const reload = vi.fn().mockResolvedValue(undefined);
  const showToast = vi.fn();
  const { result } = renderHook(() => useOccurrenceArchive({ reload, showToast }));
  return { archive: result.current, reload, showToast };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(setHabitInstanceArchived).mockResolvedValue(undefined);
});

describe("useOccurrenceArchive", () => {
  it("leaves a selection of real nodes to the ordinary delete", () => {
    const { archive } = setup();
    expect(archive([realTask])).toBe(false);
    expect(setHabitInstanceArchived).not.toHaveBeenCalled();
  });

  it("archives item occurrences and iteration roots alike, in one gesture, and says so", async () => {
    const { archive, reload, showToast } = setup();
    expect(archive([occurrence, iterationRoot])).toBe(true);
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(withAtomicGesture).toHaveBeenCalledTimes(1);
    expect(setHabitInstanceArchived).toHaveBeenCalledWith(key, true);
    expect(setHabitInstanceArchived).toHaveBeenCalledWith(rootKey, true);
    expect(showToast).toHaveBeenCalledWith({ nodeId: "occ", message: "warnings:occurrenceArchived" });
  });

  it("refuses a folded run of history out loud", () => {
    const { archive, showToast } = setup();
    expect(archive([foldedRun])).toBe(true);
    expect(setHabitInstanceArchived).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith({ nodeId: "run", message: "warnings:deleteRepetitionRefused" });
  });

  it("leaves a mix of occurrences and real nodes to the caller's refusal", () => {
    const { archive } = setup();
    expect(archive([occurrence, realTask])).toBe(false);
    expect(setHabitInstanceArchived).not.toHaveBeenCalled();
  });
});
