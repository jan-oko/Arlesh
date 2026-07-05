import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import FilterPopover from "./FilterPopover";
import { useFilterStore } from "@/stores/use-filter-store";
import { useListFilterStore } from "@/stores/use-list-filter-store";
import { useViewStore } from "@/stores/use-view-store";
import { DEFAULT_FILTER } from "@/utils/filter-tree";
import { DEFAULT_LIST_FILTER } from "@/utils/list-filter";
import { useMindmapData } from "@/components/MindmapView/use-mindmap-data";
import type { MindmapNode } from "@/utils/tree-layout";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { dir: () => "ltr" } }),
}));

vi.mock("@/api/domains", () => ({
  DOMAIN_SUBTYPE: { TAG: "tag" },
  listDomains: vi.fn().mockResolvedValue([
    { id: 1, title: "urgent", subtype: "tag", parent_id: 10, color: null, description: null, status: null, knowledge_base_directory: null, position: 0 },
  ]),
}));

vi.mock("@/components/MindmapView/use-mindmap-data");

const EMPTY_ROOT: MindmapNode = { id: "root", kind: "domain", title: "Arlesh", position: 0, tagIds: [], children: [] };
const mockUseMindmapData = vi.mocked(useMindmapData);

beforeEach(() => {
  useFilterStore.setState({ filter: { ...DEFAULT_FILTER } });
  useListFilterStore.setState({ filter: { ...DEFAULT_LIST_FILTER, pills: { ...DEFAULT_LIST_FILTER.pills } } });
  useViewStore.setState({ view: "mindmap" });
  mockUseMindmapData.mockReturnValue({
    tree: EMPTY_ROOT,
    isLoading: false,
    error: null,
    createNode: vi.fn(), createChild: vi.fn(), renameNode: vi.fn(), retypeNode: vi.fn(),
    reorderNode: vi.fn(), moveNode: vi.fn(), removeNode: vi.fn(), createFlow: vi.fn(),
    updateFlow: vi.fn(), reload: vi.fn(),
  });
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

  it("hides tags & type controls under a collapsed Advanced section by default", () => {
    render(<FilterPopover />);
    expect(screen.queryByText("tagsLabel")).not.toBeInTheDocument();
    expect(screen.queryByText("typesLabel")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("advanced"));
    expect(screen.getByText("tagsLabel")).toBeInTheDocument();
    expect(screen.getByText("typesLabel")).toBeInTheDocument();
  });

  it("toggles Info visibility off via the type pill (under Advanced)", () => {
    render(<FilterPopover />);
    fireEvent.click(screen.getByText("advanced")); // expand
    fireEvent.click(screen.getByRole("button", { name: "nodeKinds:info" }));
    expect(useFilterStore.getState().filter.showInfo).toBe(false);
  });

  it("adds a tag filter (default Any) from the search combobox and cycles its mode Any→All", async () => {
    render(<FilterPopover />);
    fireEvent.click(screen.getByText("advanced")); // expand
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

  describe("List View filter sections", () => {
    beforeEach(() => {
      useViewStore.setState({ view: "list" });
    });

    it("does not render List-View-exclusive sections while the Mindmap is active", () => {
      useViewStore.setState({ view: "mindmap" });
      render(<FilterPopover />);
      fireEvent.click(screen.getByText("advanced"));
      expect(screen.queryByText("listView:taskStatusLabel")).not.toBeInTheDocument();
    });

    it("adds a fixed-option pill (task status) in 'any' mode by clicking it", () => {
      render(<FilterPopover />);
      fireEvent.click(screen.getByText("advanced"));
      fireEvent.click(screen.getByText("status:task.todo"));
      expect(useListFilterStore.getState().filter.pills.taskStatus).toEqual([{ value: "todo", mode: "any" }]);
    });

    it("cycles a fixed-option pill's mode and removes it", () => {
      useListFilterStore.getState().addPill("blocked", "blocked");
      render(<FilterPopover />);
      fireEvent.click(screen.getByText("advanced"));
      fireEvent.click(screen.getByRole("button", { name: "tagMode.any" }));
      expect(useListFilterStore.getState().filter.pills.blocked[0]?.mode).toBe("all");
      fireEvent.click(screen.getByRole("button", { name: "removeTagFilter" }));
      expect(useListFilterStore.getState().filter.pills.blocked).toEqual([]);
    });

    it("adds a parent filter pill from the searchable combobox", async () => {
      mockUseMindmapData.mockReturnValue({
        tree: {
          id: "root", kind: "domain", title: "Arlesh", position: 0, tagIds: [],
          children: [{ id: "project-1", kind: "project", title: "Rocket", position: 0, tagIds: [], children: [] }],
        },
        isLoading: false, error: null,
        createNode: vi.fn(), createChild: vi.fn(), renameNode: vi.fn(), retypeNode: vi.fn(),
        reorderNode: vi.fn(), moveNode: vi.fn(), removeNode: vi.fn(), createFlow: vi.fn(),
        updateFlow: vi.fn(), reload: vi.fn(),
      });
      render(<FilterPopover />);
      fireEvent.click(screen.getByText("advanced"));
      fireEvent.focus(await screen.findByPlaceholderText("listView:addParent"));
      await waitFor(() => expect(screen.getByText("Rocket")).toBeInTheDocument());
      fireEvent.mouseDown(screen.getByText("Rocket"));
      expect(useListFilterStore.getState().filter.pills.parent).toEqual([{ value: "project-1", mode: "any" }]);
    });
  });
});
