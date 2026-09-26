import { beforeEach, describe, expect, it } from "vitest";
import { useListFilterStore } from "./use-list-filter-store";
import { DEFAULT_LIST_FILTER } from "@/utils/list-filter";

beforeEach(() => {
  localStorage.clear();
  useListFilterStore.setState({ filter: DEFAULT_LIST_FILTER });
});

describe("setPreset", () => {
  it("sets the List View's own preset", () => {
    useListFilterStore.getState().setPreset("unblock");
    expect(useListFilterStore.getState().filter.preset).toBe("unblock");
  });
});

describe("toggleKind", () => {
  it("hides a kind, then shows it again", () => {
    useListFilterStore.getState().toggleKind("task");
    expect(useListFilterStore.getState().filter.kinds).toEqual(["commitment", "expectation"]);
    useListFilterStore.getState().toggleKind("task");
    expect(useListFilterStore.getState().filter.kinds).toEqual(["task", "commitment", "expectation"]);
  });

  it("will not hide the last kind shown", () => {
    useListFilterStore.getState().toggleKind("task");
    useListFilterStore.getState().toggleKind("commitment");
    useListFilterStore.getState().toggleKind("expectation");
    expect(useListFilterStore.getState().filter.kinds).toEqual(["expectation"]);
  });

  it("changes nothing under the Expectations option", () => {
    useListFilterStore.getState().setPreset("expectations");
    useListFilterStore.getState().toggleKind("task");
    expect(useListFilterStore.getState().filter.kinds).toEqual(["task", "commitment", "expectation"]);
  });
});

describe("addPill / setPillMode / removePill", () => {
  it("adds a pill in 'any' mode by default, to the given dimension only", () => {
    useListFilterStore.getState().addPill("antecedent", "goal-1");
    const s = useListFilterStore.getState().filter;
    expect(s.pills.antecedent).toEqual([{ value: "goal-1", mode: "any" }]);
    expect(s.pills.dependency).toEqual([]);
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

describe("setPillSide", () => {
  function antecedent() {
    return useListFilterStore.getState().filter.pills.antecedent;
  }

  it("adds a missing pill on the side asked for", () => {
    useListFilterStore.getState().setPillSide("antecedent", "goal-1", "include");
    expect(antecedent()).toEqual([{ value: "goal-1", mode: "any" }]);
  });

  it("adds a missing pill already excluding, so one gesture is one state change", () => {
    useListFilterStore.getState().setPillSide("antecedent", "goal-1", "exclude");
    expect(antecedent()).toEqual([{ value: "goal-1", mode: "exclude" }]);
  });

  it("moves an existing pill across rather than adding a second one for the same value", () => {
    useListFilterStore.getState().setPillSide("antecedent", "goal-1", "include");
    useListFilterStore.getState().setPillSide("antecedent", "goal-1", "exclude");
    expect(antecedent()).toEqual([{ value: "goal-1", mode: "exclude" }]);
  });

  it("is idempotent: asking twice for the same side leaves the same filter", () => {
    useListFilterStore.getState().setPillSide("antecedent", "goal-1", "exclude");
    useListFilterStore.getState().setPillSide("antecedent", "goal-1", "exclude");
    expect(antecedent()).toEqual([{ value: "goal-1", mode: "exclude" }]);
  });

  // `all` and `any` both keep the value in; only `exclude` reverses the question.
  it("leaves an 'all' pill alone when asked to include it, keeping the mode set on its chip", () => {
    useListFilterStore.getState().addPill("antecedent", "goal-1");
    useListFilterStore.getState().setPillMode("antecedent", "goal-1", "all");
    useListFilterStore.getState().setPillSide("antecedent", "goal-1", "include");
    expect(antecedent()).toEqual([{ value: "goal-1", mode: "all" }]);
  });

  it("brings an 'all' pill back to a plain include when asked to exclude and then include it", () => {
    useListFilterStore.getState().addPill("antecedent", "goal-1");
    useListFilterStore.getState().setPillMode("antecedent", "goal-1", "all");
    useListFilterStore.getState().setPillSide("antecedent", "goal-1", "exclude");
    useListFilterStore.getState().setPillSide("antecedent", "goal-1", "include");
    expect(antecedent()).toEqual([{ value: "goal-1", mode: "any" }]);
  });

  it("touches only the dimension it is given", () => {
    useListFilterStore.getState().setPillSide("antecedent", "goal-1", "exclude");
    expect(useListFilterStore.getState().filter.pills.dependency).toEqual([]);
  });

  it("leaves the other pills in its own dimension untouched", () => {
    useListFilterStore.getState().addPill("antecedent", "goal-1");
    useListFilterStore.getState().setPillSide("antecedent", "task-2", "exclude");
    expect(antecedent()).toEqual([
      { value: "goal-1", mode: "any" },
      { value: "task-2", mode: "exclude" },
    ]);
  });
});

describe("reset", () => {
  it("restores the neutral filter", () => {
    useListFilterStore.getState().setPreset("do");
    useListFilterStore.getState().addPill("antecedent", "goal-1");
    useListFilterStore.getState().reset();
    expect(useListFilterStore.getState().filter).toEqual(DEFAULT_LIST_FILTER);
  });
});
