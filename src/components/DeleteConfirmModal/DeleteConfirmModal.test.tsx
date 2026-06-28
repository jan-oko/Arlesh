import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DeleteConfirmModal from "./DeleteConfirmModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts === undefined
        ? key
        : Object.entries(opts).reduce((s, [k, v]) => s.replace(`{{${k}}}`, String(v)), key),
    i18n: { dir: () => "ltr" },
  }),
}));

const defaultProps = {
  nodeTitle: "My Task",
  nodeCount: 1,
  descendantCount: 0,
  isDeleting: false,
  error: null,
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
};

beforeEach(() => { vi.clearAllMocks(); });

describe("DeleteConfirmModal — heading", () => {
  it("uses single-node heading when nodeCount is 1", () => {
    render(<DeleteConfirmModal {...defaultProps} nodeCount={1} />);
    expect(screen.getByRole("heading", { name: "warnings:deleteHeading" })).toBeInTheDocument();
  });

  it("uses multi-node heading when nodeCount is greater than 1", () => {
    render(<DeleteConfirmModal {...defaultProps} nodeCount={3} />);
    expect(screen.getByRole("heading", { name: "warnings:deleteMultipleHeading" })).toBeInTheDocument();
  });
});

describe("DeleteConfirmModal — descendants paragraph", () => {
  it("shows descendants paragraph when descendantCount > 0", () => {
    render(<DeleteConfirmModal {...defaultProps} descendantCount={5} />);
    expect(screen.getByText("warnings:deleteWithChildren")).toBeInTheDocument();
  });

  it("omits descendants paragraph when descendantCount is 0", () => {
    render(<DeleteConfirmModal {...defaultProps} descendantCount={0} />);
    expect(screen.queryByText("warnings:deleteWithChildren")).not.toBeInTheDocument();
  });
});

describe("DeleteConfirmModal — error", () => {
  it("shows error paragraph when error is non-null", () => {
    render(<DeleteConfirmModal {...defaultProps} error="something went wrong" />);
    expect(screen.getByText("warnings:deleteFailed")).toBeInTheDocument();
  });

  it("omits error paragraph when error is null", () => {
    render(<DeleteConfirmModal {...defaultProps} error={null} />);
    expect(screen.queryByText("warnings:deleteFailed")).not.toBeInTheDocument();
  });
});

describe("DeleteConfirmModal — buttons", () => {
  it("calls onCancel when cancel button is clicked", () => {
    render(<DeleteConfirmModal {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: "common:cancel" }));
    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onConfirm when confirm button is clicked", () => {
    render(<DeleteConfirmModal {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: "warnings:deleteConfirm" }));
    expect(defaultProps.onConfirm).toHaveBeenCalledTimes(1);
  });

  it("disables both buttons while isDeleting is true", () => {
    render(<DeleteConfirmModal {...defaultProps} isDeleting={true} />);
    expect(screen.getByRole("button", { name: "common:cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "warnings:deleteConfirm" })).toBeDisabled();
  });

  it("calls onCancel when overlay is clicked", () => {
    const { container } = render(<DeleteConfirmModal {...defaultProps} />);
    const overlay = container.firstChild as HTMLElement;
    fireEvent.click(overlay);
    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
  });
});
