import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import {
  useListScroll,
  LIST_SCROLL_STEP_PX,
  LIST_SCROLL_HOLD_SPEED_PX_PER_SECOND,
  LIST_SCROLL_HOLD_DELAY_MS,
} from "@/hooks/use-list-scroll";
import { SCROLL_DOWN_CODE, SCROLL_UP_CODE } from "@/utils/hotkeys/list-bindings";

/**
 * jsdom implements no scrolling and no layout: `scrollIntoView` and `scrollBy` do not exist, and
 * every element measures zero. These stubs record what the hook *asked the viewport to do*, which
 * is the seam worth testing. What the browser then does with a `nearest` alignment — including the
 * part where a row already on screen does not move — is its contract, not something these tests see.
 * The same goes for how the motion looks: the tests can check that it arrives in small, evenly
 * paced pieces at the intended speed, not that anything was pleasant to watch.
 */
interface IntoViewCall {
  rowId: string | null;
  options: boolean | ScrollIntoViewOptions | undefined;
}

let intoViewCalls: IntoViewCall[] = [];
let scrollByCalls: ScrollToOptions[] = [];
const originalIntoView = Element.prototype.scrollIntoView;
const originalScrollBy = Element.prototype.scrollBy;

beforeEach(() => {
  intoViewCalls = [];
  scrollByCalls = [];
  Element.prototype.scrollIntoView = function (options?: boolean | ScrollIntoViewOptions) {
    intoViewCalls.push({ rowId: this.getAttribute("data-row-id"), options });
  };
  Element.prototype.scrollBy = function (options?: ScrollToOptions | number) {
    if (typeof options === "object") scrollByCalls.push(options);
  };
});

afterEach(() => {
  Element.prototype.scrollIntoView = originalIntoView;
  Element.prototype.scrollBy = originalScrollBy;
  vi.useRealTimers();
});

/** Every pixel the viewport was asked to move, in order, ignoring the nudge that starts a hold. */
function heldDistances(): number[] {
  return scrollByCalls.slice(1).map((call) => call.top ?? 0);
}

function totalHeld(): number {
  return heldDistances().reduce((sum, distance) => sum + distance, 0);
}

interface Props {
  selectedRowId: string | null;
  /** Stands in for any unrelated re-render — a status cycle, a filter chip, a reload. */
  caption?: string;
}

/** A stand-in for the List View's shape: a band of rows inside a section, then loose rows. */
function Scroller({ selectedRowId, caption = "" }: Props) {
  const { containerRef, startScroll } = useListScroll(selectedRowId);
  return (
    <div ref={containerRef} data-testid="container">
      <span data-testid="caption">{caption}</span>
      <section>
        <div data-row-id="commitment-1" />
      </section>
      <div data-row-id="task-1" />
      <div data-row-id="task-2" />
      <button data-testid="step-down" onClick={() => startScroll(1)} />
      <button data-testid="step-up" onClick={() => startScroll(-1)} />
    </div>
  );
}

