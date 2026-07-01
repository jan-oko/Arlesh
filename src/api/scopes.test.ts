import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  getScope,
  getOrCreateScope,
  getOrCreatePartScope,
  getOrCreateExactScope,
  resolveScope,
} from "./scopes";
import type { Scope, ResolvedScope } from "./scopes";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockScope: Scope = {
  id: 1,
  kind: "day",
  label: "2026-06-20",
  start_date: "2026-06-20",
  end_date: "2026-06-20",
  week_id: 2,
  month_id: 3,
  season_id: 4,
  day_id: null,
  part: null,
  start_datetime: null,
  end_datetime: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getScope", () => {
  it("calls invoke with get_scope and the id", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(mockScope);
    const result = await getScope(1);
    expect(invoke).toHaveBeenCalledWith("get_scope", { id: 1 });
    expect(result).toEqual(mockScope);
  });
});

describe("getOrCreateScope", () => {
  it("calls invoke with get_or_create_scope, the kind, and the date", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(mockScope);
    const result = await getOrCreateScope("week", "2026-06-20");
    expect(invoke).toHaveBeenCalledWith("get_or_create_scope", {
      kind: "week",
      date: "2026-06-20",
    });
    expect(result).toEqual(mockScope);
  });
});

describe("getOrCreatePartScope", () => {
  it("calls invoke with get_or_create_part_scope, the date, and the part", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(mockScope);
    await getOrCreatePartScope("2026-06-20", "morning");
    expect(invoke).toHaveBeenCalledWith("get_or_create_part_scope", {
      date: "2026-06-20",
      part: "morning",
    });
  });
});

describe("getOrCreateExactScope", () => {
  it("calls invoke with get_or_create_exact_scope and the two datetimes", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(mockScope);
    await getOrCreateExactScope("2026-06-20T09:30:00", "2026-06-22T14:00:00");
    expect(invoke).toHaveBeenCalledWith("get_or_create_exact_scope", {
      start: "2026-06-20T09:30:00",
      end: "2026-06-22T14:00:00",
    });
  });
});

describe("resolveScope", () => {
  it("calls invoke with resolve_scope and returns the resolved window", async () => {
    const resolved: ResolvedScope = {
      start: "2026-06-20T00:00:00",
      end: "2026-06-21T00:00:00",
      active: true,
    };
    vi.mocked(invoke).mockResolvedValueOnce(resolved);
    const result = await resolveScope(1);
    expect(invoke).toHaveBeenCalledWith("resolve_scope", { id: 1 });
    expect(result).toEqual(resolved);
  });
});
