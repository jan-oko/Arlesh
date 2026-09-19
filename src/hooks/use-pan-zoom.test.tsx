import { describe, it, expect } from "vitest";
import { render, renderHook, act } from "@testing-library/react";
import { usePanZoom, type PanZoomResult } from "./use-pan-zoom";
import { createTabStores, type TabStores } from "@/stores/tab-stores";
import { TabStoresContext } from "@/stores/tab-stores-context";

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

/**
 * Pan and zoom belong to the tab, not to the canvas — and the canvas stays mounted across a tab
 * switch, so the hook has to hand the viewport over: save to the tab being left, restore the tab
 * being arrived at.
 */
describe("usePanZoom across a tab switch", () => {
  it("restores the tab it is given rather than re-centring", () => {
    const stores = createTabStores();
    stores.panZoom.getState().setTransform({ x: 400, y: 120, scale: 1.5 });

    const { result } = renderHook(() => usePanZoom(makeRef()), {
      wrapper: ({ children }) => <TabStoresContext.Provider value={stores}>{children}</TabStoresContext.Provider>,
    });

    expect(result.current.getViewport()).toMatchObject({ x: 400, y: 120, scale: 1.5 });
  });

  it("writes the viewport back to the tab it is leaving, and picks up the one it arrives at", () => {
    const a = createTabStores();
    const b = createTabStores();
    b.panZoom.getState().setTransform({ x: 900, y: 900, scale: 3 });

    const probe: { live: PanZoomResult | null } = { live: null };
    function Probe() {
      probe.live = usePanZoom(makeRef());
      return null;
    }
    function Canvas({ stores }: { stores: TabStores }) {
      return <TabStoresContext.Provider value={stores}><Probe /></TabStoresContext.Provider>;
    }

    const { rerender } = render(<Canvas stores={a} />);
    const first = probe.live;
    if (first === null) throw new Error("the canvas never mounted");
    act(() => first.panBy(70, -20));
    const left = first.getViewport();

    rerender(<Canvas stores={b} />);

    expect(a.panZoom.getState().transform).toMatchObject({ x: left.x, y: left.y });
    const second = probe.live;
    if (second === null) throw new Error("the canvas never re-rendered");
    expect(second.getViewport()).toMatchObject({ x: 900, y: 900, scale: 3 });
  });
});
