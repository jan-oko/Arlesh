import { beforeEach, describe, expect, it } from "vitest";
import { useFilterStore } from "./use-filter-store";
import { DEFAULT_FILTER } from "@/utils/filter-tree";

beforeEach(() => {
  useFilterStore.setState({ filter: DEFAULT_FILTER });
  localStorage.clear();
});

describe("cycleArchivedMode", () => {
  it("cycles Inactive -> Include -> Exclude -> Inactive", () => {
    expect(useFilterStore.getState().filter.archivedMode).toBe("inactive");
    useFilterStore.getState().cycleArchivedMode();
    expect(useFilterStore.getState().filter.archivedMode).toBe("include");
    useFilterStore.getState().cycleArchivedMode();
    expect(useFilterStore.getState().filter.archivedMode).toBe("exclude");
    useFilterStore.getState().cycleArchivedMode();
    expect(useFilterStore.getState().filter.archivedMode).toBe("inactive");
  });
});

describe("tag filters", () => {
  it("adds a tag in the mode it is given, once", () => {
    useFilterStore.getState().addTagFilter(3, "exclude");
    useFilterStore.getState().addTagFilter(3, "all");
    expect(useFilterStore.getState().filter.tagFilters).toEqual([{ tagId: 3, mode: "exclude" }]);
  });

  it("cycles a tag All → Any → Not → All", () => {
    useFilterStore.getState().addTagFilter(3, "all");
    const modes: string[] = [];
    for (let step = 0; step < 3; step += 1) {
      useFilterStore.getState().cycleTagFilter(3);
      modes.push(useFilterStore.getState().filter.tagFilters[0]?.mode ?? "");
    }
    expect(modes).toEqual(["any", "exclude", "all"]);
  });
});

describe("switch setters", () => {
  it("sets Archived, Backlog and Private outright", () => {
    useFilterStore.getState().setArchivedMode("exclude");
    useFilterStore.getState().setBacklogMode("include");
    useFilterStore.getState().setPrivateMode(true);
    const { archivedMode, backlogMode, privateMode } = useFilterStore.getState().filter;
    expect({ archivedMode, backlogMode, privateMode }).toEqual({ archivedMode: "exclude", backlogMode: "include", privateMode: true });
  });
});
