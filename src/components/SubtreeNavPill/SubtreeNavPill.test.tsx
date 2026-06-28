import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SubtreeNavPill from "./SubtreeNavPill";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { dir: () => "ltr" },
  }),
}));

const baseProps = {
  parentTitle: "My Domain",
  rootTitle: "Arlesh",
  onBack: vi.fn(),
};

beforeEach(() => { vi.clearAllMocks(); });

describe("SubtreeNavPill — back button", () => {
  it("renders the back button with the parent title", () => {
    render(<SubtreeNavPill {...baseProps} />);
    expect(screen.getByRole("button", { name: "← My Domain" })).toBeInTheDocument();
  });

  it("calls onBack when the back button is clicked", () => {
    render(<SubtreeNavPill {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: "← My Domain" }));
    expect(baseProps.onBack).toHaveBeenCalledTimes(1);
  });

  it("uses ← arrow for LTR locale", () => {
    render(<SubtreeNavPill {...baseProps} parentTitle="Parent" />);
    expect(screen.getByRole("button", { name: "← Parent" })).toBeInTheDocument();
  });
});

describe("SubtreeNavPill — root button", () => {
  it("does not render root button when onBackToRoot is omitted", () => {
    render(<SubtreeNavPill {...baseProps} />);
    expect(screen.queryByRole("button", { name: /↑/ })).not.toBeInTheDocument();
  });

  it("renders root button with root title when onBackToRoot is provided", () => {
    const onBackToRoot = vi.fn();
    render(<SubtreeNavPill {...baseProps} onBackToRoot={onBackToRoot} />);
    expect(screen.getByRole("button", { name: "↑ Arlesh" })).toBeInTheDocument();
  });

  it("calls onBackToRoot when root button is clicked", () => {
    const onBackToRoot = vi.fn();
    render(<SubtreeNavPill {...baseProps} onBackToRoot={onBackToRoot} />);
    fireEvent.click(screen.getByRole("button", { name: "↑ Arlesh" }));
    expect(onBackToRoot).toHaveBeenCalledTimes(1);
  });
});
