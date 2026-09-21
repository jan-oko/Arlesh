import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import BeadsIdField from "./BeadsIdField";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { dir: () => "ltr" },
  }),
}));

describe("BeadsIdField", () => {
  it("shows the issue id a node is linked to", () => {
    render(<BeadsIdField beadsId="Arlesh-5fs" onClear={vi.fn()} />);
    expect(screen.getByText("Arlesh-5fs")).toBeInTheDocument();
    expect(screen.getByText("fieldBeadsId")).toBeInTheDocument();
  });

  it("renders nothing at all when the node has no link", () => {
    const { container } = render(<BeadsIdField beadsId={undefined} onClear={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a blank link, rather than an empty labelled row", () => {
    const { container } = render(<BeadsIdField beadsId="   " onClear={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("offers no way to type an id: the value is bd's, and only the MCP server writes one", () => {
    render(<BeadsIdField beadsId="Arlesh-5fs" onClear={vi.fn()} />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1); // the × and nothing else
  });

  it("shows no × where no clear is on offer", () => {
    render(<BeadsIdField beadsId="Arlesh-5fs" />);
    expect(screen.getByText("Arlesh-5fs")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("BeadsIdField — clearing", () => {
  it("stages the drop on the × rather than writing it, so Save is what commits", () => {
    const onClear = vi.fn();
    render(<BeadsIdField beadsId="Arlesh-5fs" onClear={onClear} />);

    fireEvent.click(screen.getByRole("button", { name: "clearBeadsId" }));

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the row, greyed and without its ×, so the dialog does not jump", () => {
    const { rerender } = render(<BeadsIdField beadsId="Arlesh-5fs" onClear={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "clearBeadsId" }));
    rerender(<BeadsIdField beadsId="Arlesh-5fs" isCleared onClear={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "clearBeadsId" })).not.toBeInTheDocument();
    expect(screen.getByText("Arlesh-5fs")).toBeInTheDocument();
    expect(screen.getByText("fieldBeadsId")).toBeInTheDocument();
  });

  it("holds no clear state of its own: the editor owns the staged drop, and Cancel discards it", () => {
    const { rerender } = render(<BeadsIdField beadsId="Arlesh-5fs" isCleared onClear={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "clearBeadsId" })).not.toBeInTheDocument();

    // What a re-opened editor amounts to: the same row with nothing staged, × back on offer.
    rerender(<BeadsIdField beadsId="Arlesh-5fs" onClear={vi.fn()} />);
    expect(screen.getByRole("button", { name: "clearBeadsId" })).toBeInTheDocument();
  });
});
