import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import QuitConfirm from "./QuitConfirm";
import { dismissTopSheet } from "@/utils/dismiss-sheet";
import { stepBack } from "@/utils/back-navigation";
import { useQuitConfirmStore } from "@/stores/use-quit-confirm-store";

const quit = vi.fn();
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/hooks/use-close-to-tray", () => ({ useQuit: () => quit }));

beforeEach(() => {
  quit.mockClear();
  useQuitConfirmStore.setState({ isOpen: false });
});

describe("QuitConfirm", () => {
  it("is not drawn until back asks for it", () => {
    render(<QuitConfirm />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("asks at the root instead of leaving, and Quit quits", () => {
    render(<QuitConfirm />);
    act(() => {
      stepBack({
        dismissSheet: dismissTopSheet,
        leaveSubtree: () => false,
        upScope: () => false,
        exit: () => useQuitConfirmStore.getState().show(),
      });
    });
    expect(screen.getByRole("dialog", { name: "quitHeading" })).toBeInTheDocument();
    expect(quit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "quit" }));
    expect(quit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("cancels on Cancel, and on back while it is open", () => {
    render(<QuitConfirm />);
    act(() => useQuitConfirmStore.getState().show());
    fireEvent.click(screen.getByRole("button", { name: "cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    act(() => useQuitConfirmStore.getState().show());
    act(() => {
      expect(dismissTopSheet()).toBe(true);
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(quit).not.toHaveBeenCalled();
  });

  it("lets a sheet, the subtree or the scope take back first", () => {
    const exit = vi.fn();
    stepBack({ dismissSheet: () => true, leaveSubtree: () => false, upScope: () => false, exit });
    stepBack({ dismissSheet: () => false, leaveSubtree: () => true, upScope: () => false, exit });
    stepBack({ dismissSheet: () => false, leaveSubtree: () => false, upScope: () => true, exit });
    expect(exit).not.toHaveBeenCalled();
  });
});
