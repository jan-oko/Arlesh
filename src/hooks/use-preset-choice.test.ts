import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { usePresetChoice } from "./use-preset-choice";
import { useFilterStore } from "@/stores/use-filter-store";
import { useListFilterStore } from "@/stores/use-list-filter-store";
import { useViewStore } from "@/stores/use-view-store";
import { DEFAULT_FILTER } from "@/utils/filter-tree";
import { DEFAULT_LIST_FILTER } from "@/utils/list-filter";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

beforeEach(() => {
  useFilterStore.setState({ filter: { ...DEFAULT_FILTER, statusMode: "all" } });
  useListFilterStore.setState({ filter: { ...DEFAULT_LIST_FILTER, preset: "all" } });
  useViewStore.setState({ view: "mindmap" });
});

describe("usePresetChoice", () => {
  it("cycles forward and wraps from the last preset to the first", () => {
    const { result } = renderHook(() => usePresetChoice());
    act(() => result.current.cycle(-1));
    expect(result.current.active).toBe("backlog");
    act(() => result.current.cycle(1));
    expect(result.current.active).toBe("all");
  });

  it("offers the List View's own options there, and writes them to the list alone", () => {
    useViewStore.setState({ view: "list" });
    const { result } = renderHook(() => usePresetChoice());
    act(() => result.current.select("unblock"));
    expect(result.current.active).toBe("unblock");
    expect(useFilterStore.getState().filter.statusMode).toBe("all");
  });

  it("changes nothing in the Zen View, which always reads under Do", () => {
    useViewStore.setState({ view: "zen" });
    const { result } = renderHook(() => usePresetChoice());
    act(() => result.current.cycle(1));
    expect(result.current.active).toBe("do");
    expect(result.current.lockedReason).toBe("zenView:presetLocked");
    expect(useFilterStore.getState().filter.statusMode).toBe("all");
  });
});
