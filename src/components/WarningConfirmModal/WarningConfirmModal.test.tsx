import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WarningConfirmModal from "./WarningConfirmModal";
import TitleEditorModal from "@/components/TitleEditorModal/TitleEditorModal";
import { expectFocusTrapped, dialogIn } from "@/test/focus-trap";

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

describe("WarningConfirmModal — keyboard", () => {
  it("puts focus on cancel when the dialog opens", () => {
    render(<WarningConfirmModal {...defaultProps} />);
    expect(screen.getByRole("button", { name: "cancel" })).toHaveFocus();
  });

  it("cancels when Escape is pressed, wherever the dialog was opened from", async () => {
    const user = userEvent.setup();
    render(<WarningConfirmModal {...defaultProps} />);
    await user.keyboard("{Escape}");
    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
    expect(primaryAction.onClick).not.toHaveBeenCalled();
  });
});

describe("WarningConfirmModal — focus trap", () => {
  it("keeps Tab and Shift+Tab inside the dialog, wrapping at both ends", async () => {
    render(<button data-testid="behind-the-modal" />);
    const { container } = render(<WarningConfirmModal {...defaultProps} />);
    await expectFocusTrapped(dialogIn(container));
  });
});

describe("WarningConfirmModal — opened over an editor", () => {
  it("keeps Tab inside the prompt rather than the editor still on screen behind it", async () => {
    // The scope-clamp prompt opens mid-save, while the editor that triggered it is still mounted.
    render(
      <TitleEditorModal heading="editTag" title="Deep work" isPrivate={false} onSave={vi.fn()} onClose={vi.fn()} />,
    );
    const { container } = render(<WarningConfirmModal {...defaultProps} />);
    await expectFocusTrapped(dialogIn(container));
  });

  it("still moves between the prompt's own buttons, instead of being pinned to the first", async () => {
    const user = userEvent.setup();
    render(
      <TitleEditorModal heading="editTag" title="Deep work" isPrivate={false} onSave={vi.fn()} onClose={vi.fn()} />,
    );
    const { container } = render(<WarningConfirmModal {...defaultProps} />);
    const prompt = within(dialogIn(container));
    expect(prompt.getByRole("button", { name: "cancel" })).toHaveFocus();
    await user.tab();
    expect(prompt.getByRole("button", { name: "Proceed" })).toHaveFocus();
  });
});
