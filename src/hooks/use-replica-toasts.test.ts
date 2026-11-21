import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import "@/i18n";
import { useReplicaToasts } from "./use-replica-toasts";
import { useTabsStore } from "@/stores/use-tabs-store";
import { activeTabStores } from "@/hooks/use-system-back";
import type { ReplicaDropped } from "@/api/replica";

let drop: ((dropped: ReplicaDropped) => void) | null = null;
const unlisten = vi.fn();

vi.mock("@/api/replica", () => ({
  listenReplicaDropped: vi.fn((handler: (dropped: ReplicaDropped) => void) => {
    drop = handler;
    return Promise.resolve(unlisten);
  }),
}));

function toast(): string | undefined {
  return activeTabStores()?.mindmap.getState().pendingToast?.message;
}

afterEach(() => {
  activeTabStores()?.mindmap.getState().clearToast();
  drop = null;
  unlisten.mockClear();
});

describe("useReplicaToasts", () => {
  it("says once that changes the server refused were taken back", async () => {
    renderHook(() => useReplicaToasts());
    await waitFor(() => expect(drop).not.toBeNull());
    drop?.({ count: 2, reason: "refused" });
    expect(toast()).toBe("2 changes the server refused were taken back");
  });

  it("says that a single change could not be sent when the server cannot be reached", async () => {
    renderHook(() => useReplicaToasts());
    await waitFor(() => expect(drop).not.toBeNull());
    drop?.({ count: 1, reason: "unreachable" });
    expect(toast()).toBe("1 change could not be sent: the server cannot be reached");
  });

  it("stops listening when unmounted", async () => {
    const { unmount } = renderHook(() => useReplicaToasts());
    await waitFor(() => expect(drop).not.toBeNull());
    unmount();
    await waitFor(() => expect(unlisten).toHaveBeenCalled());
    expect(useTabsStore.getState().tabs.length).toBeGreaterThan(0);
  });
});
