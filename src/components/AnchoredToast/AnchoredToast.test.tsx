import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import AnchoredToast from "./AnchoredToast";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("AnchoredToast", () => {
  it("renders the pending notice", () => {
    render(<AnchoredToast toast={{ nodeId: "task-1", message: "Converted" }} onDismiss={vi.fn()} />);
    expect(screen.getByText("Converted")).toBeInTheDocument();
  });

  // The silent-drop bug: the anchor node is under a collapsed ancestor, or outside the current
  // `enterSubtree` scope, so it had no laid-out position and the component rendered null — the
  // message destroyed with no fallback and no error. It is now structurally impossible rather
  // than guarded by a fallback coordinate: the notice consults no position at all.
  it("still reaches the user when the anchor node is nowhere on screen", () => {
    render(<AnchoredToast toast={{ nodeId: "task-off-screen", message: "Convert failed: boom" }} onDismiss={vi.fn()} />);
    expect(screen.getByText("Convert failed: boom")).toBeInTheDocument();
  });

  it("renders nothing when there is no pending toast", () => {
    const { container } = render(<AnchoredToast toast={null} onDismiss={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
