import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "@/i18n";
import AnchoredToast from "@/components/AnchoredToast/AnchoredToast";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { gestureName, undo, redo } from "@/api/gesture";
import type { GestureSummary } from "@/api/gesture";
import { useUndo } from "./use-undo";

/**
 * What the user actually reads after a Ctrl+Z, in real English rather than translation keys: the
 * toast is the only thing that says what an undo did, so its wording is part of the feature.
 */

vi.mock("@/api/gesture", () => ({ undo: vi.fn(), redo: vi.fn(), gestureName: vi.fn() }));

const NO_POSITIONS: ReadonlyMap<string, { x: number; y: number; depth: number }> = new Map();

function summary(over: Partial<GestureSummary> = {}): GestureSummary {
  return { gesture: "g1", rows: 1, inserted: 0, updated: 1, deleted: 0, tables: ["tasks"], ...over };
}

/** A view reduced to the two things this is about: the hotkey handlers and the notice they raise. */
function Board({ press }: { press: "undo" | "redo" }) {
  const showToast = useMindmapStore((s) => s.showToast);
  const pendingToast = useMindmapStore((s) => s.pendingToast);
  const clearToast = useMindmapStore((s) => s.clearToast);
  const { onUndo, onRedo } = useUndo({ reload: () => Promise.resolve(), showToast });
  return (
    <div>
      <button data-testid="press" onClick={press === "undo" ? onUndo : onRedo} />
      <AnchoredToast toast={pendingToast} positions={NO_POSITIONS} onDismiss={clearToast} />
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useMindmapStore.getState().clearToast();
  vi.mocked(gestureName).mockReturnValue(undefined);
});

describe("the undo toast", () => {
  it("names the gesture the user opened, in their words", async () => {
    vi.mocked(gestureName).mockReturnValue("delete 4 nodes");
    vi.mocked(undo).mockResolvedValue(summary({ rows: 4, updated: 0, deleted: 4 }));

    render(<Board press="undo" />);
    screen.getByTestId("press").click();

    await waitFor(() => expect(screen.getByText("Undid: delete 4 nodes")).toBeInTheDocument());
  });

  it("falls back to the rows a gesture nobody named changed", async () => {
    vi.mocked(undo).mockResolvedValue(summary({ rows: 1, updated: 1 }));

    render(<Board press="undo" />);
    screen.getByTestId("press").click();

    await waitFor(() => expect(screen.getByText("Undid: update 1 item")).toBeInTheDocument());
  });

  it("says redid for a redo", async () => {
    vi.mocked(gestureName).mockReturnValue("paste 5 nodes");
    vi.mocked(redo).mockResolvedValue(summary({ rows: 5, inserted: 5 }));

    render(<Board press="redo" />);
    screen.getByTestId("press").click();

    await waitFor(() => expect(screen.getByText("Redid: paste 5 nodes")).toBeInTheDocument());
  });

  it("says there is nothing to undo when the stack is empty", async () => {
    vi.mocked(undo).mockResolvedValue(null);

    render(<Board press="undo" />);
    screen.getByTestId("press").click();

    await waitFor(() => expect(screen.getByText("Nothing to undo")).toBeInTheDocument());
  });

  it("says there is nothing to redo when the redo stack is empty", async () => {
    vi.mocked(redo).mockResolvedValue(null);

    render(<Board press="redo" />);
    screen.getByTestId("press").click();

    await waitFor(() => expect(screen.getByText("Nothing to redo")).toBeInTheDocument());
  });

  it("says the undo was refused when the gesture could not be applied", async () => {
    vi.mocked(undo).mockRejectedValue({ kind: "database", message: "the row is gone" });

    render(<Board press="undo" />);
    screen.getByTestId("press").click();

    await waitFor(() =>
      expect(screen.getByText("Couldn't undo: the row is gone")).toBeInTheDocument(),
    );
  });

  // Both an empty stack and a refused apply now raise a toast, and the toast has one class and one
  // tone — so the words are the only thing left telling the user which happened. An empty stack is
  // a fact about the board; a refusal means the gesture is still sitting on the stack, unapplied.
  it("words an empty stack and a refused apply differently", async () => {
    vi.mocked(undo).mockResolvedValue(null);
    const { unmount } = render(<Board press="undo" />);
    screen.getByTestId("press").click();
    await waitFor(() => expect(useMindmapStore.getState().pendingToast).not.toBeNull());
    const empty = useMindmapStore.getState().pendingToast?.message;
    unmount();

    useMindmapStore.getState().clearToast();
    vi.mocked(undo).mockRejectedValue({ kind: "database", message: "the row is gone" });
    render(<Board press="undo" />);
    screen.getByTestId("press").click();
    await waitFor(() => expect(useMindmapStore.getState().pendingToast).not.toBeNull());
    const refused = useMindmapStore.getState().pendingToast?.message;

    expect(empty).toBe("Nothing to undo");
    expect(refused).toBe("Couldn't undo: the row is gone");
    expect(empty).not.toBe(refused);
    // The refusal names a reason and reports something went wrong; the empty stack states a fact.
    expect(refused).toContain("Couldn't");
    expect(empty).not.toContain("Couldn't");
  });
});
