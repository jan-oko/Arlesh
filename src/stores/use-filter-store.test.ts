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

describe("rehydration from a persisted shape older than the archivedMode field (regression)", () => {
  it("backfills archivedMode from defaults instead of leaving it undefined, and cycling works afterward", () => {
    // Simulates a browser whose `arlesh-filter` localStorage entry was written before `archivedMode`
    // existed — this used to leave `filter.archivedMode` `undefined` forever (the reported bug: the
    // pill never changed and archived/lapsed items were never actually filtered).
    localStorage.setItem(
      "arlesh-filter",
      JSON.stringify({
        state: {
          filter: {
            statusMode: "plan", modeIncludeFlows: true, tagFilters: [],
            showInfo: true, showFlow: true, privateMode: true,
          },
        },
        version: 0,
      }),
    );
    useFilterStore.persist.rehydrate();

    const filter = useFilterStore.getState().filter;
    expect(filter.archivedMode).toBe("inactive"); // backfilled, not undefined
    expect(filter.privateMode).toBe(true); // pre-existing persisted fields are still honored
    expect(filter.statusMode).toBe("plan");

    useFilterStore.getState().cycleArchivedMode();
    expect(useFilterStore.getState().filter.archivedMode).toBe("include"); // cycling now actually advances
  });
});

describe("cycleBacklogMode", () => {
  it("cycles Inactive -> Include -> Exclude -> Inactive, exactly as the Archived pill does", () => {
    expect(useFilterStore.getState().filter.backlogMode).toBe("inactive");
    useFilterStore.getState().cycleBacklogMode();
    expect(useFilterStore.getState().filter.backlogMode).toBe("include");
    useFilterStore.getState().cycleBacklogMode();
    expect(useFilterStore.getState().filter.backlogMode).toBe("exclude");
    useFilterStore.getState().cycleBacklogMode();
    expect(useFilterStore.getState().filter.backlogMode).toBe("inactive");
  });

  it("moves independently of the Archived pill", () => {
    useFilterStore.getState().cycleBacklogMode();
    expect(useFilterStore.getState().filter.backlogMode).toBe("include");
    expect(useFilterStore.getState().filter.archivedMode).toBe("inactive");
  });
});
