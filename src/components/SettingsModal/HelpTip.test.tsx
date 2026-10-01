import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
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
