import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import PhoneTopBar from "./PhoneTopBar";
import { useFilterStore } from "@/stores/use-filter-store";
import { useListFilterStore } from "@/stores/use-list-filter-store";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { usePaletteStore } from "@/stores/use-palette-store";
import { useViewStore } from "@/stores/use-view-store";
import { DEFAULT_FILTER } from "@/utils/filter-tree";
import { DEFAULT_LIST_FILTER } from "@/utils/list-filter";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
// The chips and the agents' status have suites of their own, and read stores this one does not set.
vi.mock("@/components/FilterChips/FilterChips", () => ({ default: () => null }));
vi.mock("@/components/TopBar/AgentStatus", () => ({ default: () => null }));
vi.mock("@/components/TopBar/ModeIndicator", () => ({ default: () => <span data-testid="mode" /> }));
vi.mock("@/components/FilterPopover/FilterPopover", () => ({ default: () => <div data-testid="filter-menu" /> }));

beforeEach(() => {
  useFilterStore.setState({ filter: { ...DEFAULT_FILTER, statusMode: "start" }, searchOpen: false, popoverOpen: false });
  useListFilterStore.setState({ filter: { ...DEFAULT_LIST_FILTER, preset: "start" } });
  useMindmapStore.setState({ subtreeRootId: null, subtreeNav: null });
  useViewStore.setState({ view: "list" });
  usePaletteStore.setState({ isOpen: false });
});

describe("PhoneTopBar", () => {
  it("titles the bar with the view at the board's root", () => {
    render(<PhoneTopBar />);
    expect(screen.getByRole("heading", { name: "common:viewList" })).toBeInTheDocument();
  });

  it("shows where the board lives, as the desktop bar does", () => {
    render(<PhoneTopBar />);
    expect(screen.getByTestId("mode")).toBeInTheDocument();
  });

  it("chooses a preset from the chip's sheet, the List View's own options included", () => {
    render(<PhoneTopBar />);
    fireEvent.click(screen.getByRole("button", { name: "touch:presetChipLabel" }));
    const sheet = screen.getByRole("dialog", { name: "touch:presetSheetTitle" });
    expect(within(sheet).getAllByRole("button", { pressed: false }).map((button) => button.textContent))
      .toContain("listView:preset.unblock");
    fireEvent.click(within(sheet).getByRole("button", { name: "listView:preset.do" }));
    expect(useFilterStore.getState().filter.statusMode).toBe("do");
    expect(useListFilterStore.getState().filter.preset).toBe("do");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("locks the Plan View's preset and says why", () => {
    useViewStore.setState({ view: "plan" });
    render(<PhoneTopBar />);
    fireEvent.click(screen.getByRole("button", { name: "touch:presetChipLabel" }));
    expect(screen.getByText("planView:presetLocked")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "listView:preset.all" })).toBeDisabled();
  });

  it("opens the Filter menu and the palette from the ☰ menu", () => {
    render(<PhoneTopBar />);
    fireEvent.click(screen.getByRole("button", { name: "touch:menuOpen" }));
    fireEvent.click(screen.getByRole("button", { name: "touch:menuFilter" }));
    expect(screen.getByTestId("filter-menu")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "touch:menuOpen" }));
    fireEvent.click(screen.getByRole("button", { name: "touch:menuPalette" }));
    expect(usePaletteStore.getState().isOpen).toBe(true);
  });
});
