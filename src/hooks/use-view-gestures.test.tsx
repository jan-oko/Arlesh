import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { useViewGestures, type ViewGestureOptions } from "./use-view-gestures";
import { useCommandSurfaceStore } from "@/stores/use-command-surface-store";
import { usePaletteStore } from "@/stores/use-palette-store";
import { useSelectModeStore } from "@/stores/use-select-mode-store";
import { surfaceCommand } from "@/test/surface-command";
import { TOUCH_QUERY } from "./use-media-query";

type Handlers = Omit<ViewGestureOptions, "idAttribute" | "ready">;

function Surface({ handlers, onQuickMenu }: { handlers: Handlers; onQuickMenu?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useViewGestures(ref, { idAttribute: "data-row-id", ready: true, ...handlers });
  return (
    <div ref={ref} data-testid="surface">
      <div data-row-id="task-1" data-testid="row" onContextMenu={onQuickMenu}>
        <button type="button" data-gesture-skip="" data-testid="status" />
      </div>
    </div>
  );
}

function touch(element: Element, x: number, y: number) {
  return { target: element, clientX: x, clientY: y };
}

/** A finger down at `from` and up at `to`, with nothing in between that takes time. */
function stroke(element: Element, from: [number, number], to: [number, number]) {
  fireEvent.touchStart(element, { touches: [touch(element, ...from)] });
  fireEvent.touchMove(element, { touches: [touch(element, ...to)] });
  fireEvent.touchEnd(element, { touches: [], changedTouches: [touch(element, ...to)] });
}

function handlers(overrides: Partial<Handlers> = {}): Handlers {
  return {
    isSelected: () => false,
    select: vi.fn(),
    deselect: vi.fn(),
    goInto: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === TOUCH_QUERY,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  useCommandSurfaceStore.setState({ tables: new Map(), revision: 0 });
  usePaletteStore.setState({ isOpen: false });
  useSelectModeStore.setState({ active: false });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useViewGestures", () => {
  it("selects a node on a tap", () => {
    const options = handlers();
    const { getByTestId } = render(<Surface handlers={options} />);
    stroke(getByTestId("row"), [10, 10], [10, 10]);
    expect(options.select).toHaveBeenCalledWith("task-1");
  });

  it("deselects the selected node on a second tap, once a double-tap can no longer claim it", () => {
    const options = handlers({ isSelected: () => true });
    const { getByTestId } = render(<Surface handlers={options} />);
    stroke(getByTestId("row"), [10, 10], [10, 10]);
    expect(options.deselect).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(300); });
    expect(options.deselect).toHaveBeenCalledTimes(1);
  });

  it("goes into a node on a double-tap, and does not deselect it on the way", () => {
    const options = handlers({ isSelected: () => true });
    const { getByTestId } = render(<Surface handlers={options} />);
    stroke(getByTestId("row"), [10, 10], [10, 10]);
    stroke(getByTestId("row"), [11, 10], [11, 10]);
    act(() => { vi.advanceTimersByTime(400); });
    expect(options.goInto).toHaveBeenCalledWith("task-1");
    expect(options.deselect).not.toHaveBeenCalled();
  });

  it("opens only the node's quick action menu on a long-press, never the palette", () => {
    const options = handlers();
    const quickMenu = vi.fn();
    const { getByTestId } = render(<Surface handlers={options} onQuickMenu={quickMenu} />);
    const row = getByTestId("row");
    fireEvent.touchStart(row, { touches: [touch(row, 10, 10)] });
    act(() => { vi.advanceTimersByTime(500); });
    // The webview raises `contextmenu` while the finger is down; the node's own handler answers it.
    fireEvent.contextMenu(row);
    fireEvent.touchEnd(row, { touches: [], changedTouches: [touch(row, 10, 10)] });
    expect(options.select).toHaveBeenCalledWith("task-1");
    expect(quickMenu).toHaveBeenCalledTimes(1);
    expect(usePaletteStore.getState().isOpen).toBe(false);
  });

  it("runs the status cycle's binding on a swipe right, as Enter would", () => {
    const cycle = surfaceCommand("listView.cycleStatus", "cycleRowStatus");
    useCommandSurfaceStore.setState({ tables: new Map([["list", [cycle]]]), revision: 1 });
    const { getByTestId } = render(<Surface handlers={handlers()} />);
    stroke(getByTestId("row"), [10, 10], [120, 12]);
    act(() => { vi.runAllTimers(); });
    expect(cycle.run).toHaveBeenCalledTimes(1);
  });

  it("runs Started's binding on a swipe left, and the editor's on a flick up", () => {
    const started = surfaceCommand("listView.toggleStarted", "toggleStarted");
    const editor = surfaceCommand("listView.openEditor", "openEditor");
    useCommandSurfaceStore.setState({ tables: new Map([["list", [started, editor]]]), revision: 1 });
    const { getByTestId } = render(<Surface handlers={handlers()} />);
    stroke(getByTestId("row"), [200, 10], [90, 12]);
    stroke(getByTestId("row"), [10, 300], [12, 240]);
    act(() => { vi.runAllTimers(); });
    expect(started.run).toHaveBeenCalledTimes(1);
    expect(editor.run).toHaveBeenCalledTimes(1);
  });

  it("adds to the selection on a tap while Select is on", () => {
    useSelectModeStore.setState({ active: true });
    const options = handlers({ toggleInSelection: vi.fn() });
    const { getByTestId } = render(<Surface handlers={options} />);
    stroke(getByTestId("row"), [10, 10], [10, 10]);
    expect(options.toggleInSelection).toHaveBeenCalledWith("task-1");
    expect(options.select).not.toHaveBeenCalled();
  });

  it("leaves a touch on a control marked to skip to that control", () => {
    const options = handlers();
    const { getByTestId } = render(<Surface handlers={options} />);
    stroke(getByTestId("status"), [10, 10], [10, 10]);
    expect(options.select).not.toHaveBeenCalled();
  });

  it("listens to nothing without a touchscreen", () => {
    vi.stubGlobal("matchMedia", undefined);
    const options = handlers();
    const { getByTestId } = render(<Surface handlers={options} />);
    stroke(getByTestId("row"), [10, 10], [10, 10]);
    expect(options.select).not.toHaveBeenCalled();
  });
});
