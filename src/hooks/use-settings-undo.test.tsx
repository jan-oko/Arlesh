import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useSettingsUndo } from "./use-settings-undo";
import { redo, undo } from "@/api/gesture";
import type { GestureSummary } from "@/api/gesture";
import { useSettingsReloadStore } from "@/stores/use-settings-reload-store";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/api/gesture", () => ({
  gestureName: () => undefined,
  undo: vi.fn(),
  redo: vi.fn(),
}));

const summary: GestureSummary = {
  gesture: "g1", rows: 1, inserted: 0, updated: 1, deleted: 0, tables: ["agents"],
};

function Probe() {
  const { toast } = useSettingsUndo();
  return (
    <div>
      <input aria-label="field" />
      <p>{toast?.message ?? "no toast"}</p>
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useSettingsReloadStore.setState({ epoch: 0 });
  vi.mocked(undo).mockResolvedValue(null);
  vi.mocked(redo).mockResolvedValue(null);
});

describe("useSettingsUndo", () => {
  it("undoes on Ctrl+Z and says nothing was left when the stack is empty", async () => {
    render(<Probe />);

    await act(async () => { fireEvent.keyDown(window, { code: "KeyZ", ctrlKey: true }); });

    expect(undo).toHaveBeenCalledTimes(1);
    expect(screen.getByText("nothingToUndo")).toBeDefined();
  });

  it("redoes on Ctrl+Shift+Z and on Ctrl+Y", async () => {
    render(<Probe />);

    await act(async () => { fireEvent.keyDown(window, { code: "KeyZ", ctrlKey: true, shiftKey: true }); });
    await act(async () => { fireEvent.keyDown(window, { code: "KeyY", ctrlKey: true }); });

    expect(redo).toHaveBeenCalledTimes(2);
  });

  it("tells the pages to read again once a Gesture was undone", async () => {
    vi.mocked(undo).mockResolvedValue(summary);
    render(<Probe />);

    await act(async () => { fireEvent.keyDown(window, { code: "KeyZ", ctrlKey: true }); });

    expect(useSettingsReloadStore.getState().epoch).toBe(1);
  });

  it("leaves Ctrl+Z inside a text field to the field", async () => {
    render(<Probe />);
    const field = screen.getByLabelText("field");

    await act(async () => { fireEvent.keyDown(field, { code: "KeyZ", ctrlKey: true }); });

    expect(undo).not.toHaveBeenCalled();
  });
});
