import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import WarningConfirmModal from "./WarningConfirmModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { dir: () => "ltr" },
  }),
}));

const primaryAction = { label: "Proceed", variant: "primary" as const, onClick: vi.fn() };
const dangerAction = { label: "Delete", variant: "danger" as const, onClick: vi.fn() };

const defaultProps = {
  heading: "Are you sure?",
  consequences: ["Data will be lost", "Action is irreversible"],
  actions: [primaryAction],
  onCancel: vi.fn(),
};

beforeEach(() => { vi.clearAllMocks(); });

describe("WarningConfirmModal — content", () => {
  it("renders the heading", () => {
    render(<WarningConfirmModal {...defaultProps} />);
    expect(screen.getByRole("heading", { name: "Are you sure?" })).toBeInTheDocument();
  });

  it("renders each consequence as a list item", () => {
    render(<WarningConfirmModal {...defaultProps} />);
    expect(screen.getByText("Data will be lost")).toBeInTheDocument();
    expect(screen.getByText("Action is irreversible")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});

describe("WarningConfirmModal — cancel", () => {
  it("calls onCancel when the cancel button is clicked", () => {
    render(<WarningConfirmModal {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: "cancel" }));
    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when the overlay backdrop is clicked", () => {
    const { container } = render(<WarningConfirmModal {...defaultProps} />);
    const overlay = container.firstChild as HTMLElement;
    fireEvent.click(overlay);
    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
  });

  it("does not call onCancel when clicking inside the modal", () => {
    render(<WarningConfirmModal {...defaultProps} />);
    fireEvent.click(screen.getByRole("heading", { name: "Are you sure?" }));
    expect(defaultProps.onCancel).not.toHaveBeenCalled();
  });
});

describe("WarningConfirmModal — action buttons", () => {
  it("renders a primary-variant action button with the action label", () => {
    render(<WarningConfirmModal {...defaultProps} actions={[primaryAction]} />);
    expect(screen.getByRole("button", { name: "Proceed" })).toBeInTheDocument();
  });

  it("renders a danger-variant action button with the action label", () => {
    render(<WarningConfirmModal {...defaultProps} actions={[dangerAction]} />);
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("calls the action's onClick when clicked", () => {
    render(<WarningConfirmModal {...defaultProps} actions={[primaryAction]} />);
    fireEvent.click(screen.getByRole("button", { name: "Proceed" }));
    expect(primaryAction.onClick).toHaveBeenCalledTimes(1);
  });

  it("renders multiple action buttons", () => {
    render(<WarningConfirmModal {...defaultProps} actions={[primaryAction, dangerAction]} />);
    expect(screen.getByRole("button", { name: "Proceed" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });
});

describe("WarningConfirmModal — focus", () => {
  it("puts focus on the cancel button when the modal opens, so the consequences get read", () => {
    render(<WarningConfirmModal {...defaultProps} />);
    expect(screen.getByRole("button", { name: "cancel" })).toHaveFocus();
  });
});
