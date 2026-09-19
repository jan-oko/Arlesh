import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useListScroll, LIST_SCROLL_STEP_PX } from "@/hooks/use-list-scroll";

/**
 * jsdom implements no scrolling and no layout: `scrollIntoView` and `scrollBy` do not exist, and
 * every element measures zero. These stubs record what the hook *asked the viewport to do*, which
 * is the seam worth testing. What the browser then does with a `nearest` alignment — including the
 * part where a row already on screen does not move — is its contract, not something these tests see.
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
});

interface Props {
  selectedRowId: string | null;
  /** Stands in for any unrelated re-render — a status cycle, a filter chip, a reload. */
  caption?: string;
}

/** A stand-in for the List View's shape: a band of rows inside a section, then loose rows. */
function Scroller({ selectedRowId, caption = "" }: Props) {
  const { containerRef, scrollByStep } = useListScroll(selectedRowId);
  return (
    <div ref={containerRef} data-testid="container">
      <span data-testid="caption">{caption}</span>
      <section>
        <div data-row-id="commitment-1" />
      </section>
      <div data-row-id="task-1" />
      <div data-row-id="task-2" />
      <button data-testid="step-down" onClick={() => scrollByStep(1)} />
      <button data-testid="step-up" onClick={() => scrollByStep(-1)} />
    </div>
  );
}

describe("useListScroll", () => {
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

  it("scrolls the container one fixed step per press, instantly, in either direction", () => {
    render(<Scroller selectedRowId={null} />);
    fireEvent.click(screen.getByTestId("step-down"));
    fireEvent.click(screen.getByTestId("step-up"));
    expect(scrollByCalls).toEqual([
      { top: LIST_SCROLL_STEP_PX, behavior: "auto" },
      { top: -LIST_SCROLL_STEP_PX, behavior: "auto" },
    ]);
  });

  it("does not disturb the selection's own scrolling when stepping", () => {
    render(<Scroller selectedRowId="task-1" />);
    fireEvent.click(screen.getByTestId("step-down"));
    fireEvent.click(screen.getByTestId("step-down"));
    // One call, from the initial selection — stepping never pulls the selection back into view.
    expect(intoViewCalls).toHaveLength(1);
  });
});
