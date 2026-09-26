import { describe, it, expect } from "vitest";
import corpusJson from "@conformance/scope-keys.json";
import type { ScopeKey } from "@/api/scopes";
import { scopeKeyFromText } from "@/utils/scope-key";
import { keyWindow, timeScopeWindowOf } from "@/utils/scope-window";

/**
 * The filter derives a scope's window on the client; the Rust `ScopeKey::bounds` is the other
 * derivation. Both replay the windows in `conformance/scope-keys.json`.
 */
describe("the shared scope-key corpus", () => {
  it.each(corpusJson.cases.map((item) => [item.text, item.window] as const))("windows %s", (text, window) => {
    const key = scopeKeyFromText(text);
    if (key === null) throw new Error(`unreadable corpus key ${text}`);
    expect(keyWindow(key)).toEqual(window);
  });
});

describe("timeScopeWindowOf", () => {
  it("runs from the start of the start boundary to the end of the end boundary", () => {
    const monday: ScopeKey = { kind: "day", date: "2026-09-21" };
    const nextWeek: ScopeKey = { kind: "week", date: "2026-09-27" };
    expect(timeScopeWindowOf({ start_id: monday, end_id: nextWeek })).toEqual({
      start: "2026-09-21T02:00:00", end: "2026-10-04T02:00:00",
    });
  });
});
