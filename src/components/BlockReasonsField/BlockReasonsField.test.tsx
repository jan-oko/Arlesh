import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import BlockReasonsField from "./BlockReasonsField";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { dir: () => "ltr" } }),
}));

beforeEach(() => { vi.clearAllMocks(); });

describe("BlockReasonsField", () => {
  it("renders an input per existing reason", () => {
    render(<BlockReasonsField reasons={["waiting", "review"]} onChange={vi.fn()} />);
    expect(screen.getByDisplayValue("waiting")).toBeInTheDocument();
    expect(screen.getByDisplayValue("review")).toBeInTheDocument();
  });

  it("appends an empty reason on add", () => {
    const onChange = vi.fn();
    render(<BlockReasonsField reasons={["a"]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "addBlockReason" }));
    expect(onChange).toHaveBeenCalledWith(["a", ""]);
  });

  it("edits a reason in place", () => {
    const onChange = vi.fn();
    render(<BlockReasonsField reasons={["a", "b"]} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue("b"), { target: { value: "bee" } });
    expect(onChange).toHaveBeenCalledWith(["a", "bee"]);
  });

  it("removes a reason", () => {
    const onChange = vi.fn();
    render(<BlockReasonsField reasons={["a", "b"]} onChange={onChange} />);
    const removeButtons = screen.getAllByRole("button", { name: "removeBlockReason" });
    fireEvent.click(removeButtons[0]!);
    expect(onChange).toHaveBeenCalledWith(["b"]);
  });

  it("shows virtual blockers as plain-text rows (not inputs) with no remove button", () => {
    render(<BlockReasonsField reasons={["manual"]} onChange={vi.fn()} virtualBlockers={["Blocked by task 2 (Dep)"]} />);
    // Plain text, not an input (so it doesn't read as editable).
    expect(screen.getByText("Blocked by task 2 (Dep)")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Blocked by task 2 (Dep)")).not.toBeInTheDocument();
    // One editable reason → one remove button; the virtual row adds none.
    expect(screen.getAllByRole("button", { name: "removeBlockReason" })).toHaveLength(1);
  });
});
