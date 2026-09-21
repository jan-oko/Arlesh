import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBeadsIdClear } from "./use-beads-id-clear";

describe("useBeadsIdClear", () => {
  it("stages nothing until the × is pressed, and commits nothing either", async () => {
    const onClearBeadsId = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useBeadsIdClear(onClearBeadsId));

    expect(result.current.isCleared).toBe(false);
    await act(async () => {
      await result.current.commitClear();
    });

    expect(onClearBeadsId).not.toHaveBeenCalled();
  });

  it("marks the row cleared on the ×, but still writes nothing", () => {
    const onClearBeadsId = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useBeadsIdClear(onClearBeadsId));

    act(() => result.current.stageClear?.());

    expect(result.current.isCleared).toBe(true);
    expect(onClearBeadsId).not.toHaveBeenCalled();
  });

  it("performs the staged clear once, when the save commits it", async () => {
    const onClearBeadsId = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useBeadsIdClear(onClearBeadsId));

    act(() => result.current.stageClear?.());
    await act(async () => {
      await result.current.commitClear();
    });

    expect(onClearBeadsId).toHaveBeenCalledTimes(1);
  });

  it("propagates a refusal, so the save reports it and does not close on it", async () => {
    const onClearBeadsId = vi.fn().mockRejectedValue(new Error('domain 4 has subtype "tag"'));
    const { result } = renderHook(() => useBeadsIdClear(onClearBeadsId));

    act(() => result.current.stageClear?.());

    await expect(result.current.commitClear()).rejects.toThrow('domain 4 has subtype "tag"');
    // A staged clear that did not land stays staged: pressing Save again retries it.
    expect(result.current.isCleared).toBe(true);
  });

  it("offers no × where the editor has no clear on offer", () => {
    const { result } = renderHook(() => useBeadsIdClear(undefined));

    expect(result.current.stageClear).toBeUndefined();
  });
});
