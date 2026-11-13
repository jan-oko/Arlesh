import { describe, expect, it } from "vitest";
import corpusJson from "@conformance/board-changes.json";
import { fail, record, str } from "@/test/conformance-board";
import type { MindmapLoad } from "@/api/mindmap";
import { COLLECTIONS, applyBoardChanges, digestOfJson, indexBoard, keyOf } from "@/utils/board-changes";
import type { BoardChanges, CollectionName } from "@/utils/board-changes";

/**
 * The board's entries, keys, digests and changes have two evaluators: the producer's, in Rust
 * (`crates/arlesh-core/src/mindmap/rules/changes.rs`), and this one. `conformance/board-changes.json`
 * writes cases down as the core's own text, and
 * `crates/arlesh-core/src/mindmap/rules/changes/tests.rs` is this file's other half.
 */

function collectionOf(name: string): CollectionName {
  const found = COLLECTIONS.find((collection) => collection === name);
  return found ?? fail(`not a collection: ${name}`);
}

function list(value: unknown, what: string): unknown[] {
  return Array.isArray(value) ? value : fail(`${what} is not an array`);
}

function num(value: unknown, what: string): number {
  return typeof value === "number" ? value : fail(`${what} is not a number`);
}

/** The corpus's boards are the core's own writing of `MindmapLoad`. */
function isLoad(value: unknown): value is MindmapLoad {
  return typeof value === "object" && value !== null && Array.isArray(Reflect.get(value, "tasks"));
}

function load(text: string): MindmapLoad {
  const parsed: unknown = JSON.parse(text);
  return isLoad(parsed) ? parsed : fail("a board is not a MindmapLoad");
}

function changes(text: string): BoardChanges {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null) fail("changes are not an object");
  return parsed;
}

/** One collection of a board, as a sorted list of each entry's text, so order is not compared. */
function multiset(board: MindmapLoad, collection: CollectionName): string[] {
  const held: unknown = board[collection];
  if (Array.isArray(held)) return held.map((row) => JSON.stringify(row)).sort();
  if (typeof held === "object" && held !== null) {
    return Object.entries(held).map(([key, value]) => `${key}=${JSON.stringify(value)}`).sort();
  }
  return [];
}

const top = record(corpusJson, "the corpus");
const entries = list(top.entries, "`entries`");
const cases = list(top.cases, "`cases`");

describe("board changes conformance corpus", () => {
  it("covers every collection", () => {
    const seen = new Set(entries.map((entry, index) => str(record(entry, `entries[${index}]`).collection, "collection")));
    expect([...seen].sort()).toEqual([...COLLECTIONS].sort());
  });

  entries.forEach((raw, index) => {
    const entry = record(raw, `entries[${index}]`);
    const collection = collectionOf(str(entry.collection, "collection"));
    const key = str(entry.key, "key");
    const json = str(entry.json, "json");

    it(`${collection} ${key}: its text survives a parse and a stringify, and its digest is the producer's`, () => {
      expect(JSON.stringify(JSON.parse(json))).toBe(json);
      expect(digestOfJson(collection, key, json)).toBe(num(entry.digest, "digest"));
    });

    it(`${collection} ${key}: its key is the one the producer computed`, () => {
      const value: unknown = JSON.parse(json);
      if (collection === "short_ids" || collection === "facts" || collection === "agent_activity") return;
      const row = collection === "block_reasons" || collection === "task_dependencies" ? list(value, "group")[0] : value;
      expect(keyOf(collection, row)).toBe(key);
    });
  });

  cases.forEach((raw, index) => {
    const one = record(raw, `cases[${index}]`);
    const name = str(one.name, "name");

    it(`${name}: applying the changes to the board before gives the board after, and its hash`, () => {
      const before = indexBoard(load(str(one.before_json, "before_json")));
      const after = load(str(one.after_json, "after_json"));

      const applied = applyBoardChanges(before, changes(str(one.changes_json, "changes_json")));

      expect(before.digests.total).toBe(num(one.hash_before, "hash_before"));
      expect(applied.digests.total).toBe(num(one.hash_after, "hash_after"));
      expect(applied.digests.total).toBe(indexBoard(after).digests.total);
      for (const collection of COLLECTIONS) {
        expect(multiset(applied.load, collection), `${name}: ${collection}`).toEqual(multiset(after, collection));
      }
    });
  });
});
