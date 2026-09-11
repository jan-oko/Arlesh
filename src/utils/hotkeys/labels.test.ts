import { describe, it, expect } from "vitest";
import en from "@/i18n/locales/en/hotkeys.json";
import he from "@/i18n/locales/he/hotkeys.json";
import { GLOBAL_BINDINGS } from "./global-bindings";
import { MINDMAP_BINDINGS } from "./mindmap-bindings";
import { LIST_BINDINGS } from "./list-bindings";
import type { BindingMeta } from "./chord";

const ALL: readonly BindingMeta[] = [...GLOBAL_BINDINGS, ...MINDMAP_BINDINGS, ...LIST_BINDINGS];

function hasKey(locale: Record<string, string>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(locale, key);
}

describe("hotkey labels", () => {
  it("every binding's label key exists in English", () => {
    const missing = ALL.filter((b) => !hasKey(en, b.labelKey)).map((b) => b.id);
    expect(missing).toEqual([]);
  });

  it("every binding's label key exists in Hebrew", () => {
    const missing = ALL.filter((b) => !hasKey(he, b.labelKey)).map((b) => b.id);
    expect(missing).toEqual([]);
  });

  it("the two locales define exactly the same keys", () => {
    expect(Object.keys(he).sort()).toEqual(Object.keys(en).sort());
  });

  it("every binding id is unique", () => {
    const ids = ALL.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
