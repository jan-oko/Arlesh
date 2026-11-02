import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { useThreeFingerTap } from "./use-three-finger-tap";
import { useViewGestures } from "./use-view-gestures";
import { TOUCH_QUERY } from "./use-media-query";

function Surface({ onTap, select }: { onTap: () => void; select: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useThreeFingerTap(onTap, true);
  useViewGestures(ref, {
    idAttribute: "data-row-id", ready: true, isSelected: () => false, select, deselect: vi.fn(),
    goInto: vi.fn(),
  });
  return (
    <div>
      <div ref={ref} data-testid="surface"><div data-row-id="a" data-testid="row" /></div>
      <div data-testid="bar" />
    </div>
  );
}

function finger(element: Element, id: number, x: number, y = 100) {
  return { target: element, identifier: id, clientX: x, clientY: y };
}

describe("useThreeFingerTap", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === TOUCH_QUERY, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), onchange: null, dispatchEvent: vi.fn(),
    }));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** Three fingers landing `gaps` ms apart on `targets`, held `hold` ms, lifting `gaps` ms apart. */
  function tap(targets: Element[], gap: number, hold = 50, moveBy = 0) {
    const down = targets.map((t, i) => finger(t, i, 50 + i * 50));
    down.forEach((_, i) => {
      fireEvent.touchStart(targets[i] ?? document.body, { touches: down.slice(0, i + 1) });
      act(() => { vi.advanceTimersByTime(gap); });
    });
    act(() => { vi.advanceTimersByTime(hold); });
    if (moveBy > 0) fireEvent.touchMove(document.body, { touches: down.map((d) => ({ ...d, clientX: d.clientX + moveBy })) });
    for (let i = 0; i < down.length; i += 1) {
      const remaining = down.slice(i + 1);
      fireEvent.touchEnd(targets[i] ?? document.body, { touches: remaining, changedTouches: [down[i]] });
      act(() => { vi.advanceTimersByTime(gap); });
    }
  }

  it("fires once for three fingers landing and lifting a few milliseconds apart", () => {
    const onTap = vi.fn();
    const select = vi.fn();
    const { getByTestId } = render(<Surface onTap={onTap} select={select} />);
    const row = getByTestId("row");
    tap([row, row, row], 40);
    expect(onTap).toHaveBeenCalledTimes(1);
    expect(select).not.toHaveBeenCalled();
  });

  it("is armed over the bars as well as the view, and judges only when the last finger is up", () => {
    const onTap = vi.fn();
    const { getByTestId } = render(<Surface onTap={onTap} select={vi.fn()} />);
    const down = [finger(getByTestId("row"), 0, 50), finger(getByTestId("bar"), 1, 100), finger(getByTestId("bar"), 2, 150)];
    fireEvent.touchStart(getByTestId("row"), { touches: down.slice(0, 1) });
    fireEvent.touchStart(getByTestId("bar"), { touches: down.slice(0, 2) });
    fireEvent.touchStart(getByTestId("bar"), { touches: down });
    fireEvent.touchEnd(getByTestId("bar"), { touches: down.slice(0, 2), changedTouches: [down[2]] });
    fireEvent.touchEnd(getByTestId("bar"), { touches: down.slice(0, 1), changedTouches: [down[1]] });
    expect(onTap).not.toHaveBeenCalled();
    fireEvent.touchEnd(getByTestId("row"), { touches: [], changedTouches: [down[0]] });
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it("tolerates a little movement", () => {
    const onTap = vi.fn();
    const { getByTestId } = render(<Surface onTap={onTap} select={vi.fn()} />);
    const row = getByTestId("row");
    tap([row, row, row], 20, 50, 8);
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it("does not fire when the third finger lands late, or when held, dragged or only two", () => {
    const onTap = vi.fn();
    const { getByTestId } = render(<Surface onTap={onTap} select={vi.fn()} />);
    const row = getByTestId("row");
    tap([row, row, row], 100);
    tap([row, row, row], 20, 800);
    tap([row, row, row], 20, 50, 60);
    tap([row, row], 20);
    expect(onTap).not.toHaveBeenCalled();
  });
});
