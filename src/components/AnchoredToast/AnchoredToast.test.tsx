import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Position } from "@/utils/tree-layout";
import AnchoredToast from "./AnchoredToast";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("AnchoredToast", () => {
  it("renders the message at the node's laid-out position", () => {
    const positions = new Map<string, Position>([["task-1", { x: 10, y: 20, depth: 0 }]]);
    render(<AnchoredToast toast={{ nodeId: "task-1", message: "Converted" }} positions={positions} onDismiss={vi.fn()} />);
    expect(screen.getByText("Converted")).toBeInTheDocument();
  });

  // The silent-drop bug: the anchor node is under a collapsed ancestor, or outside the current
  // `enterSubtree` scope, so it has no entry in `positions`. Before the fix this test fails —
  // `queryByText` finds nothing because the component renders null instead of falling back to a
  // global position. The message is destroyed with no fallback and no error.
  it("still reaches the user when the anchor node has no laid-out position", () => {
    const positions = new Map<string, Position>(); // anchor node not laid out
    render(<AnchoredToast toast={{ nodeId: "task-off-screen", message: "Convert failed: boom" }} positions={positions} onDismiss={vi.fn()} />);
    expect(screen.getByText("Convert failed: boom")).toBeInTheDocument();
  });

  it("renders nothing when there is no pending toast", () => {
    const { container } = render(<AnchoredToast toast={null} positions={new Map()} onDismiss={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
