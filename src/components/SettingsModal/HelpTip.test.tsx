import { afterEach, describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { bubblePlacement } from "@/utils/bubble-placement";
import HelpTip from "./HelpTip";

describe("HelpTip", () => {
  it("is a named, focusable mark whose description is the help", () => {
    render(<HelpTip text="What this does." label="About this" />);
    const mark = screen.getByRole("button", { name: "About this" });

    mark.focus();

    expect(mark).toHaveFocus();
    expect(mark).toHaveAccessibleDescription("What this does.");
  });
});

describe("HelpTip placement", () => {
  const original = { width: window.innerWidth, height: window.innerHeight };
  afterEach(() => {
    window.innerWidth = original.width;
    window.innerHeight = original.height;
  });

  function showAt(left: number) {
    window.innerWidth = 412;
    window.innerHeight = 915;
    render(<HelpTip text="A long help text that has to wrap inside the visible pane." label="About this" />);
    const mark = screen.getByRole("button", { name: "About this" });
    vi.spyOn(mark, "getBoundingClientRect").mockReturnValue(
      new DOMRect(left, 300, 16, 16),
    );
    fireEvent.click(mark);
    return screen.getByRole("tooltip");
  }

  it.each([2, 200, 396])("stays inside a 412 px viewport for a mark at x=%i", (left) => {
    const bubble = showAt(left);
    const x = Number.parseFloat(bubble.style.left);
    const width = Number.parseFloat(bubble.style.width);
    expect(x).toBeGreaterThanOrEqual(8);
    expect(x + width).toBeLessThanOrEqual(412 - 8);
    expect(width).toBeLessThanOrEqual(280);
  });

  it("shows on a tap and hides on a second one", () => {
    const bubble = showAt(20);
    expect(bubble.className).toContain("shown");
    const mark = screen.getByRole("button", { name: "About this" });
    fireEvent.touchStart(mark);
    fireEvent.click(mark);
    expect(bubble.className).not.toContain("shown");
  });

  it("keeps the bubble shown when a mouse clicks the mark it just hovered", () => {
    const bubble = showAt(20);
    fireEvent.click(screen.getByRole("button", { name: "About this" }));
    expect(bubble.className).toContain("shown");
  });

  it("flips above the mark near the bottom of the viewport", () => {
    expect(bubblePlacement({ left: 10, top: 880, bottom: 896 }, { width: 412, height: 915 })).toHaveProperty("bottom");
    expect(bubblePlacement({ left: 10, top: 100, bottom: 116 }, { width: 412, height: 915 })).toHaveProperty("top");
  });
});
