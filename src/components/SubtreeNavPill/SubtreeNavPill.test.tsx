import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SubtreeNavPill from "./SubtreeNavPill";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { dir: () => "ltr" },
  }),
}));

const defaultProps = {
  parentTitle: "My Domain",
  rootTitle: "Arlesh",
  onBack: vi.fn(),
  onBackToRoot: undefined as (() => void) | undefined,
};

beforeEach(() => { vi.clearAllMocks(); });

describe("SubtreeNavPill — back button", () => {
  it("renders the back button with the parent title", () => {
    render(<SubtreeNavPill {...defaultProps} />);
    expect(screen.getByRole("button", { name: "← My Domain" })).toBeInTheDocument();
  });

  it("calls onBack when the back button is clicked", () => {
    render(<SubtreeNavPill {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: "← My Domain" }));
    expect(defaultProps.onBack).toHaveBeenCalledTimes(1);
  });

  it("uses ← arrow for LTR locale", () => {
    render(<SubtreeNavPill {...defaultProps} parentTitle="Parent" />);
    expect(screen.getByRole("button", { name: "← Parent" })).toBeInTheDocument();
  });
});

describe("SubtreeNavPill — root button", () => {
  it("does not render root button when onBackToRoot is undefined", () => {
    render(<SubtreeNavPill {...defaultProps} onBackToRoot={undefined} />);
    expect(screen.queryByRole("button", { name: /↑/ })).not.toBeInTheDocument();
  });

  it("renders root button with root title when onBackToRoot is provided", () => {
    const onBackToRoot = vi.fn();
    render(<SubtreeNavPill {...defaultProps} onBackToRoot={onBackToRoot} />);
    expect(screen.getByRole("button", { name: "↑ Arlesh" })).toBeInTheDocument();
  });

  it("calls onBackToRoot when root button is clicked", () => {
    const onBackToRoot = vi.fn();
    render(<SubtreeNavPill {...defaultProps} onBackToRoot={onBackToRoot} />);
    fireEvent.click(screen.getByRole("button", { name: "↑ Arlesh" }));
    expect(onBackToRoot).toHaveBeenCalledTimes(1);
  });
});