/** Holds the key down for `ms`, driving the animation frames the hold runs on. */
function hold(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function releaseKey(code: string) {
  fireEvent.keyUp(window, { code });
}

describe("useListScroll — following the selection", () => {
  it("brings the selected row into view with nearest alignment", () => {
    render(<Scroller selectedRowId="task-2" />);
    expect(intoViewCalls).toEqual([
      { rowId: "task-2", options: { block: "nearest", inline: "nearest" } },
    ]);
  });

  it("finds a selected row in the commitments band, not only among the task rows", () => {
    render(<Scroller selectedRowId="commitment-1" />);
    expect(intoViewCalls.map((call) => call.rowId)).toEqual(["commitment-1"]);
  });

  it("follows the selection when it moves", () => {
    const { rerender } = render(<Scroller selectedRowId="task-1" />);
    rerender(<Scroller selectedRowId="task-2" />);
    expect(intoViewCalls.map((call) => call.rowId)).toEqual(["task-1", "task-2"]);
  });

  it("leaves the scroll position alone on a re-render that does not move the selection", () => {
    const { rerender } = render(<Scroller selectedRowId="task-1" />);
    rerender(<Scroller selectedRowId="task-1" caption="something else changed" />);
    expect(intoViewCalls).toHaveLength(1);
  });

  it("scrolls nothing when there is no selection", () => {
    render(<Scroller selectedRowId={null} />);
    expect(intoViewCalls).toEqual([]);
  });
});

describe("useListScroll — a tap", () => {
  it("nudges the viewport one small fixed step, instantly, in either direction", () => {
    render(<Scroller selectedRowId={null} />);
    fireEvent.click(screen.getByTestId("step-down"));
    fireEvent.click(screen.getByTestId("step-up"));
    expect(scrollByCalls.slice(0, 2)).toEqual([
      { top: LIST_SCROLL_STEP_PX, behavior: "auto" },
      { top: -LIST_SCROLL_STEP_PX, behavior: "auto" },
    ]);
  });

  it("never asks the browser to animate a scroll of its own", () => {
    vi.useFakeTimers();
    render(<Scroller selectedRowId={null} />);
    fireEvent.click(screen.getByTestId("step-down"));
    hold(LIST_SCROLL_HOLD_DELAY_MS + 500);
    // Every move is instant: a browser-animated scroll per frame would fight the next frame's.
    expect(scrollByCalls.every((call) => call.behavior === "auto")).toBe(true);
  });

  it("does not disturb the selection's own scrolling", () => {
    render(<Scroller selectedRowId="task-1" />);
    fireEvent.click(screen.getByTestId("step-down"));
    fireEvent.click(screen.getByTestId("step-down"));
    // One call, from the initial selection — scrolling never pulls the selection back into view.
    expect(intoViewCalls).toHaveLength(1);
  });
});

describe("useListScroll — a held key", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("stays a single nudge until the hold delay has passed", () => {
    render(<Scroller selectedRowId={null} />);
    fireEvent.click(screen.getByTestId("step-down"));
    hold(LIST_SCROLL_HOLD_DELAY_MS - 50);
    expect(scrollByCalls).toEqual([{ top: LIST_SCROLL_STEP_PX, behavior: "auto" }]);
  });

  it("then scrolls on at the intended speed, however long it is held", () => {
    render(<Scroller selectedRowId={null} />);
    fireEvent.click(screen.getByTestId("step-down"));
    hold(LIST_SCROLL_HOLD_DELAY_MS + 1000);

    // One second of motion at the declared speed, give or take the frame the clock stopped on.
    expect(totalHeld()).toBeGreaterThan(LIST_SCROLL_HOLD_SPEED_PX_PER_SECOND - 20);
    expect(totalHeld()).toBeLessThanOrEqual(LIST_SCROLL_HOLD_SPEED_PX_PER_SECOND);
  });

  it("arrives in small, evenly paced pieces rather than in jumps", () => {
    render(<Scroller selectedRowId={null} />);
    fireEvent.click(screen.getByTestId("step-down"));
    hold(LIST_SCROLL_HOLD_DELAY_MS + 500);

    const distances = heldDistances();
    expect(distances.length).toBeGreaterThan(20);
    // At 300px/s a 60Hz frame is ~5px; nothing should ever land as a lurch.
    expect(Math.max(...distances)).toBeLessThanOrEqual(LIST_SCROLL_STEP_PX / 2);
  });

  it("scrolls up when the up key is the one held", () => {
    render(<Scroller selectedRowId={null} />);
    fireEvent.click(screen.getByTestId("step-up"));
    hold(LIST_SCROLL_HOLD_DELAY_MS + 200);
    expect(heldDistances().every((distance) => distance < 0)).toBe(true);
  });

  it("stops as soon as the key is released", () => {
    render(<Scroller selectedRowId={null} />);
    fireEvent.click(screen.getByTestId("step-down"));
    hold(LIST_SCROLL_HOLD_DELAY_MS + 300);
    const movedBeforeRelease = totalHeld();

    releaseKey(SCROLL_DOWN_CODE);
    hold(1000);

    expect(totalHeld()).toBe(movedBeforeRelease);
  });

  it("stops on the other scroll key's release too, so neither can strand the other", () => {
    render(<Scroller selectedRowId={null} />);
    fireEvent.click(screen.getByTestId("step-down"));
    hold(LIST_SCROLL_HOLD_DELAY_MS + 300);
    const movedBeforeRelease = totalHeld();

    releaseKey(SCROLL_UP_CODE);
    hold(1000);

    expect(totalHeld()).toBe(movedBeforeRelease);
  });

  it("ignores the release of any other key", () => {
    render(<Scroller selectedRowId={null} />);
    fireEvent.click(screen.getByTestId("step-down"));
    hold(LIST_SCROLL_HOLD_DELAY_MS + 100);
    const movedBeforeRelease = totalHeld();

    releaseKey("KeyE");
    hold(500);

    expect(totalHeld()).toBeGreaterThan(movedBeforeRelease);
  });

  it("stops when the window loses focus, since the release lands somewhere else", () => {
    render(<Scroller selectedRowId={null} />);
    fireEvent.click(screen.getByTestId("step-down"));
    hold(LIST_SCROLL_HOLD_DELAY_MS + 300);
    const movedBeforeBlur = totalHeld();

    fireEvent.blur(window);
    hold(1000);

    expect(totalHeld()).toBe(movedBeforeBlur);
  });

  it("stops when the view unmounts mid-hold", () => {
    const { unmount } = render(<Scroller selectedRowId={null} />);
    fireEvent.click(screen.getByTestId("step-down"));
    hold(LIST_SCROLL_HOLD_DELAY_MS + 300);
    const movedBeforeUnmount = totalHeld();

    unmount();
    hold(1000);

    expect(totalHeld()).toBe(movedBeforeUnmount);
  });

  it("hands the viewport to the newer key when the direction reverses mid-hold", () => {
    render(<Scroller selectedRowId={null} />);
    fireEvent.click(screen.getByTestId("step-down"));
    hold(LIST_SCROLL_HOLD_DELAY_MS + 300);

    scrollByCalls = [];
    fireEvent.click(screen.getByTestId("step-up"));
    hold(LIST_SCROLL_HOLD_DELAY_MS + 300);

    // One loop, running upward — not two loops fighting over the viewport.
    expect(heldDistances().every((distance) => distance < 0)).toBe(true);
  });
});
