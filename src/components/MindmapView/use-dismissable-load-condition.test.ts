import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDismissableLoadCondition } from "./use-dismissable-load-condition";
import type { LoadCondition } from "./use-mindmap-data";

function condition(...ids: number[]): LoadCondition {
  return { failedFlows: ids.map((id) => ({ id, title: `Flow ${id}` })) };
}

const CLEAN: LoadCondition = { failedFlows: [] };

describe("useDismissableLoadCondition", () => {
  it("shows the current failures when nothing has been dismissed", () => {
    const { result } = renderHook(() => useDismissableLoadCondition(condition(7)));
    expect(result.current.visibleFailedFlows).toEqual([{ id: 7, title: "Flow 7" }]);
  });

  it("hides the banner once dismissed", () => {
    const { result, rerender } = renderHook(({ c }) => useDismissableLoadCondition(c), {
      initialProps: { c: condition(7) },
    });
    act(() => result.current.dismiss());
    rerender({ c: condition(7) });
    expect(result.current.visibleFailedFlows).toEqual([]);
  });

  // The load-bearing case: `load()` in `useMindmapData` reruns after every mutation and always
  // builds a fresh `LoadCondition` object, even when nothing about the failures changed.
  // Dismissing must survive that reload, or the user can never dismiss the banner while the
  // condition persists — their very next action (create a node, drag something, change a status)
  // undoes the dismissal because it looks like a "new" condition by object identity alone.
  it("stays dismissed across a reload that reports the identical set of failed flows", () => {
    const { result, rerender } = renderHook(({ c }) => useDismissableLoadCondition(c), {
      initialProps: { c: condition(7) },
    });
    act(() => result.current.dismiss());
    rerender({ c: condition(7) }); // a brand-new object, same content — as after a mutation reload
    expect(result.current.visibleFailedFlows).toEqual([]);
  });

  it("reappears when a load adds a new flow to the failure set", () => {
    const { result, rerender } = renderHook(({ c }) => useDismissableLoadCondition(c), {
      initialProps: { c: condition(7) },
    });
    act(() => result.current.dismiss());
    rerender({ c: condition(7, 8) });
    expect(result.current.visibleFailedFlows).toEqual([
      { id: 7, title: "Flow 7" },
      { id: 8, title: "Flow 8" },
    ]);
  });

  it("reappears when a load reports a different flow failing instead", () => {
    const { result, rerender } = renderHook(({ c }) => useDismissableLoadCondition(c), {
      initialProps: { c: condition(7) },
    });
    act(() => result.current.dismiss());
    rerender({ c: condition(9) });
    expect(result.current.visibleFailedFlows).toEqual([{ id: 9, title: "Flow 9" }]);
  });

  it("re-arms the dismissal once the condition clears, so a later recurrence of the same failure shows again", () => {
    const { result, rerender } = renderHook(({ c }) => useDismissableLoadCondition(c), {
      initialProps: { c: condition(7) },
    });
    act(() => result.current.dismiss());
    rerender({ c: CLEAN });
    expect(result.current.visibleFailedFlows).toEqual([]);
    rerender({ c: condition(7) });
    expect(result.current.visibleFailedFlows).toEqual([{ id: 7, title: "Flow 7" }]);
  });

  it("treats a reordering of the same failed-flow ids as the identical set", () => {
    const { result, rerender } = renderHook(({ c }) => useDismissableLoadCondition(c), {
      initialProps: { c: condition(7, 8) },
    });
    act(() => result.current.dismiss());
    rerender({
      c: {
        failedFlows: [
          { id: 8, title: "Flow 8" },
          { id: 7, title: "Flow 7" },
        ],
      },
    });
    expect(result.current.visibleFailedFlows).toEqual([]);
  });
});
