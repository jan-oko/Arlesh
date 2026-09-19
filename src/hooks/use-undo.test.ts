import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useUndo, UNDO_TOAST_ANCHOR } from "./use-undo";
import { gestureName, redo, undo } from "@/api/gesture";
import type { GestureSummary } from "@/api/gesture";

vi.mock("@/api/gesture", () => ({
  undo: vi.fn(),
  redo: vi.fn(),
  gestureName: vi.fn(),
}));

// The real `t` would need the whole i18next instance; the key plus its interpolation is what the
// assertions are about, and reading them back literally keeps the expected wording legible here.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options === undefined ? key : `${key}(${JSON.stringify(options)})`,
  }),
}));

function summary(over: Partial<GestureSummary> = {}): GestureSummary {
  return { gesture: "g1", rows: 1, inserted: 0, updated: 1, deleted: 0, tables: ["tasks"], ...over };
}

const reload = vi.fn(() => Promise.resolve());
const showToast = vi.fn();

function renderUndo() {
  return renderHook(() => useUndo({ reload, showToast }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(gestureName).mockReturnValue(undefined);
});

describe("useUndo", () => {
  it("names the gesture it reversed and redraws the board", async () => {
    vi.mocked(gestureName).mockReturnValue("paste 5 nodes");
    vi.mocked(undo).mockResolvedValue(summary());

    const { result } = renderUndo();
    act(() => result.current.onUndo());

    await waitFor(() => expect(showToast).toHaveBeenCalled());
    expect(showToast).toHaveBeenCalledWith({
      nodeId: UNDO_TOAST_ANCHOR,
      message: 'undid({"gesture":"paste 5 nodes"})',
    });
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it("falls back to the row counts for a gesture nobody named", async () => {
    vi.mocked(undo).mockResolvedValue(summary({ rows: 4, updated: 0, deleted: 4 }));

    const { result } = renderUndo();
    act(() => result.current.onUndo());

    await waitFor(() => expect(showToast).toHaveBeenCalled());
    expect(showToast).toHaveBeenCalledWith({
      nodeId: UNDO_TOAST_ANCHOR,
      message: 'undid({"gesture":"changes.delete({\\"count\\":4})"})',
    });
  });

  it("says redid, not undid, for a redo", async () => {
    vi.mocked(gestureName).mockReturnValue("delete 4 nodes");
    vi.mocked(redo).mockResolvedValue(summary());

    const { result } = renderUndo();
    act(() => result.current.onRedo());

    await waitFor(() => expect(showToast).toHaveBeenCalled());
    expect(showToast).toHaveBeenCalledWith({
      nodeId: UNDO_TOAST_ANCHOR,
      message: 'redid({"gesture":"delete 4 nodes"})',
    });
  });

  // Ctrl+Z with nothing to undo is not a mistake. A toast here would read like an error.
  it("says nothing and redraws nothing when the stack is empty", async () => {
    vi.mocked(undo).mockResolvedValue(null);

    const { result } = renderUndo();
    act(() => result.current.onUndo());

    await waitFor(() => expect(undo).toHaveBeenCalled());
    expect(showToast).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  // An empty stack and a refused apply must not look alike: this one changed nothing *and* the
  // gesture is still waiting on the stack, so the user has to be told.
  it("says so when the gesture could not be applied, and leaves the board alone", async () => {
    vi.mocked(undo).mockRejectedValue({ kind: "database", message: "locked" });

    const { result } = renderUndo();
    act(() => result.current.onUndo());

    await waitFor(() => expect(showToast).toHaveBeenCalled());
    expect(showToast).toHaveBeenCalledWith({
      nodeId: UNDO_TOAST_ANCHOR,
      message: 'undoFailed({"message":"locked"})',
    });
    expect(reload).not.toHaveBeenCalled();
  });

  it("reports a failed redo as a redo failure", async () => {
    vi.mocked(redo).mockRejectedValue(new Error("nope"));

    const { result } = renderUndo();
    act(() => result.current.onRedo());

    await waitFor(() => expect(showToast).toHaveBeenCalled());
    expect(showToast).toHaveBeenCalledWith({
      nodeId: UNDO_TOAST_ANCHOR,
      message: 'redoFailed({"message":"nope"})',
    });
  });

  it("ignores a second press while the first is still running", async () => {
    let release = (): void => undefined;
    vi.mocked(undo).mockReturnValue(new Promise((resolve) => {
      release = () => resolve(summary());
    }));

    const { result } = renderUndo();
    act(() => result.current.onUndo());
    act(() => result.current.onUndo());

    expect(undo).toHaveBeenCalledTimes(1);
    await act(async () => {
      release();
    });
  });
});
