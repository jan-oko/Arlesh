import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { PHONE_LAYOUT_QUERY, useMediaQuery, usePhoneLayout, useShowsActionBar } from "./use-media-query";

type Listener = () => void;

/** A `matchMedia` whose answers the test sets, and whose listeners it can fire. */
function stubMatchMedia(matching: Set<string>) {
  const listeners = new Set<Listener>();
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() { return matching.has(query); },
    addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
  }));
  return () => listeners.forEach((listener) => listener());
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useMediaQuery", () => {
  it("reads false where the platform has no matchMedia — the desktop layout", () => {
    vi.stubGlobal("matchMedia", undefined);
    const { result } = renderHook(() => usePhoneLayout());
    expect(result.current).toBe(false);
  });

  it("follows the query as the window narrows", () => {
    const matching = new Set<string>();
    const fire = stubMatchMedia(matching);
    const { result } = renderHook(() => useMediaQuery(PHONE_LAYOUT_QUERY));
    expect(result.current).toBe(false);
    matching.add(PHONE_LAYOUT_QUERY);
    act(() => fire());
    expect(result.current).toBe(true);
  });

  it("shows the action bar on a wide touch-only device", () => {
    stubMatchMedia(new Set(["(any-pointer: coarse) and (not (any-pointer: fine))"]));
    const { result } = renderHook(() => useShowsActionBar());
    expect(result.current).toBe(true);
  });
});
