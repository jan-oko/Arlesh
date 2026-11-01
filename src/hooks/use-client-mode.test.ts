import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useClientModeSync } from "./use-client-mode";
import { useClientModeStore } from "@/stores/use-client-mode-store";
import type { ServerStatus } from "@/api/client-mode";

let announce: ((status: ServerStatus) => void) | null = null;

vi.mock("@/api/client-mode", () => ({
  fetchModeStatus: vi.fn(() => Promise.resolve({
    mode: "client",
    first_run: false,
    api_version: 1,
    standalone_available: true,
    server: { url: "http://box", reachable: true, last_sync: null, read_only: null, server_api_version: 1 },
  })),
  onServerStatusChanged: vi.fn((onChange: (status: ServerStatus) => void) => {
    announce = onChange;
    return Promise.resolve(() => undefined);
  }),
}));

afterEach(() => useClientModeStore.setState({ status: null }));

describe("useClientModeSync", () => {
  it("reads the mode, then takes each status change the backend announces", async () => {
    renderHook(() => useClientModeSync());
    await waitFor(() => expect(useClientModeStore.getState().status?.mode).toBe("client"));

    announce?.({ url: "http://box", reachable: false, last_sync: null, read_only: "server_unreachable", server_api_version: 1 });

    expect(useClientModeStore.getState().status?.server?.read_only).toBe("server_unreachable");
  });
});
