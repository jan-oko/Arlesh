import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { mockCommandOnce, mockGestureProtocol } from "@/test/command-mock";
import {
  exactScope,
  getScope,
  partScope,
  resolveScope,
  scopeContaining,
  scopeForRef,
} from "./scopes";
import type { Scope, ResolvedScope } from "./scopes";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockScope: Scope = {
  id: "day:2026-06-20",
  kind: "day",
  label: "2026-06-20",
  start_date: "2026-06-20",
  end_date: "2026-06-20",
  part: null,
  start_datetime: null,
  end_datetime: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGestureProtocol();
});

describe("getScope", () => {
  it("calls invoke with get_scope and the key", async () => {
    mockCommandOnce(mockScope);
    const result = await getScope("day:2026-06-20");
    expect(invoke).toHaveBeenCalledWith("get_scope", { id: "day:2026-06-20" });
    expect(result).toEqual(mockScope);
  });
});

describe("scopeContaining", () => {
  it("calls invoke with scope_containing, the kind, and the date", async () => {
    mockCommandOnce(mockScope);
    const result = await scopeContaining("week", "2026-06-20");
    expect(invoke).toHaveBeenCalledWith("scope_containing", {
      kind: "week",
      date: "2026-06-20",
    });
    expect(result).toEqual(mockScope);
  });
});

describe("partScope", () => {
  it("calls invoke with part_scope, the date, and the part", async () => {
    mockCommandOnce(mockScope);
    await partScope("2026-06-20", "morning");
    expect(invoke).toHaveBeenCalledWith("part_scope", {
      date: "2026-06-20",
      part: "morning",
    });
  });
});

describe("exactScope", () => {
  it("calls invoke with exact_scope and the two datetimes", async () => {
    mockCommandOnce(mockScope);
    await exactScope("2026-06-20T09:30:00", "2026-06-22T14:00:00");
    expect(invoke).toHaveBeenCalledWith("exact_scope", {
      start: "2026-06-20T09:30:00",
      end: "2026-06-22T14:00:00",
    });
  });
});

describe("scopeForRef", () => {
  it("reads a canonical cell through scope_containing and a band through part_scope", async () => {
    mockCommandOnce(mockScope);
    await scopeForRef({ kind: "week", date: "2026-06-20" });
    expect(invoke).toHaveBeenCalledWith("scope_containing", { kind: "week", date: "2026-06-20" });
    mockCommandOnce(mockScope);
    await scopeForRef({ kind: "part_of_day", date: "2026-06-20", part: "night" });
    expect(invoke).toHaveBeenCalledWith("part_scope", { date: "2026-06-20", part: "night" });
  });

  it("refuses an exact window, which is no calendar cell", async () => {
    await expect(
      scopeForRef({ kind: "exact", start: "2026-06-20T09:30:00", end: "2026-06-20T10:00:00" }),
    ).rejects.toThrow();
  });
});

describe("resolveScope", () => {
  it("calls invoke with resolve_scope and returns the resolved window", async () => {
    const resolved: ResolvedScope = {
      start: "2026-06-20T02:00:00",
      end: "2026-06-21T02:00:00",
      active: true,
    };
    mockCommandOnce(resolved);
    const result = await resolveScope("day:2026-06-20");
    expect(invoke).toHaveBeenCalledWith("resolve_scope", { id: "day:2026-06-20" });
    expect(result).toEqual(resolved);
  });
});
