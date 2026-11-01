import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import PhoneTopBar from "./PhoneTopBar";
import { useFilterStore } from "@/stores/use-filter-store";
import { useListFilterStore } from "@/stores/use-list-filter-store";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { useCommandSurfaceStore } from "@/stores/use-command-surface-store";
import { surfaceCommand } from "@/test/surface-command";
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

describe("PhoneTopBar — the path", () => {
  const enterSubtree = () => useMindmapStore.setState({
    subtreeRootId: "a-3",
    subtreeNav: { ancestors: [{ id: null, title: "Arlesh" }, { id: "a-1", title: "A-one" }], currentTitle: "Deep" },
  });

  function matchPortrait(portrait: boolean) {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(orientation: portrait)" ? portrait : false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
  }
  afterEach(() => { vi.unstubAllGlobals(); });

  it("in portrait shows `‹ current` and opens the full path from the chevron", () => {
    matchPortrait(true);
    enterSubtree();
    render(<PhoneTopBar />);
    expect(screen.queryByRole("button", { name: "Arlesh" })).not.toBeInTheDocument();
    expect(screen.getByText("Deep")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "fullPath" }));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Arlesh", "A-one"]);
  });

  it("in landscape keeps the whole chain", () => {
    matchPortrait(false);
    enterSubtree();
    render(<PhoneTopBar />);
    expect(screen.getByRole("button", { name: "A-one" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "fullPath" })).not.toBeInTheDocument();
  });
});

describe("PhoneTopBar — the free square", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function publishOpen() {
    const open = surfaceCommand("global.openSearch", "openSearch");
    useCommandSurfaceStore.setState({ tables: new Map([["global", [open]]]), revision: 1 });
    return open;
  }

  it("opens Open on a double-tap", () => {
    const open = publishOpen();
    render(<PhoneTopBar />);
    const square = screen.getByRole("button", { name: "topBarSquare" });
    fireEvent.pointerDown(square);
    fireEvent.pointerUp(square);
    act(() => { vi.advanceTimersByTime(120); });
    fireEvent.pointerDown(square);
    fireEvent.pointerUp(square);
    expect(open.run).toHaveBeenCalledTimes(1);
    expect(usePaletteStore.getState().isOpen).toBe(false);
  });

  it("does nothing on a single tap, or on two taps too far apart", () => {
    const open = publishOpen();
    render(<PhoneTopBar />);
    const square = screen.getByRole("button", { name: "topBarSquare" });
    fireEvent.pointerDown(square);
    fireEvent.pointerUp(square);
    act(() => { vi.advanceTimersByTime(600); });
    fireEvent.pointerDown(square);
    fireEvent.pointerUp(square);
    expect(open.run).not.toHaveBeenCalled();
    expect(usePaletteStore.getState().isOpen).toBe(false);
  });

  it("opens the command palette on a long-press, when the finger lifts", () => {
    const open = publishOpen();
    render(<PhoneTopBar />);
    const square = screen.getByRole("button", { name: "topBarSquare" });
    fireEvent.pointerDown(square);
    act(() => { vi.advanceTimersByTime(700); });
    fireEvent.pointerUp(square);
    expect(usePaletteStore.getState().isOpen).toBe(true);
    expect(open.run).not.toHaveBeenCalled();
  });

  it("opens nothing when the finger slides off before the hold registers", () => {
    render(<PhoneTopBar />);
    const square = screen.getByRole("button", { name: "topBarSquare" });
    fireEvent.pointerDown(square);
    fireEvent.pointerLeave(square);
    act(() => { vi.advanceTimersByTime(700); });
    fireEvent.pointerUp(square);
    expect(usePaletteStore.getState().isOpen).toBe(false);
  });
});
