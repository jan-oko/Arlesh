import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import OccurrenceContextMenu from "./OccurrenceContextMenu";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe("OccurrenceContextMenu", () => {
  it("draws exactly the entries it is given, and runs the one clicked", () => {
    const onAction = vi.fn();
    const onClose = vi.fn();
    render(
      <OccurrenceContextMenu
        x={10} y={10}
        entries={[{ action: "edit", group: "edit" }, { action: "delete", group: "delete" }]}
        onAction={onAction} onClose={onClose}
      />,
    );
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent))
      .toEqual(["occurrence.edit", "occurrence.delete"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "occurrence.delete" }));
    expect(onAction).toHaveBeenCalledWith("delete");
    expect(onClose).toHaveBeenCalled();
  });
});
