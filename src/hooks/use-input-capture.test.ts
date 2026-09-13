import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useInputCapture, useIsInputCaptured } from "./use-input-capture";
import { useInputCaptureStore } from "@/stores/use-input-capture-store";

beforeEach(() => {
  useInputCaptureStore.setState({ captors: new Set<string>() });
});

function isCaptured(): boolean {
  return renderHook(() => useIsInputCaptured()).result.current;
}

describe("useInputCapture", () => {
  it("captures input for as long as the component is mounted", () => {
    renderHook(() => useInputCapture());
    expect(isCaptured()).toBe(true);
  });

  it("releases the capture when the component unmounts", () => {
    const { unmount } = renderHook(() => useInputCapture());
    unmount();
    expect(isCaptured()).toBe(false);
  });

  // The whole point of the registry: a captor that stops rendering cannot strand the flag,
  // because the release rides the same unmount that removed it from the screen.
  it("keeps input captured while a second captor is still mounted", () => {
    const first = renderHook(() => useInputCapture());
    renderHook(() => useInputCapture());
    first.unmount();
    expect(isCaptured()).toBe(true);
  });

  it("gives each mounted captor its own token", () => {
    renderHook(() => useInputCapture());
    renderHook(() => useInputCapture());
    expect(useInputCaptureStore.getState().captors.size).toBe(2);
  });
});

describe("useInputCapture(active)", () => {
  it("captures nothing while the editor is not editing", () => {
    renderHook(() => useInputCapture(false));
    expect(isCaptured()).toBe(false);
  });

  it("captures once the editor starts editing", () => {
    const { rerender } = renderHook(({ editing }) => useInputCapture(editing), {
      initialProps: { editing: false },
    });
    rerender({ editing: true });
    expect(isCaptured()).toBe(true);
  });

  it("releases when the editor stops editing without unmounting", () => {
    const { rerender } = renderHook(({ editing }) => useInputCapture(editing), {
      initialProps: { editing: true },
    });
    rerender({ editing: false });
    expect(isCaptured()).toBe(false);
  });
});
