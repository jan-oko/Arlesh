import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useZenGrid } from "./use-zen-grid";
import { ZEN_MIN_CARD_HEIGHT_PX, ZEN_MIN_CARD_WIDTH_PX } from "@/utils/zen-grid";

function sizedElement(width: number, height: number): HTMLElement {
  const element = document.createElement("div");
  vi.spyOn(element, "clientWidth", "get").mockReturnValue(width);
  vi.spyOn(element, "clientHeight", "get").mockReturnValue(height);
  return element;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useZenGrid", () => {
  it("draws minimum cards, scrolling, until it has an area to fit", () => {
    const { result } = renderHook(() => useZenGrid(3));
    expect(result.current.layout).toEqual({
      columns: 1, cardWidth: ZEN_MIN_CARD_WIDTH_PX, cardHeight: ZEN_MIN_CARD_HEIGHT_PX, scrolls: true,
    });
  });

  it("fits the cards to the element it is attached to", () => {
    const { result } = renderHook(() => useZenGrid(4));
    act(() => { result.current.ref(sizedElement(1200, 800)); });
    expect(result.current.layout).toEqual({ columns: 2, cardWidth: 594, cardHeight: 394, scrolls: false });
  });

  it("reads an element with no size yet as unmeasured", () => {
    const { result } = renderHook(() => useZenGrid(2));
    act(() => { result.current.ref(sizedElement(0, 0)); });
    expect(result.current.layout.scrolls).toBe(true);
  });
});
