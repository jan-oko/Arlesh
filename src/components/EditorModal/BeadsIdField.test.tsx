import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import BeadsIdField from "./BeadsIdField";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { dir: () => "ltr" },
  }),
}));

describe("BeadsIdField", () => {
  it("shows the issue id a node is linked to", () => {
    render(<BeadsIdField beadsId="Arlesh-5fs" />);
    expect(screen.getByText("Arlesh-5fs")).toBeInTheDocument();
    expect(screen.getByText("fieldBeadsId")).toBeInTheDocument();
  });

  it("renders nothing at all when the node has no link", () => {
    const { container } = render(<BeadsIdField beadsId={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a blank link, rather than an empty labelled row", () => {
    const { container } = render(<BeadsIdField beadsId="   " />);
    expect(container).toBeEmptyDOMElement();
  });

  it("offers no control to edit the link", () => {
    render(<BeadsIdField beadsId="Arlesh-5fs" />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
