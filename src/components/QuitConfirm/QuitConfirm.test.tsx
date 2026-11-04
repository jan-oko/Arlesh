import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import QuitConfirm from "./QuitConfirm";
import { useQuitConfirmStore } from "@/stores/use-quit-confirm-store";

const quit = vi.fn();
vi.mock("@/hooks/use-close-to-tray", () => ({ useQuit: () => quit }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

beforeEach(() => {
  quit.mockReset();
  useQuitConfirmStore.setState({ isOpen: false });
});

describe("QuitConfirm", () => {
  it("opens as a modal dialog, cancels back to the board and quits on Quit", () => {
    useQuitConfirmStore.setState({ isOpen: true });
    render(<QuitConfirm />);
    expect(screen.getByRole("dialog", { name: "quitHeading" })).toHaveAttribute("aria-modal", "true");
    fireEvent.click(screen.getByRole("button", { name: "quit" }));
    expect(quit).toHaveBeenCalledTimes(1);
    expect(useQuitConfirmStore.getState().isOpen).toBe(false);
  });

  it("is centred on the phone as on the desktop, never a sheet at the bottom edge", () => {
    // Read as a file: a CSS module imported into a test comes back as a class-name proxy.
    const css = readFileSync("src/components/WarningConfirmModal/WarningConfirmModal.module.css", "utf8");
    expect(css).toMatch(/align-items:\s*center/);
    expect(css).toMatch(/justify-content:\s*center/);
    expect(css).not.toMatch(/align-items:\s*flex-end/);
    expect(css).not.toMatch(/border-radius:\s*16px 16px 0 0/);
  });
});
