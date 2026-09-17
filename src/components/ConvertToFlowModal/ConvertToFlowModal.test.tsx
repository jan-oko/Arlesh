import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ConvertToFlowModal from "./ConvertToFlowModal";
import { expectFocusTrapped, dialogIn } from "@/test/focus-trap";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { dir: () => "ltr" },
  }),
}));

const defaultProps = {
  title: "Ship the thing",
  onConvert: vi.fn().mockResolvedValue(undefined),
  onClose: vi.fn(),
};

beforeEach(() => { vi.clearAllMocks(); });

describe("ConvertToFlowModal — content", () => {
  it("warns that the original subtree goes away", () => {
    render(<ConvertToFlowModal {...defaultProps} />);
    expect(screen.getByText("convertToFlowWarning")).toBeInTheDocument();
  });

  it("offers both conversion options switched on", () => {
    render(<ConvertToFlowModal {...defaultProps} />);
    expect(screen.getByRole("checkbox", { name: "convertKeepDeps" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "convertMapScopes" })).toBeChecked();
  });
});

describe("ConvertToFlowModal — converting", () => {
  it("converts with both options on by default", () => {
    render(<ConvertToFlowModal {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    expect(defaultProps.onConvert).toHaveBeenCalledWith(true, true);
  });

  it("converts without dependencies once that switch is turned off", () => {
    render(<ConvertToFlowModal {...defaultProps} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "convertKeepDeps" }));
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    expect(defaultProps.onConvert).toHaveBeenCalledWith(false, true);
  });

  it("closes without converting when cancel is clicked", () => {
    render(<ConvertToFlowModal {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: "cancel" }));
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    expect(defaultProps.onConvert).not.toHaveBeenCalled();
  });
});

describe("ConvertToFlowModal — focus trap", () => {
  it("keeps Tab and Shift+Tab inside the dialog, wrapping at both ends", async () => {
    render(<button data-testid="behind-the-modal" />);
    const { container } = render(<ConvertToFlowModal {...defaultProps} />);
    await expectFocusTrapped(dialogIn(container));
  });
});
