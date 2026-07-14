import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePanZoom } from "./use-pan-zoom";

function makeRef(): React.RefObject<SVGSVGElement | null> {
  return { current: null };
}

describe("usePanZoom — panBy", () => {
  it("moves the transform by the given screen-pixel offset", () => {
    const ref = makeRef();
    const { result } = renderHook(() => usePanZoom(ref));
    const before = result.current.getViewport();

    act(() => result.current.panBy(50, -30));

    const after = result.current.getViewport();
    expect(after.x).toBe(before.x + 50);
    expect(after.y).toBe(before.y - 30);
    expect(after.scale).toBe(before.scale);
  });

  it("accumulates across repeated calls", () => {
    const ref = makeRef();
    const { result } = renderHook(() => usePanZoom(ref));
    const before = result.current.getViewport();

    act(() => {
      result.current.panBy(10, 10);
      result.current.panBy(10, 10);
    });

    const after = result.current.getViewport();
    expect(after.x).toBe(before.x + 20);
    expect(after.y).toBe(before.y + 20);
  });
});
