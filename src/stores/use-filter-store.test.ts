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
