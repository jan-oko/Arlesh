import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockCommandFailsOnce, mockGestureProtocol } from "@/test/command-mock";
import { isWireError, getErrorMessage } from "./errors";
import { listInfos } from "./infos";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  mockGestureProtocol();
});

describe("isWireError", () => {
  it("accepts a well-formed wire error", () => {
    expect(isWireError({ kind: "not_found", message: "task 42 not found" })).toBe(true);
  });

  it("accepts a well-formed wire error carrying details", () => {
    expect(isWireError({ kind: "invalid_request", message: "bad input", details: { field: "title" } })).toBe(true);
  });

  it("rejects a plain string", () => {
    expect(isWireError("task 42 not found")).toBe(false);
  });

  it("rejects null", () => {
    expect(isWireError(null)).toBe(false);
  });

  it("rejects an object with an unknown kind", () => {
    expect(isWireError({ kind: "totally_made_up", message: "oops" })).toBe(false);
  });

  it("rejects an object with a non-string message", () => {
    expect(isWireError({ kind: "not_found", message: 42 })).toBe(false);
  });

  it("rejects a real Error instance", () => {
    expect(isWireError(new Error("task 42 not found"))).toBe(false);
  });
});

describe("getErrorMessage", () => {
  it("returns the message from a wire error", () => {
    expect(getErrorMessage({ kind: "not_found", message: "task 42 not found" })).toBe("task 42 not found");
  });

  it("returns the message from a real Error", () => {
    expect(getErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("stringifies anything else", () => {
    expect(getErrorMessage("boom")).toBe("boom");
  });

  it("stringifies null", () => {
    expect(getErrorMessage(null)).toBe("null");
  });

  it("stringifies undefined", () => {
    expect(getErrorMessage(undefined)).toBe("undefined");
  });

  it("returns the message from a plain object with a message but no kind", () => {
    // This is the shape a forward-compatible backend kind arrives as: not a
    // recognised WireError (no valid `kind`), not an Error instance, but
    // still carrying a usable message that should be shown rather than
    // falling through to "[object Object]".
    expect(getErrorMessage({ message: "x" })).toBe("x");
  });
});

describe("a rejected invoke", () => {
  it("surfaces a typed error the caller can read kind from", async () => {
    mockCommandFailsOnce({ kind: "not_found", message: "task 42 not found" });

    try {
      await listInfos();
      expect.fail("expected listInfos() to reject");
    } catch (err) {
      expect(isWireError(err)).toBe(true);
      if (isWireError(err)) {
        expect(err.kind).toBe("not_found");
      }
    }
  });
});
