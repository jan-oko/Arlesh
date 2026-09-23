import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { setHabitInstanceDeleted, setHabitInstancePlan } from "@/api/flows";
import { useOccurrenceMenu } from "@/hooks/use-occurrence-menu";
import type { MindmapNode } from "@/utils/tree-layout";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/api/flows", () => ({ setHabitInstanceDeleted: vi.fn(), setHabitInstancePlan: vi.fn() }));

const key = { flowId: 3, itemType: "flow_task" as const, itemId: 4, scopeId: 100, cycleId: 0 };
const occurrence: MindmapNode = {
  id: "occ", kind: "task", title: "Run", status: "todo", position: 0, tagIds: [], children: [],
  virtual: true, habitItem: key,
};

function setup() {
  const options = {
    openEditor: vi.fn(() => true),
    setOccurrenceStatus: vi.fn(),
    deleteOccurrences: vi.fn(() => true),
    toggleCollapsed: vi.fn(),
    reload: vi.fn().mockResolvedValue(undefined),
    showToast: vi.fn(),
  };
  const { result } = renderHook(() => useOccurrenceMenu(options));
  return { run: result.current, ...options };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(setHabitInstancePlan).mockResolvedValue(undefined);
  vi.mocked(setHabitInstanceDeleted).mockResolvedValue(undefined);
});

describe("useOccurrenceMenu", () => {
  it("opens the occurrence editor for Edit and for Plan", () => {
    const view = setup();
    view.run(occurrence, "edit");
    view.run(occurrence, "plan");
    expect(view.openEditor).toHaveBeenCalledTimes(2);
  });

  it("writes a status through the completion guard, clearing the base one", () => {
    const view = setup();
    view.run(occurrence, "status:done");
    view.run(occurrence, "status:todo");
    expect(view.setOccurrenceStatus).toHaveBeenNthCalledWith(1, occurrence, "done");
    expect(view.setOccurrenceStatus).toHaveBeenNthCalledWith(2, occurrence, null);
  });

  it("leaves the occurrence unplanned, or hands it back to the Cycle Plan, and reloads", async () => {
    const view = setup();
    view.run(occurrence, "unplan");
    view.run(occurrence, "follow-cycle-plan");
    await waitFor(() => expect(view.reload).toHaveBeenCalledTimes(2));
    expect(setHabitInstancePlan).toHaveBeenCalledWith(key, { kind: "unplanned" });
    expect(setHabitInstancePlan).toHaveBeenCalledWith(key, { kind: "inherit" });
  });

  it("deletes through the occurrence delete, and restores directly", async () => {
    const view = setup();
    view.run(occurrence, "delete");
    view.run(occurrence, "restore");
    expect(view.deleteOccurrences).toHaveBeenCalledWith([occurrence]);
    await waitFor(() => expect(setHabitInstanceDeleted).toHaveBeenCalledWith(key, false));
  });

  it("says why when a write is refused", async () => {
    vi.mocked(setHabitInstancePlan).mockRejectedValue(new Error("no"));
    const view = setup();
    view.run(occurrence, "unplan");
    await waitFor(() => expect(view.showToast).toHaveBeenCalledWith({ nodeId: "occ", message: "occurrenceActionFailed" }));
  });
});
