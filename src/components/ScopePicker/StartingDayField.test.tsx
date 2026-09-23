import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import StartingDayField from "./StartingDayField";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

function setup(value: string | null = "2026-10-01") {
  const onChange = vi.fn();
  const outerKey = vi.fn();
  render(
    <div onKeyDown={outerKey}>
      <button type="button" aria-label="outside" />
      <StartingDayField value={value} onChange={onChange} emptyLabel="now" />
    </div>,
  );
  fireEvent.click(screen.getByRole("button", { name: "scopeEdit" }));
  return { onChange, outerKey };
}

describe("StartingDayField", () => {
  it("closes on a click outside, committing the picked day", () => {
    const { onChange } = setup();
    expect(screen.getByRole("group", { name: "startingPicker" })).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("button", { name: "outside" }));
    expect(screen.queryByRole("group", { name: "startingPicker" })).toBeNull();
    expect(onChange).toHaveBeenCalledWith("2026-10-01");
  });

  it("commits on Enter", () => {
    const { onChange } = setup();
    fireEvent.keyDown(screen.getByRole("group", { name: "startingPicker" }), { key: "Enter" });
    expect(screen.queryByRole("group", { name: "startingPicker" })).toBeNull();
    expect(onChange).toHaveBeenCalledWith("2026-10-01");
  });

  it("cancels on Escape, without closing the editor it sits in", () => {
    const { onChange, outerKey } = setup();
    fireEvent.keyDown(screen.getByRole("group", { name: "startingPicker" }), { key: "Escape" });
    expect(screen.queryByRole("group", { name: "startingPicker" })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(outerKey).not.toHaveBeenCalled();
  });

  it("stays open for a click inside it", () => {
    setup();
    fireEvent.mouseDown(screen.getByRole("group", { name: "startingPicker" }));
    expect(screen.getByRole("group", { name: "startingPicker" })).toBeInTheDocument();
  });
});
