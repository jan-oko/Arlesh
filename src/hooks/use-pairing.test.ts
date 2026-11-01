import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { POLL_MS, usePairing } from "./use-pairing";
import { pairPoll, pairStart } from "@/api/devices";

vi.mock("@/api/devices", () => ({
  pairStart: vi.fn(),
  pairPoll: vi.fn(),
  errorReason: (error: unknown) => {
    if (typeof error !== "object" || error === null) return null;
    const details = Reflect.get(error, "details");
    return typeof details === "object" && details !== null && typeof Reflect.get(details, "reason") === "string"
      ? String(Reflect.get(details, "reason"))
      : null;
  },
}));

const STARTED = { id: "secret", pin: "123456", name: "phone", expires_at: "x" };

function refusal(reason: string) {
  return { kind: "not_found", message: `refused: ${reason}`, details: { reason } };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(pairStart).mockResolvedValue(STARTED);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function begin(onApproved = vi.fn()) {
  const hook = renderHook(() => usePairing(onApproved));
  await act(async () => { await hook.result.current.start("http://box", "phone"); });
  return { hook, onApproved };
}

describe("usePairing", () => {
  it("shows the PIN and asks again every few seconds while it is pending", async () => {
    vi.mocked(pairPoll).mockResolvedValue({ status: "pending", name: null, token: null });
    const { hook } = await begin();
    expect(hook.result.current.state).toEqual({ phase: "waiting", pin: "123456" });

    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS * 3); });

    expect(pairPoll).toHaveBeenCalledTimes(3);
    expect(pairPoll).toHaveBeenCalledWith("http://box", "secret", "123456");
  });

  it("hands over the token once, and stops polling", async () => {
    vi.mocked(pairPoll).mockResolvedValue({ status: "approved", name: "phone", token: "tok" });
    const { onApproved } = await begin();

    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS * 4); });

    expect(onApproved).toHaveBeenCalledTimes(1);
    expect(onApproved).toHaveBeenCalledWith("tok", "http://box");
    expect(pairPoll).toHaveBeenCalledTimes(1);
  });

  it("keeps polling through a network failure", async () => {
    vi.mocked(pairPoll)
      .mockRejectedValueOnce(refusal("server_unreachable"))
      .mockResolvedValueOnce({ status: "approved", name: "phone", token: "tok" });
    const { onApproved } = await begin();

    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS * 2); });

    expect(onApproved).toHaveBeenCalledWith("tok", "http://box");
  });

  it("stops and says so when the PIN lapsed or was invalidated", async () => {
    vi.mocked(pairPoll).mockRejectedValue(refusal("unknown_pairing"));
    const { hook } = await begin();

    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS * 3); });

    expect(hook.result.current.state).toMatchObject({ phase: "failed", reason: "unknown_pairing" });
    expect(pairPoll).toHaveBeenCalledTimes(1);
  });

  it("reports a failure to connect with the token it received", async () => {
    vi.mocked(pairPoll).mockResolvedValue({ status: "approved", name: "phone", token: "tok" });
    const { hook } = await begin(vi.fn().mockRejectedValue(new Error("no keychain")));

    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS); });

    expect(hook.result.current.state).toMatchObject({ phase: "failed", message: "no keychain" });
  });

  it("stops polling when cancelled", async () => {
    vi.mocked(pairPoll).mockResolvedValue({ status: "pending", name: null, token: null });
    const { hook } = await begin();

    act(() => hook.result.current.cancel());
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS * 3); });

    expect(pairPoll).not.toHaveBeenCalled();
    expect(hook.result.current.state).toEqual({ phase: "idle" });
  });

  it("reports a server that refuses to start a pairing", async () => {
    vi.mocked(pairStart).mockRejectedValue(refusal("rate_limited"));
    const hook = renderHook(() => usePairing(vi.fn()));

    await act(async () => { await hook.result.current.start("http://box", "phone"); });

    expect(hook.result.current.state).toMatchObject({ phase: "failed", reason: "rate_limited" });
  });
});
