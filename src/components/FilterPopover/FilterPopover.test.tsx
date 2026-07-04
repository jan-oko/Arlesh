import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import FilterPopover from "./FilterPopover";
import { useFilterStore } from "@/stores/use-filter-store";
import { DEFAULT_FILTER } from "@/utils/filter-tree";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { dir: () => "ltr" } }),
}));

vi.mock("@/api/domains", () => ({
  DOMAIN_SUBTYPE: { TAG: "tag" },
  listDomains: vi.fn().mockResolvedValue([
    { id: 1, title: "urgent", subtype: "tag", parent_id: 10, color: null, description: null, status: null, knowledge_base_directory: null, position: 0 },
  ]),
}));

beforeEach(() => {
  useFilterStore.setState({ filter: { ...DEFAULT_FILTER } });
  vi.clearAllMocks();
});

describe("FilterPopover", () => {
  it("switches the status mode in the store", () => {
    render(<FilterPopover />);
    fireEvent.click(screen.getByText("mode.do"));
    expect(useFilterStore.getState().filter.statusMode).toBe("do");
  });

  it("shows the include-flows subtoggle only in Plan/Start", () => {
    render(<FilterPopover />);
    expect(screen.queryByText("includeFlows")).not.toBeInTheDocument(); // All
    fireEvent.click(screen.getByText("mode.plan"));
    expect(screen.getByText("includeFlows")).toBeInTheDocument();
  });

  it("toggles Info visibility off via the type pill", () => {
    render(<FilterPopover />);
    fireEvent.click(screen.getByRole("button", { name: "nodeKinds:info" }));
    expect(useFilterStore.getState().filter.showInfo).toBe(false);
  });

  it("adds a tag filter (default Any) from the search combobox and cycles its mode Any→All", async () => {
    render(<FilterPopover />);
    fireEvent.focus(await screen.findByPlaceholderText("addTag"));
    await waitFor(() => expect(screen.getByText("urgent")).toBeInTheDocument());
    fireEvent.mouseDown(screen.getByText("urgent"));
    expect(useFilterStore.getState().filter.tagFilters).toEqual([{ tagId: 1, mode: "any" }]);
    // The mode pill shows a set-theory glyph; its accessible name is the mode.
    fireEvent.click(screen.getByRole("button", { name: "tagMode.any" }));
    expect(useFilterStore.getState().filter.tagFilters[0]?.mode).toBe("all");
  });

  it("removes a tag filter and resets the filter", async () => {
    useFilterStore.setState({ filter: { ...DEFAULT_FILTER, tagFilters: [{ tagId: 1, mode: "any" }] } });
    render(<FilterPopover />);
    await waitFor(() => expect(screen.getByText("urgent")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "removeTagFilter" }));
    expect(useFilterStore.getState().filter.tagFilters).toEqual([]);
  });
});
