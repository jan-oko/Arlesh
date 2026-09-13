import { beforeEach, describe, expect, it } from "vitest";
import { useInputCaptureStore } from "./use-input-capture-store";

function captured(): boolean {
  return useInputCaptureStore.getState().captors.size > 0;
}

beforeEach(() => {
  useInputCaptureStore.setState({ captors: new Set<string>() });
});

describe("default", () => {
  it("captures nothing when no modal or editor is mounted", () => {
    expect(captured()).toBe(false);
  });
});

describe("acquire", () => {
  it("captures input while one captor holds a token", () => {
    useInputCaptureStore.getState().acquire("modal-1");
    expect(captured()).toBe(true);
  });

  it("counts a repeated token once, so a re-registering captor cannot double-count", () => {
    useInputCaptureStore.getState().acquire("modal-1");
    useInputCaptureStore.getState().acquire("modal-1");
    expect(useInputCaptureStore.getState().captors.size).toBe(1);
  });
});

describe("release", () => {
  it("frees input once the last captor releases", () => {
    useInputCaptureStore.getState().acquire("modal-1");
    useInputCaptureStore.getState().release("modal-1");
    expect(captured()).toBe(false);
  });

  it("keeps input captured while another captor remains", () => {
    useInputCaptureStore.getState().acquire("modal-1");
    useInputCaptureStore.getState().acquire("modal-2");
    useInputCaptureStore.getState().release("modal-1");
    expect(captured()).toBe(true);
  });

  it("ignores a token that was never acquired", () => {
    useInputCaptureStore.getState().release("never-acquired");
    expect(captured()).toBe(false);
  });
});
