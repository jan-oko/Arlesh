import { describe, it, expect } from "vitest";
import { mergePersistedFilterSlice } from "./persist-merge";

interface Defaults {
  a: string;
  b: number;
}

const defaults: Defaults = { a: "default-a", b: 1 };

describe("mergePersistedFilterSlice", () => {
  it("returns defaults when there is nothing persisted yet", () => {
    expect(mergePersistedFilterSlice(undefined, defaults)).toEqual(defaults);
  });

  it("returns defaults when the persisted blob has no filter key", () => {
    expect(mergePersistedFilterSlice({}, defaults)).toEqual(defaults);
  });

  it("returns defaults when the persisted filter itself is not an object", () => {
    expect(mergePersistedFilterSlice({ filter: null }, defaults)).toEqual(defaults);
  });

  it("backfills a field missing from an older persisted shape from defaults (the reported bug)", () => {
    // Simulates a user's localStorage blob saved before a new field (e.g. `archivedMode`) existed.
    const oldPersisted = { filter: { a: "kept-a" } };
    expect(mergePersistedFilterSlice(oldPersisted, defaults)).toEqual({ a: "kept-a", b: 1 });
  });

  it("lets every persisted field override its default, including a value equal to the default", () => {
    const persisted = { filter: { a: "kept-a", b: 42 } };
    expect(mergePersistedFilterSlice(persisted, defaults)).toEqual({ a: "kept-a", b: 42 });
  });
});
