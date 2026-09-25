import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SettingsModal from "./SettingsModal";
import { useViewStore } from "@/stores/use-view-store";
import { useDisplayStore } from "@/stores/use-display-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useCloseToTrayStore } from "@/stores/use-close-to-tray-store";
import { useMcpRoots } from "@/hooks/use-mcp-roots";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/use-mcp-roots");

beforeEach(() => {
  useViewStore.setState({ view: "mindmap", mindmapOrientation: "horizontal" });
  useDisplayStore.setState({
    asynchronousFirst: false, listBands: true, habitCollapseThreshold: 3,
    planCandidatesPathGrouping: false, planCandidatesParentOnly: false,
    planSubscopeSplit: false, planIncludePremorning: false,
  });
  useThemeStore.setState({ theme: "dark" });
  useCloseToTrayStore.setState({ closeToTray: true });
  vi.mocked(useMcpRoots).mockReturnValue({
    roots: [], candidates: [], isLoading: false, error: null,
    addRoot: vi.fn(), removeRoot: vi.fn(),
  });
});

function open(props: Partial<Parameters<typeof SettingsModal>[0]> = {}) {
  const onClose = vi.fn();
  const onOpenHotkeys = vi.fn();
  render(<SettingsModal onClose={onClose} onOpenHotkeys={onOpenHotkeys} {...props} />);
  return { onClose, onOpenHotkeys };
}

function goTo(page: string) {
  fireEvent.click(screen.getByRole("tab", { name: `page.${page}` }));
}

describe("SettingsModal", () => {
  it("lists every page, whichever view is active", () => {
    useViewStore.setState({ view: "list" });
    open();

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "page.general", "page.mindmap", "page.list", "page.steps", "page.plan", "page.windows",
      "page.expectations", "page.mcp",
    ]);
  });

  it("opens on General, with focus on its tab", () => {
    open();

    const general = screen.getByRole("tab", { name: "page.general" });
    expect(general).toHaveAttribute("aria-selected", "true");
    expect(general).toHaveFocus();
  });

  it("moves between pages with the arrow keys, wrapping at the ends", () => {
    open();
    const general = screen.getByRole("tab", { name: "page.general" });

    fireEvent.keyDown(general, { key: "ArrowDown" });
    expect(screen.getByRole("tab", { name: "page.mindmap" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "page.mindmap" })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("tab", { name: "page.mindmap" }), { key: "ArrowUp" });
    fireEvent.keyDown(screen.getByRole("tab", { name: "page.general" }), { key: "ArrowUp" });
    expect(screen.getByRole("tab", { name: "page.mcp" })).toHaveAttribute("aria-selected", "true");
  });

  it("closes on Escape", () => {
    const escaped = open();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(escaped.onClose).toHaveBeenCalledTimes(1);
  });

  it("leaves an Escape a nested dialog already handled alone", () => {
    const { onClose } = open();
    const handled = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    handled.preventDefault();

    screen.getByRole("dialog").dispatchEvent(handled);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes itself and opens the keyboard cheat-sheet from General", () => {
    const { onOpenHotkeys } = open();

    fireEvent.click(screen.getByRole("button", { name: "keyboardShortcuts" }));

    expect(onOpenHotkeys).toHaveBeenCalledTimes(1);
  });

  it("toggles the theme on General", () => {
    open();

    fireEvent.click(screen.getByRole("checkbox", { name: "lightMode" }));

    expect(useThemeStore.getState().theme).toBe("light");
  });

  it("turns close-to-tray off under Windows & tray", () => {
    open();
    goTo("windows");

    fireEvent.click(screen.getByRole("checkbox", { name: "closeToTray" }));

    expect(useCloseToTrayStore.getState().closeToTray).toBe(false);
  });

  it("flips the branch axis and stores the Habit-history threshold under Mindmap", () => {
    open();
    goTo("mindmap");

    fireEvent.click(screen.getByRole("checkbox", { name: "verticalLayout" }));
    expect(useViewStore.getState().mindmapOrientation).toBe("vertical");

    const threshold = screen.getByLabelText("collapse.thresholdLabel");
    expect(threshold).toHaveValue(3);
    fireEvent.change(threshold, { target: { value: "7" } });
    fireEvent.blur(threshold);
    expect(useDisplayStore.getState().habitCollapseThreshold).toBe(7);
  });

  it("refuses a Habit-history threshold below two", () => {
    open();
    goTo("mindmap");
    const threshold = screen.getByLabelText("collapse.thresholdLabel");

    fireEvent.change(threshold, { target: { value: "1" } });
    fireEvent.blur(threshold);

    expect(useDisplayStore.getState().habitCollapseThreshold).toBe(2);
  });

  it("switches Asynchronous first and the bands under List", () => {
    open();
    goTo("list");

    fireEvent.click(screen.getByRole("checkbox", { name: "asynchronousFirst" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "listBands" }));

    expect(useDisplayStore.getState().asynchronousFirst).toBe(true);
    expect(useDisplayStore.getState().listBands).toBe(false);
  });

  it("offers the card size under Steps", () => {
    open();
    goTo("steps");

    expect(screen.getByLabelText("zoomLabel")).toBeInTheDocument();
  });

  it("holds both Plan panes' switches under Plan", () => {
    open();
    goTo("plan");

    fireEvent.click(screen.getByRole("checkbox", { name: "planView:optionParentOnly" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "planView:optionGroupByPath" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "planView:optionSubscopeSplit" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "planView:optionIncludePremorning" }));

    const display = useDisplayStore.getState();
    expect(display.planCandidatesParentOnly).toBe(true);
    expect(display.planCandidatesPathGrouping).toBe(true);
    expect(display.planSubscopeSplit).toBe(true);
    expect(display.planIncludePremorning).toBe(true);
  });

  it("offers the check-task prefix under Expectations", () => {
    open();
    goTo("expectations");

    expect(screen.getByLabelText("common:checkTaskPrefix")).toBeInTheDocument();
  });

  it("shows the MCP roots under MCP access", () => {
    open();
    goTo("mcp");

    expect(screen.getByText("settings:mcp.none")).toBeInTheDocument();
  });
});
