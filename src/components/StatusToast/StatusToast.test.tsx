import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import StatusToast from "./StatusToast";

const defaultProps = {
  message: "Status updated",
  position: { x: 100, y: 200, depth: 1 },
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
