import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useNotificationSwitches } from "./use-notification-switches";

vi.mock("@/api/notifications", () => ({
  notificationSwitches: vi.fn(),
  setNotificationEnabled: vi.fn(),
}));

import { notificationSwitches, setNotificationEnabled } from "@/api/notifications";

describe("useNotificationSwitches", () => {
  beforeEach(() => {
    vi.mocked(notificationSwitches).mockResolvedValue([
      { channel: "agent_question", enabled: true },
      { channel: "task_overdue", enabled: true },
    ]);
    vi.mocked(setNotificationEnabled).mockResolvedValue(undefined);
  });

  it("lists the switches the backend keeps", async () => {
    const { result } = renderHook(() => useNotificationSwitches());
    await waitFor(() => { expect(result.current.switches).toHaveLength(2); });
  });

  it("saves a switch and shows it changed", async () => {
    const { result } = renderHook(() => useNotificationSwitches());
    await waitFor(() => { expect(result.current.switches).not.toBeNull(); });

    act(() => { result.current.toggle("task_overdue", false); });

    await waitFor(() => {
      expect(result.current.switches?.find((s) => s.channel === "task_overdue")?.enabled).toBe(false);
    });
    expect(setNotificationEnabled).toHaveBeenCalledWith("task_overdue", false);
  });

  it("keeps a switch as it was, and says why, when saving fails", async () => {
    vi.mocked(setNotificationEnabled).mockRejectedValue(new Error("disk full"));
    const { result } = renderHook(() => useNotificationSwitches());
    await waitFor(() => { expect(result.current.switches).not.toBeNull(); });

    act(() => { result.current.toggle("agent_question", false); });

    await waitFor(() => { expect(result.current.error).not.toBeNull(); });
    expect(result.current.switches?.find((s) => s.channel === "agent_question")?.enabled).toBe(true);
  });
});
