import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import BeadsIdField from "./BeadsIdField";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { dir: () => "ltr" },
  }),
}));

/** A clear that never settles, for the in-flight window between the press and the answer. */
function pending(): { onClear: () => Promise<void>; settle: () => void } {
  let settle = () => {};
  const onClear = () => new Promise<void>((resolve) => { settle = resolve; });
  return { onClear, settle: () => settle() };
}

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
  it("drops the link on the × with no confirmation in the way", async () => {
    const onClear = vi.fn().mockResolvedValue(undefined);
    render(<BeadsIdField beadsId="Arlesh-5fs" onClear={onClear} />);

    fireEvent.click(screen.getByRole("button", { name: "clearBeadsId" }));

    await waitFor(() => expect(onClear).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the row, greyed and without its ×, so the dialog does not jump", async () => {
    render(<BeadsIdField beadsId="Arlesh-5fs" onClear={vi.fn().mockResolvedValue(undefined)} />);

    fireEvent.click(screen.getByRole("button", { name: "clearBeadsId" }));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "clearBeadsId" })).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Arlesh-5fs")).toBeInTheDocument();
    expect(screen.getByText("fieldBeadsId")).toBeInTheDocument();
  });

  it("does not fire a second time while the first clear is still in flight", () => {
    const { onClear } = pending();
    const spy = vi.fn(onClear);
    render(<BeadsIdField beadsId="Arlesh-5fs" onClear={spy} />);

    const clear = screen.getByRole("button", { name: "clearBeadsId" });
    fireEvent.click(clear);
    fireEvent.click(clear);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("leaves the row live and says why when the clear is refused", async () => {
    const onClear = vi.fn().mockRejectedValue(new Error("domain 4 has subtype \"tag\""));
    render(<BeadsIdField beadsId="Arlesh-5fs" onClear={onClear} />);

    fireEvent.click(screen.getByRole("button", { name: "clearBeadsId" }));

    await waitFor(() =>
      expect(screen.getByText('domain 4 has subtype "tag"')).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "clearBeadsId" }),
      // A clear that did not land must not look like one that did.
    ).toBeEnabled();
  });
});
