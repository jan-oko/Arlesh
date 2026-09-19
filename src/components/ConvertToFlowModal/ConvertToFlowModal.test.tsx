import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ConvertToFlowModal from "./ConvertToFlowModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { dir: () => "ltr" },
  }),
}));

const defaultProps = {
  title: "Ship it",
  onConvert: vi.fn().mockResolvedValue(undefined),
  onClose: vi.fn(),
};

beforeEach(() => { vi.clearAllMocks(); });

/*
 * Escape is handled by a React `onKeyDown` on the dialog element, so it only fires while focus is
 * already inside the dialog. Every other editor claims focus with its own title field; this one has
 * no field, so without the Cancel button taking focus, Escape does nothing until the user tabs in.
 */
describe("ConvertToFlowModal — focus on open", () => {
  it("puts focus on the cancel button when it opens", () => {
    render(<ConvertToFlowModal {...defaultProps} />);
    expect(screen.getByRole("button", { name: "cancel" })).toHaveFocus();
  });

  it("leaves the conversion toggles alone, so a reflex Space cannot silently flip one", () => {
    render(<ConvertToFlowModal {...defaultProps} />);
    for (const toggle of screen.getAllByRole("checkbox")) {
      expect(toggle).not.toHaveFocus();
    }
  });

  it("closes on an Escape pressed the moment it opens, with no Tab or click first", async () => {
    const user = userEvent.setup();
    render(<ConvertToFlowModal {...defaultProps} />);
    await user.keyboard("{Escape}");
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    expect(defaultProps.onConvert).not.toHaveBeenCalled();
  });

  it("cancels, rather than converting, on an Enter pressed the moment it opens", async () => {
    const user = userEvent.setup();
    render(<ConvertToFlowModal {...defaultProps} />);
    await user.keyboard("{Enter}");
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    expect(defaultProps.onConvert).not.toHaveBeenCalled();
  });
});
