import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { usePendingWrite } from "@/hooks/use-pending-write";
import type { ActionWrite } from "@/hooks/use-pending-write";
import { useClientModeStore } from "@/stores/use-client-mode-store";
import { usePendingWritesStore } from "@/stores/use-pending-writes-store";
import type { ModeStatus } from "@/api/client-mode";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const showToast = vi.fn();

function action(over: Partial<ActionWrite> = {}): ActionWrite {
  return {
    nodeId: "task-1", label: "rename", patch: { kind: "fields", fields: { title: "x" } },
    send: vi.fn(() => Promise.resolve({ outcome: "refused" as const, message: "no" })),
    refuseReadOnly: vi.fn(),
    ...over,
  };
}

function readOnly(reason: "server_unreachable" | null): ModeStatus {
  return {
    mode: "client", first_run: false, api_version: 1, standalone_available: false,
    server: { url: "http://server", reachable: reason === null, last_sync: null, read_only: reason, server_api_version: 1 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  usePendingWritesStore.getState().reset();
  useClientModeStore.setState({ status: null });
});

describe("usePendingWrite", () => {
  it("puts the write in the lane, with the toast wired to the caller's", async () => {
    const { result } = renderHook(() => usePendingWrite({ showToast }));
    const write = action();
    let enqueued = false;
    await act(async () => { enqueued = result.current(write); await Promise.resolve(); });
    expect(enqueued).toBe(true);
    expect(write.send).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith({ nodeId: "task-1", message: "no" });
  });

  it("refuses on a read-only board before anything is enqueued or patched", () => {
    useClientModeStore.setState({ status: readOnly("server_unreachable") });
    const { result } = renderHook(() => usePendingWrite({ showToast }));
    const write = action();
    let enqueued = true;
    act(() => { enqueued = result.current(write); });
    expect(enqueued).toBe(false);
    expect(write.refuseReadOnly).toHaveBeenCalledTimes(1);
    expect(write.send).not.toHaveBeenCalled();
    expect(usePendingWritesStore.getState().writes).toEqual([]);
  });
});
