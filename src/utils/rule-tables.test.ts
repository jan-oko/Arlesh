import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { RuleTables } from "@/api/rules";
import { loadRuleTables } from "@/api/rules";
import { mayParent, setRuleTables, takeOutLanding } from "./rule-tables";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const SERVED: RuleTables = {
  parenting: [
    { child: "task", parents: ["domain", "task"] },
    { child: "aspect", parents: [] },
  ],
  takeOut: [{ split: false, hasParent: true, lands: "parent" }],
};

describe("rule tables", () => {
  const before = vi.mocked(invoke);
  beforeEach(() => { before.mockReset(); });
  afterEach(() => { setRuleTables(null); });

  it("answers from the tables Rust served at start", async () => {
    before.mockResolvedValue(SERVED);

    await loadRuleTables();

    expect(before).toHaveBeenCalledWith("rule_tables");
    expect(mayParent("task", "task")).toBe(true);
    expect(mayParent("task", "aspect")).toBe(false);
    expect(mayParent("aspect", "domain")).toBe(false);
    expect(takeOutLanding(false, true)).toBe("parent");
  });

  it("refuses to answer before the tables are loaded rather than guess", () => {
    setRuleTables(null);

    expect(() => mayParent("task", "task")).toThrow();
  });

  it("fails loudly on a take-out case the table does not hold", () => {
    setRuleTables(SERVED);

    expect(() => takeOutLanding(true, true)).toThrow();
  });
});
