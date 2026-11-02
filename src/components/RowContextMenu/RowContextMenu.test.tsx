import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import RowContextMenu from "./RowContextMenu";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("RowContextMenu", () => {
  it("offers Edit on a row that takes no archive, and closes after it", () => {
    const onEdit = vi.fn();
    const onClose = vi.fn();
    render(<RowContextMenu x={1} y={2} archive={null} onArchive={vi.fn()} onEdit={onEdit} onClose={onClose} />);
    expect(screen.queryByRole("menuitem", { name: "archive" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "edit" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("offers the archive beside Edit where the row takes one", () => {
    const onArchive = vi.fn();
    render(<RowContextMenu x={1} y={2} archive="unarchive" onArchive={onArchive} onEdit={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("menuitem", { name: "unarchive" }));
    expect(onArchive).toHaveBeenCalledTimes(1);
  });
});
