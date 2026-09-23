import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { setHabitInstanceDeleted } from "@/api/flows";
import { withAtomicGesture } from "@/api/gesture";
import { useOccurrenceDelete } from "@/hooks/use-occurrence-delete";
import type { MindmapNode } from "@/utils/tree-layout";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/api/flows", () => ({ setHabitInstanceDeleted: vi.fn() }));
vi.mock("@/api/gesture", () => ({
  withAtomicGesture: vi.fn((_name: string, run: () => Promise<unknown>) => run()),
}));

const key = { flowId: 3, itemType: "flow_task" as const, itemId: 7, scopeId: 100, cycleId: 0 };

function node(extra: Partial<MindmapNode>): MindmapNode {
  return { id: "n", kind: "task", title: "Shop", position: 0, tagIds: [], children: [], ...extra };
}

const occurrence = node({ id: "occ", virtual: true, habitItem: key });
const iterationRoot = node({
  id: "root", virtual: true, habitItem: { ...key, itemType: "flow_root", itemId: 3 },
});
const realTask = node({ id: "task-1" });

function setup() {
  const reload = vi.fn().mockResolvedValue(undefined);
  const showToast = vi.fn();
  const { result } = renderHook(() => useOccurrenceDelete({ reload, showToast }));
  return { remove: result.current, reload, showToast };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(setHabitInstanceDeleted).mockResolvedValue(undefined);
});

describe("useOccurrenceDelete", () => {
  it("leaves a selection of real nodes to the ordinary delete", () => {
    const { remove } = setup();
    expect(remove([realTask])).toBe(false);
    expect(setHabitInstanceDeleted).not.toHaveBeenCalled();
  });

  it("deletes item occurrences from their iterations in one gesture, and says so", async () => {
    const { remove, reload, showToast } = setup();
    expect(remove([occurrence])).toBe(true);
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(withAtomicGesture).toHaveBeenCalledTimes(1);
    expect(setHabitInstanceDeleted).toHaveBeenCalledWith(key, true);
    expect(showToast).toHaveBeenCalledWith({ nodeId: "occ", message: "warnings:occurrenceDeleted" });
  });

  it("refuses an iteration root out loud", () => {
    const { remove, showToast } = setup();
    expect(remove([iterationRoot])).toBe(true);
    expect(setHabitInstanceDeleted).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith({ nodeId: "root", message: "warnings:deleteRepetitionRefused" });
  });

  it("leaves a mix of occurrences and real nodes to the caller's refusal", () => {
    const { remove } = setup();
    expect(remove([occurrence, realTask])).toBe(false);
    expect(setHabitInstanceDeleted).not.toHaveBeenCalled();
  });
});
