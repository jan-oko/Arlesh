import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DeleteConfirmModal from "./DeleteConfirmModal";
import { expectFocusTrapped, dialogIn } from "@/test/focus-trap";

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

describe("DeleteConfirmModal — keyboard", () => {
  it("puts focus on the delete button when the modal opens", () => {
    render(<DeleteConfirmModal {...defaultProps} />);
    expect(screen.getByRole("button", { name: "warnings:deleteConfirm" })).toHaveFocus();
  });

  it("puts focus on the delete button when several nodes are being deleted", () => {
    render(<DeleteConfirmModal {...defaultProps} nodeCount={3} />);
    expect(screen.getByRole("button", { name: "warnings:deleteConfirm" })).toHaveFocus();
  });

  it("puts focus on the delete button when the delete takes descendants with it", () => {
    render(<DeleteConfirmModal {...defaultProps} descendantCount={5} />);
    expect(screen.getByRole("button", { name: "warnings:deleteConfirm" })).toHaveFocus();
  });

  it("confirms when Enter is pressed on the freshly opened modal", async () => {
    const user = userEvent.setup();
    render(<DeleteConfirmModal {...defaultProps} />);
    await user.keyboard("{Enter}");
    expect(defaultProps.onConfirm).toHaveBeenCalledTimes(1);
    expect(defaultProps.onCancel).not.toHaveBeenCalled();
  });

  it("confirms when Space is pressed on the freshly opened modal", async () => {
    const user = userEvent.setup();
    render(<DeleteConfirmModal {...defaultProps} />);
    await user.keyboard("{ }");
    expect(defaultProps.onConfirm).toHaveBeenCalledTimes(1);
    expect(defaultProps.onCancel).not.toHaveBeenCalled();
  });

  it("reaches the cancel button with a single Tab, where Enter cancels instead", async () => {
    const user = userEvent.setup();
    render(<DeleteConfirmModal {...defaultProps} />);
    await user.tab();
    expect(screen.getByRole("button", { name: "common:cancel" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
    expect(defaultProps.onConfirm).not.toHaveBeenCalled();
  });

  it("reaches the cancel button with a single Shift+Tab", async () => {
    const user = userEvent.setup();
    render(<DeleteConfirmModal {...defaultProps} />);
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "common:cancel" })).toHaveFocus();
  });

  it("keeps Tab and Shift+Tab inside the dialog, wrapping at both ends", async () => {
    render(<button data-testid="behind-the-modal" />);
    const { container } = render(<DeleteConfirmModal {...defaultProps} />);
    await expectFocusTrapped(dialogIn(container));
  });

  it("cancels when Escape is pressed", async () => {
    const user = userEvent.setup();
    render(<DeleteConfirmModal {...defaultProps} />);
    await user.keyboard("{Escape}");
    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
    expect(defaultProps.onConfirm).not.toHaveBeenCalled();
  });

  it("ignores Enter while the delete is in flight", async () => {
    const user = userEvent.setup();
    render(<DeleteConfirmModal {...defaultProps} isDeleting={true} />);
    await user.keyboard("{Enter}");
    expect(defaultProps.onConfirm).not.toHaveBeenCalled();
  });
});

/*
 * jsdom reports `:focus-visible` as false even for the element it has just focused, so the ring
 * itself cannot be observed here. These read the stylesheet instead: the point is that the ring
 * exists at all and is built from theme tokens, which is what makes it legible in both themes.
 */
describe("DeleteConfirmModal — focus ring", () => {
  // Imported rather than read, the stylesheet arrives as the class-name map; the text is the point
  // here, so read it off disk. Vitest runs from the project root.
  const css = readFileSync("src/components/DeleteConfirmModal/DeleteConfirmModal.module.css", "utf8");

  function declarationsFor(selector: string): string[] {
    return css
      .split("}")
      .map((block) => block.split("{"))
      .filter((parts): parts is [string, string] => parts.length === 2)
      .filter(([selectors]) => selectors.split(",").some((s) => s.trim().endsWith(selector)))
      .map(([, declarations]) => declarations);
  }

  it.each([".deleteBtn:focus", ".deleteBtn:focus-visible", ".cancelBtn:focus-visible"])(
    "draws a token-coloured outline for %s",
    (selector) => {
      const declarations = declarationsFor(selector).join("\n");
      expect(declarations).toMatch(/outline:[^;]*var\(--accent\)/);
      expect(declarations).toContain("outline-offset");
    },
  );
});
