import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { PUSH_TOKEN_EVENT, registerPush } from "@/api/push";
import { usePushRegistration } from "@/hooks/use-push-registration";
import { useClientModeStore } from "@/stores/use-client-mode-store";

vi.mock("@/api/push", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/push")>()),
  registerPush: vi.fn(() => Promise.resolve({ new: true })),
}));

const bridge = {
  available: vi.fn(() => true),
  allowed: vi.fn(() => true),
  requestPermission: vi.fn(),
  fetchToken: vi.fn(),
  openSettings: vi.fn(),
  takeOpenedTask: vi.fn(() => ""),
};

function asClient(mode: "client" | "standalone" = "client"): void {
  useClientModeStore.setState({
    status: { mode, first_run: false, api_version: 1, standalone_available: true, server: null },
  });
}

function hearToken(token: string): void {
  act(() => { window.dispatchEvent(new CustomEvent(PUSH_TOKEN_EVENT, { detail: token })); });
}

beforeEach(() => {
  vi.clearAllMocks();
  bridge.available.mockReturnValue(true);
  bridge.allowed.mockReturnValue(true);
  Reflect.set(window, "ArleshPush", bridge);
  asClient();
});
afterEach(() => {
  Reflect.deleteProperty(window, "ArleshPush");
  useClientModeStore.setState({ status: null });
});

describe("usePushRegistration", () => {
  it("asks for the token and registers it with the server", () => {
    renderHook(() => usePushRegistration());
    expect(bridge.fetchToken).toHaveBeenCalledTimes(1);

    hearToken("fcm-token");

    expect(registerPush).toHaveBeenCalledWith("fcm-token");
  });

  it("registers a token FCM rotates later", () => {
    renderHook(() => usePushRegistration());
    hearToken("first");
    hearToken("second");
    expect(vi.mocked(registerPush).mock.calls.map(([token]) => token)).toEqual(["first", "second"]);
  });

  it("does nothing while notifications are not allowed", () => {
    bridge.allowed.mockReturnValue(false);
    renderHook(() => usePushRegistration());
    hearToken("fcm-token");

    expect(bridge.fetchToken).not.toHaveBeenCalled();
    expect(registerPush).not.toHaveBeenCalled();
  });

  it("does nothing in Standalone mode, in a build without Firebase, or with no bridge", () => {
    asClient("standalone");
    renderHook(() => usePushRegistration());
    asClient();
    bridge.available.mockReturnValue(false);
    renderHook(() => usePushRegistration());
    Reflect.deleteProperty(window, "ArleshPush");
    renderHook(() => usePushRegistration());

    expect(bridge.fetchToken).not.toHaveBeenCalled();
  });
});
