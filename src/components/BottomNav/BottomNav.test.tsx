import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import BottomNav from "./BottomNav";
import { useViewStore } from "@/stores/use-view-store";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

beforeEach(() => {
  useViewStore.setState({ view: "list" });
});

describe("BottomNav", () => {
  it("draws the views in the spec's order, the current one marked", () => {
    render(<BottomNav />);
    const items = screen.getAllByRole("button");
    expect(items.map((item) => item.textContent)).toEqual(["navZen", "navList", "navPlan", "navSteps", "navMap"]);
    expect(screen.getByRole("button", { name: /navList/ })).toHaveAttribute("aria-current", "page");
  });

  it("draws each view's icon from the action icon set, the Steps View's as a staircase", () => {
    render(<BottomNav />);
    const icons = screen.getAllByRole("button").map((item) => item.querySelector("[data-action-icon]")?.getAttribute("data-action-icon"));
    expect(icons).toEqual(["viewZen", "viewList", "viewPlan", "viewSteps", "viewMap"]);
  });

  it("switches the tab's view on a tap", () => {
    render(<BottomNav />);
    fireEvent.click(screen.getByRole("button", { name: /navMap/ }));
    expect(useViewStore.getState().view).toBe("mindmap");
  });
});
