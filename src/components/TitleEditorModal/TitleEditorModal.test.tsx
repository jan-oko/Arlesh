import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TitleEditorModal from "./TitleEditorModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { dir: () => "ltr" },
  }),
}));

const defaultProps = {
  heading: "Rename Node",
  title: "Original Title",
  onSave: vi.fn().mockResolvedValue(undefined),
  onClose: vi.fn(),
};

beforeEach(() => { vi.clearAllMocks(); });

describe("TitleEditorModal", () => {
  it("pre-fills the title input with the initial title", () => {
    render(<TitleEditorModal {...defaultProps} />);
    expect(screen.getByRole("textbox")).toHaveValue("Original Title");
  });

  it("renders the heading", () => {
    render(<TitleEditorModal {...defaultProps} />);
    expect(screen.getByRole("heading", { name: "Rename Node" })).toBeInTheDocument();
  });

  it("calls onSave with trimmed title when save button is clicked", async () => {
    render(<TitleEditorModal {...defaultProps} title="  My Title  " />);
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(defaultProps.onSave).toHaveBeenCalledWith("My Title", false));
  });

  it("does not call onSave when title is blank", () => {
    render(<TitleEditorModal {...defaultProps} title="   " />);
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    expect(defaultProps.onSave).not.toHaveBeenCalled();
  });

  it("calls onSave when Enter is pressed in the input", async () => {
    render(<TitleEditorModal {...defaultProps} />);
    const input = screen.getByRole("textbox");
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(defaultProps.onSave).toHaveBeenCalledWith("Original Title", false));
  });

  it("calls onClose when Escape is pressed", () => {
    render(<TitleEditorModal {...defaultProps} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when cancel button is clicked", () => {
    render(<TitleEditorModal {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: "cancel" }));
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it("displays save error message when onSave rejects", async () => {
    const error = new Error("Save failed");
    const onSave = vi.fn().mockRejectedValue(error);
    render(<TitleEditorModal {...defaultProps} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(screen.getByText("Save failed")).toBeInTheDocument());
  });
});

/*
 * Escape is handled by a React `onKeyDown` on the dialog element, so it only fires while focus is
 * already inside the dialog. These press it with no Tab and no click first — the state the modal is
 * actually in the instant it opens — which is the one case a `fireEvent.keyDown` aimed at the input
 * cannot show.
 */
describe("TitleEditorModal — focus on open", () => {
  it("puts focus inside the dialog when it opens", () => {
    render(<TitleEditorModal {...defaultProps} />);
    expect(screen.getByLabelText("fieldTitle")).toHaveFocus();
  });

  it("closes on an Escape pressed the moment it opens, with no Tab or click first", async () => {
    const user = userEvent.setup();
    render(<TitleEditorModal {...defaultProps} />);
    await user.keyboard("{Escape}");
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });
});
