import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import StatusToast from "./StatusToast";
import { dismissDelay } from "@/utils/toast-timing";

const defaultProps = {
  message: "Status updated",
  onDismiss: vi.fn(),
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("StatusToast", () => {
  it("renders the message", () => {
    render(<StatusToast {...defaultProps} />);
    expect(screen.getByText("Status updated")).toBeInTheDocument();
  });

  // The cut-off bug. The toast used to be placed with inline `left`/`top` taken from the anchor
  // node's laid-out position — a d3 layout coordinate, with the display root at the origin and
  // half the tree at a negative x, applied outside the canvas's pan/zoom transform. Any such
  // anchor put the toast at or past the left edge, where the container's `overflow: hidden` cut
  // it. jsdom computes no geometry, so what is pinned here is the property that makes being
  // out of bounds impossible: there is no coordinate to be wrong. Placement is the stylesheet's
  // job (fixed, centred, width-capped against the viewport).
  it("carries no inline coordinate, so no anchor position can push it off screen", () => {
    render(<StatusToast {...defaultProps} />);
    const toast = screen.getByText("Status updated");
    // The element does carry one inline style — when its fade starts — so what is pinned is the
    // absence of a *position*, which is what the bug was made of.
    expect(toast.style.left).toBe("");
    expect(toast.style.top).toBe("");
    expect(toast.style.right).toBe("");
    expect(toast.style.bottom).toBe("");
  });

  // The message that exposed the bug: a refusal names the kind, its parent and every parent the
  // kind *would* have been legal under, which is far too long for the one line `nowrap` forced.
  it("renders a long refusal message in full", () => {
    const long = "Goal can't sit under Task — only under Aspect, Domain, Project, Goal";
    render(<StatusToast message={long} onDismiss={vi.fn()} />);
    expect(screen.getByText(long)).toBeInTheDocument();
  });

  it("does not call onDismiss before 3000ms", () => {
    render(<StatusToast {...defaultProps} />);
    vi.advanceTimersByTime(2999);
    expect(defaultProps.onDismiss).not.toHaveBeenCalled();
  });

  it("calls onDismiss after 3000ms", () => {
    render(<StatusToast {...defaultProps} />);
    vi.advanceTimersByTime(3000);
    expect(defaultProps.onDismiss).toHaveBeenCalledTimes(1);
  });

  it("cancels the timer on unmount", () => {
    const { unmount } = render(<StatusToast {...defaultProps} />);
    unmount();
    vi.advanceTimersByTime(3000);
    expect(defaultProps.onDismiss).not.toHaveBeenCalled();
  });
});

// A long message needs longer on screen than the fixed three seconds every toast used to get, and
// the fade has to wait for it — otherwise the toast is invisible for the time it gained.
describe("StatusToast — a message long enough to need reading", () => {
  const long = "1 Goal can't sit under Task — only under Aspect, Domain, Project, Goal.";

  it("stays past three seconds and starts its fade only when its time is nearly up", () => {
    const onDismiss = vi.fn();
    render(<StatusToast message={long} onDismiss={onDismiss} />);
    expect(screen.getByText(long).style.animationDelay).toBe(`${(dismissDelay(long) - 400) / 1000}s`);
    vi.advanceTimersByTime(3000);
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(dismissDelay(long) - 3000);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
