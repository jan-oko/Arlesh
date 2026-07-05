import { beforeEach, describe, expect, it } from "vitest";
import { useListFilterStore } from "./use-list-filter-store";
import { DEFAULT_LIST_FILTER } from "@/utils/list-filter";

beforeEach(() => {
  useListFilterStore.setState({ filter: DEFAULT_LIST_FILTER });
});

describe("setPreset", () => {
  it("sets the List View's own preset", () => {
    useListFilterStore.getState().setPreset("unblock");
    expect(useListFilterStore.getState().filter.preset).toBe("unblock");
  });
});

describe("toggleShowGoalHeaders", () => {
  it("flips the goal-header toggle, off by default", () => {
    expect(useListFilterStore.getState().filter.showGoalHeaders).toBe(false);
    useListFilterStore.getState().toggleShowGoalHeaders();
    expect(useListFilterStore.getState().filter.showGoalHeaders).toBe(true);
  });
});

describe("addPill / setPillMode / removePill", () => {
  it("adds a pill in 'any' mode by default, to the given dimension only", () => {
    useListFilterStore.getState().addPill("parent", "goal-1");
    const s = useListFilterStore.getState().filter;
    expect(s.pills.parent).toEqual([{ value: "goal-1", mode: "any" }]);
    expect(s.pills.antecedent).toEqual([]);
  });

  it("does not add a duplicate value to the same dimension", () => {
    useListFilterStore.getState().addPill("taskStatus", "todo");
    useListFilterStore.getState().addPill("taskStatus", "todo");
    expect(useListFilterStore.getState().filter.pills.taskStatus).toHaveLength(1);
  });

  it("cycles a pill's mode without touching other pills", () => {
    useListFilterStore.getState().addPill("blocked", "blocked");
    useListFilterStore.getState().addPill("blocked", "not_blocked");
    useListFilterStore.getState().setPillMode("blocked", "blocked", "exclude");
    const pills = useListFilterStore.getState().filter.pills.blocked;
    expect(pills).toEqual([{ value: "blocked", mode: "exclude" }, { value: "not_blocked", mode: "any" }]);
  });

  it("removes a pill by value", () => {
    useListFilterStore.getState().addPill("dependency", "task-9");
    useListFilterStore.getState().removePill("dependency", "task-9");
    expect(useListFilterStore.getState().filter.pills.dependency).toEqual([]);
  });
});

describe("reset", () => {
  it("restores the neutral filter", () => {
    useListFilterStore.getState().setPreset("do");
    useListFilterStore.getState().addPill("parent", "goal-1");
    useListFilterStore.getState().reset();
    expect(useListFilterStore.getState().filter).toEqual(DEFAULT_LIST_FILTER);
  });
});
