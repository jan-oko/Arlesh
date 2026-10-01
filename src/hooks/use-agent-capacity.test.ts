import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useAgentCapacity, useAgentCapacitySync } from "./use-agent-capacity";
import { fetchAgentCapacity, onAgentCapacityChanged, setAgentCapacity } from "@/api/agent-capacity";
import type { AgentCapacityState } from "@/api/agent-capacity";
import { useAgentCapacityStore } from "@/stores/use-agent-capacity-store";

vi.mock("@/api/agent-capacity", () => ({
  fetchAgentCapacity: vi.fn(),
  setAgentCapacity: vi.fn(),
  onAgentCapacityChanged: vi.fn(),
}));

let announce: (state: AgentCapacityState) => void = () => {};
const unlisten = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  useAgentCapacityStore.setState({ atCapacity: false, error: null });
  vi.mocked(fetchAgentCapacity).mockResolvedValue({ at_capacity: true });
  vi.mocked(onAgentCapacityChanged).mockImplementation((onChange) => {
    announce = onChange;
    return Promise.resolve(unlisten);
  });
});

describe("useAgentCapacitySync", () => {
  it("reads the lock on mount", async () => {
    renderHook(() => useAgentCapacitySync());

    await waitFor(() => expect(useAgentCapacityStore.getState().atCapacity).toBe(true));
  });

  it("takes a change the backend announces, such as an agent clearing the lock", async () => {
    renderHook(() => useAgentCapacitySync());
    await waitFor(() => expect(useAgentCapacityStore.getState().atCapacity).toBe(true));

    act(() => announce({ at_capacity: false }));

    expect(useAgentCapacityStore.getState().atCapacity).toBe(false);
  });

  it("stops listening on unmount", async () => {
    const { unmount } = renderHook(() => useAgentCapacitySync());
    await waitFor(() => expect(onAgentCapacityChanged).toHaveBeenCalled());
    await waitFor(() => expect(useAgentCapacityStore.getState().atCapacity).toBe(true));

    unmount();

    expect(unlisten).toHaveBeenCalled();
  });

  it("records a failed read rather than throwing", async () => {
    vi.mocked(fetchAgentCapacity).mockRejectedValue(new Error("no backend"));

    renderHook(() => useAgentCapacitySync());

    await waitFor(() => expect(useAgentCapacityStore.getState().error).toBe("no backend"));
    expect(useAgentCapacityStore.getState().atCapacity).toBe(false);
  });
});

describe("useAgentCapacity", () => {
  it("sets the lock and keeps the state the backend answers", async () => {
    vi.mocked(setAgentCapacity).mockResolvedValue({ at_capacity: true });
    const { result } = renderHook(() => useAgentCapacity());

    await act(() => result.current.setAtCapacity(true));

    expect(setAgentCapacity).toHaveBeenCalledWith(true);
    expect(result.current.atCapacity).toBe(true);
  });

  it("keeps the old state and records the error when the set fails", async () => {
    vi.mocked(setAgentCapacity).mockRejectedValue(new Error("disk full"));
    const { result } = renderHook(() => useAgentCapacity());

    await act(() => result.current.setAtCapacity(true));

    expect(result.current.atCapacity).toBe(false);
    expect(result.current.error).toBe("disk full");
  });
});
